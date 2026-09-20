import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { SandboxedContentHost } from "../rendering/SandboxedContentHost.js";
import { ReadingTheme } from "../rendering/ReadingTheme.js";
import type { DomBreakPoint } from "../layout/Page.js";
import { Page } from "../layout/Page.js";
import { PaginationEngine } from "../layout/PaginationEngine.js";
import { loadAssembledSpineItem } from "./SpineItemAssembler.js";

/**
 * Production content host for one spine item in paginated reflowable
 * mode: owns a `SandboxedContentHost`, loads/assembles a spine item into
 * it, paginates the result via `PaginationEngine`, and displays pages by
 * translating the content and clipping the iframe to each page's exact
 * height (see `Page.displayTranslateY`'s doc comment for why the clip
 * must be sized per-page, not to a fixed budget — a real bug caught via
 * Chromium verification during `pagination-engine`).
 *
 * Reserves `ReadingTheme.PAGE_INSET_TOP`/`PAGE_INSET_BOTTOM` px of blank
 * space above/below the text on every page — pure display insets applied
 * here (not CSS on the content document), since a CSS `padding` on `body`
 * would only ever show up once, at the very start/end of the whole spine
 * item's flow, not on every individual paginated page (there's only one
 * underlying `<body>` box; pages are just a clipped window over it). The
 * pagination budget passed to `PaginationEngine` is shrunk by both insets
 * so no page's text ever grows into that reserved space, and the display
 * transform/height both shift by the same amount — see `pageContentHeight`
 * and `showCurrentPage`.
 *
 * Scoped to a single spine item at a time: turning past the first/last
 * page returns `false` from `previousPage`/`nextPage` rather than
 * crossing into an adjacent spine item — that's a book-level navigation
 * decision (which spine item comes next, whether it's linear, etc.) that
 * belongs to a higher-level session/reader controller, not this class.
 */
export class PaginatedContentHost {
  private readonly sandboxedHost: SandboxedContentHost;
  private height: number;
  private pages: Page[] = [];
  private pageIndex = 0;

  public constructor(width: number, height: number, ownerDocument?: Document) {
    this.height = height;
    this.sandboxedHost = new SandboxedContentHost(ownerDocument);
    this.sandboxedHost.element.style.width = `${width}px`;
    this.sandboxedHost.element.style.height = `${height}px`;
  }

  public get element(): HTMLIFrameElement {
    return this.sandboxedHost.element;
  }

  public get pageCount(): number {
    return this.pages.length;
  }

  public get currentPageIndex(): number {
    return this.pageIndex;
  }

  /** The vertical budget available for text once the top/bottom page
   * insets are reserved — never less than a small floor, so a very short
   * available height (e.g. mid-resize) can't produce a degenerate
   * zero/negative pagination budget. */
  private get pageContentHeight(): number {
    return Math.max(50, this.height - ReadingTheme.PAGE_INSET_TOP - ReadingTheme.PAGE_INSET_BOTTOM);
  }

  /** Loads spine item `spineIndex`, paginates it at this host's current
   * width/height, and displays its first page. */
  public async open(contentLoader: ContentLoader, resolver: ResourceUrlResolver, spineIndex: number): Promise<void> {
    const assembledXhtml = await loadAssembledSpineItem(contentLoader, resolver, spineIndex);
    await this.sandboxedHost.render(assembledXhtml);

    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      throw new Error("Sandboxed iframe has no contentDocument after loading (unexpected).");
    }

    // Prevent the iframe's own scrollbar from appearing for content taller
    // than one page — display is purely the transform/height PaginationEngine
    // computes per page (see `showCurrentPage`), not native scrolling.
    iframeDocument.documentElement.style.overflow = "hidden";
    iframeDocument.body.style.overflow = "hidden";

    ReadingTheme.applyPageContentHeight(iframeDocument, this.pageContentHeight);
    this.pages = PaginationEngine.paginate(iframeDocument.body, this.pageContentHeight);
    this.pageIndex = 0;
    this.showCurrentPage();
  }

  /** The DOM position at the start of the currently-displayed page — the
   * position to resolve into a `Locator`/CFI for persistence, or to carry
   * across a `relayout`/mode switch. */
  public currentPosition(): DomBreakPoint | undefined {
    return this.pages[this.pageIndex]?.startBreak;
  }

  /** The currently-displayed `Page` (its `[startBreak, endBreak)` range —
   * see `Page.containsPosition`) paired with the live content document it
   * describes — for callers that need to test whether some other DOM
   * position (e.g. a saved bookmark's resolved CFI) falls on the page
   * actually on screen right now. `undefined` only if nothing has been
   * paginated/rendered yet. */
  public currentPageAndDocument(): { page: Page; document: Document } | undefined {
    const page = this.pages[this.pageIndex];
    const document = this.element.contentDocument;
    return page && document ? { page, document } : undefined;
  }

  /** Re-paginates the *currently loaded* content at a new width/height
   * (e.g. a window resize or font-size change), preserving reading
   * position by re-resolving the current page's start position against
   * the freshly-measured pages — per the CFI design principle that
   * position, not page number, is the source of truth across relayout.
   * The preserved position is passed to `PaginationEngine.paginate` as an
   * anchor, forcing a page break exactly there so it lands at the very
   * top of its page rather than wherever it happens to fall under normal
   * top-down pagination (see `PaginationEngine.paginate`'s `anchor`
   * parameter) — the reader's first visible word never silently shifts
   * mid-page across a resize/font-size change. */
  public relayout(width: number, height: number): void {
    const preserve = this.currentPosition();
    this.height = height;

    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      return;
    }

    this.sandboxedHost.element.style.width = `${width}px`;
    // Reset any transform left over from the previously-displayed page —
    // measureChunks/getClientRects must see the content in its natural,
    // untranslated layout position to measure correctly.
    iframeDocument.body.style.transform = "";

    ReadingTheme.applyPageContentHeight(iframeDocument, this.pageContentHeight);
    this.pages = PaginationEngine.paginate(iframeDocument.body, this.pageContentHeight, preserve);
    if (preserve) {
      const found = PaginationEngine.findPageForPosition(
        this.pages,
        preserve.node,
        preserve.offset ?? 0,
        iframeDocument,
      );
      this.pageIndex = found ? found.index : 0;
    } else {
      this.pageIndex = 0;
    }
    this.showCurrentPage();
  }

  /** Turns to the next page. Returns `false` (without effect) if already
   * on the last page of this spine item. */
  public nextPage(): boolean {
    if (this.pageIndex >= this.pages.length - 1) {
      return false;
    }
    this.pageIndex++;
    this.showCurrentPage();
    return true;
  }

  /** Turns to the previous page. Returns `false` (without effect) if
   * already on the first page of this spine item. */
  public previousPage(): boolean {
    if (this.pageIndex <= 0) {
      return false;
    }
    this.pageIndex--;
    this.showCurrentPage();
    return true;
  }

  /** Jumps directly to a specific page index without any DOM-position
   * anchoring — used by `SpreadPaginatedHost` to show its companion
   * column's "next page after the primary column" purely by index, since
   * that companion page has no independent reading position of its own
   * to preserve. A no-op if `index` is out of range; callers that need
   * "nothing to show" behavior for an out-of-range index (e.g. the
   * trailing unpaired page of a chapter in spread mode) should check
   * `pageCount` themselves first. */
  public goToPageIndex(index: number): void {
    if (index < 0 || index >= this.pages.length) {
      return;
    }
    this.pageIndex = index;
    this.showCurrentPage();
  }

  /** Jumps to the last page — used when navigating backward into this
   * spine item from the one after it. */
  public goToLastPage(): void {
    this.pageIndex = Math.max(0, this.pages.length - 1);
    this.showCurrentPage();
  }

  /** Re-suppresses this host's own native scrollbar (see `open()`'s
   * identical assignment, which this exactly mirrors) — callable on its
   * own, not just something `open()` sets once, because a sandboxed
   * iframe moved to a new DOM parent isn't guaranteed to preserve
   * anything set via JS on its *previous* document object if the
   * browser discards and reloads it as part of the move (see
   * `SpreadPaginatedHost.openMergedWithPreviousTail`'s own defensive
   * `goToPageIndex` reapplication for the identical underlying
   * reasoning, applied there to this page's transform instead — and its
   * own doc comment confirming a reload *did* empirically happen there).
   * A real, confirmed bug of that same reload: reapplying the transform
   * alone left the *reloaded* document's own default (`visible`)
   * overflow in place, silently reintroducing a native scrollbar on a
   * borrowed tail page that should never show one — masked until a
   * separate fix made that tail page visible at all. A no-op if nothing
   * actually reloaded (this host's own document already has this set
   * from `open()`). */
  public reapplyOverflowHidden(): void {
    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      return;
    }
    iframeDocument.documentElement.style.overflow = "hidden";
    iframeDocument.body.style.overflow = "hidden";
  }

  /** Jumps to `(node, offset)` — used for TOC/fragment navigation within
   * an already-open spine item, in-content link targets, and restoring a
   * bridged position after a scroll-to-paginated mode switch. Re-paginates
   * with the target as an anchor (see `PaginationEngine.paginate`) so it
   * always lands at the very top of its page — e.g. clicking a footnote
   * reference shows the footnote as the first line on screen, not buried
   * wherever normal pagination happens to place it. */
  public goToPosition(node: Node, offset: number): void {
    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      return;
    }
    // Reset any transform left over from whichever page was displayed
    // before this call (e.g. `open()`'s own initial page) — exactly the
    // same reason `relayout` resets it first: `measureChunks`/
    // `getClientRects` must see the content in its natural, untranslated
    // layout position, or every measured chunk's `top` silently includes
    // that leftover offset too. Missing this reset was a real bug (caught
    // via real-Chromium measurement): resuming a saved reading position
    // landed the first line of text noticeably too high, close enough to
    // sit under the toolbar, because the page it re-paginated from was
    // still visually shifted down from `open()`'s own initial page.
    iframeDocument.body.style.transform = "";
    ReadingTheme.applyPageContentHeight(iframeDocument, this.pageContentHeight);
    this.pages = PaginationEngine.paginate(iframeDocument.body, this.pageContentHeight, { node, offset });
    const found = PaginationEngine.findPageForPosition(this.pages, node, offset, iframeDocument);
    if (found) {
      this.pageIndex = found.index;
      this.showCurrentPage();
    }
  }

  private showCurrentPage(): void {
    const page = this.pages[this.pageIndex];
    if (!page) {
      return;
    }
    const body = this.sandboxedHost.element.contentDocument?.body;
    if (body) {
      // Shift the content down by the top inset (on top of the page's own
      // display transform) so the first line lands `PAGE_INSET_TOP` px
      // below the iframe's top edge instead of flush against it.
      body.style.transform = `translateY(${page.displayTranslateY + ReadingTheme.PAGE_INSET_TOP}px)`;
    }
    // The iframe's own height reserves both insets around the page's
    // actual content height, so the bottom inset is real blank space
    // rather than clipped-away overflow.
    this.sandboxedHost.element.style.height = `${page.height + ReadingTheme.PAGE_INSET_TOP + ReadingTheme.PAGE_INSET_BOTTOM}px`;
    // The inset bands are only reliably blank *by convention* (nothing
    // actually stops adjacent content from painting there) — the
    // previous page's last line is usually only one line-height above
    // this page's first line, routinely far less than `PAGE_INSET_TOP`,
    // so without an explicit clip it visibly bled into the header/footer
    // bands whenever a page began mid-paragraph (tightly-packed
    // continuation lines) rather than at a new block with its own
    // margin — a real, confirmed, reported bug. `clip-path` on the
    // iframe *element itself* (not anything inside its document) clips
    // its painted output to exactly the page-content band regardless of
    // what the transform happens to place above/below it, independent of
    // how much natural gap the surrounding content has.
    this.sandboxedHost.element.style.clipPath = `inset(${ReadingTheme.PAGE_INSET_TOP}px 0 ${ReadingTheme.PAGE_INSET_BOTTOM}px 0)`;
  }

  /** Temporarily grows this host's iframe to `fullHeight` (the reader
   * pane's own full height) for the duration of a page-turn animation,
   * and drops its `clip-path` entirely (see `suppressClipPathForAnimation`,
   * which this calls — read that doc comment for why `clip-path` can't
   * simply be widened to match, the way this method used to handle it).
   *
   * The height grow specifically fixes its own, separate bug:
   * `showCurrentPage` only ever sizes the iframe to *this specific
   * page's* own content height — often noticeably shorter than a full
   * page (most pages don't end exactly at the page boundary) — and a
   * page-turn animation's box-shadow traces the iframe's *real* box
   * exactly, so a short page's animated edge visibly sat higher than a
   * full page's would ("the bottom of the page in the animation starts
   * a few lines above the actual bottom of the page"). A no-op (for the
   * height part only — `clip-path` is still dropped) if this page is
   * already at least `fullHeight` tall. Call `restoreNaturalHeight` once
   * the animation finishes (whether it committed or reverted) to undo
   * both. */
  public growToFullHeight(fullHeight: number): void {
    this.suppressClipPathForAnimation();
    const page = this.pages[this.pageIndex];
    if (!page) {
      return;
    }
    const naturalHeight = page.height + ReadingTheme.PAGE_INSET_TOP + ReadingTheme.PAGE_INSET_BOTTOM;
    if (fullHeight <= naturalHeight) {
      return;
    }
    this.sandboxedHost.element.style.height = `${fullHeight}px`;
  }

  /** Drops this host's iframe `clip-path` entirely, and shrinks its
   * height to exactly its real visible content (no reserved-but-empty
   * bottom inset band at all) for the duration of a page-turn animation
   * — call on *every* host/column involved in an animated "rotate" or
   * "slide" turn, not just whichever one is actually moving
   * (`growToFullHeight` additionally *grows* height past this for
   * "rotate" specifically, once its own box-shadow-position need is
   * met — see its doc comment for why the two can't be combined into
   * one always-grow-never-shrink method).
   *
   * The `clip-path` removal exists because of a real, confirmed
   * Chromium rendering defect found via direct testing (issue #81):
   * *any* two iframes overlapping on screen, where *either* one has a
   * `clip-path` set — even one that doesn't visually exclude anything —
   * fail to composite opaquely against each other, blending both pages'
   * text together. Confirmed with a plain `translateX` and no
   * rotation/perspective involved at all, so this isn't specific to a
   * 3D transform or to whichever side is actually moving; every
   * overlapping host/column needs this for the animation's duration,
   * full stop.
   *
   * But `clip-path` was *also* the only thing hiding the reserved (by
   * convention, not by any actual layout stop — see `showCurrentPage`'s
   * doc comment) blank band below this page's real content, where the
   * *next* page's own text continues in the underlying linear flow with
   * nothing else in its way. Dropping `clip-path` without also
   * addressing that reopened exactly the bug `clip-path` was introduced
   * to fix in the first place, just for the animation's duration
   * instead of permanently — a real, reported regression ("content
   * above and below the visible page that should be clipped during the
   * animation"). Shrinking the iframe's own *height* to end precisely
   * where this page's real content does (rather than relying on any
   * form of CSS clipping, which is exactly what triggers the
   * compositing bug) sidesteps this: an iframe never paints anything
   * beyond its own box regardless of `clip-path`, so there is no longer
   * any reserved space left for the next page's continuation to bleed
   * into. Call `restoreNaturalHeight` once the turn finishes to restore
   * both. */
  public suppressClipPathForAnimation(): void {
    this.sandboxedHost.element.style.clipPath = "";
    const page = this.pages[this.pageIndex];
    if (page) {
      this.sandboxedHost.element.style.height = `${ReadingTheme.PAGE_INSET_TOP + page.height}px`;
    }
  }

  /** Undoes `growToFullHeight`/`suppressClipPathForAnimation`, restoring
   * this host's natural per-page height and `clip-path` — call once a
   * page-turn animation involving this host has finished *and it wasn't
   * disposed* (a reverted drag, not a committed turn, which disposes
   * the old host outright and so has no need to restore anything). Just
   * re-applies whatever `showCurrentPage` already computes for the
   * current page, so it's safe to call even if neither of those was
   * ever actually called. */
  public restoreNaturalHeight(): void {
    this.showCurrentPage();
  }

  public dispose(): void {
    this.sandboxedHost.dispose();
  }
}
