import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { DomBreakPoint } from "../layout/Page.js";
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

/** The gap between the two columns — wide enough to read as a genuine
 * gutter (the bound edge of an open book) rather than a stray sliver of
 * whitespace, and to hold the divider's shadow gradient (see the
 * constructor). */
const GUTTER_WIDTH = 40;

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
    divider.style.width = `${GUTTER_WIDTH}px`;
    divider.style.flexShrink = "0";
    divider.style.alignSelf = "stretch";
    divider.style.background =
      "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.06) 46%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.06) 54%, transparent 100%)";

    this.containerEl = doc.createElement("div");
    this.containerEl.style.display = "flex";
    this.containerEl.style.alignItems = "flex-start";
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

  /** Re-paginates both columns at a new width/height, splitting the width
   * evenly between them (minus the gutter). The left column preserves its
   * reading position exactly like a single-column host; the right column
   * is simply re-synced afterward. */
  public relayout(width: number, height: number): void {
    const columnWidth = SpreadPaginatedHost.columnWidth(width);
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
   * effect) if the left column is already on the chapter's last page. */
  public nextSpread(): boolean {
    if (this.left.currentPageIndex >= this.left.pageCount - 1) {
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

  public dispose(): void {
    this.left.dispose();
    this.right.dispose();
  }

  /** `true` if `totalWidth` is wide enough to show two columns of at
   * least `MIN_SPREAD_COLUMN_WIDTH` each side by side, with room for the
   * gutter between them. */
  public static isEligible(totalWidth: number): boolean {
    return totalWidth >= MIN_SPREAD_COLUMN_WIDTH * 2 + GUTTER_WIDTH;
  }

  private static columnWidth(totalWidth: number): number {
    return Math.max(MIN_SPREAD_COLUMN_WIDTH, Math.floor((totalWidth - GUTTER_WIDTH) / 2));
  }
}
