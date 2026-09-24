import { Locator } from "@ambra/engine";
import type { ContentDocumentView, LocatorResolver } from "@ambra/engine";
import type { Highlight } from "../library/LibraryDatabase.js";
import { applyActiveHighlightRange, applyHighlightRanges, applySearchMatchRanges } from "./HighlightRenderer.js";
import type { HighlightRangeEntry } from "./HighlightOverlap.js";
import { findTextRangesInDocument } from "./findTextRangesInDocument.js";
import type { ActiveHighlightState, NoteMarkerState, SelectionToolbarState } from "./ReaderTypes.js";

/** What `HighlightInteraction` needs from `ReaderController`.
 * `activeHighlight`/`selectionToolbar`/`pendingSelectionRange` stay
 * owned by `ReaderController` (other things touch them too — e.g.
 * every page turn clears `activeHighlight`). */
export interface HighlightInteractionContext {
  isFixedLayoutHost(): boolean;
  contentDocuments(): readonly ContentDocumentView[];
  forSpineIndex(spineIndex: number): readonly Highlight[] | undefined;
  currentSearchHighlightQuery(): string | undefined;
  /** Whichever highlight's popup is currently open, if any — read (not
   * owned) here purely to paint its own distinct "selected" emphasis
   * (issue #113's follow-up); `ReaderController` remains the single
   * place that actually sets it, on every path that opens or closes a
   * highlight's popup. */
  getActiveHighlight(): ActiveHighlightState | undefined;
  setPendingSelectionRange(range: Range | undefined): void;
  setSelectionToolbar(state: SelectionToolbarState | undefined): void;
  setActiveHighlight(state: ActiveHighlightState | undefined): void;
  notify(): void;
}

/** Paints highlights and the live search-match spotlight into the
 * content document(s), and handles the interaction depending on that
 * painted content: selection tracking, click hit-testing, and note
 * marker positions. `HighlightManager` owns highlight data (the cache
 * and CRUD); this owns everything needing live host/document access. */
export class HighlightInteraction {
  /** On-page note-marker badges — see `ReaderSnapshot.noteMarkers`.
   * Field named `markers` so the public getter can be `noteMarkers`. */
  private markers: NoteMarkerState[] = [];
  private cleanup: (() => void) | undefined;

  constructor(
    private readonly locatorResolver: LocatorResolver,
    private readonly ctx: HighlightInteractionContext,
  ) {}

  public get noteMarkers(): readonly NoteMarkerState[] {
    return this.markers;
  }

  /** Resolves `spineIndex`'s highlights into `{ style, range }` entries
   * and paints them via `applyHighlightRanges`, which handles grouping
   * (and blending any overlaps — issue #113) itself. A highlight whose
   * CFI fails to resolve is skipped rather than failing the batch.
   * No-op for fixed-layout content. */
  private applyHighlightsToDocument(doc: Document, spineIndex: number): void {
    const highlights = this.ctx.forSpineIndex(spineIndex);
    const entries: HighlightRangeEntry[] = [];
    if (highlights) {
      for (const highlight of highlights) {
        const range = this.resolveHighlightRange(highlight, spineIndex, doc);
        if (range) {
          entries.push({ style: highlight.style, range });
        }
      }
    }
    applyHighlightRanges(doc, entries);
  }

  /** Each document owns its spine identity, including cross-chapter spreads. */
  public applyHighlightsToCurrentHost(): void {
    if (this.ctx.isFixedLayoutHost()) {
      return;
    }
    for (const { document, spineIndex } of this.ctx.contentDocuments()) {
      this.applyHighlightsToDocument(document, spineIndex);
    }
    this.applySearchHighlightToCurrentHost();
    this.applyActiveHighlightOverlay();
    this.updateNoteMarkers();
  }

  /** Clear emphasis on other spine items as well as painting the active one. */
  public applyActiveHighlightOverlay(): void {
    if (this.ctx.isFixedLayoutHost()) {
      return;
    }
    const active = this.ctx.getActiveHighlight();
    for (const { document: doc, spineIndex } of this.ctx.contentDocuments()) {
      const range =
        active && active.highlight.spineIndex === spineIndex
          ? this.resolveHighlightRange(active.highlight, spineIndex, doc)
          : undefined;
      applyActiveHighlightRange(doc, range, active?.highlight.style);
    }
  }

  /** Re-scans every content document the current host owns for
   * occurrences of the live search query and paints them via a
   * dedicated search-match `::highlight()` (issue #100) — separate
   * from `applyHighlightsToDocument`'s persisted highlights, since this
   * is transient and keyed off the query, not a spine index. No-op for
   * fixed-layout content. */
  public applySearchHighlightToCurrentHost(): void {
    if (this.ctx.isFixedLayoutHost()) {
      return;
    }
    for (const { document: doc } of this.ctx.contentDocuments()) {
      this.applySearchHighlightToDocument(doc);
    }
  }

  private applySearchHighlightToDocument(doc: Document): void {
    const query = this.ctx.currentSearchHighlightQuery();
    applySearchMatchRanges(doc, query ? findTextRangesInDocument(doc, query) : []);
  }

  /** Recomputes `noteMarkers` — one marker per highlight with a note,
   * anchored at the top-right of its last visible client rect. Called
   * on repaint, on note add/remove, on resize, and (continuous-scroll
   * mode) on scroll, since content can move without any other event
   * firing. */
  public updateNoteMarkers(): void {
    if (this.ctx.isFixedLayoutHost()) {
      this.markers = [];
      return;
    }
    const markers: NoteMarkerState[] = [];
    const resolveForDoc = (doc: Document, spineIndex: number): void => {
      const iframeEl = doc.defaultView?.frameElement as HTMLIFrameElement | null | undefined;
      const highlights = this.ctx.forSpineIndex(spineIndex);
      if (!iframeEl || !highlights) {
        return;
      }
      const iframeRect = iframeEl.getBoundingClientRect();
      const bounds = HighlightInteraction.visiblePageBounds(iframeEl, iframeRect.height);
      for (const highlight of highlights) {
        if (highlight.note === undefined) {
          continue;
        }
        const range = this.resolveHighlightRange(highlight, spineIndex, doc);
        if (!range) {
          continue;
        }
        // A highlight can span onto an adjacent (currently off-page)
        // line, so `getClientRects()` can include off-page rects too —
        // keep only the last rect within the visible band, and skip
        // the highlight if none of its rects are (issue #99).
        let lastVisibleRect: DOMRect | undefined;
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.bottom > bounds.top && rect.top < bounds.bottom) {
            lastVisibleRect = rect;
          }
        }
        if (!lastVisibleRect) {
          continue;
        }
        markers.push({
          id: highlight.id,
          left: iframeRect.left + lastVisibleRect.right,
          top: iframeRect.top + Math.min(Math.max(lastVisibleRect.top, bounds.top), bounds.bottom),
        });
      }
    };
    for (const { document, spineIndex } of this.ctx.contentDocuments()) {
      resolveForDoc(document, spineIndex);
    }
    this.markers = markers;
  }

  /** The current page's visible vertical band, read off the iframe's
   * `clip-path` (set by `PaginatedContentHost.showCurrentPage`) —
   * falls back to the iframe's full box when there's no `clip-path`
   * (continuous-scroll mode, or mid page-turn-animation). */
  private static visiblePageBounds(iframeEl: HTMLIFrameElement, iframeHeight: number): { top: number; bottom: number } {
    const clipPath = iframeEl.style.clipPath;
    const numbers = Array.from(clipPath.matchAll(/(-?[\d.]+)px/g)).map((m) => Number(m[1]));
    if (numbers.length === 0) {
      return { top: 0, bottom: iframeHeight };
    }
    // 1-value: all sides equal. 2-value: [top/bottom, right/left].
    // 3-value: [top, right/left, bottom]. 4-value: [top, right, bottom, left].
    const top = numbers[0]!;
    const bottom = numbers.length === 1 ? numbers[0]! : numbers.length === 2 ? numbers[0]! : numbers[2]!;
    return { top, bottom: iframeHeight - bottom };
  }

  private static visibleSelectionRect(range: Range, iframeEl: HTMLIFrameElement): {
    left: number; right: number; top: number; bottom: number;
  } | undefined {
    const frame = iframeEl.getBoundingClientRect();
    const viewport = iframeEl.ownerDocument.defaultView;
    if (!viewport) return undefined;
    const page = HighlightInteraction.visiblePageBounds(iframeEl, frame.height);
    const bounds = {
      left: Math.max(0, -frame.left),
      right: Math.min(frame.width, viewport.innerWidth - frame.left),
      top: Math.max(page.top, -frame.top),
      bottom: Math.min(page.bottom, viewport.innerHeight - frame.top),
    };
    let visible: { left: number; right: number; top: number; bottom: number } | undefined;
    // The body contains the whole chapter, including text translated outside
    // this page. Its selection's bounding box can span entirely hidden lines.
    for (const rect of Array.from(range.getClientRects())) {
      const left = Math.max(rect.left, bounds.left);
      const right = Math.min(rect.right, bounds.right);
      const top = Math.max(rect.top, bounds.top);
      const bottom = Math.min(rect.bottom, bounds.bottom);
      if (right <= left || bottom <= top) continue;
      visible = visible
        ? {
          left: Math.min(visible.left, left), right: Math.max(visible.right, right),
          top: Math.min(visible.top, top), bottom: Math.max(visible.bottom, bottom),
        }
        : { left, right, top, bottom };
    }
    return visible;
  }

  /** Off-page native ranges are retained for accessibility, but aren't
   * visible UI that a page-turning click needs to dismiss. */
  public hasVisibleSelection(doc: Document): boolean {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    // Fixed-layout frames have their own scaled coordinate space.
    if (this.ctx.isFixedLayoutHost()) return true;
    const frame = doc.defaultView?.frameElement as HTMLIFrameElement | null | undefined;
    return !frame || !!HighlightInteraction.visibleSelectionRect(selection.getRangeAt(0), frame);
  }

  private resolveHighlightRange(highlight: Highlight, spineIndex: number, doc: Document): Range | undefined {
    try {
      const start = this.locatorResolver.resolveInDocument(new Locator(highlight.startCfi), spineIndex, doc);
      const end = this.locatorResolver.resolveInDocument(new Locator(highlight.endCfi), spineIndex, doc);
      const range = doc.createRange();
      range.setStart(start.node, start.characterOffset ?? 0);
      range.setEnd(end.node, end.characterOffset ?? 0);
      return range;
    } catch {
      return undefined;
    }
  }

  /** Detaches whatever listeners `setUpHighlightSelection` last
   * attached. */
  public teardownSelection(): void {
    this.cleanup?.();
    this.cleanup = undefined;
  }

  /** Attaches selection tracking to every content document the current
   * host has: on `pointerup`/`keyup`, updates `selectionToolbar` to
   * show/hide a floating highlight-color picker over the selection.
   * No-op for fixed-layout content.
   *
   * Click-drag text selection in single-column paginated mode is
   * untested end-to-end: that mode's own drag-based page-turn gesture
   * attaches pointermove handling to the same document, and a synthetic
   * drag-select there hung the test browser during manual testing
   * (same category as issue #15's iframe-drag hang) — avoid poking at
   * that combination without care. Double-click word selection is
   * unaffected and covers the common case. */
  public setUpHighlightSelection(): void {
    this.teardownSelection();
    if (this.ctx.isFixedLayoutHost()) {
      return;
    }
    const documents = this.ctx.contentDocuments().map(view => view.document);
    if (documents.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];
    let selectionDocument: Document | undefined;
    for (const doc of documents) {
      const iframeEl = doc.defaultView?.frameElement as HTMLIFrameElement | null | undefined;
      if (!iframeEl) {
        continue;
      }

      const updateFromSelection = (): boolean => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          selectionDocument = undefined;
          this.ctx.setPendingSelectionRange(undefined);
          this.ctx.setSelectionToolbar(undefined);
          return false;
        }
        const range = selection.getRangeAt(0);
        const rangeRect = HighlightInteraction.visibleSelectionRect(range, iframeEl);
        if (!rangeRect) {
          // Preserve native/assistive-technology selections, but never offer
          // annotation actions for text the reader cannot see.
          selectionDocument = undefined;
          this.ctx.setPendingSelectionRange(undefined);
          this.ctx.setSelectionToolbar(undefined);
          return true;
        }
        const iframeRect = iframeEl.getBoundingClientRect();
        selectionDocument = doc;
        this.ctx.setPendingSelectionRange(range.cloneRange());
        this.ctx.setSelectionToolbar({
          left: iframeRect.left + (rangeRect.left + rangeRect.right) / 2,
          top: iframeRect.top + rangeRect.top,
        });
        return true;
      };

      const onPointerUp = (event: PointerEvent): void => {
        const hasSelection = updateFromSelection();
        if (!hasSelection) {
          // Only a caret click, not a hidden selection, can open an
          // existing highlight's popup (issue #48).
          this.checkExistingHighlightClick(doc, iframeEl, event.clientX, event.clientY);
        } else {
          this.ctx.setActiveHighlight(undefined);
        }
        this.ctx.notify();
      };
      const onKeyUp = (): void => {
        updateFromSelection();
        this.ctx.notify();
      };

      // Reposition existing UI without opening a toolbar during native
      // selection autoscroll.
      let scrollAnimationFrame: number | undefined;
      const onScroll = (): void => {
        if (scrollAnimationFrame !== undefined) {
          return;
        }
        scrollAnimationFrame = requestAnimationFrame(() => {
          scrollAnimationFrame = undefined;
          if (selectionDocument === doc) updateFromSelection();
          this.updateNoteMarkers();
          this.ctx.notify();
        });
      };

      doc.addEventListener("pointerup", onPointerUp);
      doc.addEventListener("keyup", onKeyUp);
      doc.addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => {
        doc.removeEventListener("pointerup", onPointerUp);
        doc.removeEventListener("keyup", onKeyUp);
        doc.removeEventListener("scroll", onScroll);
        if (scrollAnimationFrame !== undefined) {
          cancelAnimationFrame(scrollAnimationFrame);
        }
      });
    }
    this.cleanup = () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  /** Finds whichever highlight (if any) covers the document position at
   * `(clientX, clientY)`, via `caretRangeFromPoint` — the CSS Custom
   * Highlight API used to paint highlights has no hit-testing of its
   * own. Also used by `handleContentClick` (issue #62) so a highlight
   * click doesn't also turn the page underneath it. */
  public findHighlightAtPoint(doc: Document, clientX: number, clientY: number): Highlight | undefined {
    const view = this.ctx.contentDocuments().find(view => view.document === doc);
    if (!view) return undefined;
    const highlights = this.ctx.forSpineIndex(view.spineIndex);
    const caretRangeFromPoint = (
      doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    ).caretRangeFromPoint;
    if (!highlights || highlights.length === 0 || !caretRangeFromPoint) {
      return undefined;
    }
    const caretRange = caretRangeFromPoint.call(doc, clientX, clientY);
    if (!caretRange) {
      return undefined;
    }
    for (const highlight of highlights) {
      const range = this.resolveHighlightRange(highlight, view.spineIndex, doc);
      if (!range) {
        continue;
      }
      try {
        if (range.comparePoint(caretRange.startContainer, caretRange.startOffset) !== 0) {
          continue;
        }
      } catch {
        continue;
      }
      return highlight;
    }
    return undefined;
  }

  /** Opens `activeHighlight` for an existing highlight tapped/clicked
   * while reading (issue #48), or clears it if the click missed. */
  private checkExistingHighlightClick(doc: Document, iframeEl: Element, clientX: number, clientY: number): void {
    const highlight = this.findHighlightAtPoint(doc, clientX, clientY);
    if (!highlight) {
      this.ctx.setActiveHighlight(undefined);
      return;
    }
    const range = this.resolveHighlightRange(highlight, highlight.spineIndex, doc);
    const iframeRect = iframeEl.getBoundingClientRect();
    this.ctx.setActiveHighlight({
      highlight,
      left: iframeRect.left + clientX,
      top: iframeRect.top + (range?.getBoundingClientRect().top ?? clientY),
    });
  }

  /** Hides the selection toolbar and clears the native text selection
   * on every content document. */
  public dismissSelectionToolbar(): void {
    for (const { document: doc } of this.ctx.contentDocuments()) {
      doc.getSelection()?.removeAllRanges();
    }
    this.ctx.setPendingSelectionRange(undefined);
    this.ctx.setSelectionToolbar(undefined);
    this.ctx.notify();
  }

  public dismissActiveHighlight(): void {
    this.ctx.setActiveHighlight(undefined);
    this.ctx.notify();
  }

  /** Opens `activeHighlight` for a highlight with an on-page note
   * marker (issue #99), reusing the marker's own position as the
   * anchor. */
  public openHighlightPopup(id: string): void {
    const marker = this.markers.find((candidate) => candidate.id === id);
    const highlight = this.ctx.contentDocuments()
      .flatMap(view => this.ctx.forSpineIndex(view.spineIndex) ?? [])
      .find(candidate => candidate.id === id);
    if (!marker || !highlight) {
      return;
    }
    this.ctx.setActiveHighlight({ highlight, left: marker.left, top: marker.top });
    this.ctx.notify();
  }
}
