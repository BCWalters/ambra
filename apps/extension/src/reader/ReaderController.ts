import {
  AccessibilityController,
  BookPaginationEstimator,
  ContentLoader,
  EpubCfi,
  EpubContainer,
  FixedContentHost,
  FixedLayoutSpreadPlanner,
  FixedSpreadHost,
  Locator,
  LocatorResolver,
  NavigationDocument,
  NCX_MEDIA_TYPE,
  PaginatedContentHost,
  ReadingTheme,
  ResourceUrlResolver,
  resolveEpubPath,
  ScrollContentHost,
  splitHrefFragment,
  SpreadPaginatedHost,
} from "@ambra/engine";
import type {
  FontFamilyChoice,
  HighlightStyle,
  NavPoint,
  PackageDocument,
  Page,
  PageTheme,
} from "@ambra/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { Bookmark } from "../library/LibraryDatabase.js";
import { fetchBookDescription } from "../library/BookDescriptionEnrichment.js";
import { BookmarkManager } from "./BookmarkManager.js";
import { HighlightInteraction } from "./HighlightInteraction.js";
import { HighlightManager } from "./HighlightManager.js";
import { PageTurnAnimator } from "./PageTurnAnimator.js";
import { SearchCoordinator } from "./SearchCoordinator.js";
import { DEFAULT_CHROME_THEME } from "./chromeTheme.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";
import { DEFAULT_PAGE_TURN_ANIMATION_STYLE } from "./PageTurnAnimationStyle.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";
import type { ViewMode } from "./ViewMode.js";
import type {
  ActiveHighlightState,
  BookDetails,
  EpubInspectionData,
  EpubInspectionFile,
  FootnotePopupState,
  ImageViewerState,
  PreviewPosition,
  ReaderSnapshot,
  SelectionToolbarState,
} from "./ReaderTypes.js";
import { DiagnosticsLog } from "./DiagnosticsLog.js";
import { DEFAULT_LOCALE } from "../i18n/Locale.js";
import { getTranslate } from "../i18n/LocaleContext.js";
import type { Translate } from "../i18n/LocaleContext.js";

/** The smallest a rendered image is allowed to be (in both CSS px
 * dimensions) for a click/keypress on it to open the image viewer —
 * checked against rendered size, not intrinsic resolution, so a small
 * decorative icon can't accidentally "zoom" into a meaningless blur. */
const MIN_ZOOMABLE_IMAGE_SIZE = 100;

/** Caps how many times a book with no discoverable description gets a
 * fresh `fetchBookDescription` attempt on subsequent opens. */
const MAX_DESCRIPTION_FETCH_ATTEMPTS = 3;

/** `epub:type`'s namespace (EPUB3 Structural Semantics vocabulary) —
 * see `hasEpubType`/`applyEpubTypeAriaRoles`. */
const OPS_NAMESPACE = "http://www.idpf.org/2007/ops";

/** Checks whether `element`'s `epub:type` attribute (a space-separated
 * token list, e.g. `epub:type="noteref"`) contains `token`. */
function hasEpubType(element: Element, token: string): boolean {
  const value = element.getAttributeNS(OPS_NAMESPACE, "type");
  return value ? value.trim().split(/\s+/).includes(token) : false;
}

/** Maps a handful of common `epub:type` values to their DPUB-ARIA role
 * equivalent (see the DPUB-ARIA module) so assistive technology
 * announces, e.g., a footnote reference as "footnote reference" rather
 * than a plain, generic "link" — deliberately just the footnote/endnote
 * pair this reader's own noteref popup (see `setUpContentInteraction`)
 * cares about, not the full DPUB-ARIA vocabulary; broader `epub:type`
 * role mapping is out of scope for this pass. */
const EPUB_TYPE_ARIA_ROLES: ReadonlyMap<string, string> = new Map([
  ["noteref", "doc-noteref"],
  ["footnote", "doc-footnote"],
  ["endnote", "doc-endnote"],
]);

/** Sets the matching DPUB-ARIA `role` (see `EPUB_TYPE_ARIA_ROLES`) on
 * every element in `doc` with a recognized `epub:type`, unless it
 * already declares its own explicit `role`. Idempotent (safe to call
 * repeatedly on the same document), and no-ops entirely for content
 * that declares no `epub:type` at all — the overwhelming majority of
 * EPUB2-era or otherwise plain content.
 *
 * Walks every element directly (via `getElementsByTagName("*")`) rather
 * than `querySelectorAll("[epub\\:type]")` — confirmed real, `epub:type`
 * being a namespaced attribute (`xmlns:epub="..."`) means CSS attribute
 * selectors don't match it at all in a real XHTML document, silently
 * returning zero results rather than erroring. `hasEpubType`'s
 * `getAttributeNS` check below is the only reliable, prefix-independent
 * way to actually read it. */
function applyEpubTypeAriaRoles(doc: Document): void {
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    if (element.hasAttribute("role") || !element.getAttributeNS(OPS_NAMESPACE, "type")) {
      continue;
    }
    for (const [epubType, role] of EPUB_TYPE_ARIA_ROLES) {
      if (hasEpubType(element, epubType)) {
        element.setAttribute("role", role);
        break;
      }
    }
  }
}

/**
 * Owns one reading session's state — which book, spine item, and view
 * mode are active — and orchestrates the engine on the React reader
 * UI's behalf: opening/switching spine items, turning pages, switching
 * between paginated and scroll mode, relaying window resizes,
 * persisting/restoring reading position, and accessibility (keyboard
 * navigation, managed focus, live-region announcements). React never
 * touches the engine objects directly — it reads `snapshot()` and calls
 * methods here, then is notified (`subscribe`) to re-render.
 */
export class ReaderController {
  private host:
    PaginatedContentHost | ScrollContentHost | FixedContentHost | SpreadPaginatedHost | FixedSpreadHost | undefined;
  /** The wrapper `stageHiddenHostElement` created around `this.host`'s
   * element — removed once `this.host` is replaced. `this.host.element`
   * itself must never be reparented once loaded (most browsers reload
   * an iframe that's disconnected and reattached). */
  private hostWrapperEl: HTMLDivElement | undefined;
  private viewMode: ViewMode = "paginated";
  private fontScale = 1;
  private lineSpacing = ReadingTheme.DEFAULT_LINE_SPACING;
  private letterSpacing = ReadingTheme.DEFAULT_LETTER_SPACING;
  private contentWidthEm = ReadingTheme.DEFAULT_CONTENT_WIDTH_EM;
  private fontFamily: FontFamilyChoice = ReadingTheme.DEFAULT_FONT_FAMILY;
  private pageTheme: PageTheme = ReadingTheme.DEFAULT_PAGE_THEME;
  private brightness = ReadingTheme.DEFAULT_BRIGHTNESS;
  /** Pure UI state — never applied to a content document the way font/
   * page settings are; the shell reads it straight off the snapshot. */
  private chromeTheme: ChromeThemeChoice = DEFAULT_CHROME_THEME;
  private pageTurnAnimationStyle: PageTurnAnimationStyle = DEFAULT_PAGE_TURN_ANIMATION_STYLE;
  private spineIndex = 0;
  /** The most recently requested reader-pane size. */
  private width = 0;
  private height = 0;
  /** The size the *current* host was actually last laid out at — lets
   * `resize` recognize a no-op (a deferred resize matching what
   * `openSpineItem` already laid the fresh host out at). */
  private appliedWidth = 0;
  private appliedHeight = 0;
  /** Whether the currently-open `FixedSpreadHost` was last built with
   * spread mode eligible — `undefined` when the current host isn't a
   * `FixedSpreadHost`. See `shouldSwitchSpreadMode`. */
  private fixedLayoutSpreadEligible: boolean | undefined;
  /** Drives the `Spinner` overlay — deliberately delayed from when a
   * spine-item load actually starts (issue #88), since most loads
   * resolve near-instantly and a flash of spinner reads as more
   * distracting than nothing. `isLoadInFlight` is the undelayed signal
   * other logic (e.g. `resize`) needs immediately. */
  private isLoading = false;
  /** `true` for the entire duration of an in-progress `openSpineItem`
   * call, set/cleared synchronously — unlike the delayed `isLoading`,
   * anything needing to know *right now* whether it's unsafe to act
   * (currently `resize`) must check this instead. */
  private isLoadInFlight = false;
  /** Guards against overlapping `turnPage` calls — rapid repeated
   * clicks could otherwise start a second animated turn while the first
   * was still in flight, racing to swap `this.host` and corrupting
   * pagination state. Ignores a call that arrives mid-turn rather than
   * queuing it. */
  private isTurningPage = false;
  /** Set by `prepareMergedIncomingSpread` right before returning a
   * merged host, so `turnPageInternal` knows to adopt this as the new
   * `this.spineIndex` (this turn crossed a chapter boundary even though
   * it took the same "just another spread turn" animation path). */
  private pendingSpreadMergeSpineIndex: number | undefined;
  /** Incremented on every new page-turn gesture; a stale gesture whose
   * captured token no longer matches discards its own work instead of
   * clobbering newer state (a second safety net beyond `isTurningPage`
   * for the same race). */
  private turnToken = 0;
  /** Incremented at the start of every `openSpineItem` call; every
   * return path checks its captured token against the current one so a
   * stale, slow-loading call can't clobber a newer one's result once it
   * finally resolves. */
  private spineOpenToken = 0;
  /** A resize that arrived while an `openSpineItem` was already in
   * flight — applying it immediately would relayout a host that's
   * mid-open, against stale content. Recorded and applied once the
   * in-flight open settles instead. */
  private pendingResize: { width: number; height: number } | undefined;
  private error: string | undefined;
  private errorSeverity: "blocking" | "transient" | undefined;
  private containerEl: HTMLDivElement | undefined;
  private readonly accessibility = new AccessibilityController();
  private readonly diagnostics = new DiagnosticsLog();
  private announcement: string | undefined;
  private announcementId = 0;
  /** Translates announcement text into the current UI locale — a plain
   * field (rather than threading `t` through every method) since
   * `ReaderApp` sets the real translator once it mounts inside
   * `LocaleProvider`. */
  private translate: Translate = getTranslate(DEFAULT_LOCALE);
  /** Increments on every pointerdown inside the content — `Toolbar`
   * watches this to hide itself immediately, rather than waiting for
   * the usual auto-hide timeout. */
  private contentPointerActivityId = 0;
  private imageViewer: ImageViewerState | undefined;
  /** Focus target to restore when the image viewer closes. */
  private imageViewerReturnFocusTarget: Element | undefined;
  private readonly highlights: HighlightManager;
  private readonly bookmarks: BookmarkManager;
  private selectionToolbar: SelectionToolbarState | undefined;
  /** The live `Range` backing `selectionToolbar` — `addHighlight` uses
   * this directly rather than re-querying `getSelection()`, since focus
   * may have moved away from the content iframe by the time a reader
   * clicks a toolbar swatch. */
  private pendingSelectionRange: Range | undefined;
  /** The existing highlight tapped/clicked while reading (not a fresh
   * selection). Independent of `selectionToolbar` — only one is ever
   * set at a time, but they're separate fields since their popup UIs
   * differ (color swatches vs. note/delete). */
  private activeHighlight: ActiveHighlightState | undefined;
  /** An `epub:type="noteref"` link's target content, shown inline
   * instead of navigating — see `setUpContentInteraction`. */
  private footnotePopup: FootnotePopupState | undefined;
  private readonly highlightInteraction: HighlightInteraction;
  private readonly pageTurnAnimator = new PageTurnAnimator({
    containerEl: () => this.containerEl,
    height: () => this.height,
    pageTheme: () => this.pageTheme,
    pageTurnAnimationStyle: () => this.pageTurnAnimationStyle,
  });
  /** Book-wide full-text search plus the live "highlight matches on the
   * current page" spotlight (issue #100) — see `SearchCoordinator`. */
  private readonly searchCoordinator: SearchCoordinator;

  /** Detaches the current spine item's in-content interaction listeners
   * (link clicks, image-viewer triggers) — re-created on every
   * `openSpineItem` call since each gets a fresh iframe/document. */
  private contentInteractionCleanup: (() => void) | undefined;
  /** Detaches the current drag-page-turn `pointerdown` listener — same
   * lifecycle as `contentInteractionCleanup`. */
  private dragCleanup: (() => void) | undefined;
  private isAnimatingPageTurn = false;
  /** Background-paginates the whole book for book-wide page numbers —
   * `undefined` until `mount` creates it. */
  private bookPagination: BookPaginationEstimator | undefined;
  /** An offscreen, zero-size-but-attached container `bookPagination`
   * mounts its measurement iframes into (a detached element doesn't lay
   * out in real browsers). Created in `mount`, torn down in `dispose`. */
  private hiddenMeasureContainer: HTMLDivElement | undefined;

  private readonly listeners = new Set<() => void>();
  private cachedSnapshot: ReaderSnapshot | undefined;
  /** Lazily created by `getBookDetails`, revoked in `dispose`. */
  private cachedCoverUrl: string | undefined;
  /** Lazily created per-path by `getInspectionFilePreviewUrl` (issue
   * #46), revoked in `dispose`. */
  private readonly inspectionPreviewUrlCache = new Map<string, string>();
  /** The OCF rootfile path, set once in `open` — only used by
   * `getEpubInspectionData` (issue #46). */
  private rootFilePath = "";

  private constructor(
    private readonly contentLoader: ContentLoader,
    private readonly resolver: ResourceUrlResolver,
    private readonly locatorResolver: LocatorResolver,
    public readonly pkg: PackageDocument,
    public readonly navigation: NavigationDocument,
    private readonly bookId: string,
    private readonly library: LibraryDatabase,
  ) {
    this.searchCoordinator = new SearchCoordinator(contentLoader, locatorResolver, pkg.spine, {
      goToCfi: (cfi) => this.goToCfi(cfi),
      chapterLabel: (spineIndex) => this.chapterLabel(spineIndex),
      repaintHighlight: () => this.highlightInteraction.applySearchHighlightToCurrentHost(),
      notify: () => this.notify(),
    });
    this.bookmarks = new BookmarkManager(library, bookId, locatorResolver, {
      currentPosition: () => this.host?.currentPosition(),
      currentPagesAndDocuments: () => this.currentPagesAndDocuments(),
      currentPageIndex: () => {
        if (this.host instanceof PaginatedContentHost) return this.host.currentPageIndex;
        if (this.host instanceof SpreadPaginatedHost) return this.host.pageIndex;
        return undefined;
      },
      spineIndex: () => this.spineIndex,
      chapterLabel: (spineIndex) => this.chapterLabel(spineIndex),
      announce: (translationKey) => this.announce(this.translate(translationKey)),
      notify: () => this.notify(),
    });
    this.highlights = new HighlightManager(library, bookId, locatorResolver, {
      spineIndex: () => this.spineIndex,
      isFixedLayoutHost: () => this.isFixedLayoutHost(this.host),
      pendingSelectionRange: () => this.pendingSelectionRange,
      selectionToolbarAnchor: () => this.selectionToolbar,
      dismissSelectionToolbar: () => this.dismissSelectionToolbar(),
      applyHighlightsToCurrentHost: () => this.highlightInteraction.applyHighlightsToCurrentHost(),
      updateNoteMarkers: () => this.highlightInteraction.updateNoteMarkers(),
      announce: (translationKey) => this.announce(this.translate(translationKey)),
      getActiveHighlight: () => this.activeHighlight,
      setActiveHighlight: (state) => {
        this.activeHighlight = state;
      },
      notify: () => this.notify(),
    });
    this.highlightInteraction = new HighlightInteraction(locatorResolver, {
      spineIndex: () => this.spineIndex,
      isFixedLayoutHost: () => this.isFixedLayoutHost(this.host),
      allContentDocuments: () => this.allContentDocuments(),
      mergedTailDocument: () => (this.host instanceof SpreadPaginatedHost ? this.host.mergedTailDocument() : undefined),
      forSpineIndex: (spineIndex) => this.highlights.forSpineIndex(spineIndex),
      currentSearchHighlightQuery: () => this.searchCoordinator.currentHighlightQuery,
      setPendingSelectionRange: (range) => {
        this.pendingSelectionRange = range;
      },
      setSelectionToolbar: (state) => {
        this.selectionToolbar = state;
      },
      setActiveHighlight: (state) => {
        this.activeHighlight = state;
      },
      notify: () => this.notify(),
    });
  }

  /** Opens a book from its raw bytes. `bookId`/`library` persist and
   * restore reading position — see `mount`/`saveProgress`. */
  public static async open(
    buffer: ArrayBuffer,
    bookId: string,
    library: LibraryDatabase,
  ): Promise<ReaderController> {
    const container = await EpubContainer.open(buffer);
    const contentLoader = await ContentLoader.create(container);
    const resolver = new ResourceUrlResolver(contentLoader);
    const pkg = contentLoader.packageDocument;
    const navigation = await NavigationDocument.load(container);
    const locatorResolver = new LocatorResolver(pkg, contentLoader);

    const controller = new ReaderController(
      contentLoader,
      resolver,
      locatorResolver,
      pkg,
      navigation,
      bookId,
      library,
    );
    controller.rootFilePath = container.rootFilePath;
    controller.viewMode = (await library.getDefaultViewMode()) ?? "paginated";
    controller.fontScale = (await library.getDefaultFontScale()) ?? 1;
    controller.lineSpacing =
      (await library.getDefaultLineSpacing()) ?? ReadingTheme.DEFAULT_LINE_SPACING;
    controller.letterSpacing =
      (await library.getDefaultLetterSpacing()) ?? ReadingTheme.DEFAULT_LETTER_SPACING;
    controller.contentWidthEm =
      (await library.getDefaultContentWidth()) ?? ReadingTheme.DEFAULT_CONTENT_WIDTH_EM;
    controller.fontFamily =
      (await library.getDefaultFontFamily()) ?? ReadingTheme.DEFAULT_FONT_FAMILY;
    controller.pageTheme = (await library.getDefaultPageTheme()) ?? ReadingTheme.DEFAULT_PAGE_THEME;
    controller.brightness = (await library.getDefaultBrightness()) ?? ReadingTheme.DEFAULT_BRIGHTNESS;
    controller.chromeTheme = (await library.getDefaultChromeTheme()) ?? DEFAULT_CHROME_THEME;
    controller.pageTurnAnimationStyle =
      (await library.getDefaultPageTurnAnimationStyle()) ?? DEFAULT_PAGE_TURN_ANIMATION_STYLE;
    controller.highlights.load(await library.listHighlightsForBook(bookId));
    await controller.bookmarks.load();
    // Fire-and-forget: never awaited, and any failure inside is already
    // caught by `fetchBookDescription` itself — a slow or failing
    // network request must never delay (or be able to break) opening
    // the book itself.
    void controller.maybeEnrichDescription();
    return controller;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public snapshot(): ReaderSnapshot {
    if (!this.cachedSnapshot) {
      let pageIndex = 0;
      let pageCount = 0;
      if (this.host instanceof PaginatedContentHost) {
        pageIndex = this.host.currentPageIndex;
        pageCount = this.host.pageCount;
      } else if (this.host instanceof SpreadPaginatedHost) {
        pageIndex = this.host.pageIndex;
        pageCount = this.host.pageCount;
      }

      // Book-wide numbers only make sense in paginated/spread/
      // fixed-layout mode — scroll mode has no discrete "page" to place
      // within a book-wide count.
      let bookPageIndex: number | undefined;
      let bookPageCount: number | undefined;
      if (
        this.bookPagination &&
        (this.host instanceof PaginatedContentHost ||
          this.host instanceof SpreadPaginatedHost ||
          this.host instanceof FixedSpreadHost)
      ) {
        const position = this.bookPagination.positionFor(this.spineIndex, pageIndex);
        bookPageIndex = position.currentPage;
        bookPageCount = position.totalPages;
      }

      this.cachedSnapshot = {
        title: this.pkg.metadata.title,
        toc: this.navigation.toc.items,
        spineIndex: this.spineIndex,
        spineLength: this.pkg.spine.length,
        currentSpinePath: this.pkg.spine[this.spineIndex]?.manifestItem.path,
        firstSpinePath: this.pkg.spine[0]?.manifestItem.path,
        highlightedTocPath: this.tocHighlightPath(),
        tocPageNumbers: this.computeTocPageNumbers(),
        currentChapterLabel: this.chapterLabel(this.spineIndex),
        viewMode: this.viewMode,
        isFixedLayout: this.isFixedLayoutHost(this.host),
        pageIndex,
        pageCount,
        bookPageIndex,
        bookPageCount,
        isSpread:
          this.host instanceof SpreadPaginatedHost ||
          (this.host instanceof FixedSpreadHost && this.host.spread?.kind === "pair"),
        secondPageIndex:
          this.host instanceof SpreadPaginatedHost ? this.host.secondPageIndex : undefined,
        isPrimaryPageMergedTail:
          this.host instanceof SpreadPaginatedHost ? this.host.isShowingMergedTail : false,
        paneWidth: this.width,
        isAnimatingPageTurn: this.isAnimatingPageTurn,
        isBookmarked: this.bookmarks.onCurrentPage().length > 0,
        bookmarkedPages: this.bookmarks.flagsForCurrentPages(),
        fontScale: this.isFixedLayoutHost(this.host) ? 1 : this.fontScale,
        lineSpacing: this.isFixedLayoutHost(this.host) ? ReadingTheme.DEFAULT_LINE_SPACING : this.lineSpacing,
        letterSpacing: this.isFixedLayoutHost(this.host)
          ? ReadingTheme.DEFAULT_LETTER_SPACING
          : this.letterSpacing,
        contentWidthEm: this.isFixedLayoutHost(this.host)
          ? ReadingTheme.DEFAULT_CONTENT_WIDTH_EM
          : this.contentWidthEm,
        fontFamily: this.fontFamily,
        pageTheme: this.pageTheme,
        brightness: this.brightness,
        chromeTheme: this.chromeTheme,
        pageTurnAnimationStyle: this.pageTurnAnimationStyle,
        isLoading: this.isLoading,
        error: this.error,
        errorSeverity: this.errorSeverity,
        announcement: this.announcement,
        announcementId: this.announcementId,
        contentPointerActivityId: this.contentPointerActivityId,
        imageViewer: this.imageViewer,
        selectionToolbar: this.selectionToolbar,
        activeHighlight: this.activeHighlight,
        noteMarkers: this.highlightInteraction.noteMarkers,
        highlights: this.highlights.allSorted(),
        ...this.searchCoordinator.snapshot,
        footnotePopup: this.footnotePopup,
      };
    }
    return this.cachedSnapshot;
  }

  private notify(): void {
    this.cachedSnapshot = undefined;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Bumps `contentPointerActivityId` and notifies. */
  private bumpContentActivity(): void {
    this.contentPointerActivityId++;
    this.notify();
  }

  /** Mounts the current view mode's content host into `containerEl` and
   * opens a previously-saved reading position, or spine item 0. Call
   * once, after the container div is available. */
  public async mount(containerEl: HTMLDivElement, width: number, height: number): Promise<void> {
    this.containerEl = containerEl;
    this.width = width;
    this.height = height;
    this.setUpBookPagination(containerEl.ownerDocument);
    this.setUpGlobalArrowKeyFallback(containerEl.ownerDocument);

    // Guards against a resize racing with the async progress lookup
    // below, before `openSpineItem` sets this same flag itself. Shown
    // immediately (no delay, unlike a later in-session chapter turn) —
    // this is the very first load, with no existing content on screen
    // yet to make a brief delay unnoticeable.
    this.isLoading = true;
    this.isLoadInFlight = true;
    this.notify();

    const resumed = await this.tryResume();
    if (!resumed) {
      await this.openSpineItem(0);
    }
  }

  /** Creates the offscreen container `BookPaginationEstimator` mounts its
   * measurement iframes into. `display: none` would be simpler but real
   * browsers don't lay out `display: none` content — `position: fixed`
   * plus zero size and `overflow: hidden` keeps it invisible while
   * still laying out. */
  private setUpBookPagination(ownerDocument: Document): void {
    const container = ownerDocument.createElement("div");
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "0";
    container.style.height = "0";
    container.style.overflow = "hidden";
    container.setAttribute("aria-hidden", "true");
    ownerDocument.body.appendChild(container);
    this.hiddenMeasureContainer = container;
    this.bookPagination = new BookPaginationEstimator(
      this.contentLoader,
      this.resolver,
      this.pkg.spine,
      this.pkg.metadata.renditionLayout,
      container,
    );
  }

  /** (Re-)starts `bookPagination` at the current width/height/font
   * settings, prioritized around the current spine item, notifying
   * subscribers as each spine item's count becomes known. Measures at
   * the effective single-column width — in spread mode that's each
   * column's own width, not the whole pane — so the book-wide page
   * number agrees with what's on screen. */
  private refreshBookPagination(): void {
    if (!this.bookPagination || this.isFixedLayoutHost(this.host)) {
      return;
    }
    const measureWidth =
      this.host instanceof SpreadPaginatedHost
        ? SpreadPaginatedHost.effectiveColumnWidth(this.width)
        : this.width;
    void this.bookPagination.run(
      this.spineIndex,
      measureWidth,
      this.height,
      this.fontScale,
      this.fontFamily,
      this.lineSpacing,
      this.letterSpacing,
      this.contentWidthEm,
      () => {
        this.notify();
      },
    );
  }

  /** Looks up a saved CFI and, if it resolves to a valid spine item,
   * opens directly there. Returns `false` if there's no saved progress
   * or it can't be resolved, so the caller falls back to the start. */
  private async tryResume(): Promise<boolean> {
    try {
      const progress = await this.library.getProgress(this.bookId);
      if (!progress) {
        return false;
      }
      const cfi = EpubCfi.parse(progress.cfi);
      const spineIndex = this.pkg.findSpineIndexByPackageCfiSteps(cfi.packageSteps);
      if (spineIndex === undefined) {
        return false;
      }
      await this.openSpineItem(spineIndex, { bridgeCfi: progress.cfi });
      return true;
    } catch {
      return false;
    }
  }

  /** Resolves the current position to a CFI and persists it as reading
   * progress. Called after every navigation settles; also exposed as
   * `flushProgress` for the reader page to call on visibility/unload. */
  private async saveProgress(): Promise<void> {
    const position = this.host?.currentPosition();
    if (!position) {
      return;
    }
    try {
      const locator = this.locatorResolver.generate(
        this.spineIndex,
        position.node,
        position.offset,
      );
      await this.library.saveProgress(this.bookId, locator.cfi);
    } catch {
      // Best-effort: resume-reading is a convenience, not something
      // that should surface an error mid-navigation.
    }
  }

  public flushProgress(): Promise<void> {
    return this.saveProgress();
  }

  public async addBookmark(): Promise<Bookmark | undefined> {
    return this.bookmarks.add();
  }

  public listBookmarks(): Promise<Bookmark[]> {
    return this.bookmarks.list();
  }

  public removeBookmark(id: string): Promise<void> {
    return this.bookmarks.remove(id);
  }

  /** The `{ page, document }` pair(s) on screen right now — both
   * columns of a spread, the single page in paginated mode, or empty
   * for scroll mode/fixed-layout content (bookmarking is inert there). */
  private currentPagesAndDocuments(): Array<{ page: Page; document: Document }> {
    if (this.host instanceof PaginatedContentHost) {
      const entry = this.host.currentPageAndDocument();
      return entry ? [entry] : [];
    }
    if (this.host instanceof SpreadPaginatedHost) {
      return this.host.currentPagesAndDocuments();
    }
    return [];
  }

  public async toggleBookmark(): Promise<void> {
    return this.bookmarks.toggle();
  }

  /** Navigates to a saved bookmark's CFI — see `goToCfi`. */
  public async goToBookmark(cfi: string): Promise<void> {
    this.clearSearchHighlightUnlessPinned();
    await this.goToCfi(cfi);
  }

  /** Navigates to a highlight's starting position — see `goToBookmark`'s
   * doc comment. */
  public async goToHighlight(cfi: string): Promise<void> {
    this.clearSearchHighlightUnlessPinned();
    await this.goToCfi(cfi);
  }

  /** Navigates to a search result's position — see `SearchCoordinator.goToResult`. */
  public async goToSearchResult(cfi: string): Promise<void> {
    await this.searchCoordinator.goToResult(cfi);
  }

  /** (Re-)starts a book-wide search — see `SearchCoordinator.search`. */
  public search(query: string): void {
    this.searchCoordinator.search(query);
  }

  /** Called by `ReaderApp` whenever the Search panel's own `open`/
   * `pinned` state changes — see `SearchCoordinator.setPanelState`. */
  public setSearchPanelState(open: boolean, pinned: boolean): void {
    this.searchCoordinator.setPanelState(open, pinned);
  }

  /** Parses `cfi`, finds the spine item it targets, and opens it with
   * `cfi` as a bridging position — the shared "jump to a previously-
   * saved position" mechanism behind resuming, bookmarks, highlights,
   * and search results. Invalid or stale CFIs are ignored. */
  private async goToCfi(cfi: string): Promise<void> {
    try {
      const parsed = EpubCfi.parse(cfi);
      const spineIndex = this.pkg.findSpineIndexByPackageCfiSteps(parsed.packageSteps);
      if (spineIndex === undefined) {
        return;
      }
      await this.openSpineItem(spineIndex, { bridgeCfi: cfi });
    } catch {
      // Best-effort.
    }
  }

  public setTranslate(translate: Translate): void {
    this.translate = translate;
  }

  /** Queues live-region text and bumps the id so repeated text is announced again. */
  private announce(text: string): void {
    this.announcement = text;
    this.announcementId++;
  }

  /** Human-readable chapter label for `spineIndex`, from the nearest
   * preceding TOC entry, falling back to "Start of Book" or a generic
   * "Chapter N". */
  private chapterLabel(spineIndex: number): string {
    const nearest = this.nearestPrecedingNavPoint(spineIndex);
    if (nearest) {
      return nearest.label;
    }
    const hasAnyToc = ReaderController.flattenLinkedNavPoints(this.navigation.toc.items).length > 0;
    return hasAnyToc ? "Start of Book" : `Chapter ${spineIndex + 1}`;
  }

  /** Flattens linked TOC entries in document order. */
  private static flattenLinkedNavPoints(items: readonly NavPoint[]): NavPoint[] {
    const result: NavPoint[] = [];
    for (const item of items) {
      if (item.isLinked && item.path !== undefined) {
        result.push(item);
      }
      result.push(...ReaderController.flattenLinkedNavPoints(item.children));
    }
    return result;
  }

  /** Last linked TOC entry whose resolved spine position is at or before
   * `spineIndex`. */
  private nearestPrecedingNavPoint(spineIndex: number): NavPoint | undefined {
    let best: NavPoint | undefined;
    let bestSpineIndex = -1;

    for (const candidate of ReaderController.flattenLinkedNavPoints(this.navigation.toc.items)) {
      const candidateIndex = this.pkg.spine.findIndex(
        (ref) => ref.manifestItem.path === candidate.path,
      );
      if (candidateIndex === -1 || candidateIndex > spineIndex) {
        continue;
      }
      if (candidateIndex >= bestSpineIndex) {
        best = candidate;
        bestSpineIndex = candidateIndex;
      }
    }

    return best;
  }

  /** TOC path to highlight for the current position, falling back to the
   * first spine item before the first real TOC entry. */
  private tocHighlightPath(): string | undefined {
    return (
      this.nearestPrecedingNavPoint(this.spineIndex)?.path ?? this.pkg.spine[0]?.manifestItem.path
    );
  }

  /** First measured page number for each spine item, keyed by manifest path. */
  private computeTocPageNumbers(): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    if (!this.bookPagination) {
      return result;
    }
    for (let spineIndex = 0; spineIndex < this.pkg.spine.length; spineIndex++) {
      const currentPage = this.bookPagination.positionFor(spineIndex, 0).currentPage;
      const path = this.pkg.spine[spineIndex]?.manifestItem.path;
      if (currentPage !== undefined && path !== undefined) {
        result.set(path, currentPage);
      }
    }
    return result;
  }

  private isFixedLayoutHost(
    host:
      | FixedContentHost
      | SpreadPaginatedHost
      | FixedSpreadHost
      | PaginatedContentHost
      | ScrollContentHost
      | undefined,
  ): host is FixedContentHost | FixedSpreadHost {
    return host instanceof FixedContentHost || host instanceof FixedSpreadHost;
  }

  /** Primary content document; spread hosts use their primary column only. */
  private primaryContentDocument(): Document | undefined {
    if (this.host instanceof SpreadPaginatedHost || this.host instanceof FixedSpreadHost) {
      return this.host.primaryContentDocument();
    }
    return this.host?.element.contentDocument ?? undefined;
  }

  /** All content documents for a host, including both columns in spread mode. */
  private allContentDocuments(
    host:
      | FixedContentHost
      | SpreadPaginatedHost
      | FixedSpreadHost
      | PaginatedContentHost
      | ScrollContentHost
      | undefined = this.host,
  ): Document[] {
    if (host instanceof SpreadPaginatedHost || host instanceof FixedSpreadHost) {
      return host.contentDocuments();
    }
    const doc = host?.element.contentDocument;
    return doc ? [doc] : [];
  }

  private updateContentTitle(): void {
    const title = `${this.pkg.metadata.title} — ${this.chapterLabel(this.spineIndex)}`;
    if (this.host instanceof SpreadPaginatedHost || this.host instanceof FixedSpreadHost) {
      this.host.setTitle(title);
    } else if (this.host) {
      this.host.element.title = title;
    }
  }

  /** Reattaches arrow-key navigation to every current content document
   * without moving focus. */
  private reattachKeyboardNav(): void {
    const documents = this.allContentDocuments();
    if (documents.length === 0) {
      return;
    }
    for (const iframeDocument of documents) {
      this.accessibility.attach(
        iframeDocument,
        {
          onNext: () => this.dispatchArrowNavigation(1),
          onPrevious: () => this.dispatchArrowNavigation(-1),
          // Ctrl/Cmd+Arrow always means chapter navigation.
          onNextChapter: () => void this.goToChapter(1),
          onPreviousChapter: () => void this.goToChapter(-1),
        },
        // Preserve Space's native viewport scroll in continuous-scroll mode.
        { interceptSpace: !(this.host instanceof ScrollContentHost) },
      );
    }
  }

  /** Plain ArrowLeft/ArrowRight navigation: page/spread turn in paginated
   * mode, chapter jump otherwise. */
  private dispatchArrowNavigation(direction: 1 | -1): void {
    const isPaginated =
      this.host instanceof PaginatedContentHost ||
      this.host instanceof SpreadPaginatedHost ||
      this.host instanceof FixedSpreadHost;
    void (isPaginated ? this.turnPage(direction) : this.goToChapter(direction));
  }

  /** Elements that should keep ArrowLeft/ArrowRight for their own interaction. */
  private static readonly ARROW_KEY_EXEMPT_SELECTOR =
    'input, textarea, select, [contenteditable="true"], [role="slider"], ' +
    '[role="menu"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], ' +
    '[role="listbox"], [role="option"], [role="tree"], [role="treeitem"], ' +
    '[role="tablist"], [role="tab"], [role="dialog"], nav, aside';

  private globalArrowKeyCleanup: (() => void) | undefined;

  /** Handles ArrowLeft/ArrowRight on the parent document so page turns
   * still work when focus is outside the content iframe, except inside
   * controls and panels matched by `ARROW_KEY_EXEMPT_SELECTOR`. */
  private setUpGlobalArrowKeyFallback(ownerDocument: Document): void {
    this.globalArrowKeyCleanup?.();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      const active = ownerDocument.activeElement;
      if (active instanceof Element && active.closest(ReaderController.ARROW_KEY_EXEMPT_SELECTOR)) {
        return;
      }
      event.preventDefault();
      this.dispatchArrowNavigation(event.key === "ArrowRight" ? 1 : -1);
    };
    ownerDocument.addEventListener("keydown", handleKeyDown);
    this.globalArrowKeyCleanup = () => ownerDocument.removeEventListener("keydown", handleKeyDown);
  }

  /** Whether the host iframe currently has parent-document focus. */
  private iframeHasFocus(host: PaginatedContentHost): boolean {
    const iframe = host.element;
    return iframe.ownerDocument.activeElement === iframe;
  }

  /** Which spread column currently has focus, if any. */
  private spreadFocusedColumn(host: SpreadPaginatedHost): "left" | "right" | undefined {
    for (const column of ["left", "right"] as const) {
      const iframe = host.columnElement(column);
      if (iframe.ownerDocument.activeElement === iframe) {
        return column;
      }
    }
    return undefined;
  }

  /** Restores focus after an animated host swap only if the old host had
   * keyboard focus. */
  private restoreFocusAfterHostSwap(hadKeyboardFocus: boolean): void {
    if (!hadKeyboardFocus) {
      return;
    }
    const doc = this.primaryContentDocument();
    if (doc) {
      this.accessibility.focusContent(doc);
    }
  }

  /** Restores focus to the same spread column after an animated swap. */
  private restoreSpreadFocusAfterHostSwap(
    newHost: SpreadPaginatedHost,
    focusedColumn: "left" | "right" | undefined,
  ): void {
    if (focusedColumn === undefined) {
      return;
    }
    const doc = newHost.columnElement(focusedColumn).contentDocument;
    if (doc) {
      this.accessibility.focusContent(doc);
    }
  }

  /** Reattaches content interaction on window focus and restores content
   * focus unless a menu, listbox, or dialog is open. */
  public handleWindowRefocus(): void {
    this.reattachKeyboardNav();
    this.setUpDragPageTurn();
    this.highlightInteraction.setUpHighlightSelection();

    const iframeDocument = this.primaryContentDocument();
    const topDocument = this.containerEl?.ownerDocument;
    const menuOpen =
      topDocument?.querySelector('[role="menu"], [role="dialog"], [role="listbox"]') != null;
    if (iframeDocument && topDocument && !menuOpen) {
      this.accessibility.focusContent(iframeDocument);
    }
  }

  /** Reattaches accessibility handlers and moves focus into the current
   * content document. */
  private setUpAccessibility(focusTarget?: Element): void {
    this.updateContentTitle();
    this.reattachKeyboardNav();

    const iframeDocument = this.primaryContentDocument();
    if (!iframeDocument) {
      return;
    }
    this.accessibility.focusContent(iframeDocument, focusTarget);
  }

  /** Intercepts in-content links for reader navigation, opens external
   * URIs in a new tab, and wires zoomable images for click and keyboard
   * activation across all active content documents. */
  private setUpContentInteraction(): void {
    const documents = this.allContentDocuments();
    if (documents.length === 0) {
      return;
    }
    // A merged spread's borrowed tail document belongs to the previous
    // spine item, so links in it must resolve relative to that item.
    const tailDoc = this.host instanceof SpreadPaginatedHost ? this.host.mergedTailDocument() : undefined;
    // In a fixed spread, each column can be a different spine item, so
    // resolve links against the clicked document's own spine index.
    const fixedSpread = this.host instanceof FixedSpreadHost ? this.host.spread : undefined;
    const fixedSpreadDocs = this.host instanceof FixedSpreadHost ? this.host.contentDocuments() : [];
    const pathAndSpineIndexFor = (doc: Document): { path: string; spineIndex: number } | undefined => {
      let spineIndex = doc === tailDoc ? this.spineIndex - 1 : this.spineIndex;
      if (fixedSpread?.kind === "pair") {
        if (doc === fixedSpreadDocs[0]) {
          spineIndex = fixedSpread.leftSpineIndex;
        } else if (doc === fixedSpreadDocs[1]) {
          spineIndex = fixedSpread.rightSpineIndex;
        }
      }
      const path = this.pkg.spine[spineIndex]?.manifestItem.path;
      return path ? { path, spineIndex } : undefined;
    };

    const focusDocument = this.primaryContentDocument();
    const cleanups: Array<() => void> = [];

    const isZoomableImage = (element: Element): element is HTMLImageElement => {
      // Fixed-layout content uses click/tap for page turns and does not
      // support the image zoom viewer.
      if (this.isFixedLayoutHost(this.host)) {
        return false;
      }
      // Use `localName` for cross-realm XHTML content; `instanceof
      // HTMLImageElement` and `tagName` are unreliable here.
      if (element.localName !== "img" || element.closest("a[href]")) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width >= MIN_ZOOMABLE_IMAGE_SIZE && rect.height >= MIN_ZOOMABLE_IMAGE_SIZE;
    };

    for (const iframeDocument of documents) {
      applyEpubTypeAriaRoles(iframeDocument);

      const clickHandler = (event: MouseEvent): void => {
        const target = event.target as Element | null;
        const anchor = target?.closest?.("a[href]");
        const href = anchor?.getAttribute("href");
        if (!href) {
          const img = target?.closest?.("img");
          if (img && isZoomableImage(img)) {
            this.openImageViewer(img.currentSrc || img.src, img.alt, img);
          }
          return;
        }
        event.preventDefault();

        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          // External URI, not an in-book path.
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }

        const own = pathAndSpineIndexFor(iframeDocument);
        if (!own) {
          return;
        }
        const { fragment } = splitHrefFragment(href);
        const targetPath = resolveEpubPath(own.path, href);
        const targetSpineIndex = this.pkg.spine.findIndex(
          (ref) => ref.manifestItem.path === targetPath,
        );
        if (targetSpineIndex === -1) {
          // Ignore links to non-spine resources.
          return;
        }

        // An epub:type="noteref" link (footnote/endnote reference) shows
        // its target's content inline instead of navigating there — only
        // for the common same-document case; a noteref into a different
        // spine item falls through to ordinary navigation below, since
        // fetching and inlining another document's content is out of
        // scope for this pass.
        if (anchor && targetSpineIndex === own.spineIndex && fragment && hasEpubType(anchor, "noteref")) {
          const content = iframeDocument.getElementById(fragment)?.textContent?.trim();
          if (content) {
            const iframeEl = iframeDocument.defaultView?.frameElement;
            const iframeRect = iframeEl?.getBoundingClientRect();
            this.footnotePopup = {
              content,
              left: (iframeRect?.left ?? 0) + event.clientX,
              top: (iframeRect?.top ?? 0) + event.clientY,
            };
            this.notify();
            return;
          }
        }

        if (targetSpineIndex === own.spineIndex) {
          if (fragment) {
            const focusTarget = this.goToFragment(fragment);
            if (focusDocument) {
              this.accessibility.focusContent(focusDocument, focusTarget);
            }
          }
          return;
        }
        void this.openSpineItem(targetSpineIndex, { fragment });
      };

      iframeDocument.addEventListener("click", clickHandler);
      cleanups.push(() => iframeDocument.removeEventListener("click", clickHandler));

      // Keyboard activation for a focused zoomable image.
      const keydownHandler = (event: KeyboardEvent): void => {
        const active = iframeDocument.activeElement;
        if ((event.key !== "Enter" && event.key !== " ") || !active || !isZoomableImage(active)) {
          return;
        }
        event.preventDefault();
        this.openImageViewer(active.currentSrc || active.src, active.alt, active);
      };
      iframeDocument.addEventListener("keydown", keydownHandler);
      cleanups.push(() => iframeDocument.removeEventListener("keydown", keydownHandler));

      // Re-run after load if the image size was not known during the
      // initial scan.
      const markIfZoomable = (img: HTMLImageElement): void => {
        if (!isZoomableImage(img)) {
          return;
        }
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", img.alt ? `Zoom image: ${img.alt}` : "Zoom image");
        img.style.cursor = "zoom-in";
      };

      for (const img of iframeDocument.querySelectorAll("img")) {
        if (img.complete) {
          markIfZoomable(img);
          continue;
        }
        const onLoad = (): void => {
          markIfZoomable(img);
          img.removeEventListener("load", onLoad);
        };
        img.addEventListener("load", onLoad);
        cleanups.push(() => img.removeEventListener("load", onLoad));
      }

      // Any pointer activity in content hides the toolbar, even in
      // scroll and fixed-layout modes.
      const pointerDownHandler = (): void => {
        this.bumpContentActivity();
      };
      iframeDocument.addEventListener("pointerdown", pointerDownHandler);
      cleanups.push(() => iframeDocument.removeEventListener("pointerdown", pointerDownHandler));
    }

    this.contentInteractionCleanup = () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  /** Resizes the current host while preserving position; a spread-mode
   * threshold crossing reopens instead of relayouting. */
  public resize(width: number, height: number): void {
    this.diagnostics.record(`resize width=${width} height=${height} isLoadInFlight=${this.isLoadInFlight}`);
    this.width = width;
    this.height = height;

    if (this.isLoadInFlight) {
      this.pendingResize = { width, height };
      return;
    }

    if (width === this.appliedWidth && height === this.appliedHeight) {
      return;
    }

    if (this.shouldSwitchSpreadMode(width)) {
      void this.reopenForCurrentSize();
      return;
    }

    this.appliedWidth = width;
    this.appliedHeight = height;

    if (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost) {
      this.host.relayout(width, height);
    } else if (this.host instanceof ScrollContentHost || this.isFixedLayoutHost(this.host)) {
      this.host.resize(width, height);
    }
    this.refreshBookPagination();
    this.highlightInteraction.updateNoteMarkers();
    this.notify();
  }

  /** Whether the new width changes spread eligibility for the open host. */
  private shouldSwitchSpreadMode(width: number): boolean {
    if (this.host instanceof FixedSpreadHost) {
      const eligible = FixedLayoutSpreadPlanner.isSpreadModeEligible(
        this.pkg.metadata.renditionSpread,
        width,
        this.height,
      );
      return eligible !== this.fixedLayoutSpreadEligible;
    }
    if (this.viewMode !== "paginated" || this.isFixedLayoutHost(this.host)) {
      return false;
    }
    return SpreadPaginatedHost.isEligible(width) !== this.host instanceof SpreadPaginatedHost;
  }

  /** Reopens the current spine item at the current size, bridging
   * position through a CFI. */
  private async reopenForCurrentSize(): Promise<void> {
    const position = this.host?.currentPosition();
    const bridgeCfi = position
      ? this.locatorResolver.generate(this.spineIndex, position.node, position.offset).cfi
      : undefined;
    await this.openSpineItem(this.spineIndex, { bridgeCfi });
  }

  public async setViewMode(mode: ViewMode): Promise<void> {
    if (mode === this.viewMode || !this.containerEl) {
      return;
    }

    // Bridge position through a CFI because the new mode uses a
    // different host and document.
    const position = this.host?.currentPosition();
    const bridgeCfi = position
      ? this.locatorResolver.generate(this.spineIndex, position.node, position.offset).cfi
      : undefined;

    this.viewMode = mode;
    await this.library.setDefaultViewMode(mode);
    await this.openSpineItem(this.spineIndex, { bridgeCfi });
    this.announce(
      mode === "paginated" ? this.translate("announcements.paginatedView") : this.translate("announcements.scrollView"),
    );
    this.notify();
  }

  /** Sets and persists font scale, then reapplies display settings and
   * pagination. No-op for fixed-layout content. */
  public async setFontScale(scale: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_FONT_SCALE,
      Math.max(ReadingTheme.MIN_FONT_SCALE, scale),
    );
    if (clamped === this.fontScale || this.isFixedLayoutHost(this.host)) {
      return;
    }
    this.fontScale = clamped;
    await this.library.setDefaultFontScale(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    // Relayout moves note markers too.
    this.highlightInteraction.updateNoteMarkers();
    this.notify();
    await this.saveProgress();
  }

  /** Sets and persists font family, then reapplies display settings and
   * pagination. No-op for fixed-layout content. */
  public async setFontFamily(family: FontFamilyChoice): Promise<void> {
    if (family === this.fontFamily || this.isFixedLayoutHost(this.host)) {
      return;
    }
    this.fontFamily = family;
    await this.library.setDefaultFontFamily(family);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    // Relayout moves note markers too.
    this.highlightInteraction.updateNoteMarkers();
    this.notify();
    await this.saveProgress();
  }

  /** Sets and persists line spacing, then reapplies display settings and
   * pagination. No-op for fixed-layout content. */
  public async setLineSpacing(spacing: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_LINE_SPACING,
      Math.max(ReadingTheme.MIN_LINE_SPACING, spacing),
    );
    if (clamped === this.lineSpacing || this.isFixedLayoutHost(this.host)) {
      return;
    }
    this.lineSpacing = clamped;
    await this.library.setDefaultLineSpacing(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    // Relayout moves note markers too.
    this.highlightInteraction.updateNoteMarkers();
    this.notify();
    await this.saveProgress();
  }

  /** Sets and persists letter spacing, then reapplies display settings
   * and pagination. No-op for fixed-layout content. */
  public async setLetterSpacing(spacing: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_LETTER_SPACING,
      Math.max(ReadingTheme.MIN_LETTER_SPACING, spacing),
    );
    if (clamped === this.letterSpacing || this.isFixedLayoutHost(this.host)) {
      return;
    }
    this.letterSpacing = clamped;
    await this.library.setDefaultLetterSpacing(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    // Relayout moves note markers too.
    this.highlightInteraction.updateNoteMarkers();
    this.notify();
    await this.saveProgress();
  }

  /** Sets and persists content width, then reapplies display settings and
   * pagination. No-op for fixed-layout content. */
  public async setContentWidth(widthEm: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_CONTENT_WIDTH_EM,
      Math.max(ReadingTheme.MIN_CONTENT_WIDTH_EM, widthEm),
    );
    if (clamped === this.contentWidthEm || this.isFixedLayoutHost(this.host)) {
      return;
    }
    this.contentWidthEm = clamped;
    await this.library.setDefaultContentWidth(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    // Relayout moves note markers too.
    this.highlightInteraction.updateNoteMarkers();
    this.notify();
    await this.saveProgress();
  }

  /** Sets and persists page theme without relayout. No-op for fixed-layout content. */
  public async setPageTheme(theme: PageTheme): Promise<void> {
    if (theme === this.pageTheme || this.isFixedLayoutHost(this.host)) {
      return;
    }
    this.pageTheme = theme;
    await this.library.setDefaultPageTheme(theme);
    this.applyDisplaySettingsToHost({ relayout: false });
    this.notify();
  }

  /** Sets and persists reader brightness. It is applied at the reader-shell
   * level, so it also works for fixed-layout content. */
  public async setBrightness(brightness: number): Promise<void> {
    const clamped = ReadingTheme.clampBrightness(brightness);
    if (clamped === this.brightness) {
      return;
    }
    this.brightness = clamped;
    await this.library.setDefaultBrightness(clamped);
    this.notify();
  }

  /** Sets and persists the reader chrome theme. */
  public async setChromeTheme(theme: ChromeThemeChoice): Promise<void> {
    if (theme === this.chromeTheme) {
      return;
    }
    this.chromeTheme = theme;
    await this.library.setDefaultChromeTheme(theme);
    this.notify();
  }

  /** Sets and persists the page-turn animation style. */
  public async setPageTurnAnimationStyle(style: PageTurnAnimationStyle): Promise<void> {
    if (style === this.pageTurnAnimationStyle) {
      return;
    }
    this.pageTurnAnimationStyle = style;
    await this.library.setDefaultPageTurnAnimationStyle(style);
    this.notify();
  }

  /** Opens the image viewer and remembers the source element so focus can
   * be restored on close. */
  public openImageViewer(src: string, alt: string, sourceElement: Element): void {
    this.imageViewer = { src, alt };
    this.imageViewerReturnFocusTarget = sourceElement;
    this.notify();
  }

  /** Closes the image viewer and restores focus to the source image when
   * possible. */
  public closeImageViewer(): void {
    if (!this.imageViewer) {
      return;
    }
    this.imageViewer = undefined;
    const returnTarget = this.imageViewerReturnFocusTarget;
    this.imageViewerReturnFocusTarget = undefined;
    const iframeDocument = this.primaryContentDocument();
    if (iframeDocument) {
      const stillConnected =
        returnTarget?.isConnected && returnTarget.ownerDocument === iframeDocument;
      this.accessibility.focusContent(iframeDocument, stillConnected ? returnTarget : undefined);
    }
    this.notify();
  }

  /** Restores managed focus to the current content document after a
   * parent-document overlay closes without navigating. */
  public restoreContentFocus(): void {
    const iframeDocument = this.primaryContentDocument();
    if (iframeDocument) {
      this.accessibility.focusContent(iframeDocument);
    }
  }

  /** Applies typography and page-theme settings to a host and optionally
   * relayouts it. */
  private applyDisplaySettingsToHost(
    options: { relayout: boolean },
    host:
      | FixedContentHost
      | SpreadPaginatedHost
      | FixedSpreadHost
      | PaginatedContentHost
      | ScrollContentHost
      | undefined = this.host,
  ): void {
    if (!host || this.isFixedLayoutHost(host)) {
      return;
    }
    const documents = this.allContentDocuments(host);
    if (documents.length === 0) {
      return;
    }
    for (const doc of documents) {
      ReadingTheme.applyFontScale(doc, this.fontScale);
      ReadingTheme.applyFontFamily(doc, this.fontFamily);
      ReadingTheme.applyLineSpacing(doc, this.lineSpacing);
      ReadingTheme.applyLetterSpacing(doc, this.letterSpacing);
      ReadingTheme.applyContentWidth(doc, this.contentWidthEm);
      ReadingTheme.applyPageTheme(doc, this.pageTheme);
    }
    if (!options.relayout) {
      return;
    }
    if (host instanceof PaginatedContentHost || host instanceof SpreadPaginatedHost) {
      host.relayout(this.width, this.height);
    } else if (host instanceof ScrollContentHost) {
      host.resize(this.width, this.height);
    }
  }

  /** Applies non-default persisted display settings to a freshly opened
   * host. */
  private applyPersistedDisplaySettingsToFreshHost(
    host:
      | FixedContentHost
      | SpreadPaginatedHost
      | FixedSpreadHost
      | PaginatedContentHost
      | ScrollContentHost
      | undefined = this.host,
  ): void {
    const needsRelayout =
      this.fontScale !== 1 ||
      this.fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY ||
      this.lineSpacing !== ReadingTheme.DEFAULT_LINE_SPACING ||
      this.letterSpacing !== ReadingTheme.DEFAULT_LETTER_SPACING ||
      this.contentWidthEm !== ReadingTheme.DEFAULT_CONTENT_WIDTH_EM;
    if (
      needsRelayout ||
      this.pageTheme !== ReadingTheme.DEFAULT_PAGE_THEME
    ) {
      this.applyDisplaySettingsToHost({ relayout: needsRelayout }, host);
    }
  }

  /** Clears the search highlight on ordinary navigation unless it is pinned. */
  private clearSearchHighlightUnlessPinned(): void {
    this.searchCoordinator.clearHighlightUnlessPinned();
  }

  public dismissSelectionToolbar(): void {
    this.highlightInteraction.dismissSelectionToolbar();
  }

  public dismissActiveHighlight(): void {
    this.highlightInteraction.dismissActiveHighlight();
  }

  public dismissFootnotePopup(): void {
    this.footnotePopup = undefined;
    this.notify();
  }

  public openHighlightPopup(id: string): void {
    this.highlightInteraction.openHighlightPopup(id);
  }

  /** Clears the current error state. */
  public dismissError(): void {
    this.error = undefined;
    this.errorSeverity = undefined;
    this.notify();
  }

  public async addHighlight(style: HighlightStyle, openNoteEditor = false): Promise<void> {
    return this.highlights.add(style, openNoteEditor);
  }

  public async removeHighlight(id: string): Promise<void> {
    return this.highlights.remove(id);
  }

  public async setHighlightNote(id: string, note: string | undefined): Promise<void> {
    return this.highlights.setNote(id, note);
  }

  public async setHighlightStyle(id: string, style: HighlightStyle): Promise<void> {
    return this.highlights.setStyle(id, style);
  }

  /** Turns one page or spread in paginated mode, crossing chapter
   * boundaries when needed. No-op in scroll mode and while a turn is
   * already in progress. */
  public async turnPage(direction: 1 | -1): Promise<void> {
    if (this.isTurningPage) {
      return;
    }
    this.clearSearchHighlightUnlessPinned();
    this.isTurningPage = true;
    const token = ++this.turnToken;
    this.diagnostics.record(`turnPage direction=${direction} token=${token}`);
    try {
      await this.turnPageInternal(direction, token);
    } finally {
      this.isTurningPage = false;
    }
  }

  private async turnPageInternal(direction: 1 | -1, token: number): Promise<void> {
    // Page turns do not rebuild the content document, so clear any highlight
    // popup that now points at content no longer on screen.
    this.activeHighlight = undefined;
    this.footnotePopup = undefined;
    let moved: boolean;
    let announcement: string;
    if (this.host instanceof SpreadPaginatedHost) {
      // Capture focus before disposing the old spread so it can be restored
      // after the host swap.
      const focusedColumn = this.spreadFocusedColumn(this.host);
      const animatedSpread = await this.animateSpreadTurn(this.host, direction);
      // Set only when `animateSpreadTurn` prepared a merged incoming spread;
      // the plain in-chapter path never uses it.
      const mergedIntoSpineIndex = this.pendingSpreadMergeSpineIndex;
      this.pendingSpreadMergeSpineIndex = undefined;
      if (animatedSpread) {
        if (token !== this.turnToken) {
          animatedSpread.dispose();
          return;
        }
        this.contentInteractionCleanup?.();
        this.contentInteractionCleanup = undefined;
        this.dragCleanup?.();
        this.dragCleanup = undefined;
        this.host = animatedSpread;
        this.clearStaleHostWrapper();
        if (mergedIntoSpineIndex !== undefined) {
          // A merged spread crossed into the next chapter, so apply the
          // chapter-scoped state updates without re-running a full open.
          this.spineIndex = mergedIntoSpineIndex;
          this.refreshBookPagination();
        }
        this.updateContentTitle();
        this.reattachKeyboardNav();
        this.setUpContentInteraction();
        this.setUpDragPageTurn();
        this.highlightInteraction.setUpHighlightSelection();
        this.highlightInteraction.applyHighlightsToCurrentHost();
        this.restoreSpreadFocusAfterHostSwap(animatedSpread, focusedColumn);
        const second = animatedSpread.secondPageIndex;
        this.announce(
          second !== undefined
            ? this.translate("announcements.spreadOfTotal", {
                first: animatedSpread.pageIndex + 1,
                second: second + 1,
                total: animatedSpread.pageCount,
              })
            : this.translate("scrubber.pageOfTotal", {
                current: animatedSpread.pageIndex + 1,
                total: animatedSpread.pageCount,
              }),
        );
        this.notify();
        await this.saveProgress();
        return;
      }
      moved = direction === 1 ? this.host.nextSpread() : this.host.previousSpread();
      const second = this.host.secondPageIndex;
      announcement =
        second !== undefined
          ? this.translate("announcements.spreadOfTotal", {
              first: this.host.pageIndex + 1,
              second: second + 1,
              total: this.host.pageCount,
            })
          : this.translate("scrubber.pageOfTotal", { current: this.host.pageIndex + 1, total: this.host.pageCount });
    } else if (this.host instanceof PaginatedContentHost) {
      // Capture focus before disposing the old host so keyboard
      // navigation can be restored after the swap.
      const hadKeyboardFocus = this.iframeHasFocus(this.host);
      const animatedHost = await this.animatePageTurn(this.host, direction);
      if (animatedHost) {
        if (token !== this.turnToken) {
          // Discard stale results if a newer turn finished while this host
          // was still loading or animating.
          animatedHost.dispose();
          return;
        }
        this.contentInteractionCleanup?.();
        this.contentInteractionCleanup = undefined;
        this.dragCleanup?.();
        this.dragCleanup = undefined;
        this.host = animatedHost;
        this.clearStaleHostWrapper();
        this.updateContentTitle();
        this.reattachKeyboardNav();
        this.setUpContentInteraction();
        this.setUpDragPageTurn();
        this.highlightInteraction.setUpHighlightSelection();
        this.highlightInteraction.applyHighlightsToCurrentHost();
        this.restoreFocusAfterHostSwap(hadKeyboardFocus);
        this.announce(
          this.translate("scrubber.pageOfTotal", {
            current: animatedHost.currentPageIndex + 1,
            total: animatedHost.pageCount,
          }),
        );
        this.notify();
        await this.saveProgress();
        return;
      }
      moved = direction === 1 ? this.host.nextPage() : this.host.previousPage();
      announcement = this.translate("scrubber.pageOfTotal", {
        current: this.host.currentPageIndex + 1,
        total: this.host.pageCount,
      });
    } else if (this.host instanceof FixedSpreadHost) {
      // Fixed-layout content has no in-chapter pagination step here:
      // `turnFixedSpread` either swaps to another spread or falls through to
      // chapter navigation.
      await this.turnFixedSpread(this.host, direction, token);
      return;
    } else {
      return;
    }

    if (moved) {
      this.announce(announcement);
      this.notify();
      await this.saveProgress();
      return;
    }

    const nextSpineIndex = this.spineIndex + direction;
    if (nextSpineIndex < 0 || nextSpineIndex >= this.pkg.spine.length) {
      return;
    }
    await this.openSpineItem(nextSpineIndex, { landOnLastPage: direction === -1, animateDirection: direction });
  }

  /** Turns within fixed-layout content by loading the next or previous
   * `FixedSpread`. If no adjacent spread exists, it falls through to
   * `openSpineItem` using this spread's outer spine edge so a paired
   * spread is skipped as a unit. */
  private async turnFixedSpread(host: FixedSpreadHost, direction: 1 | -1, token: number): Promise<void> {
    const currentSpread = host.spread;
    const indices = host.spineIndices;
    if (!currentSpread || indices.length === 0) {
      return;
    }

    const spreadEligible = this.fixedLayoutSpreadEligible ?? false;
    const nextSpread =
      direction === 1
        ? FixedLayoutSpreadPlanner.nextSpread(
            this.pkg.spine,
            this.pkg.metadata.renditionLayout,
            this.pkg.pageProgressionDirection,
            spreadEligible,
            currentSpread,
          )
        : FixedLayoutSpreadPlanner.previousSpread(
            this.pkg.spine,
            this.pkg.metadata.renditionLayout,
            this.pkg.pageProgressionDirection,
            spreadEligible,
            currentSpread,
          );
    const nextPrimaryIndex =
      nextSpread === undefined
        ? undefined
        : nextSpread.kind === "single"
          ? nextSpread.spineIndex
          : Math.min(nextSpread.leftSpineIndex, nextSpread.rightSpineIndex);
    const stillPrePaginated =
      nextPrimaryIndex !== undefined &&
      this.pkg.spine[nextPrimaryIndex]?.resolveRenditionLayout(this.pkg.metadata.renditionLayout) ===
        "pre-paginated";

    if (nextSpread && stillPrePaginated && this.containerEl) {
      const newHost = new FixedSpreadHost(this.width, this.height);
      // Attach before `open()`; detached iframes may never navigate, and the
      // staged wrapper keeps the new host hidden while it loads.
      const newStagingEl = this.stageHiddenHostElement(newHost.element);
      try {
        await newHost.open(this.contentLoader, this.resolver, nextSpread, this.pkg.metadata.renditionViewport);
      } catch (err) {
        newHost.dispose();
        newStagingEl.remove();
        throw err;
      }
      if (token !== this.turnToken) {
        // Discard stale results if a newer turn or chapter change finished
        // while this spread was still loading.
        newHost.dispose();
        newStagingEl.remove();
        return;
      }
      // Animate before disposing the old host so the outgoing spread stays
      // intact for the whole turn.
      const previousWrapperEl = this.hostWrapperEl;
      await this.animateFixedSpreadTurn(previousWrapperEl, newStagingEl, direction);
      this.contentInteractionCleanup?.();
      this.contentInteractionCleanup = undefined;
      this.dragCleanup?.();
      this.dragCleanup = undefined;
      host.dispose();
      previousWrapperEl?.remove();
      newStagingEl.style.opacity = "";
      newStagingEl.style.pointerEvents = "";
      this.host = newHost;
      this.hostWrapperEl = newStagingEl;
      this.spineIndex = Math.min(...newHost.spineIndices);
      this.updateContentTitle();
      this.reattachKeyboardNav();
      this.setUpContentInteraction();
      this.setUpDragPageTurn();
      const newIndices = newHost.spineIndices;
      this.announce(
        newIndices.length > 1
          ? this.translate("announcements.spreadOfTotal", {
              first: newIndices[0]! + 1,
              second: newIndices[1]! + 1,
              total: this.pkg.spine.length,
            })
          : this.translate("scrubber.pageOfTotal", { current: newIndices[0]! + 1, total: this.pkg.spine.length }),
      );
      this.notify();
      await this.saveProgress();
      return;
    }

    const edgeSpineIndex = direction === 1 ? Math.max(...indices) : Math.min(...indices);
    const nextSpineIndex = edgeSpineIndex + direction;
    if (nextSpineIndex < 0 || nextSpineIndex >= this.pkg.spine.length) {
      return;
    }
    await this.openSpineItem(nextSpineIndex, { landOnLastPage: direction === -1 });
  }

  /** Animates a fixed-layout spread turn using the current page-turn style.
   * Unlike the reflowable paths, this only moves whole staged spread
   * wrappers and does not need pagination-specific clip-path workarounds.
   * Returns `false` when animation is skipped. */
  private async animateFixedSpreadTurn(
    previousWrapperEl: HTMLDivElement | undefined,
    stagingEl: HTMLDivElement,
    direction: 1 | -1,
  ): Promise<boolean> {
    if (!this.containerEl || !previousWrapperEl || this.pageTurnAnimator.shouldSkipPageTurnAnimation()) {
      return false;
    }
    const oldEl = previousWrapperEl;
    const newEl = stagingEl;
    const isScroll = this.pageTurnAnimationStyle === "scroll";
    const entering = direction === -1;
    const animatingEl = entering ? newEl : oldEl;

    // Reveal the staging element so it can participate in the animation.
    stagingEl.style.opacity = "";
    stagingEl.style.pointerEvents = "";

    // Non-scroll turns stack the wrappers, so give the animating one an
    // opaque background to keep letterboxed margins from showing the other
    // spread through them.
    if (!isScroll) {
      animatingEl.style.background = FixedContentHost.LETTERBOX_BACKGROUND;
    }

    this.isAnimatingPageTurn = true;
    this.notify();

    if (isScroll) {
      await this.pageTurnAnimator.playScrollTurn([oldEl], [newEl], direction);
    } else {
      await this.pageTurnAnimator.playPageTurnAnimation(animatingEl, animatingEl, direction, [], entering);
    }

    animatingEl.style.background = "";
    this.isAnimatingPageTurn = false;
    // Reset animation-only styles on the surviving staging wrapper.
    stagingEl.style.transform = "";
    stagingEl.style.zIndex = "";
    stagingEl.style.boxShadow = "";
    stagingEl.style.transition = "";
    if (animatingEl === oldEl) {
      // Defensive: clear `oldEl`'s z-index too in case its lifecycle changes.
      oldEl.style.zIndex = "";
    }
    return true;
  }

  /** Returns the footer page number for this chapter page, using book-wide
   * pagination when available and the local page number otherwise. */
  private furniturePageNumber(spineIndex: number, pageIndex: number, pageCount: number): number | undefined {
    const bookPageIndex = this.bookPagination?.positionFor(spineIndex, pageIndex).currentPage;
    return bookPageIndex ?? (pageCount > 0 ? pageIndex + 1 : undefined);
  }

  /** Builds the incoming page in a new host and plays a page-turn animation
   * within the current chapter. Returns `undefined` when the turn would
   * cross a chapter boundary. Backward turns animate the incoming page in,
   * while "scroll" moves both pages together. */
  private async animatePageTurn(
    oldHost: PaginatedContentHost,
    direction: 1 | -1,
  ): Promise<PaginatedContentHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    const newHost = await this.prepareIncomingPage(oldHost, direction);
    if (!newHost) {
      return undefined;
    }
    const newEl = newHost.element;
    const entering = direction === -1;
    const isScroll = this.pageTurnAnimationStyle === "scroll";
    const animatingHost = entering ? newHost : oldHost;
    const otherHost = entering ? oldHost : newHost;
    // Overlapping "rotate" and "slide" turns suppress `clip-path` on both
    // hosts; overlapping clipped iframes do not composite correctly in
    // Chromium. Only "rotate" also grows the animating host to full
    // height, and the natural height must be measured after clip
    // suppression so the growth mask matches the real painted page.
    if (this.pageTurnAnimationStyle === "rotate") {
      animatingHost.suppressClipPathForAnimation();
    }
    const animatingNaturalHeight = animatingHost.element.getBoundingClientRect().height;
    if (this.pageTurnAnimationStyle === "rotate") {
      animatingHost.growToFullHeight(this.height);
      otherHost.suppressClipPathForAnimation();
    } else if (this.pageTurnAnimationStyle === "slide") {
      animatingHost.suppressClipPathForAnimation();
      otherHost.suppressClipPathForAnimation();
    }

    // "slide" leaves short pages at natural height, so add a backdrop behind
    // the animating host to keep the fully rendered page underneath from
    // showing through the gap.
    let turnBackdrop: HTMLDivElement | undefined;
    if (!this.pageTurnAnimator.shouldSkipPageTurnAnimation() && this.pageTurnAnimationStyle === "slide") {
      turnBackdrop = this.pageTurnAnimator.buildTurnBackdrop(animatingHost.element);
      if (turnBackdrop) {
        turnBackdrop.style.zIndex = "2";
        animatingHost.element.parentElement?.insertBefore(turnBackdrop, animatingHost.element);
      }
    }
    let turnGrowthMask: HTMLDivElement | undefined;
    if (!this.pageTurnAnimator.shouldSkipPageTurnAnimation() && this.pageTurnAnimationStyle === "rotate") {
      turnGrowthMask = this.pageTurnAnimator.buildTurnGrowthMask(animatingHost.element, animatingNaturalHeight);
      if (turnGrowthMask) {
        turnGrowthMask.style.zIndex = "2";
        animatingHost.element.parentElement?.insertBefore(turnGrowthMask, animatingHost.element.nextSibling);
      }
    }

    // Build temporary header/footer overlays so the running furniture turns
    // with the page. Skip them when no animation will play.
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (!this.pageTurnAnimator.shouldSkipPageTurnAnimation()) {
      const title = this.pkg.metadata.title;
      const chapterLabel = this.chapterLabel(this.spineIndex);
      const outgoingNumber = this.furniturePageNumber(this.spineIndex, oldHost.currentPageIndex, oldHost.pageCount);
      const incomingNumber = this.furniturePageNumber(this.spineIndex, newHost.currentPageIndex, newHost.pageCount);
      const header = { mode: "split" as const, left: title, right: chapterLabel };
      outgoingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(oldHost.element, [
        {
          left: 0,
          width: oldHost.element.getBoundingClientRect().width,
          header,
          footerText: outgoingNumber !== undefined ? `Page ${outgoingNumber}` : undefined,
        },
      ]);
      incomingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(newEl, [
        {
          left: 0,
          width: newEl.getBoundingClientRect().width,
          header,
          footerText: incomingNumber !== undefined ? `Page ${incomingNumber}` : undefined,
        },
      ]);
      if (isScroll) {
        // Scroll moves both pages and their overlays together.
        if (outgoingOverlay) {
          outgoingOverlay.style.zIndex = "2";
          this.containerEl.appendChild(outgoingOverlay);
        }
        if (incomingOverlay) {
          incomingOverlay.style.zIndex = "2";
          this.containerEl.appendChild(incomingOverlay);
        }
      } else {
        // Put the overlay for the moving page on top of the static one.
        const animatedOverlay = entering ? incomingOverlay : outgoingOverlay;
        const staticOverlay = entering ? outgoingOverlay : incomingOverlay;
        if (staticOverlay) {
          staticOverlay.style.zIndex = "1";
          this.containerEl.appendChild(staticOverlay);
        }
        if (animatedOverlay) {
          animatedOverlay.style.zIndex = "2";
          this.containerEl.appendChild(animatedOverlay);
        }
      }
      this.isAnimatingPageTurn = true;
      this.notify();
    }

    if (isScroll) {
      const oldGroup = [oldHost.element, ...(outgoingOverlay ? [outgoingOverlay] : [])];
      const newGroup = [newEl, ...(incomingOverlay ? [incomingOverlay] : [])];
      await this.pageTurnAnimator.playScrollTurn(oldGroup, newGroup, direction);
    } else {
      const turnEl = entering ? newEl : oldHost.element;
      const extraTurnEls = [
        ...((entering ? incomingOverlay : outgoingOverlay) ? [(entering ? incomingOverlay : outgoingOverlay)!] : []),
        ...(turnBackdrop ? [turnBackdrop] : []),
        ...(turnGrowthMask ? [turnGrowthMask] : []),
      ];
      await this.pageTurnAnimator.playPageTurnAnimation(turnEl, turnEl, direction, extraTurnEls, entering);
    }

    outgoingOverlay?.remove();
    incomingOverlay?.remove();
    turnBackdrop?.remove();
    turnGrowthMask?.remove();
    this.isAnimatingPageTurn = false;
    // Reset any temporary height or clip-path changes on the surviving host.
    newHost.restoreNaturalHeight();

    // After disposing the old host, restore `newEl` to normal host
    // positioning.
    oldHost.dispose();
    newEl.style.position = "";
    newEl.style.top = "";
    newEl.style.left = "";
    newEl.style.transform = "";
    newEl.style.zIndex = "";
    return newHost;
  }

  /** Spread version of `animatePageTurn`. "slide" and "scroll" move the
   * whole spread, while "rotate" turns only the column nearest the
   * spine; "scroll" moves outgoing and incoming spreads together. */
  private async animateSpreadTurn(
    oldHost: SpreadPaginatedHost,
    direction: 1 | -1,
  ): Promise<SpreadPaginatedHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    const newHost = await this.prepareIncomingSpread(oldHost, direction);
    if (!newHost) {
      return undefined;
    }
    const newEl = newHost.element;
    const entering = direction === -1;
    const isScroll = this.pageTurnAnimationStyle === "scroll";
    // Backward turns animate the incoming spread rather than the outgoing one.
    const turnHost = entering ? newHost : oldHost;
    const otherHost = entering ? oldHost : newHost;

    // "rotate" turns only the spine-side column and grows it to full
    // height. "slide" moves the whole spread without growing columns, but
    // both styles suppress `clip-path` on all overlapping columns because
    // clipped iframes do not composite correctly in Chromium.
    if (this.pageTurnAnimationStyle === "rotate") {
      turnHost.suppressColumnClipPathForAnimation("right");
    }
    const turnColumnNaturalHeight = this.pageTurnAnimator.spreadColumnElement(turnHost, 1).getBoundingClientRect().height;
    if (this.pageTurnAnimationStyle === "rotate") {
      turnHost.growColumnToFullHeight("right", this.height);
      turnHost.suppressColumnClipPathForAnimation("left");
      otherHost.suppressColumnClipPathForAnimation("left");
      otherHost.suppressColumnClipPathForAnimation("right");
    } else if (this.pageTurnAnimationStyle === "slide") {
      turnHost.suppressColumnClipPathForAnimation("left");
      turnHost.suppressColumnClipPathForAnimation("right");
      otherHost.suppressColumnClipPathForAnimation("left");
      otherHost.suppressColumnClipPathForAnimation("right");
    }
    const turnEl = this.pageTurnAnimator.elementToTurn(turnHost);

    // "slide" can leave a short turning column with a visible gap, so add
    // one full-width backdrop behind the turning spread.
    let turnBackdrop: HTMLDivElement | undefined;
    if (!this.pageTurnAnimator.shouldSkipPageTurnAnimation() && this.pageTurnAnimationStyle === "slide") {
      turnBackdrop = this.pageTurnAnimator.buildTurnBackdrop(turnHost.element);
      if (turnBackdrop) {
        turnBackdrop.style.zIndex = "2";
        turnHost.element.parentElement?.insertBefore(turnBackdrop, turnHost.element);
      }
    }
    // "rotate" grows the turning column to full height, so mask that extra
    // height the same way as the single-page case.
    let turnGrowthMask: HTMLDivElement | undefined;
    if (!this.pageTurnAnimator.shouldSkipPageTurnAnimation() && this.pageTurnAnimationStyle === "rotate") {
      turnGrowthMask = this.pageTurnAnimator.buildTurnGrowthMask(turnEl, turnColumnNaturalHeight);
      if (turnGrowthMask) {
        turnGrowthMask.style.zIndex = "2";
        turnEl.parentElement?.insertBefore(turnGrowthMask, turnEl.nextSibling);
      }
    }

    // For rotate turns, add a back face and run to 180° so the page lands
    // visibly instead of disappearing just past edge-on.
    const rotateBackFace =
      this.pageTurnAnimationStyle === "rotate" && !this.pageTurnAnimator.shouldSkipPageTurnAnimation()
        ? this.pageTurnAnimator.buildRotateBackFace(turnEl)
        : undefined;

    // Build the same temporary furniture overlays as `animatePageTurn`.
    // "slide"/"scroll" need both columns; "rotate" only needs the turning
    // right column.
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    // Rotate turns also need left-column overlays, because that column stays
    // stacked above or below the other spread for the whole animation.
    let outgoingLeftOverlay: HTMLDivElement | undefined;
    let incomingLeftOverlay: HTMLDivElement | undefined;
    if (!this.pageTurnAnimator.shouldSkipPageTurnAnimation()) {
      const title = this.pkg.metadata.title;
      // Merge turns animate into the next chapter through this same path, so
      // incoming labels and numbers must use the pending merged spine index.
      const incomingSpineIndex = this.pendingSpreadMergeSpineIndex ?? this.spineIndex;
      const isMergeTurn = this.pendingSpreadMergeSpineIndex !== undefined;
      const outgoingChapterLabel = this.chapterLabel(this.spineIndex);
      const incomingChapterLabel = this.chapterLabel(incomingSpineIndex);
      const outgoingPrimary = this.furniturePageNumber(this.spineIndex, oldHost.pageIndex, oldHost.pageCount);
      const outgoingSecondary =
        oldHost.secondPageIndex !== undefined && outgoingPrimary !== undefined ? outgoingPrimary + 1 : undefined;
      const incomingRightNumber = this.furniturePageNumber(incomingSpineIndex, newHost.pageIndex, newHost.pageCount);
      // During a merge, the incoming left column is the borrowed tail page,
      // so it has no page number of its own here.
      const incomingPrimary = isMergeTurn ? undefined : incomingRightNumber;
      const incomingSecondary = isMergeTurn
        ? incomingRightNumber
        : newHost.secondPageIndex !== undefined && incomingRightNumber !== undefined
          ? incomingRightNumber + 1
          : undefined;

      if (this.pageTurnAnimationStyle !== "rotate") {
        const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(this.width);
        const gutter = SpreadPaginatedHost.GUTTER_WIDTH;
        const bands = (chapterLabel: string, primary: number | undefined, secondary: number | undefined) => [
          {
            left: 0,
            width: columnWidth,
            header: { mode: "single" as const, text: title },
            footerText: primary !== undefined ? `Page ${primary}` : undefined,
          },
          {
            left: columnWidth + gutter,
            width: columnWidth,
            header: { mode: "single" as const, text: chapterLabel },
            footerText: secondary !== undefined ? `Page ${secondary}` : undefined,
          },
        ];
        outgoingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(
          oldHost.element,
          bands(outgoingChapterLabel, outgoingPrimary, outgoingSecondary),
        );
        incomingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(
          newEl,
          bands(incomingChapterLabel, incomingPrimary, incomingSecondary),
        );
      } else {
        // Rotate overlays attach to the right column, which carries the
        // chapter label and secondary page number.
        const oldColumnEl = this.pageTurnAnimator.spreadColumnElement(oldHost, 1);
        const newColumnEl = this.pageTurnAnimator.spreadColumnElement(newHost, 1);
        outgoingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(oldColumnEl, [
          {
            left: 0,
            width: oldColumnEl.getBoundingClientRect().width,
            header: { mode: "single" as const, text: outgoingChapterLabel },
            footerText: outgoingSecondary !== undefined ? `Page ${outgoingSecondary}` : undefined,
          },
        ]);
        incomingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(newColumnEl, [
          {
            left: 0,
            width: newColumnEl.getBoundingClientRect().width,
            header: { mode: "single" as const, text: incomingChapterLabel },
            footerText: incomingSecondary !== undefined ? `Page ${incomingSecondary}` : undefined,
          },
        ]);

        // The left column needs its own overlay too; its title/page-number
        // layout is independent of turn style.
        const oldLeftColumnEl = this.pageTurnAnimator.spreadColumnElement(oldHost, 0);
        const newLeftColumnEl = this.pageTurnAnimator.spreadColumnElement(newHost, 0);
        const leftHeader = { mode: "single" as const, text: title };
        outgoingLeftOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(oldLeftColumnEl, [
          {
            left: 0,
            width: oldLeftColumnEl.getBoundingClientRect().width,
            header: leftHeader,
            footerText: outgoingPrimary !== undefined ? `Page ${outgoingPrimary}` : undefined,
          },
        ]);
        incomingLeftOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(newLeftColumnEl, [
          {
            left: 0,
            width: newLeftColumnEl.getBoundingClientRect().width,
            header: leftHeader,
            footerText: incomingPrimary !== undefined ? `Page ${incomingPrimary}` : undefined,
          },
        ]);
      }
      if (isScroll) {
        // Scroll moves both spread overlays with their spreads.
        if (outgoingOverlay) {
          outgoingOverlay.style.zIndex = "2";
          this.containerEl.appendChild(outgoingOverlay);
        }
        if (incomingOverlay) {
          incomingOverlay.style.zIndex = "2";
          this.containerEl.appendChild(incomingOverlay);
        }
      } else {
        // Put the overlay for the moving spread on top of the static one.
        const animatedOverlay = entering ? incomingOverlay : outgoingOverlay;
        const staticOverlay = entering ? outgoingOverlay : incomingOverlay;
        if (staticOverlay) {
          staticOverlay.style.zIndex = "1";
          this.containerEl.appendChild(staticOverlay);
        }
        if (animatedOverlay) {
          animatedOverlay.style.zIndex = "2";
          this.containerEl.appendChild(animatedOverlay);
        }
        // Match left-column overlay z-order to whichever host stays visually
        // on top during the turn.
        const turnLeftOverlay = entering ? incomingLeftOverlay : outgoingLeftOverlay;
        const otherLeftOverlay = entering ? outgoingLeftOverlay : incomingLeftOverlay;
        if (otherLeftOverlay) {
          otherLeftOverlay.style.zIndex = "1";
          this.containerEl.appendChild(otherLeftOverlay);
        }
        if (turnLeftOverlay) {
          turnLeftOverlay.style.zIndex = "2";
          this.containerEl.appendChild(turnLeftOverlay);
        }
      }
      this.isAnimatingPageTurn = true;
      this.notify();
    }

    if (isScroll) {
      const oldGroup = [oldHost.element, ...(outgoingOverlay ? [outgoingOverlay] : [])];
      const newGroup = [newEl, ...(incomingOverlay ? [incomingOverlay] : [])];
      await this.pageTurnAnimator.playScrollTurn(oldGroup, newGroup, direction);
    } else {
      const animatedOverlayEl = entering ? incomingOverlay : outgoingOverlay;
      await this.pageTurnAnimator.playPageTurnAnimation(
        turnHost.element,
        turnEl,
        direction,
        [
          ...(animatedOverlayEl ? [animatedOverlayEl] : []),
          ...(rotateBackFace ? [rotateBackFace] : []),
          ...(turnBackdrop ? [turnBackdrop] : []),
          ...(turnGrowthMask ? [turnGrowthMask] : []),
        ],
        entering,
        rotateBackFace ? 180 : undefined,
      );
    }

    rotateBackFace?.remove();
    outgoingOverlay?.remove();
    incomingOverlay?.remove();
    outgoingLeftOverlay?.remove();
    incomingLeftOverlay?.remove();
    turnBackdrop?.remove();
    turnGrowthMask?.remove();
    this.isAnimatingPageTurn = false;
    // Reset any temporary height or clip-path changes on both columns of the
    // surviving host.
    if (this.pageTurnAnimationStyle === "rotate" || this.pageTurnAnimationStyle === "slide") {
      newHost.restoreColumnNaturalHeight("left");
      newHost.restoreColumnNaturalHeight("right");
    }

    oldHost.dispose();
    newEl.style.position = "";
    newEl.style.top = "";
    newEl.style.left = "";
    newEl.style.transform = "";
    newEl.style.zIndex = "";
    return newHost;
  }

  /** Builds the incoming page for an in-chapter turn and positions it
   * directly under `oldHost.element`. Returns `undefined` when the turn
   * would cross a chapter boundary. Attach the new iframe before `open()`,
   * and do not reparent the old one, or loading and reload behavior can
   * break. */
  private async prepareIncomingPage(
    oldHost: PaginatedContentHost,
    direction: 1 | -1,
  ): Promise<PaginatedContentHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    const targetIndex = oldHost.currentPageIndex + direction;
    if (targetIndex < 0 || targetIndex >= oldHost.pageCount) {
      return undefined;
    }

    const containerEl = this.containerEl;
    const newHost = new PaginatedContentHost(this.width, this.height);
    const newEl = newHost.element;
    newEl.style.position = "absolute";
    newEl.style.top = "0";
    // `PaginatedContentHost` already spans the container width, so `left: 0`
    // aligns it and leaves `transform` free for entering-turn animation.
    newEl.style.left = "0";
    newEl.style.zIndex = "1";
    // Keep the new host attached but invisible while `open()` briefly
    // renders page 0 before `goToPageIndex()` moves it to the real target.
    // Use `opacity`, not `visibility`, so pagination measurement still works.
    newEl.style.opacity = "0";
    containerEl.appendChild(newEl);

    await newHost.open(this.contentLoader, this.resolver, this.spineIndex);
    const newDoc = newHost.element.contentDocument;
    if (newDoc) {
      ReadingTheme.applyPageTheme(newDoc, this.pageTheme);
      if (
        this.fontScale !== 1 ||
        this.fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY ||
        this.lineSpacing !== ReadingTheme.DEFAULT_LINE_SPACING ||
        this.letterSpacing !== ReadingTheme.DEFAULT_LETTER_SPACING ||
        this.contentWidthEm !== ReadingTheme.DEFAULT_CONTENT_WIDTH_EM
      ) {
        ReadingTheme.applyFontScale(newDoc, this.fontScale);
        ReadingTheme.applyFontFamily(newDoc, this.fontFamily);
        ReadingTheme.applyLineSpacing(newDoc, this.lineSpacing);
        ReadingTheme.applyLetterSpacing(newDoc, this.letterSpacing);
        ReadingTheme.applyContentWidth(newDoc, this.contentWidthEm);
        newHost.relayout(this.width, this.height);
      }
    }
    newHost.goToPageIndex(targetIndex);
    newEl.style.opacity = "";
    newEl.title = oldHost.element.title;
    return newHost;
  }

  /** Returns whether a forward spread turn can merge into `nextSpineIndex`.
   * Shared by both merge-preparation paths so they can bail out before
   * doing work that would need to be undone. */
  private canMergeSpreadIntoNext(nextSpineIndex: number): boolean {
    if (!this.containerEl) {
      return false;
    }
    const nextSpineItem = this.pkg.spine[nextSpineIndex];
    if (!nextSpineItem) {
      return false;
    }
    const resolvedLayout = nextSpineItem.resolveRenditionLayout(this.pkg.metadata.renditionLayout);
    return resolvedLayout !== "pre-paginated" && SpreadPaginatedHost.isEligible(this.width);
  }

  /** Shared second half of the two merge paths: builds the merged spread
   * from a prepared `previousTail`, applies current display settings, and
   * records the pending merged spine index. Callers remain responsible for
   * cleaning up failures because only they know where `previousTail` came
   * from. */
  private async buildMergedSpreadHost(
    nextSpineIndex: number,
    previousTail: PaginatedContentHost,
  ): Promise<SpreadPaginatedHost> {
    const containerEl = this.containerEl;
    if (!containerEl) {
      throw new Error("buildMergedSpreadHost called without a container element (unexpected).");
    }
    const newHost = new SpreadPaginatedHost(this.width, this.height);
    const newEl = newHost.element;
    newEl.style.position = "absolute";
    newEl.style.top = "0";
    newEl.style.left = "0";
    newEl.style.zIndex = "1";
    // Keep the staging host attached but invisible while it loads.
    newEl.style.opacity = "0";
    containerEl.appendChild(newEl);

    try {
      await newHost.openMergedWithPreviousTail(this.contentLoader, this.resolver, nextSpineIndex, previousTail);
    } catch (err) {
      newHost.dispose();
      newEl.remove();
      throw err;
    }

    const newDocs = newHost.contentDocuments();
    for (const newDoc of newDocs) {
      ReadingTheme.applyPageTheme(newDoc, this.pageTheme);
    }
    if (
      this.fontScale !== 1 ||
      this.fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY ||
      this.lineSpacing !== ReadingTheme.DEFAULT_LINE_SPACING ||
      this.letterSpacing !== ReadingTheme.DEFAULT_LETTER_SPACING ||
      this.contentWidthEm !== ReadingTheme.DEFAULT_CONTENT_WIDTH_EM
    ) {
      for (const newDoc of newDocs) {
        ReadingTheme.applyFontScale(newDoc, this.fontScale);
        ReadingTheme.applyFontFamily(newDoc, this.fontFamily);
        ReadingTheme.applyLineSpacing(newDoc, this.lineSpacing);
        ReadingTheme.applyLetterSpacing(newDoc, this.letterSpacing);
        ReadingTheme.applyContentWidth(newDoc, this.contentWidthEm);
      }
      newHost.relayout(this.width, this.height);
    }
    newEl.style.opacity = "";
    // `previousTail` may have been loaded as a hidden standalone element
    // before being moved into the merged host, so clear those inline styles
    // here so the borrowed page can display and accept interaction.
    previousTail.element.style.opacity = "";
    previousTail.element.style.pointerEvents = "";
    newHost.setTitle(`${this.pkg.metadata.title} — ${this.chapterLabel(nextSpineIndex)}`);
    this.pendingSpreadMergeSpineIndex = nextSpineIndex;
    return newHost;
  }

  /** Builds the merged incoming spread for a forward turn off an `oldHost`
   * already sitting on its unpaired last page. The next chapter opens on
   * the right while `oldHost`'s last page is reused on the left, avoiding
   * a transient blank facing page. `currentSpineIndex` defaults to
   * `this.spineIndex` for turn-driven callers but can be passed explicitly
   * when `openSpineItem` invokes this on a newly opened host. */
  private async prepareMergedIncomingSpread(
    oldHost: SpreadPaginatedHost,
    currentSpineIndex: number = this.spineIndex,
  ): Promise<SpreadPaginatedHost | undefined> {
    const nextSpineIndex = currentSpineIndex + 1;
    if (!this.canMergeSpreadIntoNext(nextSpineIndex)) {
      return undefined;
    }
    // Detach the reusable left page only after all preconditions pass;
    // reattach it if the async load fails.
    const previousTail = oldHost.detachLeftForReuse();
    try {
      return await this.buildMergedSpreadHost(nextSpineIndex, previousTail);
    } catch (err) {
      oldHost.reattachDetachedLeft();
      throw err;
    }
  }

  /** Builds the more common merge case: `oldHost` is still on its last
   * paired spread, one turn before an unpaired tail page. It loads a fresh
   * standalone tail host for this chapter and merges that directly into the
   * next chapter so the reader never sees the intermediate blank-facing
   * spread. `oldHost` stays untouched so it remains the valid outgoing side
   * of the turn animation. */
  private async prepareMergedIncomingSpreadFromUpcomingLastPage(): Promise<SpreadPaginatedHost | undefined> {
    const nextSpineIndex = this.spineIndex + 1;
    if (!this.canMergeSpreadIntoNext(nextSpineIndex) || !this.containerEl) {
      return undefined;
    }
    const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(this.width);
    const previousTail = new PaginatedContentHost(columnWidth, this.height);
    // Attach before `open()`; detached iframes do not navigate. Once the
    // merged host is ready, `openMergedWithPreviousTail` reparents this
    // loaded element into it.
    previousTail.element.style.position = "absolute";
    // Keep the standalone tail hidden and inert until
    // `buildMergedSpreadHost` moves it into place.
    previousTail.element.style.opacity = "0";
    previousTail.element.style.pointerEvents = "none";
    this.containerEl.appendChild(previousTail.element);
    try {
      await previousTail.open(this.contentLoader, this.resolver, this.spineIndex);
    } catch (err) {
      previousTail.element.remove();
      previousTail.dispose();
      throw err;
    }
    previousTail.goToLastPage();
    try {
      return await this.buildMergedSpreadHost(nextSpineIndex, previousTail);
    } catch (err) {
      previousTail.element.remove();
      previousTail.dispose();
      throw err;
    }
  }

  /** Builds the incoming spread for an in-chapter spread turn and
   * positions it directly under `oldHost.element`. Returns `undefined`
   * only when `oldHost` is already at the edge of the chapter; a lopsided
   * final spread is still a valid target. Forward turns off an unpaired
   * last page are handled earlier by `prepareMergedIncomingSpread`. */
  private async prepareIncomingSpread(
    oldHost: SpreadPaginatedHost,
    direction: 1 | -1,
  ): Promise<SpreadPaginatedHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    this.pendingSpreadMergeSpineIndex = undefined;
    if (direction === 1 && oldHost.secondPageIndex === undefined) {
      const merged = await this.prepareMergedIncomingSpread(oldHost);
      if (merged) {
        return merged;
      }
      // No mergeable next chapter; fall through so the usual chapter-open
      // fallback handles the boundary with the normal blank facing page.
    } else if (
      direction === 1 &&
      oldHost.secondPageIndex !== undefined &&
      oldHost.pageIndex < oldHost.pageCount - 2
    ) {
      // Catch an upcoming unpaired last page one turn early so the reader
      // never sees the blank-facing intermediate spread.
      //
      // The `oldHost.pageIndex < oldHost.pageCount - 2` guard is required:
      // without a real further in-chapter turn, even-length chapters would
      // misclassify their true last spread as "upcoming unpaired" and
      // wrongly force a merge.
      const upcomingTarget = Math.min(oldHost.pageIndex + 2, oldHost.pageCount - 1);
      const upcomingTargetHasCompanion = upcomingTarget + 1 < oldHost.pageCount;
      if (!upcomingTargetHasCompanion) {
        const merged = await this.prepareMergedIncomingSpreadFromUpcomingLastPage();
        if (merged) {
          return merged;
        }
        // No eligible next chapter; fall through to the normal in-chapter
        // path so `oldHost` still lands on its own unpaired last page.
      }
    }
    if (direction === 1 ? oldHost.pageIndex >= oldHost.pageCount - 2 : oldHost.pageIndex <= 0) {
      return undefined;
    }
    const targetIndex =
      direction === 1
        ? Math.min(oldHost.pageIndex + 2, oldHost.pageCount - 1)
        : Math.max(oldHost.pageIndex - 2, 0);

    const containerEl = this.containerEl;
    const newHost = new SpreadPaginatedHost(this.width, this.height);
    const newEl = newHost.element;
    newEl.style.position = "absolute";
    newEl.style.top = "0";
    // `SpreadPaginatedHost` is created at `this.width`, so `left: 0`
    // aligns it and leaves `transform` free for the entering turn.
    newEl.style.left = "0";
    newEl.style.zIndex = "1";
    // Hide the incoming spread while it loads; use `opacity: 0`, not
    // `visibility: hidden`, because `syncRight` can set explicit
    // visibility on the right column and override inherited visibility.
    newEl.style.opacity = "0";
    containerEl.appendChild(newEl);

    await newHost.open(this.contentLoader, this.resolver, this.spineIndex);
    const newDocs = newHost.contentDocuments();
    for (const newDoc of newDocs) {
      ReadingTheme.applyPageTheme(newDoc, this.pageTheme);
    }
    if (
      this.fontScale !== 1 ||
      this.fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY ||
      this.lineSpacing !== ReadingTheme.DEFAULT_LINE_SPACING ||
      this.letterSpacing !== ReadingTheme.DEFAULT_LETTER_SPACING ||
      this.contentWidthEm !== ReadingTheme.DEFAULT_CONTENT_WIDTH_EM
    ) {
      for (const newDoc of newDocs) {
        ReadingTheme.applyFontScale(newDoc, this.fontScale);
        ReadingTheme.applyFontFamily(newDoc, this.fontFamily);
        ReadingTheme.applyLineSpacing(newDoc, this.lineSpacing);
        ReadingTheme.applyLetterSpacing(newDoc, this.letterSpacing);
        ReadingTheme.applyContentWidth(newDoc, this.contentWidthEm);
      }
      newHost.relayout(this.width, this.height);
    }
    newHost.goToPageIndex(targetIndex);
    newEl.style.opacity = "";
    newHost.setTitle(`${this.pkg.metadata.title} — ${this.chapterLabel(this.spineIndex)}`);
    return newHost;
  }

  /** Fraction of the pane width a drag must cross to commit the turn. */
  private static readonly DRAG_COMMIT_THRESHOLD = 0.4;

  /** Re-attaches page-turn pointer handling to the current host. Single-
   * column paginated mode gets drag-to-turn; spread and fixed-layout
   * modes stay click-to-navigate only in this pass. Listeners attach to
   * each iframe document because iframe pointer events do not bubble out. */
  private setUpDragPageTurn(): void {
    this.dragCleanup?.();
    this.dragCleanup = undefined;

    if (this.host instanceof SpreadPaginatedHost) {
      this.dragCleanup = this.setUpSpreadClickToNavigate(this.host);
      return;
    }

    if (this.host instanceof FixedSpreadHost) {
      // Fixed-layout content uses click-to-navigate only.
      this.dragCleanup = this.setUpFixedSpreadClickToNavigate(this.host);
      return;
    }

    if (!(this.host instanceof PaginatedContentHost)) {
      return;
    }
    const iframeDocument = this.host.element.contentDocument;
    if (!iframeDocument) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      this.beginDragPageTurn(event, iframeDocument);
    };
    iframeDocument.addEventListener("pointerdown", onPointerDown);
    const containerCleanup = this.setUpBelowPageClickFallback();
    this.dragCleanup = () => {
      iframeDocument.removeEventListener("pointerdown", onPointerDown);
      containerCleanup();
    };
  }

  /** Container-level click fallback for single-page paginated mode.
   * `PaginatedContentHost` can be shorter than the pane, so clicks in the
   * uncovered lower gap must still use whole-pane third-based navigation. */
  private setUpBelowPageClickFallback(): () => void {
    const containerEl = this.containerEl;
    if (!containerEl) {
      return () => {};
    }
    // Keep `pointerup` gesture-scoped instead of sharing mutable start
    // state: this listener can be rebuilt mid-gesture, and the in-flight
    // release must still use the original coordinates.
    const onContainerPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      this.bumpContentActivity();
      const startX = event.clientX;
      const startY = event.clientY;
      const onPointerUp = (upEvent: PointerEvent): void => {
        containerEl.removeEventListener("pointerup", onPointerUp);
        const deltaX = Math.abs(upEvent.clientX - startX);
        const deltaY = Math.abs(upEvent.clientY - startY);
        if (
          deltaX > ReaderController.CLICK_MOVEMENT_TOLERANCE ||
          deltaY > ReaderController.CLICK_MOVEMENT_TOLERANCE
        ) {
          return;
        }
        const thirdWidth = this.width / 3;
        if (startX < thirdWidth) {
          void this.turnPage(-1);
        } else if (startX > this.width - thirdWidth) {
          void this.turnPage(1);
        }
        // Middle third: no-op, exactly like `handleContentClick`.
      };
      containerEl.addEventListener("pointerup", onPointerUp);
    };
    containerEl.addEventListener("pointerdown", onContainerPointerDown);
    return () => containerEl.removeEventListener("pointerdown", onContainerPointerDown);
  }

  /** Click-to-navigate for spread mode, using each column's own width for
   * its third-based tap zones. A container listener handles taps on the
   * blank companion page or gutter because a `visibility: hidden` iframe
   * is not hit-tested. Each gesture keeps its own one-shot `pointerup`
   * because these listeners may be rebuilt mid-gesture. */
  private setUpSpreadClickToNavigate(host: SpreadPaginatedHost): () => void {
    const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(this.width);
    const cleanups: Array<() => void> = [];

    host.contentDocuments().forEach((doc, columnIndex) => {
      // The right column's left edge is the gutter, so that zone still
      // means "forward" rather than "back."
      const isRightColumn = columnIndex === 1;
      const leftThirdAction: 1 | -1 = isRightColumn ? 1 : -1;
      const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        const startX = event.clientX;
        const startY = event.clientY;
        const onPointerUp = (upEvent: PointerEvent): void => {
          doc.removeEventListener("pointerup", onPointerUp);
          this.handleContentClick(upEvent, startX, startY, columnWidth, doc, leftThirdAction, 1);
        };
        doc.addEventListener("pointerup", onPointerUp);
      };
      doc.addEventListener("pointerdown", onPointerDown);
      cleanups.push(() => doc.removeEventListener("pointerdown", onPointerDown));
    });

    const containerEl = host.element;
    const onContainerPointerDown = (event: PointerEvent): void => {
      this.bumpContentActivity();
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      const containerStartX = event.clientX;
      const containerStartY = event.clientY;
      const onContainerPointerUp = (event: PointerEvent): void => {
        containerEl.removeEventListener("pointerup", onContainerPointerUp);
        const deltaX = Math.abs(event.clientX - containerStartX);
        const deltaY = Math.abs(event.clientY - containerStartY);
        if (
          deltaX > ReaderController.CLICK_MOVEMENT_TOLERANCE ||
          deltaY > ReaderController.CLICK_MOVEMENT_TOLERANCE
        ) {
          return;
        }
        void this.turnPage(1);
      };
      containerEl.addEventListener("pointerup", onContainerPointerUp);
    };
    containerEl.addEventListener("pointerdown", onContainerPointerDown);
    cleanups.push(() => containerEl.removeEventListener("pointerdown", onContainerPointerDown));

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  /** Fixed-layout click-to-navigate. Pointer coordinates stay in each
   * document's intrinsic space even when the iframe is scaled, so this
   * path reads that document's live `innerWidth` instead of reusing a
   * spread-wide width. The container fallback buckets by whole-pane
   * thirds because fixed pages can be letterboxed on either side. */
  private setUpFixedSpreadClickToNavigate(host: FixedSpreadHost): () => void {
    const cleanups: Array<() => void> = [];
    const rtl = this.pkg.pageProgressionDirection === "rtl";

    host.contentDocuments().forEach((doc, columnIndex) => {
      // Only meaningful for a `"pair"` spread.
      const columnRole: "single" | "left" | "right" =
        host.spread?.kind === "pair" ? (columnIndex === 1 ? "right" : "left") : "single";
      const { left: leftThirdAction, right: rightThirdAction } = this.fixedSpreadThirdActions(columnRole, rtl);
      const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        const startX = event.clientX;
        const startY = event.clientY;
        const containerWidth = doc.defaultView?.innerWidth ?? this.width;
        const onPointerUp = (upEvent: PointerEvent): void => {
          doc.removeEventListener("pointerup", onPointerUp);
          this.handleContentClick(upEvent, startX, startY, containerWidth, doc, leftThirdAction, rightThirdAction);
        };
        doc.addEventListener("pointerup", onPointerUp);
      };
      doc.addEventListener("pointerdown", onPointerDown);
      cleanups.push(() => doc.removeEventListener("pointerdown", onPointerDown));
    });

    const containerEl = host.element;
    // Margin clicks belong to no specific page, so treat them as
    // `"single"` and use the outer-edge convention.
    const { left: containerLeftAction, right: containerRightAction } = this.fixedSpreadThirdActions("single", rtl);
    const onContainerPointerDown = (event: PointerEvent): void => {
      this.bumpContentActivity();
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const onContainerPointerUp = (upEvent: PointerEvent): void => {
        containerEl.removeEventListener("pointerup", onContainerPointerUp);
        // This click missed every page, so container coordinates are the
        // right frame of reference here.
        this.handleContentClick(
          upEvent,
          startX,
          startY,
          this.width,
          containerEl.ownerDocument,
          containerLeftAction,
          containerRightAction,
        );
      };
      containerEl.addEventListener("pointerup", onContainerPointerUp);
    };
    containerEl.addEventListener("pointerdown", onContainerPointerDown);
    cleanups.push(() => containerEl.removeEventListener("pointerdown", onContainerPointerDown));

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  /** Returns the fixed-spread third actions for one column. Only the
   * spread's true outer edge means "back"; the gutter-side third always
   * means "forward", mirrored in RTL. */
  private fixedSpreadThirdActions(
    columnRole: "single" | "left" | "right",
    rtl: boolean,
  ): { left: 1 | -1; right: 1 | -1 } {
    if (!rtl) {
      return columnRole === "right" ? { left: 1, right: 1 } : { left: -1, right: 1 };
    }
    return columnRole === "left" ? { left: 1, right: 1 } : { left: 1, right: -1 };
  }

  /** Tracks one drag-to-turn gesture from `pointerdown` through release.
   * Direction locks once movement clears the dead zone, then the incoming
   * page loads; if release happens first, settlement waits for that load
   * and uses the last recorded fraction. */
  private beginDragPageTurn(startEvent: PointerEvent, doc: Document): void {
    if (this.isTurningPage || !(this.host instanceof PaginatedContentHost)) {
      return;
    }
    const oldHost = this.host;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const containerWidth = Math.max(1, this.width);
    // "scroll" moves the incoming page with the drag instead of only
    // revealing it underneath.
    const isScroll = this.pageTurnAnimationStyle === "scroll";

    let direction: 1 | -1 | undefined;
    let newHost: PaginatedContentHost | undefined;
    let preparing = false;
    let released = false;
    let latestFraction = 0;
    let capturedToken: number | undefined;
    // Built once when the incoming page is ready: "slide" needs a
    // backdrop for short-page bleed, and "rotate" needs a mask for the
    // newly exposed grown-height region.
    let turnBackdrop: HTMLDivElement | undefined;
    let turnGrowthMask: HTMLDivElement | undefined;

    const cleanupListeners = (): void => {
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerup", onPointerUp);
      doc.removeEventListener("pointercancel", onPointerUp);
    };

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startX;

      if (direction === undefined) {
        if (Math.abs(deltaX) < 12) {
          return;
        }
        const lockedDirection: 1 | -1 = deltaX < 0 ? 1 : -1;
        direction = lockedDirection;
        this.isTurningPage = true;
        const token = ++this.turnToken;
        capturedToken = token;
        preparing = true;
        void this.prepareIncomingPage(oldHost, lockedDirection).then((prepared) => {
          preparing = false;
          newHost = prepared;
          if (released) {
            void this.settleDragPageTurn(
              oldHost,
              prepared,
              lockedDirection,
              latestFraction,
              token,
              turnBackdrop,
              turnGrowthMask,
            );
            return;
          }
          if (prepared) {
            // Drop `clip-path` on both hosts during overlapping drag
            // previews; the Chromium compositing bug this avoids is not
            // specific to committed turns.
            //
            // Only "rotate" grows `oldHost` to full height; "slide" must
            // not, or a short page would reveal extra document flow once
            // its clip-path is gone.
            //
            // "slide" and "rotate" also need their usual bleed-masking in
            // the interactive preview path.
            if (this.pageTurnAnimationStyle === "rotate") {
              oldHost.suppressClipPathForAnimation();
              const naturalHeight = oldHost.element.getBoundingClientRect().height;
              oldHost.growToFullHeight(this.height);
              prepared.suppressClipPathForAnimation();
              turnGrowthMask = this.pageTurnAnimator.buildTurnGrowthMask(oldHost.element, naturalHeight);
              if (turnGrowthMask) {
                turnGrowthMask.style.zIndex = "2";
                oldHost.element.parentElement?.insertBefore(turnGrowthMask, oldHost.element.nextSibling);
              }
            } else if (this.pageTurnAnimationStyle === "slide") {
              oldHost.suppressClipPathForAnimation();
              prepared.suppressClipPathForAnimation();
              turnBackdrop = this.pageTurnAnimator.buildTurnBackdrop(oldHost.element);
              if (turnBackdrop) {
                turnBackdrop.style.zIndex = "2";
                oldHost.element.parentElement?.insertBefore(turnBackdrop, oldHost.element);
              }
            }
            this.pageTurnAnimator.stagePageTurn(oldHost.element, oldHost.element, lockedDirection);
            this.pageTurnAnimator.setPageTurnTransform(
              oldHost.element,
              this.pageTurnAnimator.pageTurnPartialAmount(lockedDirection, latestFraction),
              latestFraction,
              [...(turnBackdrop ? [turnBackdrop] : []), ...(turnGrowthMask ? [turnGrowthMask] : [])],
            );
            if (isScroll) {
              prepared.element.style.transform = `translateX(${this.pageTurnAnimator.scrollDragEnterAmount(lockedDirection, latestFraction)}%)`;
            }
          } else {
            // Chapter boundary: this pass has nothing to drag into.
            this.isTurningPage = false;
          }
        });
      }

      moveEvent.preventDefault();
      const fraction = Math.max(0, Math.min(1, Math.abs(deltaX) / containerWidth));
      latestFraction = fraction;
      if (newHost && direction !== undefined) {
        this.pageTurnAnimator.setPageTurnTransform(
          oldHost.element,
          this.pageTurnAnimator.pageTurnPartialAmount(direction, fraction),
          fraction,
          [...(turnBackdrop ? [turnBackdrop] : []), ...(turnGrowthMask ? [turnGrowthMask] : [])],
        );
        if (isScroll) {
          newHost.element.style.transform = `translateX(${this.pageTurnAnimator.scrollDragEnterAmount(direction, fraction)}%)`;
        }
      }
    };

    const onPointerUp = (upEvent: PointerEvent): void => {
      cleanupListeners();
      if (direction === undefined || capturedToken === undefined) {
        // Still a tap, not a drag; only a real release should trigger
        // click-to-navigate.
        if (upEvent.type === "pointerup") {
          this.handleContentClick(upEvent, startX, startY, containerWidth, doc);
        }
        return;
      }
      released = true;
      if (preparing) {
        // Settled by the prepare promise once the incoming page is ready.
        return;
      }
      void this.settleDragPageTurn(oldHost, newHost, direction, latestFraction, capturedToken, turnBackdrop, turnGrowthMask);
    };

    doc.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("pointerup", onPointerUp);
    doc.addEventListener("pointercancel", onPointerUp);
  }

  /** Maximum movement for a gesture to still count as a tap. */
  private static readonly CLICK_MOVEMENT_TOLERANCE = 10;

  /** Turns the page when a tap lands in the left or right third, with
   * guards for drags, active selections, and link clicks. The explicit
   * third actions matter because gutter-adjacent thirds still mean
   * "forward", and fixed-layout RTL spreads mirror which outer edge means
   * "back". */
  private handleContentClick(
    upEvent: PointerEvent,
    startX: number,
    startY: number,
    containerWidth: number,
    doc: Document,
    leftThirdAction: 1 | -1 = -1,
    rightThirdAction: 1 | -1 = 1,
  ): void {
    const deltaX = Math.abs(upEvent.clientX - startX);
    const deltaY = Math.abs(upEvent.clientY - startY);
    if (
      deltaX > ReaderController.CLICK_MOVEMENT_TOLERANCE ||
      deltaY > ReaderController.CLICK_MOVEMENT_TOLERANCE
    ) {
      return;
    }

    // The caller passes `doc` directly because iframe events come from a
    // different `Node` realm, so `upEvent.target instanceof Node` would
    // fail and break the selection guard.
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    if ((upEvent.target as Element | null)?.closest?.("a[href]")) {
      return;
    }

    // A tap on an existing highlight should open its popup, not also turn
    // the page out from under that interaction.
    if (this.highlightInteraction.findHighlightAtPoint(doc, upEvent.clientX, upEvent.clientY)) {
      return;
    }

    const thirdWidth = containerWidth / 3;
    if (startX < thirdWidth) {
      void this.turnPage(leftThirdAction);
    } else if (startX > containerWidth - thirdWidth) {
      void this.turnPage(rightThirdAction);
    }
    // Middle third: no-op for now.
  }

  /** Settles a released drag gesture once the incoming page is ready.
   * Commits past `DRAG_COMMIT_THRESHOLD`, otherwise animates back closed.
   * `newHost` is absent at chapter boundaries, and `token` prevents a
   * stale completion from clobbering a newer turn. */
  private async settleDragPageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost | undefined,
    direction: 1 | -1,
    fraction: number,
    token: number,
    turnBackdrop?: HTMLDivElement,
    turnGrowthMask?: HTMLDivElement,
  ): Promise<void> {
    if (!newHost) {
      this.isTurningPage = false;
      turnBackdrop?.remove();
      turnGrowthMask?.remove();
      return;
    }

    // Capture before anything below disposes `oldHost`.
    const hadKeyboardFocus = this.iframeHasFocus(oldHost);
    const oldEl = oldHost.element;
    const newEl = newHost.element;
    const commit = fraction >= ReaderController.DRAG_COMMIT_THRESHOLD;
    const reduceMotion = this.pageTurnAnimator.shouldSkipPageTurnAnimation();
    // Only "scroll" moves `newEl` during the drag, so only it needs a
    // matching release animation here.
    const isScroll = this.pageTurnAnimationStyle === "scroll";
    const extraEls = [...(turnBackdrop ? [turnBackdrop] : []), ...(turnGrowthMask ? [turnGrowthMask] : [])];

    if (!reduceMotion) {
      const remainingFraction = commit ? 1 - fraction : fraction;
      const duration = Math.max(80, Math.round(remainingFraction * 260));
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          oldEl.removeEventListener("transitionend", onTransitionEnd);
          resolve();
        };
        const onTransitionEnd = (event: TransitionEvent): void => {
          if (event.target === oldEl && event.propertyName === "transform") {
            finish();
          }
        };
        oldEl.addEventListener("transitionend", onTransitionEnd);
        // Only the non-scroll styles animate box-shadow.
        for (const el of [oldEl, ...extraEls]) {
          el.style.transition = isScroll
            ? `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`
            : `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow ${duration}ms ease`;
        }
        if (isScroll) {
          newEl.style.transition = `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        }
        requestAnimationFrame(() => {
          if (commit) {
            this.pageTurnAnimator.setPageTurnTransform(oldEl, direction === 1 ? -100 : 100, 1, extraEls);
            if (isScroll) {
              newEl.style.transform = "translateX(0%)";
            }
          } else {
            this.pageTurnAnimator.setPageTurnTransform(oldEl, 0, 0, extraEls);
            if (isScroll) {
              newEl.style.transform = `translateX(${direction * 100}%)`;
            }
          }
        });
        setTimeout(finish, duration + 250);
      });
    }
    turnBackdrop?.remove();
    turnGrowthMask?.remove();

    if (this.containerEl) {
      this.containerEl.style.perspective = "";
    }

    if (token !== this.turnToken) {
      // Discard stale completion if a newer turn won the race.
      newHost.dispose();
      if (!commit) {
        oldEl.style.position = "";
        oldEl.style.zIndex = "";
        oldEl.style.backfaceVisibility = "";
        oldEl.style.transformOrigin = "";
        oldEl.style.transition = "";
        oldEl.style.transform = "";
        oldEl.style.boxShadow = "";
        oldHost.restoreNaturalHeight();
      }
      this.isTurningPage = false;
      return;
    }

    if (commit) {
      // A committed drag turn also invalidates any highlight popup tied
      // to the outgoing page.
      this.activeHighlight = undefined;
      this.footnotePopup = undefined;
      oldHost.dispose();
      newEl.style.position = "";
      newEl.style.top = "";
      newEl.style.left = "";
      newEl.style.transform = "";
      newEl.style.zIndex = "";
      // Restore anything `suppressClipPathForAnimation` changed while
      // `newHost` sat underneath the drag preview.
      newHost.restoreNaturalHeight();

      this.contentInteractionCleanup?.();
      this.contentInteractionCleanup = undefined;
      this.dragCleanup?.();
      this.dragCleanup = undefined;
      this.host = newHost;
      this.clearStaleHostWrapper();
      this.updateContentTitle();
      this.reattachKeyboardNav();
      this.setUpContentInteraction();
      this.setUpDragPageTurn();
      this.highlightInteraction.setUpHighlightSelection();
      this.highlightInteraction.applyHighlightsToCurrentHost();
      this.restoreFocusAfterHostSwap(hadKeyboardFocus);
      this.announce(
        this.translate("scrubber.pageOfTotal", { current: newHost.currentPageIndex + 1, total: newHost.pageCount }),
      );
      this.notify();
      await this.saveProgress();
    } else {
      oldEl.style.position = "";
      oldEl.style.zIndex = "";
      oldEl.style.backfaceVisibility = "";
      oldEl.style.transformOrigin = "";
      oldEl.style.transition = "";
      oldEl.style.transform = "";
      oldEl.style.boxShadow = "";
      oldHost.restoreNaturalHeight();
      newHost.dispose();
    }
    this.isTurningPage = false;
  }

  /** Assembles the Book Details panel data from parsed OPF metadata plus
   * the stored file name and cover. The cover object URL is cached per
   * controller so repeated opens do not leak unreclaimed URLs. */
  public async getBookDetails(): Promise<BookDetails> {
    const libraryRecord = await this.library.getBookMetadata(this.bookId);

    if (this.cachedCoverUrl === undefined) {
      const coverBlob = await this.library.getCoverBlob(this.bookId);
      if (coverBlob) {
        this.cachedCoverUrl = URL.createObjectURL(coverBlob);
      }
    }

    // The EPUB's own description wins; fetched fallback text is only used
    // when absent and stays attributed to its source.
    const hasOwnDescription = Boolean(this.pkg.metadata.description);
    return {
      title: this.pkg.metadata.title,
      creator: this.pkg.metadata.creator,
      description: this.pkg.metadata.description ?? libraryRecord?.fetchedDescription,
      descriptionSourceName: hasOwnDescription ? undefined : libraryRecord?.fetchedDescriptionSourceName,
      descriptionSourceUrl: hasOwnDescription ? undefined : libraryRecord?.fetchedDescriptionSourceUrl,
      publisher: this.pkg.metadata.publisher,
      language: this.pkg.metadata.language,
      identifiers: this.pkg.metadata.identifiers,
      fileName: libraryRecord?.fileName,
      rights: this.pkg.metadata.rights,
      coverUrl: this.cachedCoverUrl,
      accessibility: this.pkg.metadata.accessibility,
    };
  }

  /** Best-effort fallback description fetch for books with no embedded
   * `dc:description`. It skips once a description exists or the retry
   * budget is exhausted. */
  private async maybeEnrichDescription(): Promise<void> {
    if (this.pkg.metadata.description) {
      return;
    }
    const libraryRecord = await this.library.getBookMetadata(this.bookId);
    if (!libraryRecord || libraryRecord.fetchedDescription) {
      return;
    }
    if ((libraryRecord.descriptionFetchAttempts ?? 0) >= MAX_DESCRIPTION_FETCH_ATTEMPTS) {
      return;
    }

    const isbn = this.pkg.metadata.identifiers.find((id) => id.scheme?.toUpperCase() === "ISBN")?.value;
    const result = await fetchBookDescription(this.pkg.metadata.title, this.pkg.metadata.creator, isbn);
    await this.library.recordDescriptionFetchResult(this.bookId, result);
  }

  /** Assembles the EPUB Inspector panel data from the in-memory archive
   * listing and parsed package metadata. Reading an individual file's raw
   * source is the only inspector path that hits the archive again. */
  public getEpubInspectionData(): EpubInspectionData {
    const manifestMediaTypeByPath = new Map(this.pkg.manifest.map((item) => [item.path, item.mediaType]));

    return {
      files: this.orderInspectionFiles(
        this.contentLoader.archiveEntries
          .filter((entry) => !entry.isDirectory)
          .map((entry) => ({
            path: entry.fileName,
            size: entry.uncompressedSize,
            isDirectory: entry.isDirectory,
            mediaType: manifestMediaTypeByPath.get(entry.fileName),
          })),
      ),
      rootFilePath: this.rootFilePath,
      title: this.pkg.metadata.title,
      identifiers: this.pkg.metadata.identifiers,
      language: this.pkg.metadata.language,
      creator: this.pkg.metadata.creator,
      creators: this.pkg.metadata.creators,
      publisher: this.pkg.metadata.publisher,
      description: this.pkg.metadata.description,
      renditionLayout: this.pkg.metadata.renditionLayout,
      renditionOrientation: this.pkg.metadata.renditionOrientation,
      rights: this.pkg.metadata.rights,
      date: this.pkg.metadata.date,
      subjects: this.pkg.metadata.subjects,
      contributors: this.pkg.metadata.contributors,
      metaEntries: this.pkg.metadata.metaEntries,
      manifest: this.pkg.manifest.map((item) => ({
        id: item.id,
        path: item.path,
        mediaType: item.mediaType,
        properties: Array.from(item.properties),
      })),
      spine: this.pkg.spine.map((spineItemRef) => ({
        path: spineItemRef.manifestItem.path,
        linear: spineItemRef.linear,
        mediaType: spineItemRef.manifestItem.mediaType,
        properties: Array.from(spineItemRef.properties),
      })),
    };
  }

  /** Orders Inspector files by EPUB structure: core container files first,
   * then spine items in reading order, then other manifest resources, and
   * finally non-manifest leftovers. */
  private orderInspectionFiles(
    files: readonly { path: string; size: number; isDirectory: boolean; mediaType: string | undefined }[],
  ): EpubInspectionFile[] {
    const rootFilePath = this.rootFilePath;
    const navPath = this.pkg.manifest.find((item) => item.isNavDocument)?.path;
    const ncxPath = this.pkg.manifest.find((item) => item.mediaType === NCX_MEDIA_TYPE)?.path;
    const spineOrder = new Map(this.pkg.spine.map((ref, index) => [ref.manifestItem.path, index]));

    function groupOf(path: string): number {
      if (path === "mimetype") {
        return 0;
      }
      if (path.startsWith("META-INF/")) {
        return 1;
      }
      if (path === rootFilePath) {
        return 2;
      }
      if (path === ncxPath) {
        return 3;
      }
      if (path === navPath) {
        return 4;
      }
      if (spineOrder.has(path)) {
        return 5;
      }
      return 6;
    }

    return files
      .map((file, originalIndex) => ({ file, originalIndex }))
      .sort((a, b) => {
        const groupA = groupOf(a.file.path);
        const groupB = groupOf(b.file.path);
        if (groupA !== groupB) {
          return groupA - groupB;
        }
        if (groupA === 5) {
          // Within the spine group, preserve reading order instead of
          // archive order.
          return (spineOrder.get(a.file.path) ?? 0) - (spineOrder.get(b.file.path) ?? 0);
        }
        return a.originalIndex - b.originalIndex;
      })
      .map(({ file }) => file);
  }

  /** Reads one archive file's raw text for the Inspector file browser,
   * without any rendering-time parsing or rewriting. */
  public readInspectionFileText(path: string): Promise<string> {
    return this.contentLoader.readArchiveFileText(path);
  }

  /** Builds and caches an object URL for an Inspector media preview.
   * The caller supplies the resolved `mediaType` so the preview element
   * gets a correctly typed `Blob`. */
  public async getInspectionFilePreviewUrl(path: string, mediaType: string): Promise<string> {
    const cached = this.inspectionPreviewUrlCache.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const bytes = await this.contentLoader.readArchiveFileBytes(path);
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType }));
    this.inspectionPreviewUrlCache.set(path, url);
    return url;
  }

  /** Basic reader state to include alongside the diagnostics trail. */
  private diagnosticsContext(): Record<string, string> {
    return {
      book: this.pkg.metadata.title,
      spineIndex: String(this.spineIndex),
      spineLength: String(this.pkg.spine.length),
      viewMode: this.viewMode,
      paneSize: `${this.width}x${this.height}`,
      isSpread: String(this.host instanceof SpreadPaginatedHost),
    };
  }

  /** Formats the diagnostics trail and reader state as plain text. */
  public getDiagnosticsText(): string {
    return this.diagnostics.format(this.diagnosticsContext());
  }

  /** Loads the adjacent chapter directly, unlike page-by-page `turnPage`. */
  public async goToChapter(direction: 1 | -1): Promise<void> {
    const nextSpineIndex = this.spineIndex + direction;
    if (nextSpineIndex < 0 || nextSpineIndex >= this.pkg.spine.length) {
      return;
    }
    this.clearSearchHighlightUnlessPinned();
    await this.openSpineItem(nextSpineIndex);
  }

  /** Side-effect-free preview of where a scrubber drag would land.
   * Prefer exact page data when `bookPagination` is ready, otherwise fall
   * back to a chapter-level preview. Returns raw position data because
   * the UI formats localized strings, while `chapterLabel` is book text. */
  public previewSeek(fraction: number): { position: PreviewPosition; chapterLabel: string } {
    const clamped = Math.max(0, Math.min(1, fraction));
    const totalPages = this.bookPagination?.positionFor(0, 0).totalPages;
    if (totalPages !== undefined && totalPages > 0) {
      const targetGlobalPage = Math.max(1, Math.round(clamped * totalPages));
      const resolved = this.bookPagination?.resolveGlobalPage(targetGlobalPage);
      if (resolved) {
        return {
          position: { kind: "page", current: targetGlobalPage, total: totalPages },
          chapterLabel: this.chapterLabel(resolved.spineIndex),
        };
      }
    }
    const { spineIndex: targetSpineIndex } = this.resolveSpineFraction(clamped);
    return {
      position: { kind: "chapter", current: targetSpineIndex + 1, total: this.pkg.spine.length },
      chapterLabel: this.chapterLabel(targetSpineIndex),
    };
  }

  /** Jumps to a whole-book fraction after the scrubber drag settles.
   * Prefer exact page-level seeking when `bookPagination` is ready;
   * otherwise fall back to coarse spine-level seeking that still lands
   * partway through the chosen chapter instead of always at its start. */
  public async seekToFraction(fraction: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.diagnostics.record(`seekToFraction fraction=${fraction} clamped=${clamped}`);
    this.clearSearchHighlightUnlessPinned();
    const totalPages = this.bookPagination?.positionFor(0, 0).totalPages;
    if (totalPages !== undefined && totalPages > 0) {
      const targetGlobalPage = Math.max(1, Math.round(clamped * totalPages));
      const resolved = this.bookPagination?.resolveGlobalPage(targetGlobalPage);
      if (resolved) {
        await this.openSpineItem(resolved.spineIndex, {
          landOnPageIndex: resolved.pageIndexInItem,
        });
        return;
      }
    }
    const { spineIndex: targetSpineIndex, localFraction } = this.resolveSpineFraction(clamped);
    await this.openSpineItem(targetSpineIndex, { landOnFractionInItem: localFraction });
  }

  /** Picks a spine item and an in-item fraction for coarse seeking when
   * `bookPagination` is incomplete. It treats the book as equal-width
   * spine slots so a target can still land partway through a chapter. */
  private resolveSpineFraction(clamped: number): { spineIndex: number; localFraction: number } {
    const spineLength = this.pkg.spine.length;
    if (spineLength <= 0) {
      return { spineIndex: 0, localFraction: 0 };
    }
    const scaled = clamped * spineLength;
    const spineIndex = Math.max(0, Math.min(spineLength - 1, Math.floor(scaled)));
    const localFraction = Math.max(0, Math.min(1, scaled - spineIndex));
    return { spineIndex, localFraction };
  }

  /** Navigates to a Table of Contents entry: loads its target spine item
   * (if not already open) and jumps to its fragment, if any. */
  public async goToNavPoint(navPoint: NavPoint): Promise<void> {
    if (!navPoint.path) {
      return;
    }
    const spineIndex = this.pkg.spine.findIndex((ref) => ref.manifestItem.path === navPoint.path);
    if (spineIndex === -1) {
      return;
    }
    this.clearSearchHighlightUnlessPinned();
    await this.openSpineItem(spineIndex, { fragment: navPoint.fragment });
  }

  /** Reveals a newly loaded paginated host with the same page-turn
   * animation used within a chapter, so chapter crossings read as a
   * normal turn. Returns `false` if animation is skipped or the old and
   * new hosts are not the same paginated host type. Backward turns
   * animate the incoming content on top, matching in-chapter behavior. */
  private async animateChapterCrossingReveal(
    previousHost: PaginatedContentHost | SpreadPaginatedHost,
    previousWrapperEl: HTMLDivElement | undefined,
    newHost: PaginatedContentHost | SpreadPaginatedHost,
    stagingEl: HTMLDivElement,
    direction: 1 | -1,
    oldSpineIndex: number,
    newSpineIndex: number,
  ): Promise<boolean> {
    if (!this.containerEl || this.pageTurnAnimator.shouldSkipPageTurnAnimation()) {
      return false;
    }
    const bothSingle = previousHost instanceof PaginatedContentHost && newHost instanceof PaginatedContentHost;
    const bothSpread = previousHost instanceof SpreadPaginatedHost && newHost instanceof SpreadPaginatedHost;
    if (!bothSingle && !bothSpread) {
      return false;
    }

    const oldEl = previousWrapperEl ?? previousHost.element;
    const newEl = stagingEl;
    const isScroll = this.pageTurnAnimationStyle === "scroll";
    const entering = direction === -1;
    const animatingEl = entering ? newEl : oldEl;
    const otherEl = entering ? oldEl : newEl;
    const animatingHost = entering ? newHost : previousHost;
    const otherHost = entering ? previousHost : newHost;

    let turnGrowthMaskLeft: HTMLDivElement | undefined;
    let turnGrowthMaskRight: HTMLDivElement | undefined;
    if (this.pageTurnAnimationStyle === "rotate") {
      // Match `animatePageTurn`'s single-page rotate handling.
      // Measure after dropping clip-path so the growth mask matches the
      // shrunken content height, and insert masks beside `animatingEl`
      // rather than inside it so they do not inherit the wrapper's turn.
      if (bothSpread) {
        const spreadAnimatingHost = animatingHost as SpreadPaginatedHost;
        const leftEl = this.pageTurnAnimator.spreadColumnElement(spreadAnimatingHost, 0);
        const rightEl = this.pageTurnAnimator.spreadColumnElement(spreadAnimatingHost, 1);
        spreadAnimatingHost.suppressColumnClipPathForAnimation("left");
        spreadAnimatingHost.suppressColumnClipPathForAnimation("right");
        const leftNaturalHeight = leftEl.getBoundingClientRect().height;
        const rightNaturalHeight = rightEl.getBoundingClientRect().height;
        spreadAnimatingHost.growColumnToFullHeight("left", this.height);
        spreadAnimatingHost.growColumnToFullHeight("right", this.height);
        (otherHost as SpreadPaginatedHost).suppressColumnClipPathForAnimation("left");
        (otherHost as SpreadPaginatedHost).suppressColumnClipPathForAnimation("right");
        turnGrowthMaskLeft = this.pageTurnAnimator.buildTurnGrowthMask(leftEl, leftNaturalHeight);
        turnGrowthMaskRight = this.pageTurnAnimator.buildTurnGrowthMask(rightEl, rightNaturalHeight);
        if (turnGrowthMaskLeft) {
          turnGrowthMaskLeft.style.zIndex = "2";
          animatingEl.parentElement?.insertBefore(turnGrowthMaskLeft, animatingEl.nextSibling);
        }
        if (turnGrowthMaskRight) {
          turnGrowthMaskRight.style.zIndex = "2";
          animatingEl.parentElement?.insertBefore(turnGrowthMaskRight, animatingEl.nextSibling);
        }
      } else {
        const singleAnimatingHost = animatingHost as PaginatedContentHost;
        singleAnimatingHost.suppressClipPathForAnimation();
        const naturalHeight = singleAnimatingHost.element.getBoundingClientRect().height;
        singleAnimatingHost.growToFullHeight(this.height);
        (otherHost as PaginatedContentHost).suppressClipPathForAnimation();
        turnGrowthMaskLeft = this.pageTurnAnimator.buildTurnGrowthMask(singleAnimatingHost.element, naturalHeight);
        if (turnGrowthMaskLeft) {
          turnGrowthMaskLeft.style.zIndex = "2";
          animatingEl.parentElement?.insertBefore(turnGrowthMaskLeft, animatingEl.nextSibling);
        }
      }
    } else if (this.pageTurnAnimationStyle === "slide") {
      // Drop clip-path from both sides for overlapping-iframe
      // animations.
      if (bothSpread) {
        (previousHost as SpreadPaginatedHost).suppressColumnClipPathForAnimation("left");
        (previousHost as SpreadPaginatedHost).suppressColumnClipPathForAnimation("right");
        (newHost as SpreadPaginatedHost).suppressColumnClipPathForAnimation("left");
        (newHost as SpreadPaginatedHost).suppressColumnClipPathForAnimation("right");
      } else {
        (previousHost as PaginatedContentHost).suppressClipPathForAnimation();
        (newHost as PaginatedContentHost).suppressClipPathForAnimation();
      }
    }

    // Reveal staged content and clear the loading spinner before the
    // transition runs.
    stagingEl.style.opacity = "";
    stagingEl.style.pointerEvents = "";
    this.isLoading = false;

    let turnBackdrop: HTMLDivElement | undefined;
    if (this.pageTurnAnimationStyle === "slide") {
      turnBackdrop = this.pageTurnAnimator.buildTurnBackdrop(animatingEl);
      if (turnBackdrop) {
        turnBackdrop.style.zIndex = "2";
        animatingEl.parentElement?.insertBefore(turnBackdrop, animatingEl);
      }
    }

    const title = this.pkg.metadata.title;
    const oldChapterLabel = this.chapterLabel(oldSpineIndex);
    const newChapterLabel = this.chapterLabel(newSpineIndex);
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (bothSpread) {
      const oldSpread = previousHost as SpreadPaginatedHost;
      const newSpread = newHost as SpreadPaginatedHost;
      const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(this.width);
      const gutter = SpreadPaginatedHost.GUTTER_WIDTH;
      const bands = (chapterLabel: string, primary: number | undefined, secondary: number | undefined) => [
        {
          left: 0,
          width: columnWidth,
          header: { mode: "single" as const, text: title },
          footerText: primary !== undefined ? `Page ${primary}` : undefined,
        },
        {
          left: columnWidth + gutter,
          width: columnWidth,
          header: { mode: "single" as const, text: chapterLabel },
          footerText: secondary !== undefined ? `Page ${secondary}` : undefined,
        },
      ];
      const oldPrimary = this.furniturePageNumber(oldSpineIndex, oldSpread.pageIndex, oldSpread.pageCount);
      const oldSecondary =
        oldSpread.secondPageIndex !== undefined && oldPrimary !== undefined ? oldPrimary + 1 : undefined;
      const newPrimary = this.furniturePageNumber(newSpineIndex, newSpread.pageIndex, newSpread.pageCount);
      const newSecondary =
        newSpread.secondPageIndex !== undefined && newPrimary !== undefined ? newPrimary + 1 : undefined;
      outgoingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(oldEl, bands(oldChapterLabel, oldPrimary, oldSecondary));
      incomingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(newEl, bands(newChapterLabel, newPrimary, newSecondary));
    } else {
      const oldSingle = previousHost as PaginatedContentHost;
      const newSingle = newHost as PaginatedContentHost;
      const oldNumber = this.furniturePageNumber(oldSpineIndex, oldSingle.currentPageIndex, oldSingle.pageCount);
      const newNumber = this.furniturePageNumber(newSpineIndex, newSingle.currentPageIndex, newSingle.pageCount);
      outgoingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(oldEl, [
        {
          left: 0,
          width: oldEl.getBoundingClientRect().width,
          header: { mode: "split" as const, left: title, right: oldChapterLabel },
          footerText: oldNumber !== undefined ? `Page ${oldNumber}` : undefined,
        },
      ]);
      incomingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(newEl, [
        {
          left: 0,
          width: newEl.getBoundingClientRect().width,
          header: { mode: "split" as const, left: title, right: newChapterLabel },
          footerText: newNumber !== undefined ? `Page ${newNumber}` : undefined,
        },
      ]);
    }

    if (isScroll) {
      // In scroll mode both overlays move with their pages.
      if (outgoingOverlay) {
        outgoingOverlay.style.zIndex = "2";
        this.containerEl.appendChild(outgoingOverlay);
      }
      if (incomingOverlay) {
        incomingOverlay.style.zIndex = "2";
        this.containerEl.appendChild(incomingOverlay);
      }
    } else {
      const animatedOverlay = entering ? incomingOverlay : outgoingOverlay;
      const staticOverlay = entering ? outgoingOverlay : incomingOverlay;
      if (staticOverlay) {
        staticOverlay.style.zIndex = "1";
        this.containerEl.appendChild(staticOverlay);
      }
      if (animatedOverlay) {
        animatedOverlay.style.zIndex = "2";
        this.containerEl.appendChild(animatedOverlay);
      }
    }
    this.isAnimatingPageTurn = true;
    this.notify();

    if (isScroll) {
      const oldGroup = [oldEl, ...(outgoingOverlay ? [outgoingOverlay] : [])];
      const newGroup = [newEl, ...(incomingOverlay ? [incomingOverlay] : [])];
      await this.pageTurnAnimator.playScrollTurn(oldGroup, newGroup, direction);
    } else {
      const animatedOverlayEl = entering ? incomingOverlay : outgoingOverlay;
      await this.pageTurnAnimator.playPageTurnAnimation(
        animatingEl,
        animatingEl,
        direction,
        [
          ...(animatedOverlayEl ? [animatedOverlayEl] : []),
          ...(turnBackdrop ? [turnBackdrop] : []),
          ...(turnGrowthMaskLeft ? [turnGrowthMaskLeft] : []),
          ...(turnGrowthMaskRight ? [turnGrowthMaskRight] : []),
        ],
        entering,
      );
    }

    outgoingOverlay?.remove();
    incomingOverlay?.remove();
    turnBackdrop?.remove();
    turnGrowthMaskLeft?.remove();
    turnGrowthMaskRight?.remove();
    this.isAnimatingPageTurn = false;

    if (this.pageTurnAnimationStyle === "slide" || this.pageTurnAnimationStyle === "rotate") {
      // Restore the surviving host's natural sizing and clip state after
      // slide/rotate turns.
      if (bothSpread) {
        (newHost as SpreadPaginatedHost).restoreColumnNaturalHeight("left");
        (newHost as SpreadPaginatedHost).restoreColumnNaturalHeight("right");
      } else {
        (newHost as PaginatedContentHost).restoreNaturalHeight();
      }
    }

    // Reset the surviving staging wrapper to its resting state.
    stagingEl.style.transform = "";
    stagingEl.style.zIndex = "";
    stagingEl.style.boxShadow = "";
    stagingEl.style.transition = "";
    if (otherEl === oldEl) {
      // Defensive only; `oldEl` is about to be disposed by the caller.
      otherEl.style.zIndex = "";
    }

    return true;
  }

  /** Mounts `el` in a hidden absolute wrapper so a new host can load
   * without disturbing the current one. Once loaded, reveal or remove
   * the wrapper in place; do not reparent the loaded content, because
   * moving iframes can reload them and discard in-document state. */
  private stageHiddenHostElement(el: HTMLElement): HTMLDivElement {
    const containerEl = this.containerEl!;
    const stagingEl = containerEl.ownerDocument.createElement("div");
    stagingEl.style.position = "absolute";
    stagingEl.style.inset = "0";
    // Use opacity, not visibility: spread columns can set their own
    // visibility and flash through an ancestor's hidden state.
    stagingEl.style.opacity = "0";
    stagingEl.style.pointerEvents = "none";
    stagingEl.style.display = "flex";
    stagingEl.style.justifyContent = "center";
    stagingEl.style.alignItems = "flex-start";
    // Preserve `containerEl`'s 3D perspective through this wrapper for
    // rotate turns.
    stagingEl.style.transformStyle = "preserve-3d";
    stagingEl.appendChild(el);
    containerEl.appendChild(stagingEl);
    return stagingEl;
  }

  /** Removes an empty wrapper left behind after an animated turn, since
   * the new host is mounted directly in `containerEl` and
   * `this.hostWrapperEl` would otherwise point at stale DOM. */
  private clearStaleHostWrapper(): void {
    this.hostWrapperEl?.remove();
    this.hostWrapperEl = undefined;
  }

  private async openSpineItem(
    spineIndex: number,
    options: {
      fragment?: string;
      bridgeCfi?: string;
      landOnLastPage?: boolean;
      landOnPageIndex?: number;
      landOnFractionInItem?: number;
      /** Used by chapter-boundary page turns to animate this load as a
       * directional turn instead of an instant jump. */
      animateDirection?: 1 | -1;
    } = {},
  ): Promise<void> {
    if (!this.containerEl) {
      return;
    }

    this.error = undefined;
    this.errorSeverity = undefined;
    this.isLoadInFlight = true;
    // Every return path below must check this token before mutating
    // shared state.
    const token = ++this.spineOpenToken;
    // Only show the loading spinner for slower loads. `finished`
    // prevents the timer from turning it back on after this call has
    // already completed.
    let finished = false;
    const loadingTimeout = setTimeout(() => {
      if (!finished && token === this.spineOpenToken) {
        this.isLoading = true;
        this.notify();
      }
    }, 200);
    this.diagnostics.record(
      `openSpineItem start spineIndex=${spineIndex} token=${token} options=${JSON.stringify(options)}`,
    );

    try {
      this.accessibility.detach();
      this.contentInteractionCleanup?.();
      this.contentInteractionCleanup = undefined;
      this.highlightInteraction.teardownSelection();
      this.pendingSelectionRange = undefined;
      this.selectionToolbar = undefined;
      this.activeHighlight = undefined;
      this.footnotePopup = undefined;

      // Open the new host hidden alongside the current one so failures
      // leave the existing content on screen until replacement
      // succeeds.
      const previousHost = this.host;
      const previousWrapperEl = this.hostWrapperEl;
      const resolvedLayout = this.pkg.spine[spineIndex]?.resolveRenditionLayout(
        this.pkg.metadata.renditionLayout,
      );
      let stagingEl: HTMLDivElement | undefined;
      // Set immediately on construction so failed loads can still
      // dispose the host and release its blob URLs.
      let createdHost:
        | FixedContentHost
        | SpreadPaginatedHost
        | FixedSpreadHost
        | PaginatedContentHost
        | ScrollContentHost
        | undefined;
      let applyDisplaySettings = false;
      try {
        if (resolvedLayout === "pre-paginated") {
          // Fixed-layout content always uses `FixedSpreadHost`;
          // normalize `spineIndex` to the opened spread's first item
          // afterwards.
          const spreadEligible = FixedLayoutSpreadPlanner.isSpreadModeEligible(
            this.pkg.metadata.renditionSpread,
            this.width,
            this.height,
          );
          const spread = FixedLayoutSpreadPlanner.spreadContaining(
            this.pkg.spine,
            this.pkg.metadata.renditionLayout,
            this.pkg.pageProgressionDirection,
            spreadEligible,
            spineIndex,
          );
          const fixedHost = new FixedSpreadHost(this.width, this.height);
          createdHost = fixedHost;
          stagingEl = this.stageHiddenHostElement(fixedHost.element);
          await fixedHost.open(this.contentLoader, this.resolver, spread, this.pkg.metadata.renditionViewport);
          this.fixedLayoutSpreadEligible = spreadEligible;
          spineIndex = Math.min(...fixedHost.spineIndices);
        } else if (this.viewMode === "paginated" && SpreadPaginatedHost.isEligible(this.width)) {
          this.fixedLayoutSpreadEligible = undefined;
          const host = new SpreadPaginatedHost(this.width, this.height);
          createdHost = host;
          stagingEl = this.stageHiddenHostElement(host.element);
          await host.open(this.contentLoader, this.resolver, spineIndex);
          applyDisplaySettings = true;

          // If a spread-capable open lands on a single visible page, try
          // merging forward before reveal so lone pages do not show a
          // blank facing column. Skip this when restoring an explicit
          // target position or explicit last-page behavior.
          if (
            host.secondPageIndex === undefined &&
            options.bridgeCfi === undefined &&
            options.fragment === undefined &&
            options.landOnLastPage === undefined &&
            options.landOnPageIndex === undefined &&
            options.landOnFractionInItem === undefined
          ) {
            const merged = await this.prepareMergedIncomingSpread(host, spineIndex);
            if (merged) {
              host.dispose();
              stagingEl.remove();
              // `buildMergedSpreadHost` returns a direct overlay child of
              // `containerEl`. Reset it to normal in-flow display here,
              // but do not wrap or reparent the already-loaded host:
              // moving it can reload nested iframes.
              merged.element.style.position = "";
              merged.element.style.top = "";
              merged.element.style.left = "";
              merged.element.style.zIndex = "";
              createdHost = merged;
              stagingEl = undefined;
              spineIndex += 1;
            }
          }
        } else {
          this.fixedLayoutSpreadEligible = undefined;
          const host =
            this.viewMode === "paginated"
              ? new PaginatedContentHost(this.width, this.height)
              : new ScrollContentHost(this.width, this.height);
          createdHost = host;
          stagingEl = this.stageHiddenHostElement(host.element);
          await host.open(this.contentLoader, this.resolver, spineIndex);
          applyDisplaySettings = true;
        }
      } catch (err) {
        // Removing `stagingEl` is safe because nothing is reparented;
        // dispose the host too so failed loads release their blob URLs.
        createdHost?.dispose();
        stagingEl?.remove();
        throw err;
      }
      const newHost = createdHost;

      if (token !== this.spineOpenToken) {
        this.diagnostics.record(
          `openSpineItem stale-discard spineIndex=${spineIndex} token=${token} currentToken=${this.spineOpenToken}`,
        );
        newHost.dispose();
        stagingEl?.remove();
        return;
      }

      // For chapter-boundary turns, land on the target page and apply
      // display settings before reveal so the animation shows the right
      // content. Guard on `stagingEl` because retroactive merged opens
      // have no wrapper to reveal.
      let animatedReveal = false;
      if (
        options.animateDirection !== undefined &&
        stagingEl !== undefined &&
        (previousHost instanceof PaginatedContentHost || previousHost instanceof SpreadPaginatedHost) &&
        (newHost instanceof PaginatedContentHost || newHost instanceof SpreadPaginatedHost)
      ) {
        if (options.landOnLastPage) {
          newHost.goToLastPage();
        }
        if (applyDisplaySettings) {
          this.applyPersistedDisplaySettingsToFreshHost(newHost);
        }
        animatedReveal = await this.animateChapterCrossingReveal(
          previousHost,
          previousWrapperEl,
          newHost,
          stagingEl,
          options.animateDirection,
          this.spineIndex,
          spineIndex,
        );
      }

      // Swap hosts by disposing/removing wrappers in place and revealing
      // the staging wrapper; never reparent an already-loaded host.
      previousHost?.dispose();
      previousWrapperEl?.remove();
      stagingEl?.style.setProperty("opacity", "");
      stagingEl?.style.setProperty("pointer-events", "");
      this.host = newHost;
      this.hostWrapperEl = stagingEl;
      // Skip a second settings pass if the animation path already
      // applied it.
      if (applyDisplaySettings && !animatedReveal) {
        this.applyPersistedDisplaySettingsToFreshHost();
      }

      this.spineIndex = spineIndex;
      this.appliedWidth = this.width;
      this.appliedHeight = this.height;
      this.setUpContentInteraction();
      this.setUpDragPageTurn();
      this.highlightInteraction.setUpHighlightSelection();
      this.highlightInteraction.applyHighlightsToCurrentHost();
      this.refreshBookPagination();

      if (options.bridgeCfi) {
        this.restoreCfi(options.bridgeCfi, spineIndex);
        this.setUpAccessibility();
      } else if (options.fragment) {
        const focusTarget = this.goToFragment(options.fragment);
        this.setUpAccessibility(focusTarget);
      } else {
        if (
          options.landOnLastPage &&
          (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost)
        ) {
          this.host.goToLastPage();
        } else if (
          options.landOnPageIndex !== undefined &&
          (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost)
        ) {
          this.host.goToPageIndex(options.landOnPageIndex);
        } else if (
          options.landOnFractionInItem !== undefined &&
          (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost)
        ) {
          // The spine-level progress scrubber only knows a fraction
          // through this chapter until the host is open and its real
          // page count is known.
          const targetIndex = Math.round(
            options.landOnFractionInItem * Math.max(0, this.host.pageCount - 1),
          );
          this.host.goToPageIndex(targetIndex);
        }
        this.setUpAccessibility();
      }
      // Highlights and search ranges are page-independent, but note
      // markers snapshot pixel positions on the current page, so
      // recompute them after the final landing page is set.
      this.highlightInteraction.updateNoteMarkers();
      this.announce(this.chapterLabel(spineIndex));
      await this.saveProgress();
      // properties="remote-resources" (EPUB3) is the book's own
      // declaration that this item may need network access this reader's
      // CSP unconditionally blocks — logged so a reader-reported "this
      // looks broken" bug is immediately distinguishable from a genuinely
      // corrupted book, rather than a silent, unexplained gap.
      if (this.pkg.spine[spineIndex]?.manifestItem.hasProperty("remote-resources")) {
        this.diagnostics.record(
          `openSpineItem spineIndex=${spineIndex} declares remote-resources; ` +
            `network access is not available, so any remote reference will not display`,
        );
      }
      this.diagnostics.record(`openSpineItem success spineIndex=${spineIndex} token=${token}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (token === this.spineOpenToken) {
        this.error = message;
        // A failed replacement leaves the previous host visible; only
        // the very first load can leave the reader with nothing shown.
        this.errorSeverity = this.host ? "transient" : "blocking";
        this.diagnostics.record(
          `openSpineItem ERROR spineIndex=${spineIndex} token=${token} message=${message} severity=${this.errorSeverity}`,
        );
        console.error(this.diagnostics.format(this.diagnosticsContext()));
      } else {
        this.diagnostics.record(
          `openSpineItem stale-error (suppressed) spineIndex=${spineIndex} token=${token} currentToken=${this.spineOpenToken} message=${message}`,
        );
      }
      // Ignore stale-load failures; a newer `openSpineItem` call has
      // already replaced this one.
    } finally {
      finished = true;
      clearTimeout(loadingTimeout);
      if (token === this.spineOpenToken) {
        this.isLoading = false;
        this.isLoadInFlight = false;
        this.notify();

        if (this.pendingResize) {
          const { width, height } = this.pendingResize;
          this.pendingResize = undefined;
          this.resize(width, height);
        }
      }
    }
  }

  private restoreCfi(cfi: string, spineIndex: number): void {
    const iframeDocument = this.primaryContentDocument();
    if (!iframeDocument) {
      return;
    }
    const resolved = this.locatorResolver.resolveInDocument(
      new Locator(cfi),
      spineIndex,
      iframeDocument,
    );
    const offset = resolved.characterOffset ?? 0;
    if (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost) {
      this.host.goToPosition(resolved.node, offset);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.restorePosition(resolved.node, offset);
    }
  }

  private goToFragment(fragment: string): Element | undefined {
    const iframeDocument = this.primaryContentDocument();
    const target = iframeDocument?.getElementById(fragment);
    if (!target) {
      return undefined;
    }
    if (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost) {
      this.host.goToPosition(target, 0);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.restorePosition(target, 0);
    }
    return target;
  }

  public dispose(): void {
    this.accessibility.detach();
    this.globalArrowKeyCleanup?.();
    this.contentInteractionCleanup?.();
    this.dragCleanup?.();
    this.highlightInteraction.teardownSelection();
    this.searchCoordinator.dispose();
    this.host?.dispose();
    this.hostWrapperEl?.remove();
    this.bookPagination?.dispose();
    this.hiddenMeasureContainer?.remove();
    this.resolver.dispose();
    if (this.cachedCoverUrl !== undefined) {
      URL.revokeObjectURL(this.cachedCoverUrl);
    }
    for (const url of this.inspectionPreviewUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.library.close();
  }
}
