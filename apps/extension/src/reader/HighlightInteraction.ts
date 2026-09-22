import { Locator } from "@ambra/engine";
import type { LocatorResolver } from "@ambra/engine";
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
  spineIndex(): number;
  isFixedLayoutHost(): boolean;
  allContentDocuments(): Document[];
  /** The previous spine item's merged-tail document borrowed into the
   * current spread, or `undefined` if not showing one. */
  mergedTailDocument(): Document | undefined;
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

  /** Applies highlights to every content document the current host
   * owns. A merged spread's borrowed tail document belongs to the
   * *previous* spine item (`spineIndex() - 1`), not the current one —
   * `applyHighlightRanges` replaces a document's whole registry per
   * call, so applying the wrong index there would blank out highlights
   * already showing on it. */
  public applyHighlightsToCurrentHost(): void {
    if (this.ctx.isFixedLayoutHost()) {
      return;
    }
    const tailDoc = this.ctx.mergedTailDocument();
    if (tailDoc) {
      this.applyHighlightsToDocument(tailDoc, this.ctx.spineIndex() - 1);
    }
    for (const doc of this.ctx.allContentDocuments()) {
      if (doc === tailDoc) {
        continue;
      }
      this.applyHighlightsToDocument(doc, this.ctx.spineIndex());
    }
    this.applySearchHighlightToCurrentHost();
    this.applyActiveHighlightOverlay();
    this.updateNoteMarkers();
  }

  /** Re-paints (or clears) the "this highlight's popup is open" emphasis
   * (issue #113's follow-up) across every content document the current
   * host owns, the same tail/primary-document split
   * `applyHighlightsToDocument` uses — a highlight only ever belongs to
   * *one* spine item, so every document *except* the one matching its
   * own `spineIndex` gets the emphasis cleared rather than left
   * showing a stale one from before. Called both by
   * `applyHighlightsToCurrentHost` (so a full repaint — page turn,
   * font-size change, etc. — never leaves this out of sync) and
   * directly by `ReaderController` every time `activeHighlight` itself
   * changes (opening/closing a popup doesn't otherwise trigger a full
   * highlight repaint, and shouldn't need to just for this). */
  public applyActiveHighlightOverlay(): void {
    if (this.ctx.isFixedLayoutHost()) {
      return;
    }
    const active = this.ctx.getActiveHighlight();
    const applyToDoc = (doc: Document, spineIndex: number): void => {
      const range =
        active && active.highlight.spineIndex === spineIndex
          ? this.resolveHighlightRange(active.highlight, spineIndex, doc)
          : undefined;
      applyActiveHighlightRange(doc, range, active?.highlight.style);
    };
    const tailDoc = this.ctx.mergedTailDocument();
    if (tailDoc) {
      applyToDoc(tailDoc, this.ctx.spineIndex() - 1);
    }
    for (const doc of this.ctx.allContentDocuments()) {
      if (doc === tailDoc) {
        continue;
      }
      applyToDoc(doc, this.ctx.spineIndex());
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
    const tailDoc = this.ctx.mergedTailDocument();
    if (tailDoc) {
      this.applySearchHighlightToDocument(tailDoc);
    }
    for (const doc of this.ctx.allContentDocuments()) {
      if (doc === tailDoc) {
        continue;
      }
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
    const tailDoc = this.ctx.mergedTailDocument();
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
    if (tailDoc) {
      resolveForDoc(tailDoc, this.ctx.spineIndex() - 1);
    }
    for (const doc of this.ctx.allContentDocuments()) {
      if (doc === tailDoc) {
        continue;
      }
      resolveForDoc(doc, this.ctx.spineIndex());
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
    const documents = this.ctx.allContentDocuments();
    if (documents.length === 0) {
      return;
    }

    const cleanups: Array<() => void> = [];
    for (const doc of documents) {
      const iframeEl = doc.defaultView?.frameElement;
      if (!iframeEl) {
        continue;
      }

      const updateFromSelection = (): boolean => {
        const selection = doc.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          this.ctx.setPendingSelectionRange(undefined);
          this.ctx.setSelectionToolbar(undefined);
          return false;
        }
        const range = selection.getRangeAt(0);
        const rangeRect = range.getBoundingClientRect();
        if (rangeRect.width === 0 && rangeRect.height === 0) {
          // A selection can momentarily report a zero-size rect (e.g.
          // right as it's being cleared) — treat like "no selection".
          this.ctx.setPendingSelectionRange(undefined);
          this.ctx.setSelectionToolbar(undefined);
          return false;
        }
        const iframeRect = iframeEl.getBoundingClientRect();
        this.ctx.setPendingSelectionRange(range.cloneRange());
        this.ctx.setSelectionToolbar({
          left: iframeRect.left + rangeRect.left + rangeRect.width / 2,
          top: iframeRect.top + rangeRect.top,
        });
        return true;
      };

      const onPointerUp = (event: PointerEvent): void => {
        const madeOrKeptSelection = updateFromSelection();
        if (!madeOrKeptSelection) {
          // No selection to show a toolbar for — check if the click
          // landed on an existing highlight instead (issue #48).
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

      // Continuous-scroll mode only — keeps note markers from staying
      // pinned to a stale position as the reader scrolls past them.
      let scrollAnimationFrame: number | undefined;
      const onScroll = (): void => {
        if (scrollAnimationFrame !== undefined) {
          return;
        }
        scrollAnimationFrame = requestAnimationFrame(() => {
          scrollAnimationFrame = undefined;
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
    const highlights = this.ctx.forSpineIndex(this.ctx.spineIndex());
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
      const range = this.resolveHighlightRange(highlight, this.ctx.spineIndex(), doc);
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
    const range = this.resolveHighlightRange(highlight, this.ctx.spineIndex(), doc);
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
    for (const doc of this.ctx.allContentDocuments()) {
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
    const highlight = this.ctx.forSpineIndex(this.ctx.spineIndex())?.find((candidate) => candidate.id === id);
    if (!marker || !highlight) {
      return;
    }
    this.ctx.setActiveHighlight({ highlight, left: marker.left, top: marker.top });
    this.ctx.notify();
  }
}
