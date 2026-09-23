import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { SandboxedContentHost } from "../rendering/SandboxedContentHost.js";
import { ReadingTheme } from "../rendering/ReadingTheme.js";
import { makeOverflowingPreElementsFocusable } from "../rendering/PreOverflowFocusability.js";
import type { DomBreakPoint } from "../layout/Page.js";
import { Page } from "../layout/Page.js";
import { PaginationEngine } from "../layout/PaginationEngine.js";
import { loadAssembledSpineItem } from "./SpineItemAssembler.js";
import type { DisclosureState } from "./DisclosureState.js";

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
  private disclosureCleanup: (() => void) | undefined;
  private readerOverlay: { body: HTMLElement; clipPath: string; priority: string } | undefined;
  // Grown past `ReadingTheme.PAGE_INSET_TOP`/`PAGE_INSET_BOTTOM`'s own
  // fixed floor by `refreshInsets` whenever the current font scale/
  // line-spacing demands more room — see `ReadingTheme.insetsForLineHeight`'s
  // own doc comment for why the fixed constants alone aren't always
  // enough. Plain fields (not derived getters) since they're read very
  // frequently (every `showCurrentPage`) and only ever need updating
  // right after a (re)pagination pass, not on every access.
  private insetTop = ReadingTheme.PAGE_INSET_TOP;
  private insetBottom = ReadingTheme.PAGE_INSET_BOTTOM;

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

  /** Re-measures `doc`'s current line-height and grows `insetTop`/
   * `insetBottom` to match, if the reader's current font scale/line-
   * spacing demands more room than the fixed constants alone provide —
   * see `ReadingTheme.insetsForLineHeight`'s doc comment. Called right
   * before every (re)pagination pass (`open`/`relayout`/`goToPosition`/
   * pagination), so `pageContentHeight`/`showCurrentPage`/etc.
   * always use insets sized for *this* pass's own font settings, not
   * whatever the reader had the *previous* time this host paginated. A
   * no-op (keeps the previous value) if `doc`'s line-height can't be
   * measured yet (e.g. this theme's CSS hasn't been injected into it at
   * all) rather than resetting to the bare constants, which would be a
   * regression for a caller that already grew them for a still-current
   * large font scale. */
  private refreshInsets(doc: Document): void {
    const lineHeightPx = ReadingTheme.currentLineHeightPx(doc);
    if (lineHeightPx === undefined) {
      return;
    }
    const insets = ReadingTheme.insetsForLineHeight(lineHeightPx);
    this.insetTop = insets.top;
    this.insetBottom = insets.bottom;
  }

  /** The vertical budget available for text once the top/bottom page
   * insets are reserved — never less than a small floor, so a very short
   * available height (e.g. mid-resize) can't produce a degenerate
   * zero/negative pagination budget. */
  private get pageContentHeight(): number {
    return Math.max(50, this.height - this.insetTop - this.insetBottom);
  }

  /** Loads spine item `spineIndex`, paginates it at this host's current
   * width/height, and displays its first page. */
  public async open(
    contentLoader: ContentLoader,
    resolver: ResourceUrlResolver,
    spineIndex: number,
    disclosures?: DisclosureState,
  ): Promise<void> {
    this.disclosureCleanup?.();
    this.disclosureCleanup = undefined;
    const assembledXhtml = await loadAssembledSpineItem(contentLoader, resolver, spineIndex);
    await this.sandboxedHost.render(assembledXhtml);

    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      throw new Error("Sandboxed iframe has no contentDocument after loading (unexpected).");
    }
    this.disclosureCleanup = disclosures?.attach(spineIndex, iframeDocument);

    // Prevent the iframe's own scrollbar from appearing for content taller
    // than one page — display is purely the transform/height PaginationEngine
    // computes per page (see `showCurrentPage`), not native scrolling.
    iframeDocument.documentElement.style.overflow = "hidden";
    iframeDocument.body.style.overflow = "hidden";

    // A real, confirmed bug (reported: duplicated lines of dialogue
    // straddling a spread's left/right columns in a book using an
    // embedded italic font face): the iframe's `load` event fires once
    // the document/images/stylesheets are loaded, but *not* once
    // `@font-face` resources are — those are fetched/parsed lazily,
    // triggered by the initial layout pass, and can still be in flight
    // right when `PaginationEngine.paginate` below measures line boxes.
    // In `SpreadPaginatedHost`, the left and right columns are two
    // wholly independent `PaginatedContentHost`s/iframes/font caches
    // loading the *same* content in parallel; if one column's custom
    // font finishes loading (swapping in, and reflowing every line
    // after it) before its own measurement runs but the other column's
    // doesn't, the two columns' `pages` arrays genuinely stop agreeing
    // with each other — and since the right column blindly displays
    // `pageIndex + 1` from its *own* (differently-cut) array, its first
    // page can start a line or two earlier than the left column's page
    // actually ended, duplicating that text in both columns at once.
    // Waiting for `fonts.ready` here ensures pagination always measures
    // final layout, with every embedded font already resolved — for
    // *every* `PaginatedContentHost`, so left/right columns (as well as
    // ordinary single-column mode, which this same race could otherwise
    // silently mis-paginate too) always agree.
    await PaginatedContentHost.waitForFontsReady(iframeDocument);
    makeOverflowingPreElementsFocusable(iframeDocument);

    this.refreshInsets(iframeDocument);
    ReadingTheme.applyPageContentHeight(iframeDocument, this.pageContentHeight);
    this.pages = PaginationEngine.paginate(iframeDocument.body, this.pageContentHeight);
    this.pageIndex = 0;
    this.showCurrentPage();
  }

  /** The most any single `open()` call will wait on `document.fonts.ready`
   * before giving up and pagination proceeding anyway — a defensive
   * ceiling only, not expected to normally matter (blob-URL font
   * resources have no real network latency, just parse time), guarding
   * against a malformed/unsupported embedded font file that could
   * otherwise leave `fonts.ready` unsettled indefinitely and stall the
   * whole spine item load. */
  private static readonly FONTS_READY_TIMEOUT_MS = 2_000;

  /** Resolves once `doc`'s `FontFaceSet` has settled every load triggered
   * by rendering it so far (see `open()`'s own doc comment for why this
   * matters), or after `FONTS_READY_TIMEOUT_MS`, whichever comes first.
   * `document.fonts` isn't guaranteed to exist in every environment this
   * code might run in (e.g. a test DOM polyfill), so this is a no-op
   * there rather than throwing. */
  private static async waitForFontsReady(doc: Document): Promise<void> {
    if (!doc.fonts) {
      return;
    }
    await Promise.race([
      doc.fonts.ready.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, PaginatedContentHost.FONTS_READY_TIMEOUT_MS)),
    ]);
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

  /** Reflows while preserving a DOM reading position. Single-page readers
   * may force a break at that position. Spread readers use `forceAnchor:
   * false`: their two independently loaded documents must share canonical
   * page boundaries, regardless of the route used to reach a page. */
  public relayout(width: number, height: number, anchorOverride?: DomBreakPoint, forceAnchor = true): void {
    const preserve = anchorOverride ?? this.currentPosition();
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
    makeOverflowingPreElementsFocusable(iframeDocument);

    this.refreshInsets(iframeDocument);
    ReadingTheme.applyPageContentHeight(iframeDocument, this.pageContentHeight);
    this.pages = PaginationEngine.paginate(iframeDocument.body, this.pageContentHeight, forceAnchor ? preserve : undefined);
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

  /** Jumps to `(node, offset)` — used for TOC/fragment navigation within
   * an already-open spine item, in-content link targets, and restoring a
   * bridged position after a scroll-to-paginated mode switch. Re-paginates
   * with the target as an anchor (see `PaginationEngine.paginate`) so it
   * always lands at the very top of its page — e.g. clicking a footnote
   * reference shows the footnote as the first line on screen, not buried
   * wherever normal pagination happens to place it. */
  public goToPosition(node: Node, offset: number, forceAnchor = true): void {
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
    this.refreshInsets(iframeDocument);
    ReadingTheme.applyPageContentHeight(iframeDocument, this.pageContentHeight);
    this.pages = PaginationEngine.paginate(iframeDocument.body, this.pageContentHeight, forceAnchor ? { node, offset } : undefined);
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
      // display transform) so the first line lands `insetTop` px below
      // the iframe's top edge instead of flush against it.
      body.style.transform = `translateY(${page.displayTranslateY + this.insetTop}px)`;
    }
    // The iframe's own height reserves both insets around the page's
    // actual content height, so the bottom inset is real blank space
    // rather than clipped-away overflow.
    this.sandboxedHost.element.style.height = `${page.height + this.insetTop + this.insetBottom}px`;
    // The inset bands are only reliably blank *by convention* (nothing
    // actually stops adjacent content from painting there) — the
    // previous page's last line is usually only one line-height above
    // this page's first line, routinely far less than `insetTop`,
    // so without an explicit clip it visibly bled into the header/footer
    // bands whenever a page began mid-paragraph (tightly-packed
    // continuation lines) rather than at a new block with its own
    // margin — a real, confirmed, reported bug. `clip-path` on the
    // iframe *element itself* (not anything inside its document) clips
    // its painted output to exactly the page-content band regardless of
    // what the transform happens to place above/below it, independent of
    // how much natural gap the surrounding content has.
    this.sandboxedHost.element.style.clipPath = `inset(${this.insetTop}px 0 ${this.insetBottom}px 0)`;
    if (this.readerOverlay) this.applyReaderOverlay();
  }

  /** Top-layer UI escapes body clipping, but not the iframe's own clip. Give it
   * the reading pane while keeping publication paint confined to this page. */
  public revealReaderOverlay(): () => void {
    const body = this.element.contentDocument?.body;
    if (!body) return () => {};
    const overlay = this.readerOverlay ?? {
      body,
      clipPath: body.style.getPropertyValue("clip-path"),
      priority: body.style.getPropertyPriority("clip-path"),
    };
    this.readerOverlay = overlay;
    this.applyReaderOverlay();
    return () => {
      if (this.readerOverlay !== overlay) return;
      this.readerOverlay = undefined;
      body.style.setProperty("clip-path", overlay.clipPath, overlay.priority);
      this.showCurrentPage();
    };
  }

  private applyReaderOverlay(): void {
    const page = this.pages[this.pageIndex];
    const body = this.readerOverlay?.body;
    if (!page || !body) return;
    this.element.style.height = `${this.height}px`;
    this.element.style.clipPath = "";
    // The engine applies a translation (not scaling) to body. Convert the
    // existing viewport clip to its local coordinates without repagination.
    const top = this.insetTop - body.getBoundingClientRect().top;
    const bottom = top + page.height;
    body.style.setProperty("clip-path",
      `polygon(0 ${top}px, 100% ${top}px, 100% ${bottom}px, 0 ${bottom}px)`, "important");
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
    const naturalHeight = page.height + this.insetTop + this.insetBottom;
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
      this.sandboxedHost.element.style.height = `${this.insetTop + page.height}px`;
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
    this.readerOverlay = undefined;
    this.disclosureCleanup?.();
    this.disclosureCleanup = undefined;
    this.sandboxedHost.dispose();
  }
}
