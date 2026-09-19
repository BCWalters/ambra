import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { DomBreakPoint, Page } from "../layout/Page.js";
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
    this.containerEl.append(this.left.element, divider, this.right.element);
  }

  public get element(): HTMLDivElement {
    return this.containerEl;
  }

  public get pageIndex(): number {
    return this.left.currentPageIndex;
  }

  public get pageCount(): number {
    return this.left.pageCount;
  }

  /** The companion column's page index, or `undefined` if there isn't one
   * to show (the primary column is on the last page of the chapter) — for
   * the shell's "Pages X–Y of Z" display. */
  public get secondPageIndex(): number | undefined {
    const index = this.left.currentPageIndex + 1;
    return index < this.left.pageCount ? index : undefined;
  }

  /** All content documents currently rendering this spine item — both
   * columns — for callers (`ReaderController.setUpLinkInterception`) that
   * need to attach the same behavior everywhere the reader might click,
   * not just the primary column. */
  public contentDocuments(): Document[] {
    const docs: Document[] = [];
    const leftDoc = this.left.element.contentDocument;
    const rightDoc = this.right.element.contentDocument;
    if (leftDoc) {
      docs.push(leftDoc);
    }
    if (rightDoc) {
      docs.push(rightDoc);
    }
    return docs;
  }

  /** The primary (left) column's content document — accessibility
   * (keyboard navigation, focus management) and CFI/fragment resolution
   * all key off this one document; see the class doc comment. */
  public primaryContentDocument(): Document | undefined {
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
    this.syncRight();
  }

  /** The left column's current position — see `PaginatedContentHost.
   * currentPosition`. The right column has no independent reading
   * position of its own to preserve; it always just mirrors "one page
   * after the left column" (see `syncRight`). */
  public currentPosition(): DomBreakPoint | undefined {
    return this.left.currentPosition();
  }

  /** Both currently-visible columns' `{ page, document }` pairs (see
   * `PaginatedContentHost.currentPageAndDocument`) — just the left
   * column's if the right one is hidden (the chapter's last, unpaired
   * page — see `syncRight`). Used to test whether some other DOM
   * position (e.g. a saved bookmark) falls on *either* visible page of
   * the spread, not just the primary one. */
  public currentPagesAndDocuments(): Array<{ page: Page; document: Document }> {
    const result: Array<{ page: Page; document: Document }> = [];
    const leftEntry = this.left.currentPageAndDocument();
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
   * is simply re-synced afterward. */
  public relayout(width: number, height: number): void {
    const columnWidth = SpreadPaginatedHost.columnWidth(width);
    this.containerEl.style.height = `${height}px`;
    this.left.relayout(columnWidth, height);
    this.right.relayout(columnWidth, height);
    this.syncRight();
  }

  /** Jumps the left column to `(node, offset)` — used for TOC/fragment
   * navigation, bridged CFI restores, and in-content links, exactly like
   * `PaginatedContentHost.goToPosition` — then re-syncs the right column. */
  public goToPosition(node: Node, offset: number): void {
    this.left.goToPosition(node, offset);
    this.syncRight();
  }

  /** Jumps directly to `index` in the left column and re-syncs the right
   * column to show its companion page — used by the progress scrubber's
   * exact/proportional seeking (see `ReaderController.openSpineItem`'s
   * `landOnPageIndex`/`landOnFractionInItem` options), which previously
   * had no way to land on a specific page in spread mode at all and
   * silently fell back to the chapter's default first page instead — a
   * real bug, since it meant a scrubber release could land somewhere
   * completely different from what its own drag preview had just shown.
   * A no-op if `index` is out of range, matching
   * `PaginatedContentHost.goToPageIndex`. */
  public goToPageIndex(index: number): void {
    this.left.goToPageIndex(index);
    this.syncRight();
  }

  /** Shows the final spread of the chapter — used when navigating
   * backward into this spine item from the one after it. Lands one page
   * short of the last page (rather than the last page itself as the
   * *left* column) so the very last page of the chapter is still visible,
   * as the companion column, instead of past the edge of the spread. */
  public goToLastPage(): void {
    const lastIndex = Math.max(0, this.left.pageCount - 1);
    this.left.goToPageIndex(Math.max(0, lastIndex - 1));
    this.syncRight();
  }

  /** Turns the spread forward by two pages. Returns `false` (without
   * effect) if the left column is already on the chapter's last spread —
   * checked against `pageCount - 2`, not `pageCount - 1`: once the
   * *right* column is showing the chapter's actual last page, there is
   * nothing left to advance to, even though the *left* column's own
   * index hasn't reached `pageCount - 1` itself (it never does, for an
   * even page count — the last spread pairs `pageCount - 2` with
   * `pageCount - 1`). Checking against `pageCount - 1` here was a real,
   * confirmed bug (issue #91): from that last full spread, "next" would
   * pass this check, then clamp `currentPageIndex + 2` back down to
   * `pageCount - 1` anyway — redisplaying the *same* last page, now
   * alone in the left column, instead of correctly reporting "no more
   * spread here" so the caller advances to the next chapter. */
  public nextSpread(): boolean {
    if (this.left.currentPageIndex >= this.left.pageCount - 2) {
      return false;
    }
    this.left.goToPageIndex(Math.min(this.left.currentPageIndex + 2, this.left.pageCount - 1));
    this.syncRight();
    return true;
  }

  /** Turns the spread backward by two pages. Returns `false` (without
   * effect) if the left column is already on the chapter's first page. */
  public previousSpread(): boolean {
    if (this.left.currentPageIndex <= 0) {
      return false;
    }
    this.left.goToPageIndex(Math.max(this.left.currentPageIndex - 2, 0));
    this.syncRight();
    return true;
  }

  /** Shows `left.currentPageIndex + 1` in the right column, or hides it
   * (rather than showing stale content) if that would run past the end
   * of the chapter — e.g. an odd total page count leaves the very last
   * page without a companion, same as a real book's blank facing page. */
  private syncRight(): void {
    const index = this.left.currentPageIndex + 1;
    if (index < this.right.pageCount) {
      this.right.element.style.visibility = "visible";
      this.right.goToPageIndex(index);
    } else {
      this.right.element.style.visibility = "hidden";
    }
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
    (column === "left" ? this.left : this.right).growToFullHeight(fullHeight);
  }

  /** Delegates to the given column's own `PaginatedContentHost.
   * suppressClipPathForAnimation` — see that method's doc comment
   * (issue #81) for why *every* column of *both* the outgoing and
   * incoming spread needs this for the duration of a "rotate" turn, not
   * just whichever single column is actually being visibly rotated. */
  public suppressColumnClipPathForAnimation(column: "left" | "right"): void {
    (column === "left" ? this.left : this.right).suppressClipPathForAnimation();
  }

  /** Delegates to the given column's own `PaginatedContentHost.
   * restoreNaturalHeight` — see `growColumnToFullHeight`/
   * `suppressColumnClipPathForAnimation`. Safe to call on a column that
   * only ever had its clip-path suppressed (never grown), or on one
   * where neither happened at all. */
  public restoreColumnNaturalHeight(column: "left" | "right"): void {
    (column === "left" ? this.left : this.right).restoreNaturalHeight();
  }

  /** Disposes both columns *and* removes this host's own wrapper element
   * (`this.containerEl`, holding the now-empty divider) from the DOM —
   * a real, previously-latent bug: disposing only `left`/`right` left an
   * orphaned wrapper/divider behind, invisible as long as every caller
   * happened to immediately overwrite it via `containerEl.replaceChildren(...)`
   * (which nukes *all* existing children as a side effect, masking the
   * leak) — see `ReaderController.openSpineItem`'s staged-hidden-host
   * swap, which disposes the previous host and moves the new one's
   * element in individually rather than replacing every child
   * unconditionally, and so surfaced this the moment it shipped: a
   * leftover 40px-wide (`GUTTER_WIDTH`) sliver accumulating in the
   * content pane on every single spread-mode chapter navigation. */
  public dispose(): void {
    this.left.dispose();
    this.right.dispose();
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
