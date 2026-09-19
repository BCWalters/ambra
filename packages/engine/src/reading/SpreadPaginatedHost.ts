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
 *
 * Every chapter begins with one blank spacer page in the left column,
 * so its own real first page always lands in the *right* column instead
 * (issue #90) — the familiar book convention of a chapter opening on a
 * fresh right-hand (recto) page, rather than however the previous
 * chapter's own page count happened to land. `pageIndex`/`goToPageIndex`/
 * etc. all still operate purely in terms of *real* page indices (0 is
 * still this spine item's own first page) — the blank spacer is an
 * internal bookkeeping detail (see `virtualIndex`), never something a
 * caller needs to know about or account for. The spacer is a plain
 * overlay drawn *on top of* the left column's iframe, not a substitute
 * for it or a `visibility: hidden` left column the way the right column
 * sometimes is — the left column's iframe must stay fully present and
 * unhidden for assistive technology even while a spacer visually covers
 * it for sighted readers, since (per the previous paragraph) it's the
 * *only* copy of this spine item's complete text a screen reader ever
 * sees, regardless of which page is currently visible on screen.
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
  private readonly blankSpacerEl: HTMLDivElement;
  /** This spread's position, counting the chapter-opening blank spacer
   * (see the class doc comment) as index 0 — i.e. one *higher* than the
   * real page index it's paired with. Always even (left shows
   * `virtualIndex - 1`, right shows `virtualIndex`), advancing/
   * retreating by exactly 2 per `nextSpread`/`previousSpread` call, the
   * same as a real page index would without the spacer. `virtualIndex
   * - 1 < 0` (only ever true at `virtualIndex === 0`) is what actually
   * triggers showing the blank spacer instead of a real page in the
   * left column — see `sync`. */
  private virtualIndex = 0;

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

    // See the class doc comment's note on why this is a plain overlay
    // rather than hiding `left.element` itself. Background color is
    // refreshed from the left column's own current page theme every time
    // `sync` runs (rather than requiring every caller that ever changes
    // the page theme to *also* remember to tell this class about it
    // separately) — see `sync`.
    this.blankSpacerEl = doc.createElement("div");
    this.blankSpacerEl.setAttribute("aria-hidden", "true");
    this.blankSpacerEl.style.position = "absolute";
    this.blankSpacerEl.style.inset = "0";
    this.blankSpacerEl.style.display = "none";

    this.leftWrapperEl = doc.createElement("div");
    this.leftWrapperEl.style.position = "relative";
    this.leftWrapperEl.style.width = `${columnWidth}px`;
    this.leftWrapperEl.style.flexShrink = "0";
    this.leftWrapperEl.append(this.left.element, this.blankSpacerEl);

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

  /** This spine item's own real page index currently shown — 0 is
   * always this chapter's actual first page, regardless of the blank
   * spacer that precedes it in the left column (see the class doc
   * comment) — `virtualIndex` is this class's own internal bookkeeping,
   * never something callers need to translate themselves. Reports the
   * *right* column's real index while the spacer is showing (there's no
   * real left-column page to report yet at that point). */
  public get pageIndex(): number {
    return Math.max(0, this.virtualIndex - 1);
  }

  public get pageCount(): number {
    return this.left.pageCount;
  }

  /** Whether the left column is currently showing the chapter-opening
   * blank spacer (see the class doc comment) rather than a real page —
   * lets a caller's own *static* running header/footer (`PageFurniture`,
   * which has no other way to know this — `pageIndex`/`secondPageIndex`
   * alone can't tell "really is page 0" apart from "the spacer is still
   * showing") skip drawing a title/page-number over a page that's
   * supposed to look genuinely blank. */
  public get isShowingBlankSpacer(): boolean {
    return this.virtualIndex === 0;
  }

  /** The companion column's page index, or `undefined` if there isn't one
   * to show (the primary column is on the last page of the chapter) — for
   * the shell's "Pages X–Y of Z" display. */
  public get secondPageIndex(): number | undefined {
    return this.virtualIndex < this.left.pageCount ? this.virtualIndex : undefined;
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
    this.virtualIndex = 0;
    this.sync();
  }

  /** The left column's current position — see `PaginatedContentHost.
   * currentPosition`. The right column has no independent reading
   * position of its own to preserve; it always just mirrors "one page
   * after the left column" (see `sync`). Reports `undefined` while the
   * blank spacer is showing (there's no real position in the left
   * column to report — callers fall back to the right column's own
   * page via `currentPagesAndDocuments`, same as always). */
  public currentPosition(): DomBreakPoint | undefined {
    return this.virtualIndex === 0 ? undefined : this.left.currentPosition();
  }

  /** Both currently-visible columns' `{ page, document }` pairs (see
   * `PaginatedContentHost.currentPageAndDocument`) — just the left
   * column's if the right one is hidden (the chapter's last, unpaired
   * page — see `sync`), or just the right column's while the blank
   * spacer is showing in the left column. Used to test whether some
   * other DOM position (e.g. a saved bookmark) falls on *either* visible
   * page of the spread, not just the primary one. */
  public currentPagesAndDocuments(): Array<{ page: Page; document: Document }> {
    const result: Array<{ page: Page; document: Document }> = [];
    const leftEntry = this.virtualIndex === 0 ? undefined : this.left.currentPageAndDocument();
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
    this.leftWrapperEl.style.width = `${columnWidth}px`;
    this.left.relayout(columnWidth, height);
    this.right.relayout(columnWidth, height);
    this.sync();
  }

  /** Jumps the left column to `(node, offset)` — used for TOC/fragment
   * navigation, bridged CFI restores, and in-content links, exactly like
   * `PaginatedContentHost.goToPosition` — then re-syncs the right column.
   * Always lands the target in the left column and its immediate next
   * page in the right (i.e. `virtualIndex` becomes whatever real page
   * `left` landed on, plus 1) regardless of the usual left/right parity
   * `goToPageIndex`/`nextSpread`/etc. otherwise maintain — an arbitrary
   * jump doesn't owe the surrounding pagination any particular
   * alignment, and ordinary forward/backward turns from here on simply
   * continue alternating from this new position exactly as they always
   * do. */
  public goToPosition(node: Node, offset: number): void {
    this.left.goToPosition(node, offset);
    this.virtualIndex = this.left.currentPageIndex + 1;
    this.sync();
  }

  /** Jumps to `index` (a real page index — see the class doc comment on
   * why callers never need to think about the blank spacer) and re-syncs
   * the companion column — used by the progress scrubber's exact/
   * proportional seeking (see `ReaderController.openSpineItem`'s
   * `landOnPageIndex`/`landOnFractionInItem` options), which previously
   * had no way to land on a specific page in spread mode at all and
   * silently fell back to the chapter's default first page instead — a
   * real bug, since it meant a scrubber release could land somewhere
   * completely different from what its own drag preview had just shown.
   * Lands `index` in whichever column the spacer-shifted left/right
   * parity puts it in — not always the left column the way it would
   * without the spacer — rather than forcing it into the left column
   * regardless, which would silently break that parity for every page
   * after it. A no-op if `index` is out of range, matching
   * `PaginatedContentHost.goToPageIndex`. */
  public goToPageIndex(index: number): void {
    if (index < 0 || index >= this.left.pageCount) {
      return;
    }
    this.virtualIndex = index % 2 === 0 ? index : index + 1;
    this.sync();
  }

  /** Shows the final spread of the chapter — used when navigating
   * backward into this spine item from the one after it. Simply lands on
   * the chapter's actual last real page via `goToPageIndex`, whichever
   * column the spacer-shifted parity puts it in (alone in the left
   * column, with no companion, for an odd total *extended* page count —
   * see `nextSpread` — exactly matching where forward navigation would
   * have arrived on its own; landing anywhere else here would be a
   * discontinuity the instant the reader turned back forward again). */
  public goToLastPage(): void {
    this.goToPageIndex(Math.max(0, this.left.pageCount - 1));
  }

  /** Whether there's a further spread within this chapter to turn
   * forward to — i.e. whether `nextSpread` would have any effect.
   * Checked against `pageCount - 1`, not `pageCount` (`virtualIndex`'s
   * own effective total, counting the blank spacer as one extra page —
   * see the class doc comment): once the *right* column is showing the
   * chapter's actual last page, there is nothing left to advance to,
   * even though `virtualIndex` hasn't reached its own maximum yet (it
   * never does, for an even real page count — the last spread pairs
   * `pageCount - 2` with `pageCount - 1`). This is `SpreadPaginatedHost`'s
   * own copy of a real, confirmed bug (issue #91) originally found (and
   * fixed) in terms of real page indices, before the blank spacer added
   * its own extra "virtual" page to the count — the exact same
   * off-by-one, just re-derived here against `virtualIndex`'s own
   * effective total instead. Exposed separately from `nextSpread` itself
   * so a caller (the animated turn's own `prepareIncomingSpread`) can
   * check this without side effects. */
  public hasNextSpread(): boolean {
    return this.virtualIndex < this.left.pageCount - 1;
  }

  /** Whether there's a further spread within this chapter to turn
   * backward to — `false` once the left column is already on the
   * chapter's first spread (`virtualIndex === 0`, the blank spacer
   * paired with the chapter's own real first page). */
  public hasPreviousSpread(): boolean {
    return this.virtualIndex > 0;
  }

  /** Turns the spread forward by two pages. Returns `false` (without
   * effect, see `hasNextSpread`) if already on the chapter's last
   * spread. */
  public nextSpread(): boolean {
    if (!this.hasNextSpread()) {
      return false;
    }
    this.virtualIndex = Math.min(this.virtualIndex + 2, this.left.pageCount);
    this.sync();
    return true;
  }

  /** Turns the spread backward by two pages. Returns `false` (without
   * effect, see `hasPreviousSpread`) if already on the chapter's first
   * spread. */
  public previousSpread(): boolean {
    if (!this.hasPreviousSpread()) {
      return false;
    }
    this.virtualIndex = Math.max(this.virtualIndex - 2, 0);
    this.sync();
    return true;
  }

  /** Shows `virtualIndex - 1` in the left column (or, at `virtualIndex
   * === 0`, the blank spacer instead — see the class doc comment) and
   * `virtualIndex` in the right column, hiding the latter (rather than
   * showing stale content) if that would run past the end of the
   * chapter — e.g. an odd total page count leaves the very last page
   * without a companion, same as a real book's blank facing page. Also
   * refreshes the blank spacer's own background color from the left
   * column's current page theme, so it stays looking like a genuine
   * blank page rather than needing every future caller that changes the
   * page theme to separately remember to tell this class about it too. */
  private sync(): void {
    const leftIndex = this.virtualIndex - 1;
    const showSpacer = leftIndex < 0;
    this.blankSpacerEl.style.display = showSpacer ? "block" : "none";
    if (!showSpacer) {
      this.left.goToPageIndex(leftIndex);
    }
    // `getComputedStyle` (not reading `documentElement.style` directly)
    // because the *default* page theme is never actually set as an
    // inline style at all — it's only ever a plain CSS custom property
    // default in the content document's own baked-in stylesheet (see
    // `ReadingTheme.CSS`), which only `getComputedStyle` resolves;
    // `applyPageTheme`'s inline `:root` override, once a reader actually
    // changes the theme, works either way.
    const leftBody = this.left.element.contentDocument?.body;
    if (leftBody) {
      this.blankSpacerEl.style.background = getComputedStyle(leftBody).backgroundColor;
    }

    const rightIndex = this.virtualIndex;
    if (rightIndex < this.right.pageCount) {
      this.right.element.style.visibility = "visible";
      this.right.goToPageIndex(rightIndex);
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
