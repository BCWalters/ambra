import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { DomBreakPoint, Page } from "../layout/Page.js";
import { mapDomPositionToDocument } from "../layout/DomPositionMapping.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";

/** The narrowest a single spread column is allowed to get before spread
 * mode gives way to a single column — below this, splitting the available
 * width in two would cramp the reading measure `ReadingTheme` establishes
 * (~34em) more than is worth the two-page presentation. Exposed via
 * `SpreadPaginatedHost.isEligible` so `ReaderController` can decide, on
 * every resize, whether the reader pane is currently wide enough for a
 * spread — the same kind of width-driven mode decision already made for
 * paginated vs. scroll, just automatic instead of reader-chosen. */
const MIN_SPREAD_COLUMN_WIDTH = 480;

/**
 * A two-page spread for reflowable content on wide reader panes: two
 * independent `PaginatedContentHost` instances, each loading and
 * paginating the *same* spine item at half the available width, showing
 * adjacent page indices side by side — the primary (left) column shows
 * `pageIndex`, the companion (right) column always shows `pageIndex + 1`
 * (or nothing, if that would run past the end of the chapter).
 *
 * Deliberately built as two independently-paginated hosts rather than one
 * host split visually in two: a single iframe/DOM can only display one
 * transform/clip state at a time, so showing two different pages of the
 * same content simultaneously genuinely requires two separate documents.
 * `ResourceUrlResolver`'s blob-URL cache (keyed by archive-relative path,
 * shared across both hosts via the same `resolver` instance) means this
 * costs an extra DOM/measurement pass, not extra network/memory.
 *
 * Accessibility is handled entirely through the *left* column: because
 * pagination never fragments the DOM (see `PaginationEngine`), the left
 * column's iframe already contains the spine item's *complete* linear
 * text — the right column is a genuinely redundant second copy of the
 * same content, just displaying a different page. So the right column's
 * iframe is marked `aria-hidden`/untabbable, and `ReaderController`
 * attaches keyboard navigation and manages focus on the left column only
 * (exactly as it would for a single-column `PaginatedContentHost`) — a
 * screen reader user gets the complete chapter with no gaps, and never
 * has to reason about a visual layout that doesn't matter to them. Mouse
 * users still get working in-content links on *both* columns, since
 * `ReaderController.setUpLinkInterception` attaches to every document
 * `contentDocuments()` returns, not just the primary one.
 *
 * A chapter whose own real page count is odd ends with its last page
 * alone in the left column, the right column hidden — same as a real
 * book's blank facing page. Left as-is *within* a chapter, but
 * `ReaderController` avoids ever actually showing that blank facing page
 * on screen: crossing *forward* from it into the next chapter (see
 * `openMergedWithPreviousTail`) shows the next chapter's own real first
 * page in that same right column instead of opening an entirely new
 * spread, so the next chapter starts on the right without ever
 * displaying a blank page at all. This *does* mean a chapter can start
 * in either column, depending entirely on how long the previous chapter
 * happened to be — deliberately not "always recto," which would need
 * either a blank page (rejected, see above) or book-wide layout-
 * independent page tracking (far more complexity than a virtual reader,
 * unlike a physical book, actually needs).
 */
export class SpreadPaginatedHost {
  /** The gap between the two columns — wide enough to read as a genuine
   * gutter (the bound edge of an open book) rather than a stray sliver
   * of whitespace, and to hold the divider's shadow gradient (see the
   * constructor). Public so callers outside this class (currently
   * `PageFurniture`, which overlays a running header/footer centered on
   * each column rather than injecting one into either iframe) can
   * replicate this exact layout geometry rather than guessing at it. */
  public static readonly GUTTER_WIDTH = 40;

  private readonly left: PaginatedContentHost;
  private readonly right: PaginatedContentHost;
  private readonly containerEl: HTMLDivElement;
  private readonly leftWrapperEl: HTMLDivElement;

  /** Set only when this spread continues on from a previous chapter
   * whose own last page was unpaired (see `openMergedWithPreviousTail`)
   * — that previous chapter's actual last page, still fully live and
   * rendered (not a screenshot), borrowed from its own now-otherwise-
   * disposed `SpreadPaginatedHost` and shown in the left column for as
   * long as this chapter's own real page 0 is showing alone in the
   * right column. Kept alive (not disposed) for this whole host's
   * entire lifetime rather than only transiently — `virtualIndex` can
   * return to 0 via `previousSpread`/`goToPageIndex` well after first
   * moving past it, at which point it needs to reappear exactly as it
   * did the first time, not show blank or require re-fetching content
   * that's already fully loaded right here. */
  private mergedTailHost: PaginatedContentHost | undefined;
  /** `true` once `openMergedWithPreviousTail` has been used — from then
   * on for this host's entire lifetime, *every* spread (not just the
   * first) pairs shifted by one real page relative to the unshifted
   * default (see `virtualIndex`), since `mergedTailHost` permanently
   * occupies the "slot before this chapter's own real page 0." */
  private merged = false;
  /** Only meaningful while `merged` — this spread's position counting
   * `mergedTailHost` as index 0, one higher than the real page index
   * it's paired with (left shows `virtualIndex - 1`'s real page, or
   * `mergedTailHost` if that's negative; right shows `virtualIndex`).
   * Always even, advancing/retreating by exactly 2 per `nextSpread`/
   * `previousSpread`, the same as a real page index would without the
   * shift. See `sync`. */
  private virtualIndex = 0;
  /** `true` once `detachLeftForReuse` has handed `left` off to a
   * *different* `SpreadPaginatedHost` to keep using (as that other
   * host's own `mergedTailHost`) — tells `dispose` not to *also* dispose
   * it out from under its new owner. */
  private leftDetached = false;

  public constructor(width: number, height: number, ownerDocument?: Document) {
    const doc = ownerDocument ?? document;
    const columnWidth = SpreadPaginatedHost.columnWidth(width);

    this.left = new PaginatedContentHost(columnWidth, height, ownerDocument);
    this.right = new PaginatedContentHost(columnWidth, height, ownerDocument);
    // A genuinely redundant second copy of the left column's content (see
    // the class doc comment) — hidden from assistive technology so it
    // never presents as confusing duplicate content.
    this.right.element.setAttribute("aria-hidden", "true");
    this.right.element.setAttribute("tabindex", "-1");

    // Holds whichever of `left.element`/`mergedTailHost.element` is
    // currently showing in the left slot — see `sync`. Always present
    // (even for a host that never ends up merged) so every other layout
    // measurement (`GUTTER_WIDTH`, column widths) stays identical either
    // way; an unmerged host simply never shows anything else in it.
    // Explicit height (not left to the children's own natural size)
    // because both children are positioned `absolute` — needed so they
    // can overlap in the same slot, toggling which is visible via
    // `visibility` rather than swapping which is actually mounted, which
    // would otherwise risk an unmounted iframe's own pagination/layout
    // going stale while hidden (`visibility: hidden` keeps layout live;
    // `display: none` does not).
    this.leftWrapperEl = doc.createElement("div");
    this.leftWrapperEl.style.position = "relative";
    this.leftWrapperEl.style.width = `${columnWidth}px`;
    this.leftWrapperEl.style.height = "100%";
    this.leftWrapperEl.style.flexShrink = "0";
    this.left.element.style.position = "absolute";
    this.left.element.style.top = "0";
    this.left.element.style.left = "0";
    this.leftWrapperEl.append(this.left.element);

    const divider = doc.createElement("div");
    divider.style.width = `${SpreadPaginatedHost.GUTTER_WIDTH}px`;
    divider.style.flexShrink = "0";
    divider.style.alignSelf = "stretch";
    divider.style.background =
      "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.06) 46%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.06) 54%, transparent 100%)";

    this.containerEl = doc.createElement("div");
    this.containerEl.style.display = "flex";
    this.containerEl.style.alignItems = "flex-start";
    // Fixed to the full pane height (not left to auto/content-driven
    // sizing) so the divider — which stretches via `align-self: stretch`
    // below — always reaches the bottom of the reader pane. Without this,
    // the row's cross size is derived from its tallest child, but each
    // column's own iframe is sized to that *specific page's* actual
    // content height (see `PaginatedContentHost`, which shrinks the
    // iframe to `page.height + insets` for accurate clipping), not the
    // full available height — so a page with less text than a full page
    // (very common: the last page of a chapter) left a real gap between
    // the divider's bottom and the window's bottom edge, whose size
    // varied with however much text happened to be on that page.
    this.containerEl.style.height = `${height}px`;
    this.containerEl.append(this.leftWrapperEl, divider, this.right.element);
  }

  public get element(): HTMLDivElement {
    return this.containerEl;
  }

  public get pageIndex(): number {
    return this.merged ? Math.max(0, this.virtualIndex - 1) : this.left.currentPageIndex;
  }

  public get pageCount(): number {
    return this.left.pageCount;
  }

  /** The companion column's page index, or `undefined` if there isn't one
   * to show (the primary column is on the last page of the chapter) — for
   * the shell's "Pages X–Y of Z" display. */
  public get secondPageIndex(): number | undefined {
    if (this.merged) {
      return this.virtualIndex < this.left.pageCount ? this.virtualIndex : undefined;
    }
    const index = this.left.currentPageIndex + 1;
    return index < this.left.pageCount ? index : undefined;
  }

  /** Whether the left column is currently showing `mergedTailHost` (the
   * previous chapter's borrowed last page) rather than a real page of
   * *this* chapter — lets a caller's own running header/footer
   * (`PageFurniture`) recognize that the left column's page number/
   * chapter label belong to a different spine item than the right
   * column's, rather than assuming both always describe the same
   * chapter the way every other spread does. */
  public get isShowingMergedTail(): boolean {
    return this.merged && this.virtualIndex === 0;
  }

  /** `mergedTailHost`'s own content document, but only while it's
   * actually the one showing (`isShowingMergedTail`) — belongs to the
   * *previous* spine item, not whatever `pageIndex`/this chapter's own
   * content otherwise implies, which matters to a caller
   * (`ReaderController.applyHighlightsToCurrentHost`) that needs to
   * resolve highlights against the *correct* spine item's CFIs for
   * each visible document rather than assuming every document here
   * belongs to the same one. */
  public mergedTailDocument(): Document | undefined {
    return this.isShowingMergedTail ? (this.mergedTailHost?.element.contentDocument ?? undefined) : undefined;
  }

  /** All content documents this host currently owns — for callers
   * (`ReaderController.setUpLinkInterception`/keyboard nav) that need to
   * attach the same behavior everywhere the reader might click or read,
   * including `mergedTailHost` while present: it's genuinely live,
   * readable content the reader can still tab into or click a link in,
   * not a disabled leftover, even once `this.left`'s own real page 0
   * has taken over as the primary column. Returned regardless of which
   * are *currently visible* (matching how the right column was already
   * included here even while hidden, unpaired, at a chapter's last
   * page) — a listener attached now is ready the moment any of them
   * does become visible, without needing to redo this every `sync`. */
  public contentDocuments(): Document[] {
    const docs: Document[] = [];
    const tailDoc = this.mergedTailHost?.element.contentDocument;
    const leftDoc = this.left.element.contentDocument;
    const rightDoc = this.right.element.contentDocument;
    if (tailDoc) {
      docs.push(tailDoc);
    }
    if (leftDoc) {
      docs.push(leftDoc);
    }
    if (rightDoc) {
      docs.push(rightDoc);
    }
    return docs;
  }

  /** The primary column's content document — accessibility (keyboard
   * navigation, focus management) and CFI/fragment resolution all key
   * off this one document; ordinarily the *left* column (see the class
   * doc comment), except while `isShowingMergedTail`, when the left
   * column belongs to the *previous* chapter rather than this one — the
   * reader's actual current position has already moved on to this
   * chapter's own page 0, showing in the right column, the moment this
   * host became current, so that's what accessibility/CFI/progress-
   * saving must key off here instead. */
  public primaryContentDocument(): Document | undefined {
    if (this.isShowingMergedTail) {
      return this.right.element.contentDocument ?? undefined;
    }
    return this.left.element.contentDocument ?? undefined;
  }

  /** Sets both columns' iframe `title` — the right column's is never
   * read by assistive technology (it's `aria-hidden`) but keeping it
   * accurate costs nothing and avoids a stale title if that ever changes. */
  public setTitle(title: string): void {
    this.left.element.title = title;
    this.right.element.title = title;
  }

  public async open(contentLoader: ContentLoader, resolver: ResourceUrlResolver, spineIndex: number): Promise<void> {
    await this.left.open(contentLoader, resolver, spineIndex);
    await this.right.open(contentLoader, resolver, spineIndex);
    this.sync();
  }

  /** Like `open`, but for a chapter that continues on from a previous
   * one whose own last page was unpaired (see the class doc comment and
   * issue #90/#92): `previousTail` — that previous chapter's own last
   * page, extracted via `detachLeftForReuse` from the `SpreadPaginatedHost`
   * this one is replacing, *before* that one is disposed — takes the left
   * column's place for as long as this chapter's own real page 0 is
   * showing alone in the right column, so the next chapter visibly
   * starts on the right with no blank page anywhere, instead of a whole
   * separate spread opening with this chapter's real page 0 in the left
   * column and a blank page 0 gap on the right, or the two spread apart
   * across two entirely separate spreads either side of a blank half.
   *
   * Moves `previousTail.element` into this host's own layout via a
   * *single*, synchronous `appendChild` call, *before* either column's
   * own (async) `open` — not after, and not preceded by a separate
   * `.remove()` (see `detachLeftForReuse`, which deliberately leaves
   * that to this method instead). This was a real, confirmed bug in an
   * earlier version: detaching the iframe from the DOM and re-inserting
   * it later, as two *separate* operations with an `await` gap in
   * between, left it fully disconnected for long enough that Chromium
   * discarded and recreated its browsing context on reinsertion —
   * silently reloading it back to its own initial (real page 0) state,
   * discarding the real last page it was supposed to keep showing. A
   * single direct `appendChild` of a node that already has a different
   * parent is specified as one atomic move (implicitly removing it from
   * its old parent as part of the very same insertion step) rather than
   * two separately-observable ones, which keeps the browsing context —
   * and everything already rendered in it — intact.
   *
   * `previousTail` becomes this host's responsibility from this call
   * onward (including disposal — see `dispose`); the caller must not
   * touch or dispose it separately afterward. */
  public async openMergedWithPreviousTail(
    contentLoader: ContentLoader,
    resolver: ResourceUrlResolver,
    spineIndex: number,
    previousTail: PaginatedContentHost,
  ): Promise<void> {
    this.mergedTailHost = previousTail;
    // Overlaid on top of `left.element` in the same slot (see the
    // constructor) — sized/positioned to match exactly, so toggling
    // which one is `visibility: visible` (in `sync`, once `merged` is
    // set below) is the only thing that ever needs to change to swap
    // between them.
    previousTail.element.style.position = "absolute";
    previousTail.element.style.top = "0";
    previousTail.element.style.left = "0";
    this.leftWrapperEl.appendChild(previousTail.element);
    await this.left.open(contentLoader, resolver, spineIndex);
    await this.right.open(contentLoader, resolver, spineIndex);
    // Re-applies `previousTail`'s own already-established page transform
    // (a cheap, harmless no-op if it's still showing exactly what it was
    // — `goToPageIndex` of the page it's already on) *after* the two
    // `await`s above, not right after the `appendChild` — this was a
    // real, confirmed bug even with a single atomic reparenting move
    // (not a separate `.remove()` + later `.appendChild()` — see this
    // method's own doc comment): moving a cross-origin sandboxed iframe
    // still isn't guaranteed to preserve its live document/scroll state
    // across every browser, and empirically didn't here. Reapplying only
    // *after* real async work (loading this chapter's own two columns)
    // has already elapsed, rather than immediately after the move,
    // leaves the reload — if one happens — time to actually finish
    // first; doing it too early risked the reload completing *afterward*
    // and silently reverting the fix-up along with it. `goToPageIndex`
    // recomputes purely from `page.displayTranslateY`/`page.height` (see
    // `PaginatedContentHost.showCurrentPage`) — plain numbers already
    // computed when this page was first paginated, unaffected either way
    // by whether the underlying document object is the original one or
    // a freshly reloaded (but structurally identical, same source
    // resource) replacement — so this reliably lands on the *correct*
    // page's content either way, not just "whatever happened to load".
    previousTail.goToPageIndex(previousTail.currentPageIndex);
    // Same reload risk, same "reapply after the reload's had time to
    // finish" reasoning — see `reapplyOverflowHidden`'s own doc comment
    // for the *other* thing a reload silently undoes here (the JS-only
    // scrollbar suppression `open()` originally set, on whatever the
    // *previous* document object was).
    previousTail.reapplyOverflowHidden();
    this.merged = true;
    this.virtualIndex = 0;
    this.sync();
  }

  /** Marks `left` as belonging to a *different* `SpreadPaginatedHost`
   * from now on — for `ReaderController` to pass as the `previousTail`
   * of the next chapter's `openMergedWithPreviousTail`, right before
   * disposing the rest of this host (see `dispose`, which skips `left`
   * once this has been called). Deliberately does *not* remove
   * `left.element` from the DOM itself — see `openMergedWithPreviousTail`'s
   * doc comment for why leaving that to a single atomic move over there
   * (rather than a separate `.remove()` here, with an async gap before
   * the eventual re-insertion) matters. Still fully live and showing
   * whatever page it was last on until that move happens, which is the
   * whole point: this chapter's own real last page, unpaired, about to
   * become the *next* chapter's borrowed left column. */
  public detachLeftForReuse(): PaginatedContentHost {
    this.leftDetached = true;
    return this.left;
  }

  /** Undoes `detachLeftForReuse` — for a caller that detached `left`
   * hoping to reuse it as the *next* chapter's `mergedTailHost`, but
   * ended up not needing it after all (e.g. that next chapter's own
   * content failed to load). Re-inserts `left.element` back into this
   * host's own layout and un-marks it as detached, leaving this host
   * exactly as if `detachLeftForReuse` had never been called — a no-op
   * if it wasn't. */
  public reattachDetachedLeft(): void {
    if (!this.leftDetached) {
      return;
    }
    this.leftDetached = false;
    this.leftWrapperEl.appendChild(this.left.element);
  }

  /** The left column's current position — see `PaginatedContentHost.
   * currentPosition`. The right column has no independent reading
   * position of its own to preserve; it always just mirrors "one page
   * after the left column" (see `sync`) — except while
   * `isShowingMergedTail`, when the left column belongs to a different
   * (previous) spine item entirely, so the *right* column's position is
   * reported instead — exactly like `primaryContentDocument`'s switch,
   * and for the same reason: the reader's actual current position has
   * already moved on to this chapter's own page 0 the moment this host
   * became current, and progress-saving (`ReaderController.saveProgress`)
   * needs to reflect that, not the previous chapter's already-departed
   * last page. */
  public currentPosition(): DomBreakPoint | undefined {
    return this.isShowingMergedTail ? this.right.currentPosition() : this.left.currentPosition();
  }

  /** Both currently-visible columns' `{ page, document }` pairs (see
   * `PaginatedContentHost.currentPageAndDocument`) — just the left
   * column's if the right one is hidden (the chapter's last, unpaired
   * page — see `sync`), or just the right column's while
   * `isShowingMergedTail` (the left column's content belongs to a
   * different spine item entirely — see `primaryContentDocument`).
   * Used to test whether some other DOM position (e.g. a saved
   * bookmark) falls on *either* visible page of the spread, not just
   * the primary one. */
  public currentPagesAndDocuments(): Array<{ page: Page; document: Document }> {
    const result: Array<{ page: Page; document: Document }> = [];
    const leftEntry = this.isShowingMergedTail ? undefined : this.left.currentPageAndDocument();
    if (leftEntry) {
      result.push(leftEntry);
    }
    if (this.right.element.style.visibility !== "hidden") {
      const rightEntry = this.right.currentPageAndDocument();
      if (rightEntry) {
        result.push(rightEntry);
      }
    }
    return result;
  }

  /** Re-paginates both columns at a new width/height, splitting the width
   * evenly between them (minus the gutter). The left column preserves its
   * reading position exactly like a single-column host; the right column
   * is forced through that *same* anchor (not one derived from its own,
   * necessarily different, current position) — see
   * `PaginatedContentHost.relayout`'s doc comment for the real,
   * confirmed bug this fixes: anchoring each column to its *own* current
   * position (a whole page apart) let their independently-computed
   * `pages` arrays silently diverge from each other from that point on,
   * which `sync`'s plain `pageIndex + 1` indexing then displayed as
   * duplicated/missing lines at the seam between them. Captured *before*
   * `left.relayout` runs, since that call itself updates `left`'s own
   * current position (to wherever it lands in its own freshly-measured
   * pages) — the anchor passed to `right` must be the position as it was
   * *before* either column re-paginates, the shared point both are meant
   * to agree on. Mapped via `mapLeftAnchorToRight` first — `left`'s own
   * anchor is a DOM node from *its* document, meaningless passed
   * directly into `right`'s entirely separate one. */
  public relayout(width: number, height: number): void {
    const columnWidth = SpreadPaginatedHost.columnWidth(width);
    this.containerEl.style.height = `${height}px`;
    this.leftWrapperEl.style.width = `${columnWidth}px`;
    const anchor = this.left.currentPosition();
    const rightAnchor = anchor ? this.mapLeftAnchorToRight(anchor) : undefined;
    this.left.relayout(columnWidth, height);
    this.right.relayout(columnWidth, height, rightAnchor);
    this.mergedTailHost?.relayout(columnWidth, height);
    this.sync();
  }

  /** Maps a DOM position from the left column's own document to the
   * structurally-equivalent position in the right column's — see
   * `mapDomPositionToDocument`'s doc comment. Returns `undefined` if
   * either column has no content document yet, or the mapping itself
   * fails (in which case callers simply fall back to an unanchored
   * re-pagination — still correct, just without the "lands exactly at
   * the top of its page" guarantee). */
  private mapLeftAnchorToRight(anchor: DomBreakPoint): DomBreakPoint | undefined {
    const leftBody = this.left.element.contentDocument?.body;
    const rightBody = this.right.element.contentDocument?.body;
    if (!leftBody || !rightBody) {
      return undefined;
    }
    return mapDomPositionToDocument(anchor, leftBody, rightBody);
  }

  /** Jumps the left column to `(node, offset)` — used for TOC/fragment
   * navigation, bridged CFI restores, and in-content links, exactly like
   * `PaginatedContentHost.goToPosition` — then re-syncs the right column
   * (or, if `merged`, re-derives `virtualIndex` from wherever the left
   * column actually landed, preserving this chapter's own established
   * shifted pairing exactly like `goToPageIndex` does, rather than
   * resetting it — an arbitrary jump within this same chapter doesn't
   * change *which* real pages are meant to pair together, only where
   * the reader currently is among them).
   *
   * Also reanchors the right column's own `pages` array to the same
   * (mapped) position — see `relayout`'s identical reasoning: left's own
   * anchored re-pagination here can shift its whole `pages` array in
   * ways an untouched, stale right array (built under different
   * conditions) no longer agrees with, which `sync`'s plain
   * `pageIndex + 1` indexing would otherwise display as duplicated/
   * missing lines at the seam — exactly the bug this class's `relayout`
   * fixes for a resize/font-size change, just triggered here by an
   * in-content jump instead. */
  public goToPosition(node: Node, offset: number): void {
    this.left.goToPosition(node, offset);
    const rightAnchor = this.mapLeftAnchorToRight({ node, offset });
    if (rightAnchor) {
      this.right.reanchorPagination(rightAnchor);
    }
    if (this.merged) {
      this.virtualIndex = SpreadPaginatedHost.shiftedVirtualIndexFor(this.left.currentPageIndex);
    }
    this.sync();
  }

  /** Jumps directly to `index` (a real page index) and re-syncs the
   * companion column — used by the progress scrubber's exact/
   * proportional seeking (see `ReaderController.openSpineItem`'s
   * `landOnPageIndex`/`landOnFractionInItem` options), which previously
   * had no way to land on a specific page in spread mode at all and
   * silently fell back to the chapter's default first page instead — a
   * real bug, since it meant a scrubber release could land somewhere
   * completely different from what its own drag preview had just shown.
   * Lands `index` in whichever column this chapter's own established
   * pairing (shifted if `merged`, see `shiftedVirtualIndexFor` — or
   * plain if not) puts it in, rather than always forcing it into the
   * left column, which would silently break that pairing for every page
   * after it. A no-op if `index` is out of range, matching
   * `PaginatedContentHost.goToPageIndex`. */
  public goToPageIndex(index: number): void {
    if (index < 0 || index >= this.left.pageCount) {
      return;
    }
    if (this.merged) {
      this.virtualIndex = SpreadPaginatedHost.shiftedVirtualIndexFor(index);
    } else {
      this.left.goToPageIndex(index);
    }
    this.sync();
  }

  /** Shows the final spread of the chapter — used when navigating
   * backward into this spine item from the one after it.
   *
   * Unmerged: lands one page short of the last page (rather than the
   * last page itself) as the *left* column, so the true last page shows
   * as the companion (right) column instead of alone past the edge of
   * the spread — deliberately not the same pairing plain forward
   * navigation would produce for an odd page count (which leaves it
   * alone), so that entering a chapter backward always shows its last
   * page with a companion rather than by itself.
   *
   * Merged: lands on whatever real index this chapter's own established
   * shifted pairing (see `goToPageIndex`) puts the last real page at —
   * alone if that shift leaves it unpaired, exactly matching where
   * forward navigation would have arrived on its own, since (unlike the
   * unmerged case) this chapter's whole pairing scheme is already a
   * deliberate, permanent shift rather than incidental. */
  public goToLastPage(): void {
    if (this.merged) {
      this.goToPageIndex(Math.max(0, this.left.pageCount - 1));
      return;
    }
    const lastIndex = Math.max(0, this.left.pageCount - 1);
    this.left.goToPageIndex(Math.max(0, lastIndex - 1));
    this.sync();
  }

  /** Turns the spread forward by two pages. Returns `false` (without
   * effect) once there's no more spread left within this chapter to
   * advance to.
   *
   * Unmerged: checked against `pageCount - 2`, not `pageCount - 1`: once
   * the *right* column is showing the chapter's actual last page, there
   * is nothing left to advance to, even though the *left* column's own
   * index hasn't reached `pageCount - 1` itself (it never does, for an
   * even page count — the last spread pairs `pageCount - 2` with
   * `pageCount - 1`). Checking against `pageCount - 1` here was a real,
   * confirmed bug (issue #91): from that last full spread, "next" would
   * pass this check, then clamp `currentPageIndex + 2` back down to
   * `pageCount - 1` anyway — redisplaying the *same* last page, now
   * alone in the left column, instead of correctly reporting "no more
   * spread here" so the caller advances to the next chapter.
   *
   * Merged: the exact same off-by-one, just re-derived against
   * `virtualIndex`'s own effective total (one higher, counting
   * `mergedTailHost` as an extra page) instead of `pageCount` directly. */
  public nextSpread(): boolean {
    if (this.merged) {
      if (this.virtualIndex >= this.left.pageCount - 1) {
        return false;
      }
      this.virtualIndex = Math.min(this.virtualIndex + 2, this.left.pageCount);
      this.sync();
      return true;
    }
    if (this.left.currentPageIndex >= this.left.pageCount - 2) {
      return false;
    }
    this.left.goToPageIndex(Math.min(this.left.currentPageIndex + 2, this.left.pageCount - 1));
    this.sync();
    return true;
  }

  /** Turns the spread backward by two pages. Returns `false` (without
   * effect) if already on the chapter's first spread — `virtualIndex
   * === 0` (showing `mergedTailHost`) if `merged`, or the left column
   * already on real page 0 otherwise. */
  public previousSpread(): boolean {
    if (this.merged) {
      if (this.virtualIndex <= 0) {
        return false;
      }
      this.virtualIndex = Math.max(this.virtualIndex - 2, 0);
      this.sync();
      return true;
    }
    if (this.left.currentPageIndex <= 0) {
      return false;
    }
    this.left.goToPageIndex(Math.max(this.left.currentPageIndex - 2, 0));
    this.sync();
    return true;
  }

  /** The `virtualIndex` a `merged` host should use to show real page
   * `realIndex` — one higher than `realIndex` unless `realIndex` is
   * already even (real page 0 pairs with `mergedTailHost` at
   * `virtualIndex` 0; every other even real index is itself the
   * *second* of a shifted pair, e.g. real pages 1 and 2 pair together
   * at `virtualIndex` 2). Shared by `goToPageIndex`/`goToPosition` so
   * every way of landing on a specific real page agrees on which column
   * it shows in. */
  private static shiftedVirtualIndexFor(realIndex: number): number {
    return realIndex % 2 === 0 ? realIndex : realIndex + 1;
  }

  /** Shows the current page(s) in both columns, branching on whether
   * this host is `merged` (see the class doc comment):
   *
   * Unmerged: the left column shows `left.currentPageIndex` (already
   * set by whichever caller — `goToPageIndex`/`nextSpread`/etc. — just
   * ran); the right column shows `left.currentPageIndex + 1`, or hides
   * itself (rather than showing stale content) if that would run past
   * the end of the chapter — e.g. an odd total page count leaves the
   * very last page without a companion, same as a real book's blank
   * facing page.
   *
   * Merged: the left column shows `mergedTailHost` while `virtualIndex
   * === 0`, or real page `virtualIndex - 1` otherwise (moved there via
   * `left.goToPageIndex`, since unlike the unmerged case `left` isn't
   * necessarily already on the right real page — `virtualIndex` is the
   * one source of truth here); the right column shows real page
   * `virtualIndex`, or hides itself past the end of the chapter, same
   * as the unmerged case. Both `left.element`/`mergedTailHost.element`
   * stay mounted throughout (`visibility` toggles which one paints, see
   * the constructor) rather than one being added/removed, so a hidden
   * iframe's own pagination/layout never goes stale from lack of a live
   * layout pass while it's not the one currently shown. */
  private sync(): void {
    if (this.merged && this.mergedTailHost) {
      const leftIndex = this.virtualIndex - 1;
      const showTail = leftIndex < 0;
      this.mergedTailHost.element.style.visibility = showTail ? "visible" : "hidden";
      this.left.element.style.visibility = showTail ? "hidden" : "visible";
      if (!showTail) {
        this.left.goToPageIndex(leftIndex);
      }
      const rightIndex = this.virtualIndex;
      if (rightIndex < this.right.pageCount) {
        this.right.element.style.visibility = "visible";
        this.right.goToPageIndex(rightIndex);
      } else {
        this.right.element.style.visibility = "hidden";
      }
      return;
    }
    const index = this.left.currentPageIndex + 1;
    if (index < this.right.pageCount) {
      this.right.element.style.visibility = "visible";
      this.right.goToPageIndex(index);
    } else {
      this.right.element.style.visibility = "hidden";
    }
  }

  /** The `PaginatedContentHost` currently occupying the left slot —
   * `mergedTailHost` while `isShowingMergedTail`, `left` otherwise. Used
   * by the animation-support delegates below so "left" always means
   * whatever's actually visible there, not necessarily `left` itself. */
  private currentLeftHost(): PaginatedContentHost {
    return this.isShowingMergedTail && this.mergedTailHost ? this.mergedTailHost : this.left;
  }

  /** The raw column element currently occupying the given slot — for
   * `ReaderController`'s own page-turn-animation code, which needs to
   * apply transforms directly to whichever iframe is actually on
   * screen right now (see `currentLeftHost`; the right column is never
   * anything but `right.element`). Exposed since `left`/`right`/
   * `mergedTailHost` are otherwise private to this class. */
  public columnElement(column: "left" | "right"): HTMLIFrameElement {
    return column === "left" ? this.currentLeftHost().element : this.right.element;
  }

  /** Delegates to the given column's own `PaginatedContentHost.
   * growToFullHeight` — see that method's doc comment for why this
   * matters. Used by a spread's "rotate" page-turn animation, which
   * turns only the one column nearest the spine rather than the whole
   * spread (see `ReaderController.animateSpreadTurn`), so only that
   * column (not its untouched companion — see `suppressColumnClipPathForAnimation`
   * for what *that* one still needs) needs its short-page height masked
   * for the animation's duration. */
  public growColumnToFullHeight(column: "left" | "right", fullHeight: number): void {
    (column === "left" ? this.currentLeftHost() : this.right).growToFullHeight(fullHeight);
  }

  /** Delegates to the given column's own `PaginatedContentHost.
   * suppressClipPathForAnimation` — see that method's doc comment
   * (issue #81) for why *every* column of *both* the outgoing and
   * incoming spread needs this for the duration of a "rotate" turn, not
   * just whichever single column is actually being visibly rotated. */
  public suppressColumnClipPathForAnimation(column: "left" | "right"): void {
    (column === "left" ? this.currentLeftHost() : this.right).suppressClipPathForAnimation();
  }

  /** Delegates to the given column's own `PaginatedContentHost.
   * restoreNaturalHeight` — see `growColumnToFullHeight`/
   * `suppressColumnClipPathForAnimation`. Safe to call on a column that
   * only ever had its clip-path suppressed (never grown), or on one
   * where neither happened at all. */
  public restoreColumnNaturalHeight(column: "left" | "right"): void {
    (column === "left" ? this.currentLeftHost() : this.right).restoreNaturalHeight();
  }

  /** Disposes `left`/`right` (unless `left` has been handed off via
   * `detachLeftForReuse` — see that method) and `mergedTailHost` (if
   * any), *and* removes this host's own wrapper element (`this.containerEl`,
   * holding the now-empty divider) from the DOM — a real, previously-
   * latent bug: disposing only `left`/`right` left an orphaned wrapper/
   * divider behind, invisible as long as every caller happened to
   * immediately overwrite it via `containerEl.replaceChildren(...)`
   * (which nukes *all* existing children as a side effect, masking the
   * leak) — see `ReaderController.openSpineItem`'s staged-hidden-host
   * swap, which disposes the previous host and moves the new one's
   * element in individually rather than replacing every child
   * unconditionally, and so surfaced this the moment it shipped: a
   * leftover 40px-wide (`GUTTER_WIDTH`) sliver accumulating in the
   * content pane on every single spread-mode chapter navigation. */
  public dispose(): void {
    if (!this.leftDetached) {
      this.left.dispose();
    }
    this.right.dispose();
    this.mergedTailHost?.dispose();
    this.containerEl.remove();
  }

  /** `true` if `totalWidth` is wide enough to show two columns of at
   * least `MIN_SPREAD_COLUMN_WIDTH` each side by side, with room for the
   * gutter between them. */
  public static isEligible(totalWidth: number): boolean {
    return totalWidth >= MIN_SPREAD_COLUMN_WIDTH * 2 + SpreadPaginatedHost.GUTTER_WIDTH;
  }

  private static columnWidth(totalWidth: number): number {
    return Math.max(MIN_SPREAD_COLUMN_WIDTH, Math.floor((totalWidth - SpreadPaginatedHost.GUTTER_WIDTH) / 2));
  }

  /** Public alias for `columnWidth` — the effective single-column width
   * a spread of `totalWidth` renders each side at. Exposed for callers
   * outside this class that need to measure/paginate at the *same*
   * width spread mode is actually displaying at, rather than a
   * conceptually separate "reference" width — currently
   * `BookPaginationEstimator`, which must always paginate at whatever
   * width is really on screen so its book-wide page numbers agree with
   * what the reader sees. */
  public static effectiveColumnWidth(totalWidth: number): number {
    return SpreadPaginatedHost.columnWidth(totalWidth);
  }
}
