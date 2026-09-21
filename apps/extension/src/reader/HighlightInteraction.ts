import { Locator } from "@ambra/engine";
import type { HighlightStyle, LocatorResolver } from "@ambra/engine";
import type { Highlight } from "../library/LibraryDatabase.js";
import { applyHighlightRanges, applySearchMatchRanges } from "./HighlightRenderer.js";
import { findTextRangesInDocument } from "./findTextRangesInDocument.js";
import type { ActiveHighlightState, NoteMarkerState, SelectionToolbarState } from "./ReaderTypes.js";

/** Everything `HighlightInteraction` needs to read from/call back into
 * `ReaderController` — deliberately narrow, same reasoning as
 * `HighlightManagerContext`. `activeHighlight`/`selectionToolbar`/
 * `pendingSelectionRange` (general reader-UI state other things touch
 * too — e.g. every page turn clears `activeHighlight`) stay owned by
 * `ReaderController`, read/written here only through narrow accessors. */
export interface HighlightInteractionContext {
  spineIndex(): number;
  isFixedLayoutHost(): boolean;
  allContentDocuments(): Document[];
  /** The previous spine item's merged-tail document borrowed into the
   * current spread (see `SpreadPaginatedHost.mergedTailDocument`), or
   * `undefined` if the current host isn't showing a merged spread. */
  mergedTailDocument(): Document | undefined;
  forSpineIndex(spineIndex: number): readonly Highlight[] | undefined;
  /** `SearchCoordinator.currentHighlightQuery` — the live "highlight
   * matches on this page" spotlight's query (issue #100), or `undefined`
   * when there's nothing to spotlight right now. */
  currentSearchHighlightQuery(): string | undefined;
  setPendingSelectionRange(range: Range | undefined): void;
  setSelectionToolbar(state: SelectionToolbarState | undefined): void;
  setActiveHighlight(state: ActiveHighlightState | undefined): void;
  notify(): void;
}

/** Paints highlights and the live search-match spotlight into the
 * current host's content document(s), and handles every interaction
 * that depends on that painted content: tracking text selection into
 * `selectionToolbar`, hit-testing clicks/taps against existing
 * highlights, and recomputing `noteMarkers`' on-page positions.
 * Extracted out of `ReaderController` (see `BookmarkManager`'s doc
 * comment for the overall decomposition rationale) as a follow-on to
 * `HighlightManager`: that class owns highlight *data* (the cache and
 * its CRUD); this one owns everything that actually needs live host/
 * iframe/content-document access to paint or hit-test against it, which
 * `HighlightManager` deliberately has no business holding onto. */
export class HighlightInteraction {
  /** Every on-page note-marker badge currently visible — see
   * `ReaderSnapshot.noteMarkers`. Recomputed by `updateNoteMarkers`,
   * never mutated directly. Exposed as `noteMarkers`; the field itself
   * is named `markers` purely so the public getter can share its name. */
  private markers: NoteMarkerState[] = [];
  /** Detaches the current host's selection-tracking listeners (see
   * `setUpHighlightSelection`) — re-created per spine-item lifecycle. */
  private cleanup: (() => void) | undefined;

  constructor(
    private readonly locatorResolver: LocatorResolver,
    private readonly ctx: HighlightInteractionContext,
  ) {}

  public get noteMarkers(): readonly NoteMarkerState[] {
    return this.markers;
  }

  /** Resolves every highlight belonging to `spineIndex` against `doc`
   * (a live, already-loaded content document for that same spine item)
   * into real `Range`s, grouped by style, and applies them via
   * `applyHighlightRanges` (the CSS Custom Highlight API — see its doc
   * comment for why this never touches `doc`'s own DOM). A highlight
   * whose CFI fails to resolve (corrupted data, or content that's
   * changed since it was created) is silently skipped rather than
   * failing the whole batch — one bad highlight shouldn't hide every
   * other one on the page. No-op for fixed-layout content, which has no
   * reflowable text to highlight in the first place. */
  private applyHighlightsToDocument(doc: Document, spineIndex: number): void {
    const highlights = this.ctx.forSpineIndex(spineIndex);
    const groups = new Map<HighlightStyle, Range[]>();
    if (highlights) {
      for (const highlight of highlights) {
        const range = this.resolveHighlightRange(highlight, spineIndex, doc);
        if (!range) {
          continue;
        }
        const existing = groups.get(highlight.style);
        if (existing) {
          existing.push(range);
        } else {
          groups.set(highlight.style, [range]);
        }
      }
    }
    applyHighlightRanges(doc, groups);
  }

  /** Applies highlights to every content document the current host owns
   * (both spread-mode columns, same scope as `allContentDocuments`) —
   * called on every spine item load, unconditionally (unlike the font/
   * theme settings `applyDisplaySettingsToHost` also applies, which skip
   * the work when already at their defaults — a spine item having zero
   * highlights isn't a meaningful "default" to detect ahead of time, so
   * this always at least attempts the (cheap, no-op-if-empty) lookup).
   *
   * A merged spread's borrowed tail document (see `SpreadPaginatedHost.
   * mergedTailDocument`) is always the *previous* spine item, one lower
   * than `this.ctx.spineIndex()` — resolved and applied against that index
   * specifically, not `this.ctx.spineIndex()`. Getting this wrong was a real,
   * confirmed bug: `applyHighlightRanges` *replaces* a document's entire
   * highlight registry on every call (see its own doc comment), so
   * naively applying `this.ctx.spineIndex()`'s highlights to a document that
   * actually belongs to a different spine item doesn't just fail to add
   * anything — every highlight already correctly showing on that
   * borrowed tail page visibly vanishes the instant the reader turns
   * forward into the next chapter, immediately after having read it. */
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
    // Issue #100: piggybacks on every one of this method's own call
    // sites (spine-item load, host swap, a highlight added/removed/
    // restyled) so the live search spotlight refreshes for free
    // whenever the visible document(s) themselves change — see
    // `applySearchHighlightToCurrentHost`'s own doc comment for the
    // other case this alone doesn't cover (the query changing while
    // staying on the very same page).
    this.applySearchHighlightToCurrentHost();
    this.updateNoteMarkers();
  }

  /** Re-scans every content document the current host owns (identical
   * scope to `applyHighlightsToCurrentHost`, including its merged-
   * spread tail-document handling) for occurrences of
   * `SearchCoordinator.currentHighlightQuery` and paints them via the
   * dedicated `HighlightTheme.SEARCH_MATCH_HIGHLIGHT_NAME` `::highlight()`
   * (issue #100) — entirely separate from `applyHighlightsToDocument`'s
   * persisted, reader-authored `HighlightStyle` highlights just above,
   * since this one is transient (never saved) and keyed off the live
   * search query rather than a spine index. Called both from
   * `applyHighlightsToCurrentHost` above (refreshes for free on every
   * document swap) and via `SearchCoordinatorContext.repaintHighlight`
   * whenever `currentHighlightQuery` itself changes without any document
   * swap at all (e.g. typing a fresh query while staying on the same
   * page). No-op for fixed-layout content — consistent with
   * `applyHighlightsToCurrentHost`'s own identical early return, since
   * FXL content already has no in-book highlighting of any kind (see
   * `addHighlight`'s guard). */
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
  /** Recomputes `noteMarkers` — one small marker per highlight *with a
   * note* in every content document the current host owns (mirrors
   * `applyHighlightsToCurrentHost`'s own tail-document handling for a
   * merged spread, for the identical reason: a borrowed tail document
   * belongs to `this.ctx.spineIndex() - 1`, not `this.ctx.spineIndex()`). Anchored
   * at the top-right corner of the highlight's own *last* client rect
   * (`Range.getClientRects()`) — the point right after its last visible
   * character — in parent-viewport coordinates, the same
   * iframe-rect-plus-content-rect composition `selectionToolbar`/
   * `activeHighlight` already use, since a `Range` inside a
   * cross-document iframe has no meaningful coordinates in the parent
   * document on its own.
   *
   * Called from `applyHighlightsToCurrentHost` (covers every spine-item
   * load, page/spread turn, and style change that already calls it),
   * `setHighlightNote` directly (a note's marker needs updating even
   * though a note has no effect on `applyHighlightRanges`'s own CSS
   * repaint), `resize` (marker positions are viewport-pixel values that
   * a relayout can shift even though the highlight `Range`s themselves
   * didn't change), and a scroll listener in continuous-scroll mode
   * specifically (see `setUpHighlightSelection`) — the one case where
   * the content moves without any of those other events firing at all. */
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
        // `getClientRects()` reflects every visual line of the highlight,
        // including ones the reader currently has paginated/scrolled
        // *away* — in paginated mode `doc.body` is one continuous flow
        // that's merely translated and clip-path-cropped down to the
        // current page's band (see `PaginatedContentHost.showCurrentPage`),
        // so a highlight spanning onto an adjacent page still returns real
        // (but off-page) rects for those lines. Blindly using the very
        // last rect (issue #99) could place the marker anywhere the
        // highlight's final line happens to fall, including well outside
        // the current page entirely. Instead, keep only the last rect
        // that actually falls within the current page's visible band —
        // and skip the highlight altogether if none of its rects do,
        // rather than showing a stray marker for a highlight that isn't
        // visible on this page at all (it reappears correctly once the
        // reader navigates to wherever it actually is).
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

  /** The current page's visible vertical band, in the iframe's own local
   * coordinate space (the same space `getClientRects()` reports in) —
   * used by `updateNoteMarkers` to tell a highlight's on-page rects apart
   * from off-page ones (see its own doc comment for why that distinction
   * matters, issue #99). Reads `clip-path` directly off the iframe's
   * inline style since that's exactly what `PaginatedContentHost.
   * showCurrentPage`/`SandboxedContentHost` set it to, rather than
   * duplicating the inset math independently and risking the two
   * drifting apart. Falls back to the iframe's full box when there's no
   * `clip-path` at all — continuous-scroll mode never sets one (a
   * scrolling iframe already clips to its own box natively), and a
   * page-turn animation briefly clears it too (`suppressClipPathForAnimation`) —
   * both cases where "the whole box is visible" is the correct bound.
   *
   * `clip-path: inset(...)` follows the same 1-4-value CSS shorthand as
   * `margin`/`padding` (e.g. `inset(107px 0px)` means top === bottom),
   * so this can't assume a fixed number of values are present. */
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

  /** Detaches whatever selection-tracking listeners `setUpHighlightSelection`
   * last attached, if any — called both by `setUpHighlightSelection` itself
   * (before re-attaching for a new host) and directly by `ReaderController`
   * on a host swap/dispose, where there's nothing to re-attach yet. */
  public teardownSelection(): void {
    this.cleanup?.();
    this.cleanup = undefined;
  }

  /** Attaches selection tracking to every content document the current
   * host has: whenever the reader finishes making (or clears) a text
   * selection in *either* column of a two-page spread — not just the
   * primary (left) one — updates `selectionToolbar` so the shell can
   * show/hide a floating highlight-color picker positioned just above
   * wherever that selection actually is. `AccessibilityController`'s
   * keyboard listener now follows this same "every document" scope (see
   * `reattachKeyboardNav`); only the *managed-focus* side of
   * accessibility (`setUpAccessibility`'s `focusContent` call) stays
   * scoped to the primary column, since that part is specifically for
   * screen readers, which only ever need the one column's complete text
   * (see `SpreadPaginatedHost`'s own doc comment). Listens for
   * `pointerup` (mouse/touch selection) and `keyup` (keyboard selection
   * via Shift+arrows) — the two ways a selection can actually finish
   * changing. No-op for fixed-layout content.
   *
   * Verified working well for double/triple-click word/sentence
   * selection in every mode, including single-column paginated mode.
   * Free-form click-*drag* selection in single-column paginated mode
   * specifically was **not** exercised end-to-end — that mode's own
   * `beginDragPageTurn` attaches its own pointermove/preventDefault
   * handling to the same document to drive the page-turn-drag gesture,
   * and a synthetic drag-based selection attempt during manual testing
   * hung the test browser outright (the same category of real, confirmed
   * "drag + this iframe" hang documented on issue #15's fix, not
   * something to casually re-poke at). Word-level selection via
   * double-click is unaffected (it's a click-count gesture, never enters
   * `beginDragPageTurn`'s pointermove handling at all) and covers the
   * primary use case; a real click-drag-to-select disambiguation against
   * the page-turn gesture, if ever wanted, deserves its own careful,
   * dedicated investigation rather than folding into this pass. */
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
          // A selection can momentarily report a zero-size rect (e.g. right
          // as it's being cleared) — treat exactly like "no selection"
          // rather than showing a toolbar with nowhere sensible to anchor.
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
        // No fresh/active selection to show a color picker for — check
        // whether the click instead landed on an *existing* highlight
        // (issue #48: everything the Highlights panel can do should also
        // work directly in the book). A real drag-to-select gesture
        // never reaches here (it's caught by `madeOrKeptSelection` above);
        // this only ever fires for a plain tap/click.
        if (!madeOrKeptSelection) {
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

      // Continuous-scroll mode only in practice (a paginated host's
      // iframe never scrolls internally — see `ScrollContentHost`'s own
      // doc comment) — without this, `noteMarkers` would stay pinned to
      // wherever they were computed as the reader scrolled straight past
      // them, visually detaching from the highlights they're meant to
      // sit beside. `requestAnimationFrame`-coalesced rather than
      // recomputing on every single scroll event, which can fire far
      // faster than a frame during a fast scroll/fling.
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

  /** Finds whichever of the current spine item's highlights (if any)
   * covers the document position at `(clientX, clientY)` — the shared
   * hit-testing core behind both `checkExistingHighlightClick` (opens
   * the highlight's action popup) and `handleContentClick` (issue #62:
   * must *not* also treat that same click as a page-turn tap, which it
   * previously did whenever a highlight happened to sit in one of the
   * left/right third-of-the-page turn zones — clicking a highlight
   * there would open its popup *and* turn the page out from under it in
   * the same gesture, leaving a popup referencing a highlight no longer
   * on screen). Uses `caretRangeFromPoint` to find the actual text
   * position under the pointer (the CSS Custom Highlight API used to
   * *paint* highlights — see `applyHighlightRanges` — has no
   * hit-testing of its own; it's a paint-only overlay, not real DOM
   * elements a click could target). */
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

  /** Checks whether `(clientX, clientY)` — a plain click/tap that didn't
   * make or keep a text selection (see `setUpHighlightSelection`) —
   * landed on top of an existing highlight in `doc`, and if so, opens
   * `activeHighlight` for it (a popup offering the note/delete actions
   * also available in the Highlights panel, per issue #48). Clears
   * `activeHighlight` (rather than leaving a stale one showing) if the
   * click didn't land on any highlight, or if this browser lacks
   * `caretRangeFromPoint` entirely (a non-standard but
   * near-universally-supported API — treated as a graceful "feature not
   * available" rather than a hard requirement). */
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

  /** Hides the selection toolbar and clears the current in-content text
   * selection — called after committing a highlight, and available to
   * the shell for an explicit dismiss (e.g. clicking elsewhere). Clears
   * the native selection on *every* content document, not just the
   * primary one — the pending selection this is dismissing could belong
   * to either column of a two-page spread (see `setUpHighlightSelection`),
   * and clearing a document with no active selection is a harmless
   * no-op, so there's no need to track which one it actually was. */
  public dismissSelectionToolbar(): void {
    for (const doc of this.ctx.allContentDocuments()) {
      doc.getSelection()?.removeAllRanges();
    }
    this.ctx.setPendingSelectionRange(undefined);
    this.ctx.setSelectionToolbar(undefined);
    this.ctx.notify();
  }

  /** Closes the "existing highlight" popup opened by clicking on a
   * highlight while reading (see `checkExistingHighlightClick`) — an
   * explicit dismiss (clicking elsewhere, Escape), or after acting on it
   * (deleting it, saving/canceling a note edit). */
  public dismissActiveHighlight(): void {
    this.ctx.setActiveHighlight(undefined);
    this.ctx.notify();
  }

  /** Opens `activeHighlight` for a highlight that already has an
   * on-page `noteMarkers` badge (issue #99) — tapping the badge is a
   * convenience shortcut to the exact same popup tapping the
   * highlighted text itself opens via `checkExistingHighlightClick`,
   * not a second, competing interaction. Reuses the marker's own
   * already-computed position as the popup's anchor rather than
   * re-resolving the highlight's `Range` from scratch — the marker
   * necessarily sits right at (or beside) the highlight, so it's
   * already a perfectly good anchor point. A no-op if `id` doesn't
   * match a highlight with a marker currently on screen (shouldn't
   * happen — the shell only ever calls this for a badge it's actually
   * showing — but harmless to no-op rather than throw if it somehow
   * did, e.g. a stale click racing a page turn). */
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
