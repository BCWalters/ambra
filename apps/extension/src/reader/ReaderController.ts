import {
  AccessibilityController,
  AnnotationParseError,
  BookPaginationEstimator,
  ContentLoader,
  DisclosureState,
  EpubCfi,
  EpubContainer,
  FixedContentHost,
  FixedLayoutSpreadPlanner,
  FixedSpreadHost,
  Locator,
  LocatorResolver,
  NavigationDocument,
  NavigationList,
  PaginatedContentHost,
  parseAnnotationCollection,
  ReadingTheme,
  ResourceUrlResolver,
  resolveEpubPath,
  ScrollContentHost,
  serializeAnnotationCollection,
  splitHrefFragment,
  SpreadPaginatedHost,
  ReflowableSpreadPlanner,
} from "@ambra/engine";
import type {
  ContentDocumentView,
  EpubAnnotation,
  FontFamilyChoice,
  FragmentSelector,
  HighlightStyle,
  NavPoint,
  PackageDocument,
  Page,
  PageTheme,
  ReflowableSpread,
} from "@ambra/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { Bookmark } from "../library/LibraryDatabase.js";
import { ariaShortcut, DEFAULT_SHORTCUT_PREFERENCES, getCommandBindings, getShortcutPlatform, matchReaderCommand, parseShortcutPreferences } from "../shortcuts/ReaderCommands.js";
import type { ShortcutPlatform, ShortcutPreferences } from "../shortcuts/ReaderCommands.js";
import { fetchBookDescription } from "../library/BookDescriptionEnrichment.js";
import {
  buildAnnotationCollection,
  classifyImportOutcome,
  classifyReadOnlyAnnotationKind,
  importAnnotations,
  parseSelectorCfi,
} from "../library/AnnotationInterop.js";
import type { AnnotationImportResult } from "../library/AnnotationInterop.js";
import { describeStorageError } from "../StorageErrors.js";
import { BookmarkManager } from "./BookmarkManager.js";
import { HighlightInteraction } from "./HighlightInteraction.js";
import { HighlightManager } from "./HighlightManager.js";
import { PageTurnAnimator } from "./PageTurnAnimator.js";
import { PageTurnOrchestrator } from "./PageTurnOrchestrator.js";
import { ReaderOperation, ReaderOperations } from "./ReaderOperation.js";
import { runOwnedTransition } from "./OwnedTransition.js";
import { readerDocumentViews } from "./ReaderDocuments.js";
import { attachContentBoundary, contentBoundary, setContentBoundaryShortcut } from "./ContentBoundaryNavigation.js";
import type { ReadingHost } from "./ReaderDocuments.js";
import type { PageTurnFurnitureInfo, SpreadPageTurnFurnitureInfo } from "./PageTurnOrchestrator.js";
import { SearchCoordinator } from "./SearchCoordinator.js";
import { EpubInspectionSession } from "./EpubInspectionSession.js";
import { InspectorReadingBridge } from "./InspectorReadingBridge.js";
import { MediaOverlayNarration, type NarrationTarget } from "./MediaOverlayNarration.js";
import { NarrationReadingBridge } from "./NarrationReadingBridge.js";
import { selectedReadingRange } from "./ReadingPosition.js";
import { NativeReadingPosition, type NativeReadingPoint } from "./NativeReadingPosition.js";
import type { NarrationAction } from "./ReaderTypes.js";
import { TransientReadingHighlight } from "./TransientReadingHighlight.js";
import type { InspectorReference } from "./InspectorReferences.js";
import { DEFAULT_CHROME_THEME } from "./chromeTheme.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";
import { DEFAULT_PAGE_TURN_ANIMATION_STYLE } from "./PageTurnAnimationStyle.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";
import type { ViewMode } from "./ViewMode.js";
import type {
  ActiveHighlightState,
  BookDetails,
  EpubInspectionData,
  FootnotePopupState,
  ImageViewerState,
  InspectorReaderBridge,
  PreviewPosition,
  ReaderSnapshot,
  ReadOnlyAnnotationView,
  SelectionToolbarState,
} from "./ReaderTypes.js";
import { DiagnosticsLog } from "./DiagnosticsLog.js";
import type { DiagnosticEvent, DiagnosticSurfaces } from "./DiagnosticsLog.js";
import { DEFAULT_LOCALE } from "../i18n/Locale.js";
import { getTranslate } from "../i18n/LocaleContext.js";
import type { Translate } from "../i18n/LocaleContext.js";

export interface ReaderShortcutActions {
  searchBook: () => void;
  showKeyboardShortcuts: () => void;
}

/** The smallest a rendered image is allowed to be (in both CSS px
 * dimensions) for a click/keypress on it to open the image viewer —
 * checked against rendered size, not intrinsic resolution, so a small
 * decorative icon can't accidentally "zoom" into a meaningless blur. */
const MIN_ZOOMABLE_IMAGE_SIZE = 100;

/** Caps how many times a book with no discoverable description gets a
 * fresh `fetchBookDescription` attempt on subsequent opens. */
const MAX_DESCRIPTION_FETCH_ATTEMPTS = 3;

interface ReaderLayout {
  width: number;
  height: number;
  viewMode: ViewMode;
  fontScale: number;
  fontFamily: FontFamilyChoice;
  lineSpacing: number;
  letterSpacing: number;
  contentWidthEm: number;
}

interface PendingLayout {
  configuration: ReaderLayout;
  reflow: boolean;
  disclosureFocus?: { spineIndex: number; ordinal: number };
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
}

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
    | PaginatedContentHost
    | ScrollContentHost
    | FixedContentHost
    | SpreadPaginatedHost
    | FixedSpreadHost
    | undefined;
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
  /** Active-operation geometry and typography remain stable across awaits;
   * newer requests are held in pendingLayout until that operation settles. */
  private width = 0;
  private height = 0;
  /** The size the *current* host was actually last laid out at — lets
   * `resize` recognize a no-op (a deferred resize matching what
   * `openSpineItem` already laid the fresh host out at). */
  private appliedWidth = 0;
  private appliedHeight = 0;
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
  private readonly operations = new ReaderOperations();
  private pendingLayout: PendingLayout | undefined;
  private activeLayout: PendingLayout | undefined;
  private isApplyingLayout = false;
  private readonly disclosures = new DisclosureState((spineIndex, source) => {
    this.handleDisclosureChange(spineIndex, source);
  });
  private error: string | undefined;
  private errorNotificationId = 0;
  private errorSeverity: "blocking" | "transient" | "actionFailed" | "info" | undefined;
  /** A smaller, de-emphasized technical detail shown alongside `error`
   * for "actionFailed" errors — e.g. the raw underlying exception
   * message, for anyone who wants it, without it being the primary
   * text the reader reads first (issue #119). */
  private errorDetail: string | undefined;
  /** Set by `open` when `NavigationDocument.load` failed (see its doc
   * comment) — surfaced by `mount` once the initial chapter has
   * actually finished loading, since `openSpineItem` itself
   * unconditionally clears `error`/`errorSeverity` at its start. */
  private pendingNavigationLoadError: string | undefined;
  private containerEl: HTMLDivElement | undefined;
  private readonly accessibility = new AccessibilityController();
  private readonly nativeReading = new NativeReadingPosition(
    () => this.contentDocumentViews(),
    () => this.host?.currentPosition(),
  );
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
  /** A publisher-embedded, read-only annotation collection (issue
   * #109), loaded best-effort in `open` — absent for the overwhelming
   * majority of books. Never mutated by this reader; only the user's
   * own highlights/bookmarks (above) are ever added to or removed. */
  private embeddedAnnotations: EpubAnnotation[] = [];
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
    rtl: () => this.pkg.pageProgressionDirection === "rtl",
    containerEl: () => this.containerEl,
    height: () => this.height,
    pageTheme: () => this.pageTheme,
    pageTurnAnimationStyle: () => this.pageTurnAnimationStyle,
    operationSignal: () => this.operations.current?.signal,
  });
  private readonly pageTurnOrchestrator = new PageTurnOrchestrator(
    {
      rtl: () => this.pkg.pageProgressionDirection === "rtl",
      containerEl: () => this.containerEl,
      height: () => this.height,
      width: () => this.width,
      pageTheme: () => this.pageTheme,
      pageTurnAnimationStyle: () => this.pageTurnAnimationStyle,
      operationSignal: () => this.operations.current?.signal,
      setAnimatingPageTurn: (isAnimating) => {
        this.isAnimatingPageTurn = isAnimating;
      },
      notify: () => this.notify(),
    },
    this.pageTurnAnimator,
  );
  /** Book-wide full-text search plus the live "highlight matches on the
   * current page" spotlight (issue #100) — see `SearchCoordinator`. */
  private readonly searchCoordinator: SearchCoordinator;
  private readonly navigationSpotlight = new TransientReadingHighlight();

  /** Detaches the current spine item's in-content interaction listeners
   * (link clicks, image-viewer triggers) — re-created on every
   * `openSpineItem` call since each gets a fresh iframe/document. */
  private contentInteractionCleanup: (() => void) | undefined;
  private boundaryCleanup: (() => void) | undefined;
  /** Detaches the current drag-page-turn `pointerdown` listener — same
   * lifecycle as `contentInteractionCleanup`. */
  private dragCleanup: (() => void) | undefined;
  private gestureCleanup: (() => void) | undefined;
  private isAnimatingPageTurn = false;
  /** Background-paginates the whole book for book-wide page numbers —
   * `undefined` until `mount` creates it. */
  private bookPagination: BookPaginationEstimator | undefined;
  /** An offscreen, zero-size-but-attached container `bookPagination`
   * mounts its measurement iframes into (a detached element doesn't lay
   * out in real browsers). Created in `mount`, torn down in `dispose`. */
  private hiddenMeasureContainer: HTMLDivElement | undefined;

  private readonly listeners = new Set<() => void>();
  private preferencesCleanup: (() => void) | undefined;
  private preferencesRevision = 0;
  private cachedSnapshot: ReaderSnapshot | undefined;
  /** Lazily created by `getBookDetails`, revoked in `dispose`. */
  private cachedCoverUrl: string | undefined;
  /** Lazily created per-path by `getInspectionFilePreviewUrl` (issue
   * #46), revoked in `dispose`. */
  private readonly inspectionSession: EpubInspectionSession;
  private readonly inspectionReading: InspectorReadingBridge;
  private readonly narration: MediaOverlayNarration;
  private readonly narrationReading: NarrationReadingBridge;
  private narrationOperation: ReaderOperation | undefined;
  private narrationCommand = 0;
  private narrationNoticeVisible = false;

  private constructor(
    private readonly contentLoader: ContentLoader,
    private readonly resolver: ResourceUrlResolver,
    private readonly locatorResolver: LocatorResolver,
    public readonly pkg: PackageDocument,
    public readonly navigation: NavigationDocument,
    private readonly bookId: string,
    private readonly library: LibraryDatabase,
    rootFilePath: string,
    private readonly fileSizeBytes: number,
  ) {
    this.narrationReading = new NarrationReadingBridge(contentLoader, locatorResolver, {
      activeClass: pkg.metadata.mediaOverlayActiveClass,
      playbackActiveClass: pkg.metadata.metaEntries.find(entry => entry.key === "media:playback-active-class")?.value,
    }, {
      documents: () => this.contentDocumentViews(),
      position: () => this.host?.currentPosition(),
      disposed: () => this.operations.disposed,
      navigate: target => this.navigateNarrationTarget(target),
    });
    this.narration = new MediaOverlayNarration({
      pkg, loader: contentLoader,
      onTarget: (target, follow) => this.narrationReading.update(target, follow),
      notify: () => this.notify(),
    });
    this.inspectionSession = new EpubInspectionSession(contentLoader, pkg, rootFilePath);
    this.inspectionReading = new InspectorReadingBridge(contentLoader, locatorResolver, pkg, {
      documents: () => this.contentDocumentViews(),
      currentPosition: () => this.host?.currentPosition(),
      isDisposed: () => this.operations.disposed,
      focus: (document, element) => {
        this.accessibility.focusContent(document, element);
        if (element !== document.body && element !== document.documentElement) {
          this.navigationSpotlight.show(element);
        }
      },
      navigate: async (spineIndex, cfi) => {
        this.suspendNarrationFollowing();
        await this.openSpineItem(spineIndex, { bridgeCfi: cfi });
        if (this.error) throw new Error(this.error);
        if (this.operations.disposed ||
            !this.contentDocumentViews().some(view => view.spineIndex === spineIndex)) {
          throw new Error("The reading location changed before navigation completed.");
        }
      },
    });
    this.searchCoordinator = new SearchCoordinator(contentLoader, locatorResolver, pkg.spine, {
      goToCfi: (cfi) => this.goToCfi(cfi, "that search result"),
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
      reportError: (err) => this.reportTransientError(err, "save", "that bookmark"),
      notify: () => this.notify(),
    });
    this.highlights = new HighlightManager(library, bookId, locatorResolver, {
      spineIndexForDocument: (doc) => this.spineIndexForDocument(doc),
      isSpineVisible: (index) =>
        this.contentDocumentViews().some((view) => view.spineIndex === index),
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
        this.highlightInteraction.applyActiveHighlightOverlay();
      },
      reportError: (err) => this.reportTransientError(err, "save", "that highlight"),
      notify: () => this.notify(),
    });
    this.highlightInteraction = new HighlightInteraction(locatorResolver, {
      isFixedLayoutHost: () => this.isFixedLayoutHost(this.host),
      contentDocuments: () => this.contentDocumentViews(),
      forSpineIndex: (spineIndex) => this.highlights.forSpineIndex(spineIndex),
      currentSearchHighlightQuery: () => this.searchCoordinator.currentHighlightQuery,
      getActiveHighlight: () => this.activeHighlight,
      setPendingSelectionRange: (range) => {
        this.pendingSelectionRange = range;
      },
      setSelectionToolbar: (state) => {
        this.selectionToolbar = state;
      },
      setActiveHighlight: (state) => {
        this.activeHighlight = state;
        this.highlightInteraction.applyActiveHighlightOverlay();
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
    // A missing/malformed Nav Document (or NCX fallback) is a real,
    // fairly common authoring mistake — but it only breaks the Table of
    // Contents, not the book's actual readable content. Previously this
    // threw straight out of `open`, so one broken navigation file made
    // the *entire* book fail to open at all, even though every chapter
    // itself might be perfectly fine. Falls back to an empty TOC (still
    // fully readable via next/previous-chapter navigation) and reports
    // the real underlying reason as a transient, dismissable notice —
    // useful to a reader wondering where the TOC went, and especially
    // to an EPUB author debugging their own book against this reader.
    let navigation: NavigationDocument;
    let navigationLoadError: string | undefined;
    try {
      navigation = await NavigationDocument.load(container);
    } catch (err) {
      navigation = new NavigationDocument(new NavigationList("toc", []), undefined, undefined);
      navigationLoadError = err instanceof Error ? err.message : String(err);
    }
    const locatorResolver = new LocatorResolver(pkg, contentLoader);

    const controller = new ReaderController(
      contentLoader,
      resolver,
      locatorResolver,
      pkg,
      navigation,
      bookId,
      library,
      container.rootFilePath,
      buffer.byteLength,
    );
    try {
      if (navigationLoadError) {
        controller.diagnostics.record(`NavigationDocument.load failed: ${navigationLoadError}`);
        // Not set directly on `error`/`errorSeverity` here: `mount` always
        // opens the initial spine item right after this returns, and
        // `openSpineItem` unconditionally clears both at its own start (a
        // fresh chapter load should never show a stale previous error) —
        // so anything set here would be wiped before a reader ever saw
        // it. `mount` surfaces this itself, once the initial chapter has
        // actually finished loading.
        controller.pendingNavigationLoadError = navigationLoadError;
      }
      Object.assign(controller, await library.getBookReadingSettings(bookId));
      if (controller.narration.snapshot.available) {
        const metadata = await library.getBookMetadata(bookId);
        controller.narrationNoticeVisible = metadata !== undefined && !metadata.narrationNoticeDismissed;
      }
      controller.preferencesCleanup = library.subscribePreferences(() => {
        void controller.refreshGlobalSettings().catch((error) => {
          if (!controller.operations.disposed)
            controller.reportTransientError(error, "open", "app settings");
        });
      });
      await controller.refreshGlobalSettings();
      controller.highlights.load(await library.listHighlightsForBook(bookId));
      await controller.bookmarks.load();
      // A publisher-embedded annotation collection (issue #109) is rare
      // and entirely optional — best-effort, non-fatal the same way the
      // Nav Document fallback above is, since one malformed file
      // shouldn't take down an otherwise perfectly readable book.
      const annotationsItem = pkg.findAnnotationsDocument();
      if (annotationsItem) {
        try {
          const jsonText = await contentLoader.readArchiveFileText(annotationsItem.path);
          controller.embeddedAnnotations = parseAnnotationCollection(jsonText);
        } catch (err) {
          controller.diagnostics.record(
            `Embedded annotations failed to load: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // Fire-and-forget: never awaited, and any failure inside is already
      // caught by `fetchBookDescription` itself — a slow or failing
      // network request must never delay (or be able to break) opening
      // the book itself.
      void controller.maybeEnrichDescription().catch((error) => {
        controller.diagnostics.record(`Description enrichment failed: ${String(error)}`);
      });
      return controller;
    } catch (error) {
      controller.dispose();
      throw error;
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async refreshGlobalSettings(): Promise<void> {
    if (this.operations.disposed) return;
    const revision = ++this.preferencesRevision;
    const { viewMode, ...settings } = await this.library.getGlobalReadingSettings();
    if (this.operations.disposed || revision !== this.preferencesRevision) return;
    const chromeChanged = this.brightness !== settings.brightness ||
      this.chromeTheme !== settings.chromeTheme ||
      this.pageTurnAnimationStyle !== settings.pageTurnAnimationStyle;
    this.recordDiagnosticEvent({ kind: "setting", name: "viewMode",
      before: this.viewMode, after: viewMode, source: "preferences" });
    this.recordDiagnosticEvent({ kind: "setting", name: "brightness",
      before: this.brightness, after: settings.brightness, source: "preferences" });
    this.recordDiagnosticEvent({ kind: "setting", name: "chromeTheme",
      before: this.chromeTheme, after: settings.chromeTheme, source: "preferences" });
    this.recordDiagnosticEvent({ kind: "setting", name: "pageTurnAnimationStyle",
      before: this.pageTurnAnimationStyle, after: settings.pageTurnAnimationStyle, source: "preferences" });
    Object.assign(this, settings);
    if (!this.containerEl) {
      this.viewMode = viewMode;
    } else if (viewMode !== (this.pendingLayout?.configuration.viewMode ?? this.viewMode)) {
      // External changes use the same lifecycle queue, but never write back.
      await this.requestLayout({ viewMode });
    }
    if (!this.operations.disposed && chromeChanged) this.notify();
  }

  /** Book-wide page position (current page / total pages across the
   * whole book), when available — only meaningful in paginated/spread/
   * fixed-layout mode once `bookPagination` has measured the book (see
   * `snapshot`'s `bookPageIndex`/`bookPageCount`, which this backs, and
   * `currentBookFraction`, which turns it into a 0–1 completion
   * fraction for persisted reading progress). */
  private bookWidePagePosition(): { bookPageIndex: number | undefined; bookPageCount: number | undefined } | undefined {
    let pageIndex = 0;
    if (this.host instanceof PaginatedContentHost) {
      pageIndex = this.host.currentPageIndex;
    } else if (this.host instanceof SpreadPaginatedHost) {
      pageIndex = this.host.pageIndex;
    }
    if (
      !this.bookPagination ||
      !(
        this.host instanceof PaginatedContentHost ||
        this.host instanceof SpreadPaginatedHost ||
        this.host instanceof FixedSpreadHost
      )
    ) {
      return undefined;
    }
    const position = this.bookPagination.positionFor(this.spineIndex, pageIndex);
    return { bookPageIndex: position.currentPage, bookPageCount: position.totalPages };
  }

  /** The whole-book completion fraction (0–1) to persist alongside a
   * saved CFI (see `ReadingProgress.fractionComplete`) — `undefined` in
   * scroll mode or before `bookPagination` has finished measuring, so a
   * stale/wrong percentage is never written. */
  private currentBookFraction(): number | undefined {
    const position = this.bookWidePagePosition();
    if (
      !position ||
      position.bookPageIndex === undefined ||
      position.bookPageCount === undefined ||
      position.bookPageCount <= 0
    ) {
      return undefined;
    }
    return Math.max(0, Math.min(1, position.bookPageIndex / position.bookPageCount));
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
      const bookWidePosition = this.bookWidePagePosition();
      const bookPageIndex = bookWidePosition?.bookPageIndex;
      const bookPageCount = bookWidePosition?.bookPageCount;
      const requestedLayout = this.pendingLayout?.configuration ?? this.currentLayout();

      this.cachedSnapshot = {
        narration: this.narration.snapshot,
        narrationNoticeVisible: this.narrationNoticeVisible && this.host !== undefined,
        hasReadingSelection: this.narration.snapshot.available && selectedReadingRange(this.contentDocumentViews()) !== undefined,
        title: this.pkg.metadata.title,
        toc: this.navigation.toc.items,
        spineIndex: this.spineIndex,
        spineLength: this.pkg.spine.length,
        currentSpinePath: this.pkg.spine[this.spineIndex]?.manifestItem.path,
        firstSpinePath: this.pkg.spine[0]?.manifestItem.path,
        highlightedTocPath: this.tocHighlightPath(),
        tocPageNumbers: this.computeTocPageNumbers(),
        // The default spine index is provisional until initial/resume loading
        // commits a host. Do not announce or display that placeholder chapter.
        currentChapterLabel: this.host ? this.chapterLabel(this.spineIndex) : "",
        viewMode: this.host instanceof ScrollContentHost ? "scroll"
          : this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost ? "paginated"
            : this.viewMode,
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
        pageProgressionDirection: this.pkg.pageProgressionDirection === "rtl" ? "rtl" : "ltr",
        spreadPageNumbers:
          this.host instanceof SpreadPaginatedHost
            ? [this.host.positions.first, this.host.positions.second].map((position) =>
                position
                  ? this.furniturePageNumber(position.spineIndex, position.pageIndex, 1)
                  : undefined,
              )
            : undefined,
        paneWidth: this.width,
        isAnimatingPageTurn: this.isAnimatingPageTurn,
        isBookmarked: this.bookmarks.onCurrentPage().length > 0,
        bookmarkedPages: this.bookmarks.flagsForCurrentPages(),
        bookmarks: this.bookmarks.allSorted(),
        fontScale: this.isFixedLayoutHost(this.host) ? 1 : requestedLayout.fontScale,
        lineSpacing: this.isFixedLayoutHost(this.host) ? ReadingTheme.DEFAULT_LINE_SPACING : requestedLayout.lineSpacing,
        letterSpacing: this.isFixedLayoutHost(this.host)
          ? ReadingTheme.DEFAULT_LETTER_SPACING
          : requestedLayout.letterSpacing,
        contentWidthEm: this.isFixedLayoutHost(this.host)
          ? ReadingTheme.DEFAULT_CONTENT_WIDTH_EM
          : requestedLayout.contentWidthEm,
        fontFamily: requestedLayout.fontFamily,
        pageTheme: this.pageTheme,
        brightness: this.brightness,
        chromeTheme: this.chromeTheme,
        pageTurnAnimationStyle: this.pageTurnAnimationStyle,
        isLoading: this.isLoading,
        error: this.error,
        errorNotificationId: this.errorNotificationId,
        errorSeverity: this.errorSeverity,
        errorDetail: this.errorDetail,
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
    if (this.operations.disposed) return;
    this.narrationReading.setPlaying(this.narration.snapshot.status === "playing");
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

  private dismissReaderUi: (() => boolean) | undefined;
  private contentPointerDismissals: WeakMap<PointerEvent, boolean> | undefined;

  /** UI visibility belongs to the shell. The result is sampled at pointerdown,
   * before activity notifications can hide chrome or rebuild listeners. */
  public setContentUiDismissal(dismiss: (() => boolean) | undefined): void {
    this.dismissReaderUi = dismiss;
  }

  private dismissUiForPointer(event: PointerEvent): boolean {
    const previous = this.contentPointerDismissals?.get(event);
    if (previous !== undefined) return previous;
    if (!this.dismissReaderUi || (event.pointerType === "mouse" && event.button !== 0)) return false;
    const dismissed = this.dismissReaderUi();
    this.recordDiagnosticEvent({ kind: "ui-dismissal", consumed: dismissed });
    (this.contentPointerDismissals ??= new WeakMap()).set(event, dismissed);
    return dismissed;
  }

  /** Mounts the current view mode's content host into `containerEl` and
   * opens a previously-saved reading position, or spine item 0. Call
   * once, after the container div is available. */
  public async mount(containerEl: HTMLDivElement, width: number, height: number): Promise<void> {
    if (this.operations.disposed) return;
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

    const resumeOperation = this.operations.begin();
    const resumed = await this.tryResume(resumeOperation);
    if (this.operations.disposed) return;
    if (!resumed && this.operations.owns(resumeOperation)) {
      await this.openSpineItem(0);
    }

    if (this.pendingNavigationLoadError) {
      const message = this.pendingNavigationLoadError;
      this.pendingNavigationLoadError = undefined;
      this.setNotification(
        `This book's Table of Contents couldn't be loaded: ${message} You can still read using the page/chapter navigation controls.`,
        "transient",
      );
      this.errorDetail = undefined;
      this.notify();
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
      this.disclosures,
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
  private async tryResume(operation: ReaderOperation): Promise<boolean> {
    try {
      const progress = await this.library.getProgress(this.bookId);
      if (!this.operations.owns(operation)) return true;
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
    const native = this.nativeReading.current();
    const position = native ?? this.host?.currentPosition();
    if (!position) {
      return;
    }
    try {
      const locator = this.locatorResolver.generate(
        native?.spineIndex ?? this.spineIndex,
        position.node,
        position.offset,
      );
      await this.library.saveProgress(this.bookId, locator.cfi,
        native ? this.nativeBookFraction(native) : this.currentBookFraction());
    } catch {
      // Best-effort: resume-reading is a convenience, not something
      // that should surface an error mid-navigation.
    }
  }

  private nativeBookFraction(point: NativeReadingPoint): number | undefined {
    const view = this.contentDocumentViews().find(view => view.document === point.node.ownerDocument);
    // Off-page native reading has no measured page index. Do not attach the
    // visual page's misleading percentage to its more precise CFI.
    const pageIndex = view?.page?.containsPosition(point.node, point.offset ?? 0, view.document)
      ? view.page.index : this.isFixedLayoutHost(this.host) ? 0 : undefined;
    if (pageIndex === undefined || !this.bookPagination) return undefined;
    const position = this.bookPagination.positionFor(point.spineIndex, pageIndex);
    return position.currentPage !== undefined && position.totalPages
      ? Math.max(0, Math.min(1, position.currentPage / position.totalPages)) : undefined;
  }

  public flushProgress(): Promise<void> {
    return this.saveProgress();
  }

  public async addBookmark(): Promise<Bookmark | undefined> {
    return this.bookmarks.add();
  }

  public refreshBookmarks(): Promise<void> {
    return this.bookmarks.refresh();
  }

  public removeBookmark(id: string): Promise<void> {
    return this.bookmarks.remove(id);
  }

  /** The `{ page, document }` pair(s) on screen right now — both
   * columns of a spread, the single page in paginated mode, or empty
   * for scroll mode/fixed-layout content (bookmarking is inert there). */
  private currentPagesAndDocuments(): Array<{
    page: Page;
    document: Document;
    spineIndex: number;
  }> {
    return this.contentDocumentViews().flatMap((view) =>
      view.page ? [{ page: view.page, document: view.document, spineIndex: view.spineIndex }] : [],
    );
  }

  public async toggleBookmark(): Promise<void> {
    return this.bookmarks.toggle();
  }

  /** Navigates to a saved bookmark's CFI — see `goToCfi`. */
  public async goToBookmark(cfi: string): Promise<void> {
    this.recordDiagnosticEvent({ kind: "navigation", source: "bookmark" });
    this.clearNavigationHighlights();
    await this.goToCfi(cfi, "that bookmark");
  }

  /** Navigates to a highlight's starting position — see `goToBookmark`'s
   * doc comment. */
  public async goToHighlight(cfi: string): Promise<void> {
    this.recordDiagnosticEvent({ kind: "navigation", source: "highlight" });
    this.clearNavigationHighlights();
    await this.goToCfi(cfi, "that highlight");
  }

  /** Every embedded, read-only annotation (issue #109), resolved to a
   * displayable label — the annotation's own note text if it has one,
   * else the chapter it falls in. Only resolves annotations whose
   * selector this reader understands (a `FragmentSelector` holding an
   * EPUB CFI) and whose `target.source` matches a real spine item;
   * anything else is silently omitted rather than shown broken. */
  public listEmbeddedAnnotations(): ReadOnlyAnnotationView[] {
    const views: ReadOnlyAnnotationView[] = [];
    for (const annotation of this.embeddedAnnotations) {
      const selector = annotation.target.selector?.find(
        (candidate): candidate is FragmentSelector => candidate.type === "FragmentSelector",
      );
      if (!selector) {
        continue;
      }
      const spineIndex = this.pkg.spine.findIndex(
        (ref) => ref.manifestItem.path === annotation.target.source,
      );
      if (spineIndex === -1) {
        continue;
      }
      let cfi: string;
      let isRange: boolean;
      try {
        const selection = parseSelectorCfi(selector.value);
        cfi = selection.start.toString();
        isRange = selection.end !== undefined;
      } catch {
        continue;
      }
      const note = annotation.body?.type === "TextualBody" ? annotation.body.value : undefined;
      views.push({
        id: annotation.id,
        cfi,
        label: note && note.length > 0 ? note : this.chapterLabel(spineIndex),
        note,
        kind: classifyReadOnlyAnnotationKind(annotation.motivation, isRange),
      });
    }
    return views;
  }

  /** Navigates to a read-only embedded annotation's position — see
   * `goToBookmark`'s doc comment. */
  public async goToReadOnlyAnnotation(cfi: string): Promise<void> {
    this.recordDiagnosticEvent({ kind: "navigation", source: "embedded-annotation" });
    this.clearNavigationHighlights();
    await this.goToCfi(cfi, "that note");
  }

  /** Builds this book's exportable annotation file (issue #107): every
   * current highlight and bookmark, serialized per EPUB Annotations
   * 1.0. `filename` is derived from the book's own title so a reader
   * saving several exports can tell them apart. */
  public async exportAnnotations(): Promise<{ filename: string; text: string }> {
    const highlights = this.highlights.allSorted();
    const bookmarks = await this.library.listBookmarksForBook(this.bookId);
    const annotations = buildAnnotationCollection(this.pkg, { highlights, bookmarks });
    const safeTitle = this.pkg.metadata.title.replace(/[/\\?%*:|"<>]/g, "-").trim() || "book";
    return {
      filename: `${safeTitle} - annotations.json`,
      text: serializeAnnotationCollection(annotations),
    };
  }

  /** Imports a previously-exported (or third-party) annotation file
   * (issue #108) into this book's own highlights/bookmarks, refreshing
   * both caches and the on-screen highlight paint once done. A file
   * that fails to even parse, and a file that parses fine but produces
   * nothing usable (most likely: it's from a different book), both get
   * the weightier `reportImportFailure` treatment rather than a quiet
   * toast that might time out unnoticed — see issue #114. A file that
   * resolves fine but turns out to be entirely already-known gets a
   * lighter, non-error acknowledgement — see issue #115. Any other
   * unexpected failure (malformed JSON, a resolution error that slips
   * past `importAnnotations`'s own per-annotation handling) gets a
   * friendly primary message with the raw exception demoted to a
   * `detail` line — see issue #119. */
  public async importAnnotationsFile(file: File): Promise<AnnotationImportResult | undefined> {
    try {
      const text = await file.text();
      let annotations: EpubAnnotation[];
      try {
        annotations = parseAnnotationCollection(text);
      } catch (err) {
        if (err instanceof AnnotationParseError) {
          this.reportImportFailure(this.translate("annotations.importNotAnAnnotationsFile"));
        } else {
          this.reportGenericImportFailure(err);
        }
        return undefined;
      }
      const result = await importAnnotations(
        this.pkg,
        this.locatorResolver,
        this.library,
        this.bookId,
        annotations,
      );
      this.highlights.load(await this.library.listHighlightsForBook(this.bookId));
      await this.bookmarks.load();
      this.highlightInteraction.applyHighlightsToCurrentHost();
      this.reportImportOutcome(result);
      this.notify();
      return result;
    } catch (err) {
      this.reportGenericImportFailure(err);
      return undefined;
    }
  }

  /** Decides whether a *successfully parsed and processed* import needs
   * to say anything at all — see `classifyImportOutcome`. */
  private reportImportOutcome(result: AnnotationImportResult): void {
    switch (classifyImportOutcome(result)) {
      case "imported":
        return;
      case "allDuplicates":
        this.reportInfo(this.translate("annotations.importAllDuplicates"));
        return;
      case "wrongBook":
        this.reportImportFailure(this.translate("annotations.importWrongBook"));
        return;
    }
  }

  public async performNarrationAction(action: NarrationAction): Promise<void> {
    this.recordDiagnosticEvent({ kind: "narration", action });
    if (action === "start") this.dismissNarrationNotice();
    const command = ++this.narrationCommand;
    this.cancelNarrationNavigation();
    try {
      if (action === "close" || (action === "toggle" &&
        (this.narration.snapshot.status === "playing" || this.narration.snapshot.status === "loading"))) {
        this.narration.pause();
        if (action === "close") this.narrationReading.clear();
      } else if (action === "here" || ((action === "start" || action === "toggle") && !this.narration.target)) {
        const position = await this.narrationReading.readingPosition();
        if (command !== this.narrationCommand || this.operations.disposed) return;
        await this.narration.playFrom(position.spineIndex, position.element);
      } else if (action === "start" || action === "toggle") {
        await this.narration.resume();
      } else if (action === "next") {
        await this.narration.next();
      } else if (action === "previous") {
        await this.narration.previous();
      } else if (action === "return") {
        await this.narration.returnToNarration();
      }
    } catch (error) {
      if (command !== this.narrationCommand || this.operations.disposed) return;
      const detail = error instanceof Error ? error.message : String(error);
      this.diagnostics.record(`Narration ${action} failed: ${detail}`);
      if (!this.narration.snapshot.error) {
        this.setNotification(this.translate("narration.error"), "transient");
        this.errorDetail = detail;
        this.notify();
      }
    }
  }

  public setNarrationRate(rate: number): void {
    const before = this.narration.snapshot.rate;
    this.narration.setRate(rate);
    this.recordDiagnosticEvent({ kind: "setting", name: "narrationRate",
      before, after: this.narration.snapshot.rate, source: "reader-control" });
  }

  public dismissNarrationNotice(): void {
    if (!this.narrationNoticeVisible) return;
    this.narrationNoticeVisible = false;
    this.notify();
    void this.library.dismissNarrationNotice(this.bookId).catch((error: unknown) => {
      this.reportTransientError(error, "save", "the narration reminder");
    });
  }

  private cancelNarrationNavigation(): void {
    this.narrationReading.invalidateNavigation();
    const operation = this.narrationOperation;
    if (operation && this.operations.current === operation) {
      this.operations.finish(operation);
      this.isLoading = false;
      this.isLoadInFlight = false;
      this.notify();
      this.applyPendingLayout();
    }
    this.narrationOperation = undefined;
  }

  private suspendNarrationFollowing(): void {
    this.narrationCommand++;
    this.cancelNarrationNavigation();
    this.narration.suspendFollowing();
  }

  private async navigateNarrationTarget(target: NarrationTarget): Promise<void> {
    const view = this.contentDocumentViews().find(view => view.spineIndex === target.spineIndex);
    if (view && (this.host instanceof PaginatedContentHost || this.host instanceof ScrollContentHost)) {
      const element = target.fragment ? view.document.getElementById(target.fragment) : view.document.body;
      if (!element) throw new Error(`The narrated passage ${target.path}#${target.fragment ?? ""} was not found.`);
      if (this.host instanceof PaginatedContentHost) this.host.goToPosition(element, 0);
      else this.host.restorePosition(element, 0);
      this.highlightInteraction.updateNoteMarkers();
      this.notify();
      await this.saveProgress();
      return;
    }
    await this.openSpineItem(target.spineIndex, { fragment: target.fragment, automatic: true });
    if (this.operations.disposed || !this.narration.snapshot.following) return;
    if (this.error) throw new Error(this.error);
    const document = this.contentDocumentViews().find(view => view.spineIndex === target.spineIndex)?.document;
    if (!document || (target.fragment && !document.getElementById(target.fragment))) {
      throw new Error(`The narrated passage ${target.path}#${target.fragment ?? ""} was not found.`);
    }
  }

  /** Navigates to a search result's position — see `SearchCoordinator.goToResult`. */
  public async goToSearchResult(cfi: string): Promise<void> {
    this.recordDiagnosticEvent({ kind: "navigation", source: "search" });
    this.suspendNarrationFollowing();
    await this.searchCoordinator.goToResult(cfi);
  }

  /** (Re-)starts a book-wide search — see `SearchCoordinator.search`. */
  public search(query: string): void {
    this.recordDiagnosticEvent({ kind: "search", queryLength: query.length });
    this.searchCoordinator.search(query);
  }

  /** Called by `ReaderApp` whenever the Search panel's own `open`/
   * `pinned` state changes — see `SearchCoordinator.setPanelState`. */
  public setSearchPanelState(open: boolean, pinned: boolean): void {
    this.searchCoordinator.setPanelState(open, pinned);
  }

  /** Parses `cfi`, finds the spine item it targets, and opens it with
   * `cfi` as a bridging position — the shared "jump to a previously-
   * saved position" mechanism behind resuming, bookmarks, and
   * highlights. `subject` (e.g. "that bookmark") names what a reader
   * explicitly clicked, for the transient error toast if the CFI turns
   * out to be unresolvable — a stale/corrupted saved position should
   * say so, not silently do nothing when a reader taps it expecting to
   * jump straight there. */
  private async goToCfi(cfi: string, subject: string): Promise<void> {
    try {
      const parsed = EpubCfi.parse(cfi);
      const spineIndex = this.pkg.findSpineIndexByPackageCfiSteps(parsed.packageSteps);
      if (spineIndex === undefined) {
        this.reportTransientError(
          new Error(`Its saved position (${cfi}) doesn't match any chapter in this book.`),
          "open",
          subject,
        );
        return;
      }
      await this.openSpineItem(spineIndex, { bridgeCfi: cfi });
    } catch (err) {
      this.reportTransientError(err, "open", subject);
    }
  }

  public setTranslate(translate: Translate): void {
    this.translate = translate;
    this.setUpContentBoundaries();
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

  private focusReadingContent(document: Document, target?: Element): void {
    if (target) {
      this.accessibility.focusContent(target.ownerDocument, target);
      return;
    }
    // Same-chapter spreads expose one continuous chapter, not its duplicate frame.
    if (document.defaultView?.frameElement?.getAttribute("aria-hidden") === "true") {
      document = this.primaryContentDocument() ?? document;
    }
    const page = this.contentDocumentViews().find(view => view.document === document)?.page;
    const native = this.nativeReading.current();
    const position = native?.node.ownerDocument === document
      ? native : page?.startBreak ?? this.host?.currentPosition();
    if (position && position.node.ownerDocument === document) {
      this.accessibility.focusReadingPosition(document, position);
    } else {
      this.accessibility.focusContent(document);
    }
  }

  private contentDocumentViews(host: ReadingHost | undefined = this.host): readonly ContentDocumentView[] {
    return readerDocumentViews(host, this.spineIndex);
  }

  /** Visible content documents in reading order, with ownership resolved by the host. */
  private allContentDocuments(host: ReadingHost | undefined = this.host): Document[] {
    return this.contentDocumentViews(host).map(view => view.document);
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
    this.accessibility.detach();
    const documents = this.allContentDocuments();
    if (documents.length === 0) {
      return;
    }
    for (const iframeDocument of documents) {
      this.accessibility.attach(
        iframeDocument,
        this.keyboardNavigationHandlers,
        // Preserve Space's native viewport scroll in continuous-scroll mode.
        {
          interceptSpace: !(this.host instanceof ScrollContentHost),
          pageProgressionDirection: this.pkg.pageProgressionDirection,
          keyboardHandler: (event, document) => this.handleShortcut(event, document, "content"),
        },
      );
    }
  }

  private shortcutPreferences: ShortcutPreferences = DEFAULT_SHORTCUT_PREFERENCES;
  private shortcutPlatform: ShortcutPlatform = getShortcutPlatform();
  private shortcutActions: ReaderShortcutActions | undefined;
  private shortcutModalOpen = false;

  public setShortcutPreferences(preferences: ShortcutPreferences, platform: ShortcutPlatform): void {
    this.shortcutPreferences = parseShortcutPreferences(preferences);
    this.shortcutPlatform = platform;
    this.updateBoundaryShortcutHints();
  }

  public setShortcutActions(actions: ReaderShortcutActions): void {
    this.shortcutActions = actions;
  }

  public setShortcutModalOpen(open: boolean): void {
    this.shortcutModalOpen = open;
  }

  private updateBoundaryShortcutHints(): void {
    const shortcut = this.shortcutPreferences.enabled
      ? getCommandBindings("nextSection", this.shortcutPlatform,
        this.pkg.pageProgressionDirection === "rtl" ? "rtl" : "ltr")
        .map(binding => ariaShortcut(binding, this.shortcutPlatform)).join(" ")
      : undefined;
    for (const view of this.contentDocumentViews()) setContentBoundaryShortcut(view.document, shortcut);
  }

  private handleShortcut(event: KeyboardEvent, document: Document, scope: "shell" | "content"): void {
    const command = matchReaderCommand(event, document, {
      preferences: this.shortcutPreferences,
      platform: this.shortcutPlatform,
      direction: this.pkg.pageProgressionDirection === "rtl" ? "rtl" : "ltr",
      viewMode: this.host instanceof ScrollContentHost ? "scroll" : "paginated",
      scope,
      modalOpen: this.shortcutModalOpen || !!this.imageViewer,
      canSwitchViewMode: !!this.containerEl && !this.operations.disposed &&
        (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost ||
          this.host instanceof ScrollContentHost),
    });
    if (!command) return;
    if ((command === "searchBook" || command === "showKeyboardShortcuts") && !this.shortcutActions) return;
    this.recordDiagnosticEvent({ kind: "shortcut", command, scope });
    event.preventDefault();
    switch (command) {
      case "searchBook": this.shortcutActions?.searchBook(); break;
      case "showKeyboardShortcuts": this.shortcutActions?.showKeyboardShortcuts(); break;
      case "toggleBookmark": void this.toggleBookmark().catch(error => this.reportActionFailure(error)); break;
      case "switchToScrolling":
      case "switchToPaginated":
        void this.setViewMode(command === "switchToScrolling" ? "scroll" : "paginated")
          .catch(error => this.reportActionFailure(error));
        break;
      case "previousSection": void this.goToChapter(-1, document); break;
      case "nextSection": void this.goToChapter(1, document); break;
      case "previousPage": this.dispatchArrowNavigation(-1, false, document); break;
      case "nextPage": this.dispatchArrowNavigation(1, false, document); break;
    }
  }

  /** Engine fallback callbacks are replaced by the registry on every app attachment. */
  private readonly keyboardNavigationHandlers = {
    onNext: () => this.dispatchArrowNavigation(1),
    onPrevious: () => this.dispatchArrowNavigation(-1),
    onNextChapter: () => this.dispatchArrowNavigation(1, true),
    onPreviousChapter: () => this.dispatchArrowNavigation(-1, true),
  };

  /** Plain arrows retain section navigation in continuous-scroll mode. */
  private dispatchArrowNavigation(direction: 1 | -1, chapter = false, document?: Document): void {
    // Focus may still belong to an iframe or the shell when the modal opens.
    // Guard at dispatch, not only at the dialog's React event boundary.
    if (this.imageViewer) return;
    const isPaginated =
      this.host instanceof PaginatedContentHost ||
      this.host instanceof SpreadPaginatedHost ||
      this.host instanceof FixedSpreadHost;
    void (isPaginated && !chapter ? this.turnPage(direction) : this.goToChapter(direction, document));
  }

  private physicalDirection(direction: 1 | -1): 1 | -1 {
    return this.pkg.pageProgressionDirection === "rtl" ? (direction === 1 ? -1 : 1) : direction;
  }

  private globalArrowKeyCleanup: (() => void) | undefined;

  /** The shell uses the same shortcut policy, with additional panel exemptions. */
  private setUpGlobalArrowKeyFallback(ownerDocument: Document): void {
    this.globalArrowKeyCleanup?.();
    const keyboard = new AccessibilityController();
    const interceptSpace = (): boolean => !(this.host instanceof ScrollContentHost);
    keyboard.attach(
      ownerDocument,
      this.keyboardNavigationHandlers,
      {
        scope: "shell",
        get interceptSpace() {
          return interceptSpace();
        },
        pageProgressionDirection: this.pkg.pageProgressionDirection,
        keyboardHandler: (event, document) => this.handleShortcut(event, document, "shell"),
      },
    );
    this.globalArrowKeyCleanup = () => keyboard.detach();
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
      this.focusReadingContent(doc);
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
    const frame = newHost.columnElement(focusedColumn);
    const doc = frame.style.visibility === "hidden"
      ? newHost.primaryContentDocument()
      : frame.contentDocument;
    if (doc) {
      this.focusReadingContent(doc);
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
    const active = topDocument?.activeElement;
    const hasFocusOwner = active && active !== topDocument?.body && active !== topDocument?.documentElement;
    if (iframeDocument && topDocument && !menuOpen && !hasFocusOwner) {
      this.focusReadingContent(iframeDocument);
    }
  }

  /** Reattaches accessibility handlers and moves focus into the current
   * content document. */
  private setUpAccessibility(focusTarget?: Element, moveFocus = true, readingSpineIndex?: number): void {
    this.updateContentTitle();
    this.reattachKeyboardNav();

    // A cross-chapter spread's visual primary is its second chapter, not
    // necessarily the chapter explicitly opened (including a book's first entry).
    const iframeDocument = readingSpineIndex === undefined
      ? this.primaryContentDocument()
      : this.contentDocumentViews().find(view => view.spineIndex === readingSpineIndex)?.document
        ?? this.primaryContentDocument();
    if (!iframeDocument) {
      return;
    }
    if (moveFocus) this.focusReadingContent(iframeDocument, focusTarget);
  }

  /** Intercepts in-content links for reader navigation, opens external
   * URIs in a new tab, and wires zoomable images for click and keyboard
   * activation across all active content documents. */
  private setUpContentInteraction(): void {
    this.setUpContentBoundaries();
    const documents = this.allContentDocuments();
    if (documents.length === 0) {
      return;
    }
    const views = this.contentDocumentViews();
    const pathAndSpineIndexFor = (
      doc: Document,
    ): { path: string; spineIndex: number } | undefined => {
      const spineIndex = views.find((view) => view.document === doc)?.spineIndex;
      if (spineIndex === undefined) return undefined;
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
      cleanups.push(this.nativeReading.attach(iframeDocument));
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

        this.recordDiagnosticEvent({ kind: "navigation", source: "content-link", targetSpine: targetSpineIndex });
        this.suspendNarrationFollowing();
        if (targetSpineIndex === own.spineIndex && !(this.host instanceof SpreadPaginatedHost)) {
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

      // A disclosure keeps native Space activation instead of turning the page.
      for (const summary of iframeDocument.querySelectorAll("summary")) {
        const preserveActivation = (event: KeyboardEvent): void => {
          if (event.key === " ") event.stopPropagation();
        };
        summary.addEventListener("keydown", preserveActivation);
        cleanups.push(() => summary.removeEventListener("keydown", preserveActivation));
      }

      // Re-run after load if the image size was not known during the
      // initial scan.
      const markIfZoomable = (img: HTMLImageElement): void => {
        if (!isZoomableImage(img)) {
          return;
        }
        if (!img.hasAttribute("role") || img.getAttribute("role") === "img") {
          img.setAttribute("data-ambra-image-zoom", "");
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
      const pointerDownHandler = (event: PointerEvent): void => {
        this.dismissUiForPointer(event);
        this.bumpContentActivity();
      };
      iframeDocument.addEventListener("pointerdown", pointerDownHandler);
      cleanups.push(() => iframeDocument.removeEventListener("pointerdown", pointerDownHandler));
      if (this.narration.snapshot.available) {
        const selectionChange = (): void => {
          const hasSelection = selectedReadingRange(this.contentDocumentViews()) !== undefined;
          if (hasSelection !== this.cachedSnapshot?.hasReadingSelection) this.notify();
        };
        iframeDocument.addEventListener("selectionchange", selectionChange);
        cleanups.push(() => iframeDocument.removeEventListener("selectionchange", selectionChange));
      }
      const scrollIntent = (): void => {
        if (this.host instanceof ScrollContentHost) this.suspendNarrationFollowing();
      };
      const scrollKeyIntent = (event: KeyboardEvent): void => {
        if (!event.defaultPrevented && [" ", "PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp"].includes(event.key)
          && !(event.target as Element | null)?.closest?.("input, textarea, select, button, [contenteditable]")) {
          scrollIntent();
        }
      };
      iframeDocument.addEventListener("wheel", scrollIntent, { passive: true });
      iframeDocument.addEventListener("touchmove", scrollIntent, { passive: true });
      iframeDocument.addEventListener("keydown", scrollKeyIntent);
      cleanups.push(() => {
        iframeDocument.removeEventListener("wheel", scrollIntent);
        iframeDocument.removeEventListener("touchmove", scrollIntent);
        iframeDocument.removeEventListener("keydown", scrollKeyIntent);
      });
    }

    this.contentInteractionCleanup = () => {
      this.boundaryCleanup?.();
      this.boundaryCleanup = undefined;
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  private setUpContentBoundaries(): void {
    this.boundaryCleanup?.();
    this.boundaryCleanup = undefined;
    if (this.operations.disposed) return;
    const host = this.host;
    const cleanups = this.contentDocumentViews().map(view => attachContentBoundary(
      view,
      contentBoundary(view.spineIndex, this.isFixedLayoutHost(host), this.pkg, this.navigation.toc.items, this.translate),
      this.translate("readingBoundary.navigation"),
      async nextSpineIndex => {
        if (this.operations.disposed || this.host !== host || this.isLoadInFlight ||
          this.isTurningPage || this.isApplyingLayout) return;
        this.clearNavigationHighlights();
        const destination = this.contentDocumentViews().find(candidate => candidate.spineIndex === nextSpineIndex);
        if (destination) {
          // A spread's second document is the next reading stop, even in RTL.
          if (this.isFixedLayoutHost(host)) {
            this.accessibility.focusReadingPosition(destination.document, { node: destination.document.body, offset: 0 });
          } else {
            this.focusReadingContent(destination.document);
          }
          return;
        }
        // Uses the existing owned load/error path; never advances without activation.
        await this.openSpineItem(nextSpineIndex);
      },
      this.translate.locale ?? DEFAULT_LOCALE,
    ));
    this.boundaryCleanup = () => cleanups.forEach(cleanup => cleanup());
    this.updateBoundaryShortcutHints();
  }

  /** Resizes the current host while preserving position; a spread-mode
   * threshold crossing reopens instead of relayouting. */
  public resize(width: number, height: number): void {
    if (this.operations.disposed) return;
    if (width !== this.width || height !== this.height) this.navigationSpotlight.clear();
    this.diagnostics.record(
      `resize width=${width} height=${height} isLoadInFlight=${this.isLoadInFlight}`,
    );
    this.enqueueLayout({ width, height });
    this.applyPendingLayout();
  }

  private currentLayout(): ReaderLayout {
    return {
      width: this.width, height: this.height, viewMode: this.viewMode,
      fontScale: this.fontScale, fontFamily: this.fontFamily,
      lineSpacing: this.lineSpacing, letterSpacing: this.letterSpacing,
      contentWidthEm: this.contentWidthEm,
    };
  }

  private enqueueLayout(changes: Partial<ReaderLayout>): PendingLayout {
    const pending = this.pendingLayout ?? {
      configuration: this.currentLayout(), reflow: false, waiters: [],
    };
    pending.configuration = { ...pending.configuration, ...changes };
    this.pendingLayout = pending;
    return pending;
  }

  private requestLayout(changes: Partial<ReaderLayout>): Promise<void> {
    if (this.operations.disposed) return Promise.resolve();
    const pending = this.enqueueLayout(changes);
    const settled = new Promise<void>((resolve, reject) =>
      pending.waiters.push({ resolve, reject }),
    );
    this.notify();
    this.applyPendingLayout();
    return settled;
  }

  private applyPendingLayout(): void {
    if (
      this.operations.disposed ||
      this.isLoadInFlight ||
      this.isTurningPage ||
      this.isApplyingLayout ||
      !this.pendingLayout
    )
      return;
    void this.drainLayout();
  }

  private takePendingLayout(): PendingLayout | undefined {
    const pending = this.pendingLayout;
    this.pendingLayout = undefined;
    return pending;
  }

  /** The only writer of live layout settings after mounting. Requests merge
   * while a load/turn owns the host; each drained configuration is immutable
   * until its host, persisted preferences, and reading position have settled. */
  private async drainLayout(): Promise<void> {
    this.isApplyingLayout = true;
    try {
      while (!this.operations.disposed && !this.isLoadInFlight && !this.isTurningPage) {
        const pending = this.takePendingLayout();
        if (!pending) break;
        this.activeLayout = pending;
        try {
          await this.applyLayout(pending);
          if (this.operations.disposed) break;
          if (this.pendingLayout) {
            this.pendingLayout.disclosureFocus ??= pending.disclosureFocus;
            this.pendingLayout.waiters.unshift(...pending.waiters);
          } else {
            this.restoreDisclosureFocus(pending.disclosureFocus);
            for (const waiter of pending.waiters) waiter.resolve();
          }
        } catch (error) {
          if (this.operations.disposed) break;
          for (const waiter of pending.waiters) waiter.reject(error);
          this.reportTransientError(error, "open", "the updated reading layout");
        }
      }
    } finally {
      this.activeLayout = undefined;
      this.isApplyingLayout = false;
    }
  }

  private async applyLayout(pending: PendingLayout): Promise<void> {
    const previous = this.currentLayout();
    const next = pending.configuration;
    const resized = next.width !== this.appliedWidth || next.height !== this.appliedHeight;
    const modeChanged = previous.viewMode !== next.viewMode;
    const needsReflow = pending.reflow && !(this.host instanceof ScrollContentHost);
    const typographyChanged = previous.fontScale !== next.fontScale || previous.fontFamily !== next.fontFamily ||
      previous.lineSpacing !== next.lineSpacing || previous.letterSpacing !== next.letterSpacing ||
      previous.contentWidthEm !== next.contentWidthEm;
    if (!resized && !modeChanged && !typographyChanged && !needsReflow) return;

    Object.assign(this, next);
    if (modeChanged || needsReflow || this.shouldSwitchSpreadMode(next.width) ||
      this.host instanceof SpreadPaginatedHost) {
      const previousHost = this.host;
      await this.reopenForCurrentSize(pending.disclosureFocus);
      // A direct navigation may supersede this rebuild while retaining the
      // active layout. Its replacement must settle before settings promises do.
      while (this.operations.current) await this.operations.current.settled;
      if (this.operations.disposed) return;
      if (this.containerEl && this.host === previousHost) {
        Object.assign(this, previous);
        throw new Error(this.error ?? "The updated reading layout could not be loaded.");
      }
    } else {
      const native = this.nativeReading.current();
      if (typographyChanged) {
        this.applyDisplaySettingsToHost({ relayout: true });
      } else if (this.host instanceof PaginatedContentHost) {
        this.host.relayout(next.width, next.height);
      } else if (this.host instanceof ScrollContentHost || this.isFixedLayoutHost(this.host)) {
        this.host.resize(next.width, next.height);
      }
      this.appliedWidth = next.width;
      this.appliedHeight = next.height;
      this.refreshBookPagination();
      this.highlightInteraction.updateNoteMarkers();
      if (native) this.nativeReading.retain(native);
    }
    if (this.operations.disposed) return;
    if (typographyChanged) {
      await this.library.patchBookReadingSettings(this.bookId, {
        ...(previous.fontScale !== next.fontScale ? { fontScale: next.fontScale } : {}),
        ...(previous.fontFamily !== next.fontFamily ? { fontFamily: next.fontFamily } : {}),
        ...(previous.lineSpacing !== next.lineSpacing ? { lineSpacing: next.lineSpacing } : {}),
        ...(previous.letterSpacing !== next.letterSpacing ? { letterSpacing: next.letterSpacing } : {}),
        ...(previous.contentWidthEm !== next.contentWidthEm ? { contentWidthEm: next.contentWidthEm } : {}),
      });
    }
    if (this.operations.disposed) return;
    this.diagnostics.record(`layout applied ${JSON.stringify(next)}`);
    if (modeChanged) {
      this.announce(
        next.viewMode === "paginated"
          ? this.translate("announcements.paginatedView")
          : this.translate("announcements.scrollView"),
      );
    }
    this.notify();
    if (typographyChanged) await this.saveProgress();
  }

  private restoreDisclosureFocus(focus: PendingLayout["disclosureFocus"]): void {
    if (focus) {
      for (const doc of this.allContentDocuments()) {
        if (this.spineIndexForDocument(doc) !== focus.spineIndex) continue;
        const summary = doc.querySelectorAll("details")[focus.ordinal]?.querySelector("summary");
        const bounds = summary?.getBoundingClientRect();
        if (summary && bounds && bounds.bottom > 0 && bounds.top < (doc.defaultView?.innerHeight ?? 0) &&
          bounds.right > 0 && bounds.left < (doc.defaultView?.innerWidth ?? 0)) {
          this.accessibility.focusContent(doc, summary);
          break;
        }
      }
    }
  }

  private spineIndexForDocument(doc: Document): number | undefined {
    return this.contentDocumentViews().find((view) => view.document === doc)
      ?.spineIndex;
  }

  private handleDisclosureChange(spineIndex: number, source: Document): void {
    if (!this.allContentDocuments().includes(source)) return;
    const frame = source.defaultView?.frameElement as HTMLIFrameElement | null;
    if (!frame?.isConnected || frame.style.visibility === "hidden") return;
    this.spreadCounts.delete(spineIndex);
    this.bookPagination?.invalidateSpineItem(spineIndex);
    if (this.host instanceof ScrollContentHost) {
      this.refreshBookPagination();
      this.notify();
      return;
    }
    const summary = source.activeElement?.closest("summary");
    const details = summary?.closest("details");
    const pending = this.enqueueLayout({});
    if (details) {
      pending.disclosureFocus = {
        spineIndex,
        ordinal: Array.from(source.querySelectorAll("details")).indexOf(details),
      };
    }
    pending.reflow = true;
    this.applyPendingLayout();
  }

  /** Whether the new dimensions change the open host's spread pairing. */
  private shouldSwitchSpreadMode(width: number): boolean {
    if (this.host instanceof FixedSpreadHost) {
      const planned = FixedLayoutSpreadPlanner.spreadContaining(
        this.pkg.spine,
        this.pkg.metadata.renditionLayout,
        this.pkg.pageProgressionDirection,
        this.fixedSpreadViewport(width),
        this.spineIndex,
      );
      const current = this.host.spread;
      if (planned.kind === "single") {
        return current?.kind !== "single" || current.spineIndex !== planned.spineIndex;
      }
      return (
        current?.kind !== "pair" ||
        current.leftSpineIndex !== planned.leftSpineIndex ||
        current.rightSpineIndex !== planned.rightSpineIndex
      );
    }
    if (this.viewMode !== "paginated" || this.isFixedLayoutHost(this.host)) {
      return false;
    }
    return SpreadPaginatedHost.isEligible(width) !== this.host instanceof SpreadPaginatedHost;
  }

  private fixedSpreadViewport(width = this.width) {
    return {
      width,
      height: this.height,
      packageRenditionSpread: this.pkg.metadata.renditionSpread,
    };
  }

  /** Reopens the current spine item at the current size, bridging
   * position through a CFI. */
  private async reopenForCurrentSize(disclosureFocus?: {
    spineIndex: number;
    ordinal: number;
  }): Promise<void> {
    const native = this.nativeReading.current();
    let spineIndex = native?.spineIndex ?? this.spineIndex;
    let position = native ?? this.host?.currentPosition();
    if (disclosureFocus && disclosureFocus.spineIndex !== spineIndex) {
      // Expanding the first chapter of a cross-chapter pair can move its
      // companion many pages away. Keep the interacted page, not the companion.
      const doc = this.allContentDocuments().find(
        (document) => this.spineIndexForDocument(document) === disclosureFocus.spineIndex,
      );
      const summary = doc?.querySelectorAll("details")[disclosureFocus.ordinal]?.querySelector("summary");
      if (summary) {
        spineIndex = disclosureFocus.spineIndex;
        position = { node: summary, offset: 0 };
      }
    }
    const bridgeCfi = position
      ? this.locatorResolver.generate(spineIndex, position.node, position.offset).cfi
      : undefined;
    const doc = this.containerEl?.ownerDocument;
    const activeElement = doc?.activeElement;
    // A layout rebuild is not navigation: leave shell controls (including
    // portalled settings menus) focused, but transfer old content focus to
    // the replacement host rather than leaving it on the document body.
    const preserveFocus = Boolean(
      activeElement && activeElement !== doc?.body && activeElement !== doc?.documentElement &&
      !this.host?.element.contains(activeElement),
    );
    await this.openSpineItem(spineIndex, { bridgeCfi, preserveFocus });
  }

  public async setViewMode(mode: ViewMode): Promise<void> {
    if (!this.containerEl || this.operations.disposed || this.isFixedLayoutHost(this.host)) return;
    this.recordDiagnosticEvent({ kind: "setting", name: "viewMode",
      before: this.pendingLayout?.configuration.viewMode ?? this.viewMode, after: mode, source: "reader-control" });
    await this.library.patchGlobalReadingSettings({ viewMode: mode });
    await Promise.all([this.requestLayout({ viewMode: mode }), this.refreshGlobalSettings()]);
  }

  /** Sets and persists font scale, then reapplies display settings and
   * pagination. No-op for fixed-layout content. */
  public async setFontScale(scale: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_FONT_SCALE,
      Math.max(ReadingTheme.MIN_FONT_SCALE, scale),
    );
    if (this.isFixedLayoutHost(this.host)) return;
    this.recordDiagnosticEvent({ kind: "setting", name: "fontScale",
      before: this.pendingLayout?.configuration.fontScale ?? this.fontScale, after: clamped, source: "reader-control" });
    await this.requestLayout({ fontScale: clamped });
  }

  /** Sets and persists font family, then reapplies display settings and
   * pagination. No-op for fixed-layout content. */
  public async setFontFamily(family: FontFamilyChoice): Promise<void> {
    if (this.isFixedLayoutHost(this.host)) return;
    this.recordDiagnosticEvent({ kind: "setting", name: "fontFamily",
      before: this.pendingLayout?.configuration.fontFamily ?? this.fontFamily, after: family, source: "reader-control" });
    await this.requestLayout({ fontFamily: family });
  }

  /** Sets and persists line spacing, then reapplies display settings and
   * pagination. No-op for fixed-layout content. */
  public async setLineSpacing(spacing: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_LINE_SPACING,
      Math.max(ReadingTheme.MIN_LINE_SPACING, spacing),
    );
    if (this.isFixedLayoutHost(this.host)) return;
    this.recordDiagnosticEvent({ kind: "setting", name: "lineSpacing",
      before: this.pendingLayout?.configuration.lineSpacing ?? this.lineSpacing, after: clamped, source: "reader-control" });
    await this.requestLayout({ lineSpacing: clamped });
  }

  /** Sets and persists letter spacing, then reapplies display settings
   * and pagination. No-op for fixed-layout content. */
  public async setLetterSpacing(spacing: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_LETTER_SPACING,
      Math.max(ReadingTheme.MIN_LETTER_SPACING, spacing),
    );
    if (this.isFixedLayoutHost(this.host)) return;
    this.recordDiagnosticEvent({ kind: "setting", name: "letterSpacing",
      before: this.pendingLayout?.configuration.letterSpacing ?? this.letterSpacing, after: clamped, source: "reader-control" });
    await this.requestLayout({ letterSpacing: clamped });
  }

  /** Sets and persists content width, then reapplies display settings and
   * pagination. No-op for fixed-layout content. */
  public async setContentWidth(widthEm: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_CONTENT_WIDTH_EM,
      Math.max(ReadingTheme.MIN_CONTENT_WIDTH_EM, widthEm),
    );
    if (this.isFixedLayoutHost(this.host)) return;
    this.recordDiagnosticEvent({ kind: "setting", name: "contentWidthEm",
      before: this.pendingLayout?.configuration.contentWidthEm ?? this.contentWidthEm, after: clamped, source: "reader-control" });
    await this.requestLayout({ contentWidthEm: clamped });
  }

  /** Sets and persists page theme without relayout. No-op for fixed-layout content. */
  public async setPageTheme(theme: PageTheme): Promise<void> {
    if (this.operations.disposed || this.isFixedLayoutHost(this.host)) {
      return;
    }
    this.recordDiagnosticEvent({ kind: "setting", name: "pageTheme",
      before: this.pageTheme, after: theme, source: "reader-control" });
    await this.library.patchBookReadingSettings(this.bookId, { pageTheme: theme });
    if (this.operations.disposed) return;
    this.pageTheme = theme;
    this.diagnostics.record(`pageTheme applied value=${theme}`);
    this.applyDisplaySettingsToHost({ relayout: false });
    this.notify();
  }

  /** Sets and persists reader brightness. It is applied at the reader-shell
   * level, so it also works for fixed-layout content. */
  public async setBrightness(brightness: number): Promise<void> {
    const clamped = ReadingTheme.clampBrightness(brightness);
    if (this.operations.disposed) {
      return;
    }
    this.recordDiagnosticEvent({ kind: "setting", name: "brightness",
      before: this.brightness, after: clamped, source: "reader-control" });
    await this.library.patchGlobalReadingSettings({ brightness: clamped });
    await this.refreshGlobalSettings();
  }

  /** Sets and persists the reader chrome theme. */
  public async setChromeTheme(theme: ChromeThemeChoice): Promise<void> {
    if (this.operations.disposed) {
      return;
    }
    this.recordDiagnosticEvent({ kind: "setting", name: "chromeTheme",
      before: this.chromeTheme, after: theme, source: "reader-control" });
    await this.library.patchGlobalReadingSettings({ chromeTheme: theme });
    await this.refreshGlobalSettings();
  }

  /** Sets and persists the page-turn animation style. */
  public async setPageTurnAnimationStyle(style: PageTurnAnimationStyle): Promise<void> {
    if (this.operations.disposed) {
      return;
    }
    this.recordDiagnosticEvent({ kind: "setting", name: "pageTurnAnimationStyle",
      before: this.pageTurnAnimationStyle, after: style, source: "reader-control" });
    await this.library.patchGlobalReadingSettings({ pageTurnAnimationStyle: style });
    await this.refreshGlobalSettings();
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
      this.focusReadingContent(iframeDocument, stillConnected ? returnTarget : undefined);
    }
    this.notify();
  }

  /** Restores managed focus to the current content document after a
   * parent-document overlay closes without navigating. */
  public restoreContentFocus(): void {
    const iframeDocument = this.primaryContentDocument();
    if (iframeDocument) {
      this.focusReadingContent(iframeDocument);
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
  private clearNavigationHighlights(): void {
    this.suspendNarrationFollowing();
    this.navigationSpotlight.clear();
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
    this.errorDetail = undefined;
    this.notify();
  }

  private setNotification(
    message: string,
    severity: NonNullable<ReaderSnapshot["errorSeverity"]>,
    detail?: string,
  ): void {
    this.errorNotificationId++;
    this.error = message;
    this.errorSeverity = severity;
    this.errorDetail = detail;
  }

  /** Failed actions stay visible without interrupting the current reading surface. */
  private reportTransientError(err: unknown, action: string, subject: string): void {
    if (this.operations.disposed) return;
    this.setNotification(describeStorageError(err, action, subject), "transient");
    this.notify();
  }

  public reportActionFailure(error: unknown): void {
    this.reportTransientError(error, "update", "the reader");
  }

  /** Import failures persist until dismissed; technical details are secondary copy. */
  private reportImportFailure(message: string, detail?: string): void {
    this.setNotification(message, "actionFailed", detail);
    this.notify();
  }

  /** Falls back to a generic "these don't line up with this book"
   * message (issue #119's suggested wording) for an annotation-import
   * failure that isn't one of the specifically-classified cases above —
   * keeps the raw exception message available as `detail` rather than
   * showing it as the primary text. A storage-quota failure already has
   * its own specific, friendly message with nothing further to add. */
  private reportGenericImportFailure(err: unknown): void {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      this.reportImportFailure(describeStorageError(err, "import", "that annotation file"));
      return;
    }
    this.reportImportFailure(
      this.translate("annotations.importGenericFailure"),
      describeStorageError(err, "import", "that annotation file"),
    );
  }

  /** Quiet acknowledgement, including imports whose annotations already exist. */
  private reportInfo(message: string): void {
    this.setNotification(message, "info");
    this.notify();
  }

  public async addHighlight(style: HighlightStyle, openNoteEditor = false): Promise<void> {
    return this.highlights.add(style, openNoteEditor);
  }

  public async removeHighlight(id: string): Promise<void> {
    return this.highlights.remove(id);
  }

  public async setHighlightNote(id: string, note: string | undefined): Promise<boolean> {
    return this.highlights.setNote(id, note);
  }

  public async setHighlightStyle(id: string, style: HighlightStyle): Promise<void> {
    return this.highlights.setStyle(id, style);
  }

  /** Turns one page or spread in paginated mode, crossing chapter
   * boundaries when needed. No-op in scroll mode and while a turn is
   * already in progress. */
  public async turnPage(direction: 1 | -1): Promise<void> {
    if (
      this.operations.disposed ||
      this.isTurningPage ||
      this.isLoadInFlight ||
      this.isApplyingLayout
    ) {
      return;
    }
    this.gestureCleanup?.();
    this.clearNavigationHighlights();
    this.isTurningPage = true;
    const operation = this.operations.begin();
    this.diagnostics.record(`turnPage direction=${direction}`);
    try {
      await this.turnPageInternal(direction, operation);
    } catch (error) {
      if (this.operations.owns(operation))
        this.reportTransientError(error, "open", "the next page");
    } finally {
      this.finishTurn(operation);
    }
  }

  private finishTurn(operation: ReaderOperation): void {
    if (!this.operations.owns(operation)) return;
    this.operations.finish(operation);
    this.isTurningPage = false;
    this.applyPendingLayout();
  }

  private ownCandidate(
    operation: ReaderOperation,
    host: NonNullable<ReaderController["host"]>,
    wrapper?: HTMLElement,
  ): void {
    operation.own(() => {
      if (this.host === host) return;
      host.dispose();
      wrapper?.remove();
    });
  }

  private async turnPageInternal(direction: 1 | -1, operation: ReaderOperation): Promise<void> {
    // Page turns do not rebuild the content document, so clear any highlight
    // popup that now points at content no longer on screen — and repaint
    // its "selected" emphasis away immediately (issue #113's follow-up),
    // since the fast in-chapter turn path below never otherwise repaints
    // highlights at all (the document itself doesn't change), which would
    // otherwise leave a stale glow on the outgoing page's old position.
    this.activeHighlight = undefined;
    this.highlightInteraction.applyActiveHighlightOverlay();
    this.footnotePopup = undefined;
    let moved: boolean;
    let announcement: string;
    if (this.host instanceof SpreadPaginatedHost) {
      // Capture focus before disposing the old spread so it can be restored
      // after the host swap.
      const focusedColumn = this.spreadFocusedColumn(this.host);
      const oldHost = this.host;
      const animatedSpread = await this.animateSpreadTurn(oldHost, direction, operation);
      operation.check();
      if (animatedSpread) {
        this.contentInteractionCleanup?.();
        this.contentInteractionCleanup = undefined;
        this.dragCleanup?.();
        this.dragCleanup = undefined;
        oldHost.dispose();
        this.host = animatedSpread;
        this.clearStaleHostWrapper();
        if (animatedSpread.primarySpineIndex !== this.spineIndex) {
          this.spineIndex = animatedSpread.primarySpineIndex;
          this.refreshBookPagination();
        }
        this.updateContentTitle();
        this.reattachKeyboardNav();
        this.setUpContentInteraction();
        this.setUpDragPageTurn();
        this.highlightInteraction.setUpHighlightSelection();
        this.highlightInteraction.applyHighlightsToCurrentHost();
        this.restoreSpreadFocusAfterHostSwap(animatedSpread, focusedColumn);
        const second = animatedSpread.isShowingMergedTail ? undefined : animatedSpread.secondPageIndex;
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
      moved = false;
      const second = this.host.isShowingMergedTail ? undefined : this.host.secondPageIndex;
      announcement =
        second !== undefined
          ? this.translate("announcements.spreadOfTotal", {
              first: this.host.pageIndex + 1,
              second: second + 1,
              total: this.host.pageCount,
            })
          : this.translate("scrubber.pageOfTotal", {
              current: this.host.pageIndex + 1,
              total: this.host.pageCount,
            });
    } else if (this.host instanceof PaginatedContentHost) {
      // Capture focus before disposing the old host so keyboard
      // navigation can be restored after the swap.
      const hadKeyboardFocus = this.iframeHasFocus(this.host);
      const oldHost = this.host;
      const animatedHost = await this.animatePageTurn(oldHost, direction, operation);
      operation.check();
      if (animatedHost) {
        this.contentInteractionCleanup?.();
        this.contentInteractionCleanup = undefined;
        this.dragCleanup?.();
        this.dragCleanup = undefined;
        oldHost.dispose();
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
      await this.turnFixedSpread(this.host, direction, operation);
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
    await this.openSpineItem(nextSpineIndex, {
      landOnLastPage: direction === -1,
      animateDirection: direction,
    });
  }

  /** Turns within fixed-layout content by loading the next or previous
   * `FixedSpread`. If no adjacent spread exists, it falls through to
   * `openSpineItem` using this spread's outer spine edge so a paired
   * spread is skipped as a unit. */
  private async turnFixedSpread(
    host: FixedSpreadHost,
    direction: 1 | -1,
    operation: ReaderOperation,
  ): Promise<void> {
    const currentSpread = host.spread;
    const indices = host.spineIndices;
    if (!currentSpread || indices.length === 0) {
      return;
    }

    const viewport = this.fixedSpreadViewport();
    const nextSpread =
      direction === 1
        ? FixedLayoutSpreadPlanner.nextSpread(
            this.pkg.spine,
            this.pkg.metadata.renditionLayout,
            this.pkg.pageProgressionDirection,
            viewport,
            currentSpread,
          )
        : FixedLayoutSpreadPlanner.previousSpread(
            this.pkg.spine,
            this.pkg.metadata.renditionLayout,
            this.pkg.pageProgressionDirection,
            viewport,
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
      this.pkg.spine[nextPrimaryIndex]?.resolveRenditionLayout(
        this.pkg.metadata.renditionLayout,
      ) === "pre-paginated";

    if (nextSpread && stillPrePaginated && this.containerEl) {
      const newHost = new FixedSpreadHost(this.width, this.height);
      // Attach before `open()`; detached iframes may never navigate, and the
      // staged wrapper keeps the new host hidden while it loads.
      const newStagingEl = this.stageHiddenHostElement(newHost.element);
      this.ownCandidate(operation, newHost, newStagingEl);
      try {
        await newHost.open(
          this.contentLoader,
          this.resolver,
          nextSpread,
          this.pkg.metadata.renditionViewport,
        );
      } catch (err) {
        newHost.dispose();
        newStagingEl.remove();
        throw err;
      }
      operation.check();
      // Animate before disposing the old host so the outgoing spread stays
      // intact for the whole turn.
      const previousWrapperEl = this.hostWrapperEl;
      await this.animateFixedSpreadTurn(previousWrapperEl, newStagingEl, direction);
      operation.check();
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
          : this.translate("scrubber.pageOfTotal", {
              current: newIndices[0]! + 1,
              total: this.pkg.spine.length,
            }),
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

  /** Animates a fixed-layout spread turn using the current page-turn
   * style — see `PageTurnOrchestrator.animateFixedSpreadTurn`. */
  private async animateFixedSpreadTurn(
    previousWrapperEl: HTMLDivElement | undefined,
    stagingEl: HTMLDivElement,
    direction: 1 | -1,
  ): Promise<boolean> {
    return this.pageTurnOrchestrator.animateFixedSpreadTurn(
      previousWrapperEl,
      stagingEl,
      direction,
    );
  }

  /** Returns the footer page number for this chapter page, using book-wide
   * pagination when available and the local page number otherwise. */
  private furniturePageNumber(
    spineIndex: number,
    pageIndex: number,
    pageCount: number,
  ): number | undefined {
    const bookPageIndex = this.bookPagination?.positionFor(spineIndex, pageIndex).currentPage;
    return bookPageIndex ?? (pageCount > 0 ? pageIndex + 1 : undefined);
  }

  /** Builds the incoming page in a new host and plays a page-turn
   * animation within the current chapter. Returns `undefined` when the
   * turn would cross a chapter boundary. */
  private async animatePageTurn(
    oldHost: PaginatedContentHost,
    direction: 1 | -1,
    operation: ReaderOperation,
  ): Promise<PaginatedContentHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    const newHost = await this.prepareIncomingPage(oldHost, direction, operation);
    operation.check();
    if (!newHost) {
      return undefined;
    }
    await this.pageTurnOrchestrator.animatePageTurn(
      oldHost,
      newHost,
      direction,
      this.singlePageTurnFurniture(oldHost, newHost),
    );
    return newHost;
  }

  /** The display data `PageTurnOrchestrator` needs to build an
   * in-chapter turn's temporary furniture overlays — both sides share
   * the same chapter label since a single-page turn never crosses a
   * chapter boundary (that's `prepareIncomingPage` returning `undefined`
   * instead, before this is ever called). */
  private singlePageTurnFurniture(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost,
  ): PageTurnFurnitureInfo {
    return {
      title: this.pkg.metadata.title,
      chapterLabel: this.chapterLabel(this.spineIndex),
      outgoingPage: this.furniturePageNumber(
        this.spineIndex,
        oldHost.currentPageIndex,
        oldHost.pageCount,
      ),
      incomingPage: this.furniturePageNumber(
        this.spineIndex,
        newHost.currentPageIndex,
        newHost.pageCount,
      ),
    };
  }

  /** Spread version of `animatePageTurn`. "slide" and "scroll" move the
   * whole spread, while "rotate" turns only the column nearest the
   * spine; "scroll" moves outgoing and incoming spreads together.
   * Returns `undefined` when no reflowable spread is available. */
  private async animateSpreadTurn(
    oldHost: SpreadPaginatedHost,
    direction: 1 | -1,
    operation: ReaderOperation,
  ): Promise<SpreadPaginatedHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    const newHost = await this.prepareIncomingSpread(oldHost, direction, operation);
    operation.check();
    if (!newHost) {
      return undefined;
    }
    await this.pageTurnOrchestrator.animateSpreadTurn(
      oldHost,
      newHost,
      direction,
      this.spreadTurnFurniture(oldHost, newHost),
    );
    return newHost;
  }

  /** Furniture follows each explicit page position, even across chapters. */
  private spreadTurnFurniture(
    oldHost: SpreadPaginatedHost,
    newHost: SpreadPaginatedHost,
  ): SpreadPageTurnFurnitureInfo {
    const incomingSpineIndex = newHost.primarySpineIndex;
    const outgoingPrimary = this.furniturePageNumber(
      oldHost.positions.first.spineIndex,
      oldHost.positions.first.pageIndex,
      oldHost.pageCount,
    );
    const outgoingSecondary = oldHost.positions.second
      ? this.furniturePageNumber(
          oldHost.positions.second.spineIndex,
          oldHost.positions.second.pageIndex,
          oldHost.pageCount,
        )
      : undefined;
    const incomingPrimary = this.furniturePageNumber(
      newHost.positions.first.spineIndex,
      newHost.positions.first.pageIndex,
      newHost.pageCount,
    );
    const incomingSecondary = newHost.positions.second
      ? this.furniturePageNumber(
          newHost.positions.second.spineIndex,
          newHost.positions.second.pageIndex,
          newHost.pageCount,
        )
      : undefined;
    return {
      title: this.pkg.metadata.title,
      outgoingChapterLabel: this.chapterLabel(this.spineIndex),
      incomingChapterLabel: this.chapterLabel(incomingSpineIndex),
      outgoingPrimaryPage: outgoingPrimary,
      outgoingSecondaryPage: outgoingSecondary,
      incomingPrimaryPage: incomingPrimary,
      incomingSecondaryPage: incomingSecondary,
    };
  }

  /** Builds the incoming page for an in-chapter turn and positions it
   * directly under `oldHost.element`. Returns `undefined` when the turn
   * would cross a chapter boundary. Attach the new iframe before `open()`,
   * and do not reparent the old one, or loading and reload behavior can
   * break. */
  private async prepareIncomingPage(
    oldHost: PaginatedContentHost,
    direction: 1 | -1,
    operation: ReaderOperation,
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
    this.ownCandidate(operation, newHost);
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

    await newHost.open(this.contentLoader, this.resolver, this.spineIndex, this.disclosures);
    operation.check();
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

  private spreadCounts = new Map<number, Promise<number>>();
  private spreadLayoutKey = "";

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

  private configureSpreadDocument(doc: Document): void {
    if (this.fontScale !== 1 || this.fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY ||
      this.lineSpacing !== ReadingTheme.DEFAULT_LINE_SPACING ||
      this.letterSpacing !== ReadingTheme.DEFAULT_LETTER_SPACING ||
      this.contentWidthEm !== ReadingTheme.DEFAULT_CONTENT_WIDTH_EM) {
      ReadingTheme.applyFontScale(doc, this.fontScale);
      ReadingTheme.applyFontFamily(doc, this.fontFamily);
      ReadingTheme.applyLineSpacing(doc, this.lineSpacing);
      ReadingTheme.applyLetterSpacing(doc, this.letterSpacing);
      ReadingTheme.applyContentWidth(doc, this.contentWidthEm);
    }
    ReadingTheme.applyPageTheme(doc, this.pageTheme);
  }

  private spreadPlanner(operation: ReaderOperation): ReflowableSpreadPlanner {
    const key = JSON.stringify([
      this.width,
      this.height,
      this.fontScale,
      this.fontFamily,
      this.lineSpacing,
      this.letterSpacing,
      this.contentWidthEm,
    ]);
    if (key !== this.spreadLayoutKey) {
      this.spreadLayoutKey = key;
      this.spreadCounts.clear();
    }
    return new ReflowableSpreadPlanner(
      (index) => this.spreadPageCount(index, operation),
      (index) => this.canMergeSpreadIntoNext(index),
    );
  }

  private spreadPageCount(spineIndex: number, operation: ReaderOperation): Promise<number> {
    operation.check();
    let count = this.spreadCounts.get(spineIndex);
    if (!count) {
      count = this.measureSpreadChapter(spineIndex, operation);
      this.spreadCounts.set(spineIndex, count);
      void count.catch(() => {
        if (this.spreadCounts.get(spineIndex) === count) this.spreadCounts.delete(spineIndex);
      });
    }
    return count;
  }

  private async measureSpreadChapter(
    spineIndex: number,
    operation: ReaderOperation,
  ): Promise<number> {
    operation.check();
    const width = SpreadPaginatedHost.effectiveColumnWidth(this.width);
    const probe = new PaginatedContentHost(width, this.height);
    const staging = this.stageHiddenHostElement(probe.element);
    this.ownCandidate(operation, probe, staging);
    try {
      await probe.open(this.contentLoader, this.resolver, spineIndex, this.disclosures);
      operation.check();
      this.configureSpreadDocument(probe.element.contentDocument!);
      probe.relayout(width, this.height, undefined, false);
      return probe.pageCount;
    } finally {
      probe.dispose();
      staging.remove();
    }
  }

  private async buildSpreadHost(
    spread: ReflowableSpread,
    operation: ReaderOperation,
  ): Promise<SpreadPaginatedHost> {
    operation.check();
    const host = new SpreadPaginatedHost(this.width, this.height);
    host.setProgressionDirection(this.pkg.pageProgressionDirection);
    Object.assign(host.element.style, {
      position: "absolute",
      top: "0",
      left: "0",
      zIndex: "1",
      opacity: "0",
    });
    this.containerEl!.appendChild(host.element);
    this.ownCandidate(operation, host);
    try {
      await host.openSpread(
        this.contentLoader,
        this.resolver,
        spread,
        (doc) => this.configureSpreadDocument(doc),
        this.disclosures,
      );
      operation.check();
      host.setTitle(`${this.pkg.metadata.title} — ${this.chapterLabel(host.primarySpineIndex)}`);
      return host;
    } catch (error) {
      host.dispose();
      throw error;
    }
  }

  private async prepareSpreadForOpen(
    spineIndex: number,
    options: {
      fragment?: string;
      bridgeCfi?: string;
      landOnLastPage?: boolean;
      landOnPageIndex?: number;
      landOnFractionInItem?: number;
    },
    operation: ReaderOperation,
  ): Promise<SpreadPaginatedHost> {
    const planner = this.spreadPlanner(operation);
    const count = await this.spreadPageCount(spineIndex, operation);
    operation.check();
    let pageIndex = options.landOnLastPage
      ? count - 1
      : (options.landOnPageIndex ?? Math.round((options.landOnFractionInItem ?? 0) * (count - 1)));
    if (options.bridgeCfi || options.fragment) {
      const width = SpreadPaginatedHost.effectiveColumnWidth(this.width);
      const probe = new PaginatedContentHost(width, this.height);
      const staging = this.stageHiddenHostElement(probe.element);
      this.ownCandidate(operation, probe, staging);
      try {
        await probe.open(this.contentLoader, this.resolver, spineIndex, this.disclosures);
        operation.check();
        const doc = probe.element.contentDocument!;
        this.configureSpreadDocument(doc);
        probe.relayout(width, this.height, undefined, false);
        if (options.bridgeCfi) {
          const resolved = this.locatorResolver.resolveInDocument(
            new Locator(options.bridgeCfi),
            spineIndex,
            doc,
          );
          probe.goToPosition(resolved.node, resolved.characterOffset ?? 0, false);
        } else {
          const target = doc.getElementById(options.fragment!);
          if (target) probe.goToPosition(target, 0, false);
        }
        pageIndex = probe.currentPageIndex;
      } finally {
        probe.dispose();
        staging.remove();
      }
    }
    return this.buildSpreadHost(
      await planner.containing({
        spineIndex,
        pageIndex: Math.max(0, Math.min(pageIndex, count - 1)),
      }),
      operation,
    );
  }

  private async prepareIncomingSpread(
    oldHost: SpreadPaginatedHost,
    direction: 1 | -1,
    operation: ReaderOperation,
  ): Promise<SpreadPaginatedHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    const spread = await this.spreadPlanner(operation).turn(oldHost.positions, direction);
    operation.check();
    if (!spread) return undefined;
    const newHost = await this.buildSpreadHost(spread, operation);
    newHost.element.style.opacity = "";
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
      this.dismissUiForPointer(event);
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
          void this.turnPage(this.physicalDirection(-1));
        } else if (startX > this.width - thirdWidth) {
          void this.turnPage(this.physicalDirection(1));
        }
        // Middle third: no-op, exactly like `handleContentClick`.
      };
      this.onGestureRelease(containerEl, event, onPointerUp);
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

    this.contentDocumentViews(host).forEach(({ document: doc, physicalSide }) => {
      // The right column's left edge is the gutter, so that zone still
      // means "forward" rather than "back."
      const rtl = this.pkg.pageProgressionDirection === "rtl";
      const { left: leftThirdAction, right: rightThirdAction } = this.fixedSpreadThirdActions(
        physicalSide,
        rtl,
      );
      const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        const startX = event.clientX;
        const startY = event.clientY;
        const onPointerUp = (upEvent: PointerEvent): void => {
          doc.removeEventListener("pointerup", onPointerUp);
          if (Math.abs(upEvent.clientX - startX) > 60 && Math.abs(upEvent.clientY - startY) < 50 &&
            doc.getSelection()?.isCollapsed !== false) {
            void this.turnPage(this.physicalDirection(upEvent.clientX < startX ? 1 : -1));
            return;
          }
          this.handleContentClick(
            upEvent,
            startX,
            startY,
            columnWidth,
            doc,
            leftThirdAction,
            rightThirdAction,
          );
        };
        this.onGestureRelease(doc, event, onPointerUp);
      };
      doc.addEventListener("pointerdown", onPointerDown);
      cleanups.push(() => doc.removeEventListener("pointerdown", onPointerDown));
    });

    const containerEl = host.element;
    const onContainerPointerDown = (event: PointerEvent): void => {
      this.dismissUiForPointer(event);
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
      this.onGestureRelease(containerEl, event, onContainerPointerUp);
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

    this.contentDocumentViews(host).forEach(({ document: doc, physicalSide }) => {
      const { left: leftThirdAction, right: rightThirdAction } = this.fixedSpreadThirdActions(
        physicalSide,
        rtl,
      );
      const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        const startX = event.clientX;
        const startY = event.clientY;
        const containerWidth = doc.defaultView?.innerWidth ?? this.width;
        const onPointerUp = (upEvent: PointerEvent): void => {
          doc.removeEventListener("pointerup", onPointerUp);
          this.handleContentClick(
            upEvent,
            startX,
            startY,
            containerWidth,
            doc,
            leftThirdAction,
            rightThirdAction,
          );
        };
        this.onGestureRelease(doc, event, onPointerUp);
      };
      doc.addEventListener("pointerdown", onPointerDown);
      cleanups.push(() => doc.removeEventListener("pointerdown", onPointerDown));
    });

    const containerEl = host.element;
    // Margin clicks belong to no specific page, so treat them as
    // `"single"` and use the outer-edge convention.
    const { left: containerLeftAction, right: containerRightAction } = this.fixedSpreadThirdActions(
      "single",
      rtl,
    );
    const onContainerPointerDown = (event: PointerEvent): void => {
      this.dismissUiForPointer(event);
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
      this.onGestureRelease(containerEl, event, onContainerPointerUp);
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

  private dismissContentSelection(): boolean {
    const selected = this.contentDocumentViews().some(
      ({ document }) => this.highlightInteraction.hasVisibleSelection(document),
    );
    if (selected) this.highlightInteraction.dismissSelectionToolbar();
    return selected;
  }

  private onGestureRelease(
    target: Document | HTMLElement,
    start: PointerEvent,
    release: (event: PointerEvent) => void,
  ): void {
    this.gestureCleanup?.();
    const dismissedUi = this.dismissUiForPointer(start);
    // Native pointerdown clears selection before pointerup can inspect it.
    if (this.dismissContentSelection()) return;
    const cleanup = (): void => {
      target.removeEventListener("pointerup", listener);
      target.removeEventListener("pointercancel", listener);
      if (this.gestureCleanup === cleanup) this.gestureCleanup = undefined;
    };
    const listener = (event: Event): void => {
      const pointer = event as PointerEvent;
      if (pointer.pointerId !== start.pointerId) return;
      cleanup();
      if (dismissedUi &&
        Math.abs(pointer.clientX - start.clientX) <= ReaderController.CLICK_MOVEMENT_TOLERANCE &&
        Math.abs(pointer.clientY - start.clientY) <= ReaderController.CLICK_MOVEMENT_TOLERANCE) return;
      if (event.type === "pointerup" && !this.operations.disposed) release(pointer);
    };
    this.gestureCleanup = cleanup;
    target.addEventListener("pointerup", listener);
    target.addEventListener("pointercancel", listener);
  }

  /** Tracks one drag-to-turn gesture from `pointerdown` through release.
   * Direction locks once movement clears the dead zone, then the incoming
   * page loads; if release happens first, settlement waits for that load
   * and uses the last recorded fraction. */
  private beginDragPageTurn(startEvent: PointerEvent, doc: Document): void {
    if (
      this.operations.disposed ||
      this.isTurningPage ||
      this.isLoadInFlight ||
      this.isApplyingLayout ||
      !(this.host instanceof PaginatedContentHost)
    ) {
      return;
    }
    this.gestureCleanup?.();
    const dismissedUi = this.dismissUiForPointer(startEvent);
    if (this.dismissContentSelection()) return;
    const oldHost = this.host;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const containerWidth = Math.max(1, this.width);
    // "scroll" moves the incoming page with the drag instead of only
    // revealing it underneath.
    const style = this.pageTurnAnimationStyle;
    const isScroll = style === "scroll";

    let direction: 1 | -1 | undefined;
    let newHost: PaginatedContentHost | undefined;
    let preparing = false;
    let released = false;
    let latestFraction = 0;
    let operation: ReaderOperation | undefined;
    // Built once when the incoming page is ready: "slide" needs a
    // backdrop for short-page bleed, and "rotate" needs a mask for the
    // newly exposed grown-height region.
    let turnBackdrop: HTMLDivElement | undefined;
    let turnGrowthMask: HTMLDivElement | undefined;

    const cleanupListeners = (): void => {
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerup", onPointerUp);
      doc.removeEventListener("pointercancel", onPointerUp);
      if (this.gestureCleanup === cleanupListeners) this.gestureCleanup = undefined;
    };
    this.gestureCleanup = cleanupListeners;

    const onPointerMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== startEvent.pointerId) return;
      const deltaX = moveEvent.clientX - startX;

      if (direction === undefined) {
        if (Math.abs(deltaX) < 12) {
          return;
        }
        const lockedDirection = this.physicalDirection(deltaX < 0 ? 1 : -1);
        direction = lockedDirection;
        this.suspendNarrationFollowing();
        this.isTurningPage = true;
        const turn = this.operations.begin();
        operation = turn;
        const originalStyle = oldHost.element.style.cssText;
        turn.own(() => {
          cleanupListeners();
          turnBackdrop?.remove();
          turnGrowthMask?.remove();
          if (this.host === oldHost) {
            oldHost.restoreNaturalHeight();
            oldHost.element.style.cssText = originalStyle;
          }
          if (this.containerEl) this.containerEl.style.perspective = "";
        });
        preparing = true;
        void this.prepareIncomingPage(oldHost, lockedDirection, turn)
          .then(async (prepared) => {
            turn.check();
            preparing = false;
            newHost = prepared;
            if (released) {
              await this.settleDragPageTurn(
                oldHost,
                prepared,
                lockedDirection,
                latestFraction,
                turn,
                style,
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
              // Both styles keep the full layout viewport and clip document
              // paint internally, so short pages cannot expose adjacent flow.
              //
              // "slide" and "rotate" also need their usual bleed-masking in
              // the interactive preview path.
              if (style === "rotate") {
                oldHost.suppressClipPathForAnimation();
                const naturalHeight = oldHost.element.getBoundingClientRect().height;
                oldHost.growToFullHeight(this.height);
                prepared.suppressClipPathForAnimation();
                turnGrowthMask = this.pageTurnAnimator.buildTurnGrowthMask(
                  oldHost.element,
                  naturalHeight,
                );
                if (turnGrowthMask) {
                  turnGrowthMask.style.zIndex = "2";
                  oldHost.element.parentElement?.insertBefore(
                    turnGrowthMask,
                    oldHost.element.nextSibling,
                  );
                }
              } else if (style === "slide") {
                oldHost.suppressClipPathForAnimation();
                prepared.suppressClipPathForAnimation();
                turnBackdrop = this.pageTurnAnimator.buildTurnBackdrop(oldHost.element);
                if (turnBackdrop) {
                  turnBackdrop.style.zIndex = "2";
                  oldHost.element.parentElement?.insertBefore(turnBackdrop, oldHost.element);
                }
              }
              this.pageTurnAnimator.stagePageTurn(
                oldHost.element,
                oldHost.element,
                lockedDirection,
                [],
                false,
                style,
              );
              this.pageTurnAnimator.setPageTurnTransform(
                oldHost.element,
                this.pageTurnAnimator.pageTurnPartialAmount(lockedDirection, latestFraction, style),
                latestFraction,
                [
                  ...(turnBackdrop ? [turnBackdrop] : []),
                  ...(turnGrowthMask ? [turnGrowthMask] : []),
                ],
                style,
              );
              if (isScroll) {
                prepared.element.style.transform = `translateX(${this.pageTurnAnimator.scrollDragEnterAmount(lockedDirection, latestFraction)}%)`;
              }
            } else {
              // Chapter boundary: this pass has nothing to drag into.
              this.finishTurn(turn);
            }
          })
          .catch((error) => {
            preparing = false;
            if (this.operations.owns(turn))
              this.reportTransientError(error, "open", "the next page");
            this.finishTurn(turn);
          });
      }

      moveEvent.preventDefault();
      const fraction = Math.max(0, Math.min(1, Math.abs(deltaX) / containerWidth));
      latestFraction = fraction;
      if (newHost && direction !== undefined) {
        this.pageTurnAnimator.setPageTurnTransform(
          oldHost.element,
          this.pageTurnAnimator.pageTurnPartialAmount(direction, fraction, style),
          fraction,
          [...(turnBackdrop ? [turnBackdrop] : []), ...(turnGrowthMask ? [turnGrowthMask] : [])],
          style,
        );
        if (isScroll) {
          newHost.element.style.transform = `translateX(${this.pageTurnAnimator.scrollDragEnterAmount(direction, fraction)}%)`;
        }
      }
    };

    const onPointerUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== startEvent.pointerId) return;
      cleanupListeners();
      if (direction === undefined || operation === undefined) {
        // Still a tap, not a drag; only a real release should trigger
        // click-to-navigate.
        if (upEvent.type === "pointerup" && !dismissedUi) {
          this.handleContentClick(upEvent, startX, startY, containerWidth, doc);
        }
        return;
      }
      released = true;
      if (upEvent.type === "pointercancel") latestFraction = 0;
      if (preparing) {
        // Settled by the prepare promise once the incoming page is ready.
        return;
      }
      void this.settleDragPageTurn(
        oldHost,
        newHost,
        direction,
        latestFraction,
        operation,
        style,
        turnBackdrop,
        turnGrowthMask,
      );
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
    leftThirdAction: 1 | -1 = this.physicalDirection(-1),
    rightThirdAction: 1 | -1 = this.physicalDirection(1),
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
    if (this.highlightInteraction.hasVisibleSelection(doc)) {
      return;
    }

    if ((upEvent.target as Element | null)?.closest?.("a[href], summary")) {
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
   * `newHost` is absent at chapter boundaries, and ownership prevents a
   * stale completion from clobbering a newer turn. */
  private async settleDragPageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost | undefined,
    direction: 1 | -1,
    fraction: number,
    operation: ReaderOperation,
    style: PageTurnAnimationStyle,
    turnBackdrop?: HTMLDivElement,
    turnGrowthMask?: HTMLDivElement,
  ): Promise<void> {
    try {
      operation.check();
      if (!newHost) {
        return;
      }

      // Capture before anything below disposes `oldHost`.
      const hadKeyboardFocus = this.iframeHasFocus(oldHost);
      const oldEl = oldHost.element;
      const newEl = newHost.element;
      const commit = fraction >= ReaderController.DRAG_COMMIT_THRESHOLD;
      const reduceMotion = this.pageTurnAnimator.shouldSkipPageTurnAnimation(style);
      // Only "scroll" moves `newEl` during the drag, so only it needs a
      // matching release animation here.
      const isScroll = style === "scroll";
      const extraEls = [
        ...(turnBackdrop ? [turnBackdrop] : []),
        ...(turnGrowthMask ? [turnGrowthMask] : []),
      ];

      if (!reduceMotion) {
        const remainingFraction = commit ? 1 - fraction : fraction;
        const duration = Math.max(80, Math.round(remainingFraction * 260));
        // Only the non-scroll styles animate box-shadow.
        for (const el of [oldEl, ...extraEls]) {
          el.style.transition = isScroll
            ? `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`
            : `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow ${duration}ms ease`;
        }
        if (isScroll) {
          newEl.style.transition = `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        }
        await runOwnedTransition(
          oldEl,
          () => {
            if (commit) {
              this.pageTurnAnimator.setPageTurnTransform(
                oldEl,
                this.physicalDirection(direction) * -100,
                1,
                extraEls,
                style,
              );
              if (isScroll) {
                newEl.style.transform = "translateX(0%)";
              }
            } else {
              this.pageTurnAnimator.setPageTurnTransform(oldEl, 0, 0, extraEls, style);
              if (isScroll) {
                newEl.style.transform = `translateX(${this.physicalDirection(direction) * 100}%)`;
              }
            }
          },
          duration + 250,
          operation.signal,
        );
      }
      turnBackdrop?.remove();
      turnGrowthMask?.remove();

      if (this.containerEl) {
        this.containerEl.style.perspective = "";
      }

      operation.check();

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
        newEl.style.transition = "";
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
          this.translate("scrubber.pageOfTotal", {
            current: newHost.currentPageIndex + 1,
            total: newHost.pageCount,
          }),
        );
        this.notify();
        await this.saveProgress();
      }
    } catch (error) {
      if (this.operations.owns(operation))
        this.reportTransientError(error, "open", "the next page");
    } finally {
      this.finishTurn(operation);
    }
  }

  /** Assembles the Book Details panel data from parsed OPF metadata plus
   * the stored file name and cover. The cover object URL is cached per
   * controller so repeated opens do not leak unreclaimed URLs. */
  public async getBookDetails(): Promise<BookDetails> {
    const libraryRecord = await this.library.getBookMetadata(this.bookId);

    if (this.cachedCoverUrl === undefined) {
      const coverBlob = await this.library.getCoverBlob(this.bookId);
      if (coverBlob && !this.operations.disposed) {
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
      fileSizeBytes: this.fileSizeBytes,
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

    const isbn = this.pkg.metadata.identifiers.find(
      (id) => id.scheme?.toUpperCase() === "ISBN",
    )?.value;
    const result = await fetchBookDescription(
      this.pkg.metadata.title,
      this.pkg.metadata.creator,
      isbn,
    );
    await this.library.recordDescriptionFetchResult(this.bookId, result);
  }

  /** Assembles the EPUB Inspector panel data — see `EpubInspectionSession`. */
  public getEpubInspectionData(): EpubInspectionData {
    return this.inspectionSession.getEpubInspectionData();
  }

  public getInspectorReaderBridge(): InspectorReaderBridge {
    const bridge = this.inspectionReading.create();
    return {
      ...bridge,
      showInBook: async location => {
        this.recordDiagnosticEvent({ kind: "navigation", source: "inspector", targetSpine: location.spineIndex });
        await bridge.showInBook(location);
      },
    };
  }

  public findInspectionReferences(path: string): Promise<readonly InspectorReference[]> {
    return this.inspectionSession.findReferences(path);
  }

  /** Reads one archive file's raw text for the Inspector file browser,
   * without any rendering-time parsing or rewriting. */
  public readInspectionFileText(path: string): Promise<string> {
    return this.inspectionSession.readInspectionFileText(path);
  }

  /** Builds and caches an object URL for an Inspector media preview.
   * The caller supplies the resolved `mediaType` so the preview element
   * gets a correctly typed `Blob`. */
  public getInspectionFilePreviewUrl(path: string, mediaType: string): Promise<string> {
    return this.inspectionSession.getInspectionFilePreviewUrl(path, mediaType);
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
      pageIndex: String(this.host instanceof SpreadPaginatedHost ? this.host.pageIndex :
        this.host instanceof PaginatedContentHost ? this.host.currentPageIndex : 0),
      settings: JSON.stringify({ ...this.currentLayout(), pageTheme: this.pageTheme,
        brightness: this.brightness, chromeTheme: this.chromeTheme, pageTurnAnimationStyle: this.pageTurnAnimationStyle }),
      busy: JSON.stringify({ loading: this.isLoadInFlight, turning: this.isTurningPage, layout: this.isApplyingLayout }),
    };
  }

  /** Formats the diagnostics trail and reader state as plain text. */
  public getDiagnosticsText(): string {
    return this.diagnostics.format(this.diagnosticsContext());
  }

  public recordDiagnosticEvent(event: DiagnosticEvent): void {
    if (event.kind === "setting" && event.before === event.after) return;
    this.diagnostics.recordEvent(event);
    if (event.kind === "navigation") {
      this.diagnostics.record(`navigation from spine=${this.spineIndex} page=${
        this.host instanceof SpreadPaginatedHost ? this.host.pageIndex :
          this.host instanceof PaginatedContentHost ? this.host.currentPageIndex : 0
      } busy=${!!(this.isLoadInFlight || this.isTurningPage || this.isApplyingLayout)}`);
    }
  }

  public recordDiagnosticSurfaces(surfaces: DiagnosticSurfaces): void {
    this.diagnostics.recordSurfaces(surfaces);
  }

  /** Adjacent spine item, relative to actual reading focus, not a spread's visual primary. */
  public async goToChapter(direction: 1 | -1, sourceDocument?: Document): Promise<void> {
    this.recordDiagnosticEvent({ kind: "navigation", source: "chapter" });
    if (this.operations.disposed || this.isLoadInFlight || this.isTurningPage || this.isApplyingLayout) return;
    const views = this.contentDocumentViews();
    const source = views.find(view => view.document === sourceDocument)
      ?? views.find(view => {
        const frame = view.document.defaultView?.frameElement;
        return frame && frame.ownerDocument.activeElement === frame;
      });
    const native = this.nativeReading.current();
    const nextSpineIndex = (source?.spineIndex ?? native?.spineIndex ?? this.spineIndex) + direction;
    if (nextSpineIndex < 0 || nextSpineIndex >= this.pkg.spine.length) {
      return;
    }
    this.clearNavigationHighlights();
    const destination = views.find(view => view.spineIndex === nextSpineIndex &&
      (this.isFixedLayoutHost(this.host) || view.page?.index === 0));
    if (destination) {
      const point = { spineIndex: nextSpineIndex, node: destination.document.body, offset: 0 };
      this.accessibility.focusReadingPosition(destination.document, point);
      this.nativeReading.retain(point);
      return;
    }
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
    this.clearNavigationHighlights();
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
    this.recordDiagnosticEvent({ kind: "navigation", source: "toc",
      targetSpine: this.pkg.spine.findIndex(ref => ref.manifestItem.path === navPoint.path) });
    if (!navPoint.path) {
      return;
    }
    const spineIndex = this.pkg.spine.findIndex((ref) => ref.manifestItem.path === navPoint.path);
    if (spineIndex === -1) {
      return;
    }
    this.clearNavigationHighlights();
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
    const oldStyle = oldEl.style.cssText;
    const isScroll = this.pageTurnAnimationStyle === "scroll";
    const entering = direction === -1;
    const animatingEl = entering ? newEl : oldEl;
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
        turnGrowthMaskRight = this.pageTurnAnimator.buildTurnGrowthMask(
          rightEl,
          rightNaturalHeight,
        );
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
        turnGrowthMaskLeft = this.pageTurnAnimator.buildTurnGrowthMask(
          singleAnimatingHost.element,
          naturalHeight,
        );
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
      const bands = (
        chapterLabel: string,
        primary: number | undefined,
        secondary: number | undefined,
      ) => [
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
      const oldPrimary = this.furniturePageNumber(
        oldSpineIndex,
        oldSpread.pageIndex,
        oldSpread.pageCount,
      );
      const oldSecondary =
        oldSpread.secondPageIndex !== undefined && oldPrimary !== undefined
          ? oldPrimary + 1
          : undefined;
      const newPrimary = this.furniturePageNumber(
        newSpineIndex,
        newSpread.pageIndex,
        newSpread.pageCount,
      );
      const newSecondary =
        newSpread.secondPageIndex !== undefined && newPrimary !== undefined
          ? newPrimary + 1
          : undefined;
      outgoingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(
        oldEl,
        bands(oldChapterLabel, oldPrimary, oldSecondary),
      );
      incomingOverlay = this.pageTurnAnimator.buildTurnFurnitureOverlay(
        newEl,
        bands(newChapterLabel, newPrimary, newSecondary),
      );
    } else {
      const oldSingle = previousHost as PaginatedContentHost;
      const newSingle = newHost as PaginatedContentHost;
      const oldNumber = this.furniturePageNumber(
        oldSpineIndex,
        oldSingle.currentPageIndex,
        oldSingle.pageCount,
      );
      const newNumber = this.furniturePageNumber(
        newSpineIndex,
        newSingle.currentPageIndex,
        newSingle.pageCount,
      );
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

    try {
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
    } finally {
      outgoingOverlay?.remove();
      incomingOverlay?.remove();
      turnBackdrop?.remove();
      turnGrowthMaskLeft?.remove();
      turnGrowthMaskRight?.remove();
      this.isAnimatingPageTurn = false;

      for (const host of [previousHost, newHost]) {
        if (host instanceof SpreadPaginatedHost) {
          host.restoreColumnNaturalHeight("left");
          host.restoreColumnNaturalHeight("right");
        } else host.restoreNaturalHeight();
      }

      // Reset the surviving staging wrapper to its resting state.
      stagingEl.style.transform = "";
      stagingEl.style.zIndex = "";
      stagingEl.style.boxShadow = "";
      stagingEl.style.transition = "";
      oldEl.style.cssText = oldStyle;
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
      /** Narration follows without moving keyboard focus or announcing every chapter. */
      automatic?: boolean;
      preserveFocus?: boolean;
    } = {},
  ): Promise<void> {
    if (this.operations.disposed || !this.containerEl) {
      return;
    }

    const requestedSpineIndex = spineIndex;
    this.navigationSpotlight.clear();
    this.gestureCleanup?.();
    if (this.operations.current) this.spreadCounts.clear();
    const operation = this.operations.begin();
    if (options.automatic) this.narrationOperation = operation;
    this.isTurningPage = false;
    this.error = undefined;
    this.errorSeverity = undefined;
    this.errorDetail = undefined;
    this.isLoadInFlight = true;
    const openingSize = { width: this.width, height: this.height };
    // Only show the loading spinner for slower loads. `finished`
    // prevents the timer from turning it back on after this call has
    // already completed.
    let finished = false;
    const loadingTimeout = setTimeout(() => {
      if (!finished && this.operations.owns(operation)) {
        this.isLoading = true;
        this.notify();
      }
    }, 200);
    this.diagnostics.record(
      `openSpineItem start spineIndex=${spineIndex} options=${JSON.stringify(options)}`,
    );

    try {
      // Open the new host hidden alongside the current one so failures
      // retain both the current content and its interactions until a
      // replacement is ready to commit.
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
          const spread = FixedLayoutSpreadPlanner.spreadContaining(
            this.pkg.spine,
            this.pkg.metadata.renditionLayout,
            this.pkg.pageProgressionDirection,
            this.fixedSpreadViewport(),
            spineIndex,
          );
          const fixedHost = new FixedSpreadHost(this.width, this.height);
          createdHost = fixedHost;
          stagingEl = this.stageHiddenHostElement(fixedHost.element);
          this.ownCandidate(operation, fixedHost, stagingEl);
          await fixedHost.open(
            this.contentLoader,
            this.resolver,
            spread,
            this.pkg.metadata.renditionViewport,
          );
          spineIndex = Math.min(...fixedHost.spineIndices);
        } else if (this.viewMode === "paginated" && SpreadPaginatedHost.isEligible(this.width)) {
          const host = await this.prepareSpreadForOpen(spineIndex, options, operation);
          createdHost = host;
          spineIndex = host.primarySpineIndex;
        } else {
          const host =
            this.viewMode === "paginated"
              ? new PaginatedContentHost(this.width, this.height)
              : new ScrollContentHost(this.width, this.height);
          createdHost = host;
          stagingEl = this.stageHiddenHostElement(host.element);
          this.ownCandidate(operation, host, stagingEl);
          await host.open(this.contentLoader, this.resolver, spineIndex, this.disclosures);
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

      operation.check();
      if (applyDisplaySettings) this.applyPersistedDisplaySettingsToFreshHost(newHost);

      // For chapter-boundary turns, land on the target page and apply
      // display settings before reveal so the animation shows the right
      // content. Reflowable spread hosts own their staging directly;
      // only the other host types have a separate wrapper to reveal.
      if (
        options.animateDirection !== undefined &&
        stagingEl !== undefined &&
        (previousHost instanceof PaginatedContentHost || previousHost instanceof SpreadPaginatedHost) &&
        (newHost instanceof PaginatedContentHost || newHost instanceof SpreadPaginatedHost)
      ) {
        if (options.landOnLastPage) {
          newHost.goToLastPage();
        }
        await this.animateChapterCrossingReveal(
          previousHost,
          previousWrapperEl,
          newHost,
          stagingEl,
          options.animateDirection,
          this.spineIndex,
          spineIndex,
        );
      }

      operation.check();

      this.accessibility.detach();
      this.contentInteractionCleanup?.();
      this.contentInteractionCleanup = undefined;
      this.dragCleanup?.();
      this.dragCleanup = undefined;
      this.highlightInteraction.teardownSelection();
      this.pendingSelectionRange = undefined;
      this.selectionToolbar = undefined;
      this.activeHighlight = undefined;
      this.footnotePopup = undefined;

      // Swap hosts by disposing/removing wrappers in place and revealing
      // the staging wrapper; never reparent an already-loaded host.
      previousHost?.dispose();
      previousWrapperEl?.remove();
      stagingEl?.style.setProperty("opacity", "");
      stagingEl?.style.setProperty("pointer-events", "");
      this.host = newHost;
      this.hostWrapperEl = stagingEl;
      if (newHost instanceof SpreadPaginatedHost) {
        Object.assign(newHost.element.style, {
          position: "",
          top: "",
          left: "",
          zIndex: "",
          opacity: "",
        });
      }

      this.spineIndex = spineIndex;
      this.appliedWidth = openingSize.width;
      this.appliedHeight = openingSize.height;
      this.setUpContentInteraction();
      this.setUpDragPageTurn();
      this.highlightInteraction.setUpHighlightSelection();
      this.highlightInteraction.applyHighlightsToCurrentHost();
      this.refreshBookPagination();

      if (newHost instanceof SpreadPaginatedHost) {
        this.setUpAccessibility(
          options.fragment
            ? newHost
                .contentDocuments()
                .map((doc) => doc.getElementById(options.fragment!))
                .find((el) => el !== null)
            : undefined,
          !options.automatic && !options.preserveFocus,
          requestedSpineIndex,
        );
      } else if (options.bridgeCfi) {
        this.restoreCfi(options.bridgeCfi, requestedSpineIndex);
        this.setUpAccessibility(undefined, !options.automatic && !options.preserveFocus, requestedSpineIndex);
      } else if (options.fragment) {
        const focusTarget = this.goToFragment(options.fragment);
        this.setUpAccessibility(focusTarget, !options.automatic && !options.preserveFocus);
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
        this.setUpAccessibility(undefined, !options.automatic && !options.preserveFocus, requestedSpineIndex);
      }
      if (options.bridgeCfi) {
        const view = this.contentDocumentViews().find(view => view.spineIndex === requestedSpineIndex);
        if (view) {
          const resolved = this.locatorResolver.resolveInDocument(
            new Locator(options.bridgeCfi), requestedSpineIndex, view.document,
          );
          const point = { spineIndex: requestedSpineIndex, node: resolved.node, offset: resolved.characterOffset ?? 0 };
          if (!options.automatic && !options.preserveFocus) {
            this.accessibility.focusReadingPosition(view.document, point);
          }
          this.nativeReading.retain(point);
        }
      }
      // Highlights and search ranges are page-independent, but note
      // markers snapshot pixel positions on the current page, so
      // recompute them after the final landing page is set.
      this.highlightInteraction.updateNoteMarkers();
      if (!options.automatic && !options.preserveFocus) this.announce(this.chapterLabel(spineIndex));
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
      this.diagnostics.record(`openSpineItem success spineIndex=${spineIndex}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.operations.owns(operation)) {
        // A failed replacement leaves the previous host visible; only
        // the very first load can leave the reader with nothing shown.
        this.setNotification(message, this.host ? "transient" : "blocking");
        this.errorDetail = undefined;
        this.diagnostics.record(
          `openSpineItem ERROR spineIndex=${spineIndex} message=${message} severity=${this.errorSeverity}`,
        );
      } else {
        this.diagnostics.record(
          `openSpineItem cancelled spineIndex=${spineIndex} message=${message}`,
        );
      }
      // Ignore stale-load failures; a newer `openSpineItem` call has
      // already replaced this one.
    } finally {
      finished = true;
      if (this.narrationOperation === operation) this.narrationOperation = undefined;
      clearTimeout(loadingTimeout);
      if (this.operations.owns(operation)) {
        this.operations.finish(operation);
        this.isLoading = false;
        this.isLoadInFlight = false;
        this.notify();

        this.applyPendingLayout();
      }
    }
  }

  private restoreCfi(cfi: string, spineIndex: number): void {
    const iframeDocument = this.contentDocumentViews()
      .find(view => view.spineIndex === spineIndex)?.document;
    if (!iframeDocument) {
      throw new Error("The saved position does not belong to a visible reading document.");
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
    this.narration.dispose();
    this.narrationReading.clear();
    this.navigationSpotlight.clear();
    this.preferencesCleanup?.();
    if (this.operations.disposed) return;
    this.operations.dispose();
    this.gestureCleanup?.();
    this.gestureCleanup = undefined;
    this.dismissReaderUi = undefined;
    this.contentPointerDismissals = undefined;
    // Cancellation is a settled no-op, not a layout failure to display after
    // unmount. Both queued and currently-draining setters must be released.
    for (const pending of [this.pendingLayout, this.activeLayout]) {
      for (const waiter of pending?.waiters ?? []) waiter.resolve();
    }
    this.pendingLayout = undefined;
    this.activeLayout = undefined;
    this.isLoadInFlight = false;
    this.isLoading = false;
    this.isTurningPage = false;
    this.isAnimatingPageTurn = false;
    this.isApplyingLayout = false;
    this.accessibility.detach();
    this.globalArrowKeyCleanup?.();
    this.contentInteractionCleanup?.();
    this.dragCleanup?.();
    this.highlightInteraction.teardownSelection();
    this.searchCoordinator.dispose();
    this.host?.dispose();
    this.hostWrapperEl?.remove();
    this.host = undefined;
    this.hostWrapperEl = undefined;
    if (this.containerEl) this.containerEl.style.perspective = "";
    this.containerEl = undefined;
    this.bookPagination?.dispose();
    this.hiddenMeasureContainer?.remove();
    this.resolver.dispose();
    if (this.cachedCoverUrl !== undefined) {
      URL.revokeObjectURL(this.cachedCoverUrl);
    }
    this.inspectionSession.dispose();
    this.library.close();
  }
}
