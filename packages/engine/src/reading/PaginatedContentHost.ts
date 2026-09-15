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

  /** Re-paginates the *currently loaded* content at a new width/height
   * (e.g. a window resize or font-size change), preserving reading
   * position by re-resolving the current page's start position against
   * the freshly-measured pages — per the CFI design principle that
   * position, not page number, is the source of truth across relayout. */
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

    this.pages = PaginationEngine.paginate(iframeDocument.body, this.pageContentHeight);
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

  /** Jumps to the last page — used when navigating backward into this
   * spine item from the one after it. */
  public goToLastPage(): void {
    this.pageIndex = Math.max(0, this.pages.length - 1);
    this.showCurrentPage();
  }

  /** Jumps to whichever page's range contains `(node, offset)` — used for
   * TOC/fragment navigation within an already-open spine item, and for
   * restoring a bridged position after a scroll-to-paginated mode
   * switch. No-op if no page contains the position. */
  public goToPosition(node: Node, offset: number): void {
    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      return;
    }
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
  }

  public dispose(): void {
    this.sandboxedHost.dispose();
  }
}
