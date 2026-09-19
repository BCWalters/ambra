import {
  AccessibilityController,
  BookPaginationEstimator,
  BookSearch,
  ContentLoader,
  EpubCfi,
  EpubContainer,
  FixedContentHost,
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
  BookIdentifier,
  FontFamilyChoice,
  HighlightStyle,
  NavPoint,
  OpfMetaEntry,
  PackageDocument,
  Page,
  PageTheme,
  SearchResult,
} from "@ambra/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { Bookmark, Highlight } from "../library/LibraryDatabase.js";
import { fetchBookDescription } from "../library/BookDescriptionEnrichment.js";
import { applyHighlightRanges } from "./HighlightRenderer.js";
import { DEFAULT_CHROME_THEME } from "./chromeTheme.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";
import { DEFAULT_PAGE_TURN_ANIMATION_STYLE } from "./PageTurnAnimationStyle.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";
import type { ViewMode } from "./ViewMode.js";
import { DiagnosticsLog } from "./DiagnosticsLog.js";
import { HEADER_TEXT_TOP_OFFSET } from "./furnitureLayout.js";

/** The smallest a rendered image is allowed to be (in *both* CSS px
 * dimensions) for a click/keypress on it to open the image viewer — see
 * `ReaderController.setUpContentInteraction`. Deliberately checked
 * against the image's actual *rendered* size, not its intrinsic/natural
 * resolution: a decorative icon or a chapter-divider glyph is small on
 * the page regardless of the source file's own resolution, while a
 * genuine illustration reads as large on the page even if its source
 * file happens to be modestly sized — rendered size is what actually
 * distinguishes "worth zooming" content from decoration in practice. */
const MIN_ZOOMABLE_IMAGE_SIZE = 100;

/** Caps how many times a book with no discoverable description (an
 * obscure or self-published work neither Open Library nor Wikipedia has
 * ever heard of) gets a fresh fetch attempt on subsequent opens — after
 * this many failed attempts across however many sessions, `open()` stops
 * retrying, rather than making a network request on every single open
 * forever for a book that will plainly never have one. */
const MAX_DESCRIPTION_FETCH_ATTEMPTS = 3;

/** Raw data behind `previewSeek`'s drag-preview label — either an exact
 * book-wide page number (once `bookPagination` has fully measured the
 * book) or a coarser chapter-index fallback before that. Kept as plain
 * data rather than a pre-formatted string so `ProgressScrubber` (a React
 * component, unlike `ReaderController` itself) can format it via
 * `useTranslation()`'s `t("scrubber.pageOfTotal", ...)`/
 * `t("scrubber.chapterOfTotal", ...)` in whatever the current UI locale
 * is. */
export type PreviewPosition =
  | { readonly kind: "page"; readonly current: number; readonly total: number }
  | { readonly kind: "chapter"; readonly current: number; readonly total: number };

/** Everything the Book Details panel shows, combined from two sources
 * that otherwise live in separate layers: `PackageDocument.metadata`
 * (title/creator/description/publisher/identifiers/language — already
 * parsed and in memory, no extra I/O) and `LibraryDatabase` (the
 * original file name and cover image, which live in IndexedDB and
 * require an async read the first time they're needed — see
 * `ReaderController.getBookDetails`). */
export interface BookDetails {
  readonly title: string;
  readonly creator: string | undefined;
  readonly description: string | undefined;
  /** Set only when `description` came from `fetchBookDescription`
   * rather than the EPUB's own `dc:description` — the Book Details
   * panel shows a "via ..." attribution link whenever this is present,
   * since neither free source's terms allow presenting their content
   * without credit. */
  readonly descriptionSourceName: "Open Library" | "Wikipedia" | undefined;
  readonly descriptionSourceUrl: string | undefined;
  readonly publisher: string | undefined;
  readonly language: string;
  readonly identifiers: readonly BookIdentifier[];
  readonly fileName: string | undefined;
  /** `dc:rights` — shown as "Copyright" when the book declares one. */
  readonly rights: string | undefined;
  /** An object URL for the book's cover image, or `undefined` if it has
   * none. Valid only for the lifetime of this `ReaderController` — never
   * revoked until `dispose()`, so it's safe to keep using the same URL
   * across repeated panel opens instead of creating (and needing to
   * revoke) a fresh one every time. */
  readonly coverUrl: string | undefined;
}

/** One file inside the EPUB's underlying ZIP archive — the "file
 * structure" half of the EPUB inspection feature (issue #46), a tool
 * for EPUB *authors* checking their own book's actual on-disk shape,
 * reachable only via a dedicated button in the Book Details panel (not
 * exposed anywhere an ordinary reader would stumble into it). */
export interface EpubInspectionFile {
  readonly path: string;
  readonly size: number;
  readonly isDirectory: boolean;
  /** The manifest media type for this path, if it's a manifest resource
   * — used to classify the file (text/image/audio/video/binary) for
   * the Files tab's preview, and to pick a syntax-highlighting language
   * for text files. `undefined` for archive members outside the
   * manifest (e.g. `mimetype`, `META-INF/container.xml`), which fall
   * back to an extension-based guess (see `classifyInspectionFile`). */
  readonly mediaType: string | undefined;
}

/** One manifest entry, for the "Metadata" half of the inspection
 * feature's parsed view — plain data mirroring `ManifestItem`, since the
 * engine class itself isn't meant to be handed directly to React. */
export interface EpubInspectionManifestItem {
  readonly id: string;
  readonly path: string;
  readonly mediaType: string;
  readonly properties: readonly string[];
}

/** One spine entry, in reading order. */
export interface EpubInspectionSpineItem {
  readonly path: string;
  readonly linear: boolean;
  readonly mediaType: string;
}

/** Everything the EPUB inspection panel shows: the raw archive's file
 * list (see `EpubInspectionFile`) and a parsed view of the book's own
 * metadata/manifest/spine — deliberately *not* the raw XML source of
 * every file up front (that's fetched on demand, per selected file, via
 * `ReaderController.readInspectionFileText`, since a book can have
 * hundreds of resources and there's no reason to read them all just to
 * show the file list). Validation/accessibility-checking actions are
 * explicitly out of scope for this pass (see the issue). */
export interface EpubInspectionData {
  readonly files: readonly EpubInspectionFile[];
  readonly rootFilePath: string;
  readonly title: string;
  readonly identifiers: readonly BookIdentifier[];
  readonly language: string;
  readonly creator: string | undefined;
  /** Every `dc:creator` element (not just the first — see `creator`). */
  readonly creators: readonly string[];
  readonly publisher: string | undefined;
  readonly description: string | undefined;
  readonly renditionLayout: string;
  readonly rights: string | undefined;
  readonly date: string | undefined;
  readonly subjects: readonly string[];
  readonly contributors: readonly string[];
  /** Every `<meta>` element the OPF declares, verbatim — see
   * `OpfMetaEntry`. Surfaces publisher-specific/EPUB3-collection
   * metadata this engine has no dedicated field for. */
  readonly metaEntries: readonly OpfMetaEntry[];
  readonly manifest: readonly EpubInspectionManifestItem[];
  readonly spine: readonly EpubInspectionSpineItem[];
}

export type { ViewMode } from "./ViewMode.js";

/** A plain-data snapshot of `ReaderController`'s current state, the shape
 * React components actually read (via `useReaderController`) — they never
 * touch the controller's engine objects directly. */
export interface ReaderSnapshot {
  title: string;
  toc: readonly NavPoint[];
  spineIndex: number;
  spineLength: number;
  /** Archive-relative manifest path of the *current* spine item — lets
   * the shell (the TOC panel, specifically) highlight whichever entry
   * points at the chapter currently open, by comparing against each
   * `NavPoint.path`. `undefined` only if the current spine item somehow
   * has no manifest entry (shouldn't happen for a valid EPUB). */
  currentSpinePath: string | undefined;
  /** Archive-relative manifest path of the book's very first spine item
   * — lets the shell (`TocPanel`) detect whether the navigation
   * document's own first entry skips ahead of some unlisted front
   * matter (a cover, title page, copyright page), and if so, offer a
   * synthetic "Start of Book" entry that actually reaches it. */
  firstSpinePath: string | undefined;
  /** The TOC entry path the shell should actually highlight as
   * "current" (see `ReaderController.tocHighlightPath`) — not always
   * the same as `currentSpinePath`, since the open spine item may have
   * no TOC entry of its own at all. */
  highlightedTocPath: string | undefined;
  /** Book-wide page number of the *first* page of each spine item,
   * keyed by that item's manifest path — lets `TocPanel` show a page
   * number next to each entry. Only ever contains entries whose page
   * number is already known (`BookPaginationEstimator`'s background
   * measurement reaches every spine item eventually, but not
   * instantly — see `ReaderController.computeTocPageNumbers`), so a
   * TOC opened before that finishes simply shows page numbers for
   * whichever entries are ready so far, never a placeholder. Every TOC
   * entry linking into the same spine item (e.g. several `<h2>`
   * subsections of one chapter file) shares that item's single page
   * number — resolving a fragment's own, more precise page would need
   * actually rendering/paginating around it, not just its spine item's
   * start, which is out of scope for now. */
  tocPageNumbers: ReadonlyMap<string, number>;
  /** A human-readable label for the current chapter — the matching TOC
   * entry's own label when the navigation has one, else a generic
   * "Chapter N" (see `chapterLabel`). Used for the running header (see
   * `PageFurniture`) and live-region chapter-change announcements. */
  currentChapterLabel: string;
  viewMode: ViewMode;
  /** True when the *current* spine item resolves to fixed-layout
   * rendering (see `SpineItemRef.resolveRenditionLayout`) — independent
   * of `viewMode`, since EPUB3 allows mixing reflowable and fixed-layout
   * spine items within one book. The reader UI hides page/scroll-mode
   * controls for such items, since a fixed-layout page has no sub-page
   * position or reflow to navigate within. */
  isFixedLayout: boolean;
  pageIndex: number;
  pageCount: number;
  /** The reader's position expressed as a page number across the *whole
   * book*, not just the current chapter — see `BookPaginationEstimator`.
   * Both fields are `undefined` until enough background measurement has
   * completed to know them (see `aggregateBookPosition`): `bookPageIndex`
   * needs every spine item up to and including the current one measured,
   * `bookPageCount` needs the entire book. The shell falls back to the
   * per-chapter `pageIndex`/`pageCount` above while these are still
   * unknown, so the page number is never blank, just coarser at first. */
  bookPageIndex: number | undefined;
  bookPageCount: number | undefined;
  /** `true` when the current spine item is showing as a two-page spread
   * (see `SpreadPaginatedHost`) — the reader pane is wide enough and the
   * item is reflowable and in paginated mode. The shell shows "Pages
   * X–Y of Z" instead of "Page X of Y" when this is set. */
  isSpread: boolean;
  /** The companion page index shown alongside `pageIndex` in spread mode
   * — `undefined` outside spread mode, or if there's no companion page
   * (the chapter's last page has no facing page). */
  secondPageIndex: number | undefined;
  /** The reader pane's current width in CSS pixels — lets `PageFurniture`
   * replicate `SpreadPaginatedHost`'s own column/gutter geometry exactly
   * (via `SpreadPaginatedHost.effectiveColumnWidth`/`GUTTER_WIDTH`) so its
   * running header can center itself on each visible page in spread
   * mode, rather than guessing at where the two columns actually sit. */
  paneWidth: number;
  /** `true` for the duration of an animated page-turn transition
   * (`animatePageTurn`/`animateSpreadTurn`) — tells `PageFurniture` to
   * suspend its own static per-page header/footer rendering while the
   * controller's own imperative "turn furniture" overlay (built and
   * animated in lockstep with the actual content) is standing in for it
   * instead, so the two never render on top of each other. The
   * book-wide percentage indicator stays up throughout regardless — it
   * describes overall progress, not either individual page turning. */
  isAnimatingPageTurn: boolean;
  /** `true` when at least one saved bookmark's CFI resolves onto
   * whichever page(s) are on screen right now (see `bookmarksOnCurrentPage`)
   * — drives the toolbar's single bookmark button's pressed state (see
   * `toggleBookmark`). Always `false` for scroll mode/fixed-layout
   * content, which have no discrete "page" for a bookmark to be "on". */
  isBookmarked: boolean;
  /** Per-visible-page version of `isBookmarked` (see
   * `bookmarkFlagsForCurrentPages`) — one boolean per currently-visible
   * page, in the same primary-then-secondary order `PageFurniture`'s own
   * `columnBands` uses, so a spread with a bookmark on only one of its
   * two pages draws the on-page ribbon (issue #51) on just that one. */
  bookmarkedPages: readonly boolean[];
  /** The current reader-controlled font-size multiplier (see
   * `ReadingTheme`) — `1` is the theme's own default size. Always `1` for
   * a fixed-layout spine item, which has no reader-adjustable typography. */
  fontScale: number;
  /** The current reader-controlled line-spacing multiplier and extra
   * letter-spacing (in `em`) — see `ReadingTheme`. Same fixed-layout
   * exception as `fontScale`. */
  lineSpacing: number;
  letterSpacing: number;
  /** The reading column's own max-width, in `em` — what a reader thinks
   * of as "margins" (see `ReadingTheme.CONTENT_WIDTH_PROPERTY`). Same
   * fixed-layout exception as `fontScale`. */
  contentWidthEm: number;
  /** The current reader-controlled font family and page color theme —
   * see `ReadingTheme`. */
  fontFamily: FontFamilyChoice;
  pageTheme: PageTheme;
  /** The reader's own chrome color (toolbar/TOC/scrubber/details panel
   * — see `ChromeThemeChoice`), distinct from `pageTheme` (the book
   * page's own background). */
  chromeTheme: ChromeThemeChoice;
  /** Which page-turn animation (see `PageTurnAnimationStyle`) click/drag
   * page turns use — pure UI state, read straight off the snapshot by
   * the settings menu. */
  pageTurnAnimationStyle: PageTurnAnimationStyle;
  isLoading: boolean;
  error: string | undefined;
  /** Whether `error` is "blocking" (there's genuinely nothing readable
   * on screen — the book, or this specific spine item, failed to load
   * with no previous content still showing) or "transient" (a
   * navigation failed, but the previously-open spine item is still
   * shown, so the reader isn't actually stuck — see the doc comment on
   * where this is set, in `openSpineItem`'s catch block, for the exact
   * "did `this.host` survive" test). Drives which of `FriendlyError`'s
   * two presentations the shell shows — see issue #27. `undefined`
   * whenever `error` itself is. */
  errorSeverity: "blocking" | "transient" | undefined;
  /** Text for the shell's `aria-live` region to announce (page turns,
   * chapter changes, view-mode switches) — see `announce`. `undefined`
   * before the first navigation event. */
  announcement: string | undefined;
  /** Increments on every `announce` call, including ones with identical
   * text to the last — `aria-live` regions only announce on a DOM text
   * *change*, so the shell's `LiveRegion` keys off this to force a
   * re-announcement even when, e.g., two consecutive page turns happen
   * to produce the same "Page 3 of 12" text (impossible in practice for
   * that exact case, but real for repeated chapter-boundary turns). */
  announcementId: number;
  /** Increments on every pointerdown inside the content — see
   * `ReaderController.contentPointerActivityId`'s doc comment. The
   * shell's `Toolbar` watches this to hide itself immediately on a
   * click into the book, rather than waiting for the usual auto-hide
   * timeout. */
  contentPointerActivityId: number;
  /** The currently-open image viewer overlay's image, or `undefined` if
   * it's closed — see `ReaderController.openImageViewer`/
   * `closeImageViewer`. Only ever set for images at least
   * `MIN_ZOOMABLE_IMAGE_SIZE` px in *both* dimensions when rendered (see
   * `setUpContentInteraction`), so a reader can't accidentally "zoom" a
   * decorative icon or a chapter-divider glyph into a giant, meaningless
   * blur. */
  imageViewer: ImageViewerState | undefined;
  /** A completed, non-collapsed text selection in the primary content
   * document, positioned for a floating highlight-color picker to
   * anchor itself just above it (parent-viewport coordinates, already
   * combining the selection's own rect with the content iframe's
   * position — see `setUpHighlightSelection`). `undefined` whenever
   * there's no active selection (nothing to highlight) or the current
   * content is fixed-layout (highlighting is reflowable-content-only,
   * matching every other reader-controlled reading feature). */
  selectionToolbar: SelectionToolbarState | undefined;
  /** An existing highlight the reader just tapped/clicked on while
   * reading (see `checkExistingHighlightClick`) — positioned the same
   * way `selectionToolbar` is, for a popup offering the same actions
   * available in the Highlights panel (add/edit a note, delete)
   * directly in the book, per explicit product direction (issue #48).
   * `undefined` whenever nothing's currently "opened" this way. */
  activeHighlight: ActiveHighlightState | undefined;
  /** Every highlight in the book, across all spine items, oldest first
   * — for the Highlights tab (see `TocPanel`). Read straight from the
   * in-memory cache (`highlightsBySpineIndex`) on every snapshot, not a
   * separate async fetch the way `BookDetails`/bookmarks need — a
   * highlight is created/removed by this same controller, so the cache
   * is always already up to date by the time a new snapshot is built. */
  highlights: readonly Highlight[];
  /** The current book-wide search's query, in-flight results (appended
   * to progressively — see `BookSearch`), and whether it's still
   * running — for the "Search" tab (see `TocPanel`). `searchQuery` is
   * echoed back here (not just tracked as local component state) so the
   * search input stays in sync even if the panel unmounts/remounts. */
  searchQuery: string;
  searchResults: readonly SearchResultItem[];
  isSearching: boolean;
}

/** See `ReaderSnapshot.selectionToolbar`. */
export interface SelectionToolbarState {
  readonly left: number;
  readonly top: number;
}

/** See `ReaderSnapshot.activeHighlight`. */
export interface ActiveHighlightState {
  readonly highlight: Highlight;
  readonly left: number;
  readonly top: number;
  /** `true` only right after `addHighlight(style, true)` creates this
   * highlight (issue #60) — tells `HighlightActionPopup` to open already
   * in note-editing mode instead of its normal closed-note-editor
   * default. Never set for a highlight opened by clicking on it later
   * (`checkExistingHighlightClick`). */
  readonly openNoteEditor?: boolean;
}

/** See `ReaderSnapshot.searchResults` — a `SearchResult` (see the engine)
 * plus the chapter label its spine item resolves to, computed once when
 * the result is found (see `ReaderController.search`) rather than by
 * the shell re-deriving it from `spineIndex` on every render. */
export interface SearchResultItem extends SearchResult {
  readonly chapterLabel: string;
}

/** See `ReaderSnapshot.imageViewer`. `src` is whatever the content
 * document's own `<img>` element resolved to (already a `blob:` URL for
 * an in-book image, via `ResourceUrlResolver` — reused as-is, no need to
 * re-resolve anything), so the viewer shows the exact same image data,
 * never a re-fetch. */
export interface ImageViewerState {
  readonly src: string;
  readonly alt: string;
}

/**
 * Owns one reading session's state — which book, spine item, and view
 * mode are active — and orchestrates the engine on the React reader UI's
 * behalf: opening/switching spine items, turning pages, switching between
 * paginated and scroll mode (bridging position across the switch via a
 * CFI, since the two modes render into separate content hosts/documents),
 * relaying window resizes into the active host, persisting/restoring
 * reading position (see `resume-reading`) via the same CFI-bridging
 * mechanism, and accessibility: keyboard navigation and managed focus
 * (via `AccessibilityController`, re-attached to whichever content host's
 * iframe document is current) plus live-region announcements (via
 * `announce`, surfaced through `snapshot()` for the shell's `LiveRegion`
 * to render — this class has no DOM of its own outside the content
 * hosts' iframes). React never touches `PaginatedContentHost`/
 * `ScrollContentHost`/`LocatorResolver` etc. directly — it reads
 * `snapshot()` and calls methods here, then is notified (`subscribe`) to
 * re-render.
 */
export class ReaderController {
  private host:
    PaginatedContentHost | ScrollContentHost | FixedContentHost | SpreadPaginatedHost | undefined;
  /** The wrapper element `stageHiddenHostElement` created around
   * `this.host`'s own element — kept around purely so it can be
   * `.remove()`-d once `this.host` is replaced (see `openSpineItem`).
   * Never anything else touches its children after the initial staging:
   * critically, `this.host.element` itself is *never* moved to a
   * different parent once loaded — see `stageHiddenHostElement`'s doc
   * comment for the real, confirmed hazard that guards against. */
  private hostWrapperEl: HTMLDivElement | undefined;
  /** Defaults to "paginated", but `open` overwrites this from the saved
   * `view-mode-preference` (if any) before the controller is ever used. */
  private viewMode: ViewMode = "paginated";
  /** Defaults to `1` (the theme's own default), but `open` overwrites
   * this from the saved font-scale preference (if any) — see
   * `ReadingTheme`, `setFontScale`. */
  private fontScale = 1;
  /** Defaults to `ReadingTheme.DEFAULT_LINE_SPACING`/`DEFAULT_LETTER_SPACING`,
   * but `open` overwrites these from saved preferences (if any) — see
   * `setLineSpacing`/`setLetterSpacing`. */
  private lineSpacing = ReadingTheme.DEFAULT_LINE_SPACING;
  private letterSpacing = ReadingTheme.DEFAULT_LETTER_SPACING;
  private contentWidthEm = ReadingTheme.DEFAULT_CONTENT_WIDTH_EM;
  /** Defaults to `ReadingTheme.DEFAULT_FONT_FAMILY`, but `open` overwrites
   * this from the saved preference (if any) — see `setFontFamily`. */
  private fontFamily: FontFamilyChoice = ReadingTheme.DEFAULT_FONT_FAMILY;
  /** Defaults to `ReadingTheme.DEFAULT_PAGE_THEME`, but `open` overwrites
   * this from the saved preference (if any) — see `setPageTheme`. */
  private pageTheme: PageTheme = ReadingTheme.DEFAULT_PAGE_THEME;
  /** Defaults to `DEFAULT_CHROME_THEME`, but `open` overwrites this from
   * the saved preference (if any) — see `setChromeTheme`. Pure UI state,
   * never applied to a content document the way font/page settings are
   * (see `applyDisplaySettingsToHost`) — the shell reads it straight off
   * the snapshot via `ChromeThemeProvider`. */
  private chromeTheme: ChromeThemeChoice = DEFAULT_CHROME_THEME;
  /** Defaults to `DEFAULT_PAGE_TURN_ANIMATION_STYLE`, but `open` overwrites
   * this from the saved preference (if any) — see
   * `setPageTurnAnimationStyle`. Pure UI/interaction state, consulted by
   * `stagePageTurn`/`setPageTurnTransform` for every click- or drag-driven
   * turn. */
  private pageTurnAnimationStyle: PageTurnAnimationStyle = DEFAULT_PAGE_TURN_ANIMATION_STYLE;
  private spineIndex = 0;
  /** The most recently requested reader-pane size. */
  private width = 0;
  private height = 0;
  /** The size the *current* content host was actually last laid out at —
   * distinct from `width`/`height` above, which record the latest
   * request even while it's still deferred (see `pendingResize`). Lets
   * `resize` recognize a no-op (the deferred resize turning out to match
   * what `openSpineItem` already laid out the fresh host at) and skip a
   * pointless second re-pagination that would otherwise risk introducing
   * its own drift into the just-restored position. */
  private appliedWidth = 0;
  private appliedHeight = 0;
  /** Drives the `Spinner` overlay `ReaderApp` shows — deliberately
   * *not* set the instant a spine-item load starts (see
   * `openSpineItem`'s own `loadingTimeout`, issue #88): most loads,
   * including every chapter-boundary crossing while turning pages,
   * resolve near-instantly, and flashing a spinner for a handful of
   * milliseconds reads as more distracting than showing nothing at
   * all. `isLoadInFlight` below is the *immediate*, un-delayed
   * "something is loading" signal other internal logic (`resize`'s
   * own deferral) still needs right away — the two used to be the
   * same field, which would have made `resize` briefly blind to an
   * in-progress load during the new delay window. */
  private isLoading = false;
  /** `true` for the *entire* duration of an in-progress `openSpineItem`
   * call, set/cleared synchronously with no delay — unlike
   * `isLoading` above (the delayed, purely visual spinner flag), any
   * logic that needs to know *right now* whether it's unsafe to act
   * (currently just `resize`, deferring itself via `pendingResize`
   * rather than racing a host that's still being created) must check
   * this one instead. */
  private isLoadInFlight = false;
  /** Guards against overlapping `turnPage` calls — a real bug caught via
   * Chromium testing: rapid repeated clicks/keypresses could start a
   * second animated page turn (see `animatePageTurn`) while a first was
   * still mid-flight, each building its own new host from whatever
   * `this.host`/`this.width`/`this.height` happened to be at that moment,
   * racing to swap `this.host` and corrupting pagination state (page
   * counts changing nonsensically was the symptom). `turnPage` simply
   * ignores a call that arrives while one is already in progress, rather
   * than queuing it — consistent with how physical book pages can't be
   * turned faster than one at a time anyway. */
  private isTurningPage = false;
  /** Incremented every time a new page-turn gesture (click or drag)
   * begins, and captured by that gesture's own async operations. Before
   * any turn actually commits (mutates `this.host`), it checks its
   * captured token against the current one — a mismatch means a *newer*
   * turn has since started and finished (possible if an old drag's
   * incoming-page load is unusually slow and a fresh interaction starts
   * once `isTurningPage` clears), so the stale turn discards its own
   * work instead of clobbering newer state. A second, independent
   * safety net beyond `isTurningPage` for this same class of race. */
  private turnToken = 0;
  /** Incremented at the start of every `openSpineItem` call (chapter
   * navigation, TOC jumps, and seeking via the progress scrubber all
   * funnel through it) and captured by that call's own async work.
   * Before committing anything a stale result would otherwise clobber
   * (`this.host`, `this.error`, `this.isLoading`), every return path
   * checks its captured token against the current one — a mismatch
   * means a *newer* `openSpineItem` call has since started while this
   * one's content was still loading.
   *
   * This mattered for a real, reported bug: two overlapping
   * `openSpineItem` calls (e.g. two seeks in quick succession, before
   * the first's content finished loading) used to share one call to
   * `containerEl.replaceChildren(...)`, so the second call's own new
   * iframe *detached* whichever iframe the still-in-flight older call
   * was loading into as a side effect. A detached iframe's load
   * essentially never completes (see `SandboxedContentHost`'s own doc
   * comment on this), so the older call would sit for the full
   * `RenderingSurfaceError` timeout and then throw — even though the
   * reader had already moved on to (and successfully shown) wherever the
   * newer call navigated to. Without this guard, that stale failure
   * surfaced as a scary, confusing error message despite nothing
   * actually being wrong.
   *
   * The staged-hidden-host swap `openSpineItem` now uses (each call gets
   * its own private staging element, see `stageHiddenHostElement`) means
   * overlapping calls no longer detach each other's iframes at all — but
   * this token guard is still needed so that if *both* overlapping calls
   * succeed, only the newer one actually gets displayed. */
  private spineOpenToken = 0;
  /** A resize that arrived while an `openSpineItem` was already in
   * flight (e.g. `ResizeObserver`'s spec-mandated initial callback racing
   * with `mount`'s async load) — applying it immediately would relayout
   * a host that's mid-open, against stale or not-yet-loaded content.
   * Recorded here and applied once the in-flight open settles instead. */
  private pendingResize: { width: number; height: number } | undefined;
  private error: string | undefined;
  /** See `ReaderSnapshot.errorSeverity`. */
  private errorSeverity: "blocking" | "transient" | undefined;
  private containerEl: HTMLDivElement | undefined;
  private readonly accessibility = new AccessibilityController();
  /** See `DiagnosticsLog`'s own doc comment — a short in-memory trail of
   * recent actions, to help describe "what just happened" when
   * something goes wrong in a way that's hard to reproduce on demand. */
  private readonly diagnostics = new DiagnosticsLog();
  private announcement: string | undefined;
  private announcementId = 0;
  /** Increments on every pointerdown inside the content (any content
   * host's iframe document) — the shell's `Toolbar` watches this via
   * `snapshot()` to hide itself immediately the instant the reader
   * clicks into the book, rather than waiting for the usual auto-hide
   * timeout (see `useAutoHideChrome`). Deliberately *every* pointerdown,
   * not just ones that turn out to be a page-turn tap — a click that
   * lands on a link, or one that starts a text-selection drag, should
   * still dismiss the toolbar just as immediately. */
  private contentPointerActivityId = 0;
  /** See `ReaderSnapshot.imageViewer`. */
  private imageViewer: ImageViewerState | undefined;
  /** See `openImageViewer`'s doc comment — the element to restore focus
   * to when the viewer closes. */
  private imageViewerReturnFocusTarget: Element | undefined;
  /** Every highlight in this book, grouped by the spine index its
   * `startCfi` targets — loaded once in `open()` (see
   * `LibraryDatabase.listHighlightsForBook`) and kept in sync in-memory
   * on every add/remove, rather than re-querying IndexedDB on every
   * spine item load (`applyHighlightsToDocument` runs on *every* open,
   * unconditionally, unlike the font/theme settings this class also
   * applies, which skip the work entirely at their defaults). */
  private highlightsBySpineIndex = new Map<number, Highlight[]>();
  /** Every bookmark in this book — loaded once in `open()` and kept in
   * sync in-memory on every add/remove, exactly like `highlightsBySpineIndex`
   * (just not grouped by spine index, since there's no per-spine-item
   * application step the way highlights have — this is only ever used
   * to answer "is the current page bookmarked?", a full scan of a
   * reader's typically-small bookmark list). See `ReaderSnapshot.
   * isBookmarked`. */
  private bookmarksCache: Bookmark[] = [];
  /** See `ReaderSnapshot.selectionToolbar`. */
  private selectionToolbar: SelectionToolbarState | undefined;
  /** The live `Range` backing `selectionToolbar`, captured at the same
   * time — `addHighlight` uses this directly rather than re-querying
   * `getSelection()`, since by the time a reader has clicked a color
   * swatch in the (parent-document) toolbar, focus may have moved away
   * from the content iframe, and re-querying at that point is a needless
   * risk when the original `Range` object is still perfectly valid. */
  private pendingSelectionRange: Range | undefined;
  /** See `ReaderSnapshot.activeHighlight` — the currently "opened" *existing*
   * highlight, tapped/clicked while reading (not a fresh selection — see
   * `checkExistingHighlightClick`), with a note editor and delete action.
   * Independent of `selectionToolbar`: only one of the two is ever set at
   * once in practice (a fresh selection and clicking an existing highlight
   * are mutually exclusive user actions), but they're deliberately separate
   * fields rather than one union, since the shell's popup UI for each is
   * different enough (color swatches vs. note/delete) to not want to
   * force-fit into a shared shape. */
  private activeHighlight: ActiveHighlightState | undefined;
  /** Detaches the primary content document's selection-tracking
   * listeners (see `setUpHighlightSelection`) — same re-created-per-
   * spine-item lifecycle as `contentInteractionCleanup`. */
  private highlightSelectionCleanup: (() => void) | undefined;
  /** Book-wide full-text search — see `BookSearch`'s doc comment (no
   * pre-built index; searches spine item by spine item, progressively,
   * per explicit product direction). Created once in the constructor
   * (it only needs `contentLoader`/`locatorResolver`/`pkg.spine`, all
   * available immediately — unlike `bookPagination`, it has no
   * dependency on a live DOM/hidden measurement container at all). */
  private readonly bookSearch: BookSearch;
  private searchQuery = "";
  private searchResults: SearchResultItem[] = [];
  private isSearching = false;

  /** Detaches the current spine item's in-content interaction listeners
   * (link clicks, and the image-viewer's click/keyboard triggers) — see
   * `setUpContentInteraction`. Re-created on every `openSpineItem` call
   * since each one gets a fresh iframe/document. */
  private contentInteractionCleanup: (() => void) | undefined;
  /** Detaches the current drag-page-turn `pointerdown` listener — see
   * `setUpDragPageTurn`. Re-created every time the primary content
   * document changes, same lifecycle as `contentInteractionCleanup`. */
  private dragCleanup: (() => void) | undefined;
  /** See `ReaderSnapshot.isAnimatingPageTurn`'s doc comment. */
  private isAnimatingPageTurn = false;
  /** Background-paginates the whole book to derive book-wide page
   * numbers (see `BookPaginationEstimator`) — `undefined` until `mount`
   * creates it (it needs `hiddenMeasureContainer` to exist first). */
  private bookPagination: BookPaginationEstimator | undefined;
  /** An offscreen, zero-size-but-attached container `bookPagination`
   * mounts its measurement iframes into — real browsers don't lay out a
   * detached element, so this can't simply be left unattached, but it
   * also must never let its children become visible or affect this
   * page's own scroll extents. Created once in `mount` and torn down in
   * `dispose`. */
  private hiddenMeasureContainer: HTMLDivElement | undefined;

  private readonly listeners = new Set<() => void>();
  private cachedSnapshot: ReaderSnapshot | undefined;
  /** Lazily created by `getBookDetails`, kept for the controller's whole
   * lifetime (revoked only in `dispose`) — see `BookDetails.coverUrl`. */
  private cachedCoverUrl: string | undefined;
  /** Lazily created per-path by `getInspectionFilePreviewUrl` (issue #46
   * follow-up: image/audio/video previews in the Inspector's Files tab),
   * kept for the controller's whole lifetime and all revoked together in
   * `dispose` — same reasoning as `cachedCoverUrl`, just keyed by path
   * since the Inspector can preview many different files per session. */
  private readonly inspectionPreviewUrlCache = new Map<string, string>();
  /** The OCF rootfile path (e.g. `OEBPS/content.opf`) — set once in
   * `open`. Only used by `getEpubInspectionData` (issue #46); nothing
   * about actually reading the book needs it, since every other engine
   * object already resolves paths relative to the archive root
   * internally. */
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
    this.bookSearch = new BookSearch(contentLoader, locatorResolver, pkg.spine);
  }

  /** Opens a book from its raw bytes — from a `File` (e.g. `await
   * file.arrayBuffer()`) or, in the normal case, the book `Blob` read
   * back out of `LibraryDatabase` for whichever `bookId` the reader page
   * was opened with. `bookId`/`library` are used to persist and restore
   * reading position — see `mount`/`saveProgress`. */
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
    controller.chromeTheme = (await library.getDefaultChromeTheme()) ?? DEFAULT_CHROME_THEME;
    controller.pageTurnAnimationStyle =
      (await library.getDefaultPageTurnAnimationStyle()) ?? DEFAULT_PAGE_TURN_ANIMATION_STYLE;
    controller.reloadHighlightsCache(await library.listHighlightsForBook(bookId));
    controller.bookmarksCache = await library.listBookmarksForBook(bookId);
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

      // Book-wide numbers only make sense in paginated/spread mode — the
      // same reason `pageIndex`/`pageCount` above stay `0` in scroll
      // mode, which has no discrete "page" concept of its own to place
      // within a book-wide count either.
      let bookPageIndex: number | undefined;
      let bookPageCount: number | undefined;
      if (
        this.bookPagination &&
        (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost)
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
        isFixedLayout: this.host instanceof FixedContentHost,
        pageIndex,
        pageCount,
        bookPageIndex,
        bookPageCount,
        isSpread: this.host instanceof SpreadPaginatedHost,
        secondPageIndex:
          this.host instanceof SpreadPaginatedHost ? this.host.secondPageIndex : undefined,
        paneWidth: this.width,
        isAnimatingPageTurn: this.isAnimatingPageTurn,
        isBookmarked: this.bookmarksOnCurrentPage().length > 0,
        bookmarkedPages: this.bookmarkFlagsForCurrentPages(),
        fontScale: this.host instanceof FixedContentHost ? 1 : this.fontScale,
        lineSpacing:
          this.host instanceof FixedContentHost ? ReadingTheme.DEFAULT_LINE_SPACING : this.lineSpacing,
        letterSpacing:
          this.host instanceof FixedContentHost
            ? ReadingTheme.DEFAULT_LETTER_SPACING
            : this.letterSpacing,
        contentWidthEm:
          this.host instanceof FixedContentHost
            ? ReadingTheme.DEFAULT_CONTENT_WIDTH_EM
            : this.contentWidthEm,
        fontFamily: this.fontFamily,
        pageTheme: this.pageTheme,
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
        highlights: Array.from(this.highlightsBySpineIndex.values())
          .flat()
          .sort((a, b) => this.compareHighlightsByBookOrder(a, b)),
        searchQuery: this.searchQuery,
        searchResults: this.searchResults,
        isSearching: this.isSearching,
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

  /** Bumps `contentPointerActivityId` and notifies — see that field's
   * doc comment. */
  private bumpContentActivity(): void {
    this.contentPointerActivityId++;
    this.notify();
  }

  /** Mounts the current view mode's content host into `containerEl` and
   * opens either a previously-saved reading position for this book (see
   * `saveProgress`) or spine item 0 if there is none. Call once, after
   * the container div is available. */
  public async mount(containerEl: HTMLDivElement, width: number, height: number): Promise<void> {
    this.containerEl = containerEl;
    this.width = width;
    this.height = height;
    this.setUpBookPagination(containerEl.ownerDocument);

    // Guard against a resize (e.g. `ResizeObserver`'s spec-mandated
    // initial callback) racing with the async progress lookup below —
    // `openSpineItem` sets/clears this same flag, but there's a window
    // between calling `mount` and actually reaching `openSpineItem`
    // (while `getProgress` is in flight) where it otherwise wouldn't be
    // set yet, letting a resize slip through against a not-yet-created
    // host. This exact race was caught via real-Chromium testing.
    //
    // Shown immediately here (unlike `openSpineItem`'s own delayed
    // spinner, issue #88) — this is the very first load, with no
    // existing content on screen yet to make a brief delay
    // unnoticeable, so there's no "distracting flash" concern the way
    // there is for a fast in-session chapter turn.
    this.isLoading = true;
    this.isLoadInFlight = true;
    this.notify();

    const resumed = await this.tryResume();
    if (!resumed) {
      await this.openSpineItem(0);
    }
  }

  /** Creates the offscreen container `BookPaginationEstimator` mounts its
   * measurement iframes into, and the estimator itself. `position: fixed`
   * plus zero size and `overflow: hidden` keeps it (and every iframe
   * temporarily mounted inside it, each of which sizes itself explicitly
   * regardless of this wrapper's own size) completely invisible and
   * without affecting this page's own scroll extents — `display: none`
   * would be simpler but real browsers don't lay out `display: none`
   * content at all, which is exactly the real layout measurement this
   * exists to get. */
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
   * subscribers (so the shell's book-wide page number updates) as each
   * spine item's count becomes known. Safe to call liberally — chapter
   * navigation calls this just to reprioritize (cheap: see
   * `BookPaginationEstimator.run`'s doc comment), while a real width/
   * height/font change triggers the fuller re-measurement. Measures at
   * the *effective single-column* width — in spread mode that's each
   * column's own (narrower) width, not the whole reader pane's — so a
   * book-wide page number always agrees with what's actually on screen. */
  private refreshBookPagination(): void {
    if (!this.bookPagination || this.host instanceof FixedContentHost) {
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

  /** Looks up a saved CFI for this book and, if one resolves to a valid
   * spine item, opens directly there instead of the beginning. Returns
   * `false` (having done nothing) if there's no saved progress or it
   * can't be resolved — e.g. corrupted data, or a CFI from a differently-
   * structured version of the same book — so the caller falls back to
   * starting from the beginning rather than getting stuck. */
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

  /** Resolves the currently-displayed position to a CFI and persists it
   * as this book's reading progress. Called after every navigation action
   * settles (page turn, chapter change, TOC jump, view-mode switch); also
   * exposed as `flushProgress` for the reader page to call on
   * visibility/unload, which is the only reliable checkpoint for
   * continuous-scroll mode's position drifting between explicit actions. */
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
      // Best-effort: resume-reading is a convenience, not something that
      // should ever surface an error to the reader mid-navigation.
    }
  }

  /** See `saveProgress`. Public so the reader page can flush the current
   * position on `visibilitychange`/`pagehide`. */
  public flushProgress(): Promise<void> {
    return this.saveProgress();
  }

  /** Creates a new bookmark at the currently-displayed position (see
   * `Bookmark`'s doc comment — this always creates a fresh entry, never
   * toggles an existing one — see `toggleBookmark` for the toolbar's own
   * add-or-remove behavior), labeled with the current chapter (and, in
   * paginated/spread mode, its page number) so a bookmarks list reads as
   * more than an opaque timestamp. `undefined` if the position can't be
   * resolved to a CFI right now (mirrors `saveProgress`'s own
   * best-effort handling) — vanishingly rare in practice, but bookmarks
   * are a nice-to-have, not something worth surfacing an error for. */
  public async addBookmark(): Promise<Bookmark | undefined> {
    const position = this.host?.currentPosition();
    if (!position) {
      return undefined;
    }
    try {
      const locator = this.locatorResolver.generate(this.spineIndex, position.node, position.offset);
      const bookmark = await this.library.addBookmark(this.bookId, locator.cfi, this.bookmarkLabel());
      this.bookmarksCache.push(bookmark);
      this.announce("Bookmark added");
      this.notify();
      return bookmark;
    } catch {
      return undefined;
    }
  }

  /** Orders two highlights by book reading order (`startCfi` — see
   * `EpubCfi.compare`), falling back to creation order if either CFI
   * somehow fails to parse — same defensive reasoning as
   * `LibraryDatabase`'s own identical fallback for the initial DB fetch;
   * this is the *in-memory* cache's own sort, needed since a highlight
   * added mid-session is simply pushed onto `highlightsBySpineIndex`
   * without re-sorting (see `addHighlight`), so the cache's order can
   * drift out of book order between a fresh DB load and this. */
  private compareHighlightsByBookOrder(a: Highlight, b: Highlight): number {
    try {
      return EpubCfi.compare(a.startCfi, b.startCfi);
    } catch {
      return a.createdAt - b.createdAt;
    }
  }

  /** "Chapter — Page N" for paginated/spread mode (matching what the
   * running footer/toolbar already show), or just the chapter for
   * scroll/fixed-layout content, which has no single "page number" of
   * its own. */
  private bookmarkLabel(): string {
    const chapter = this.chapterLabel(this.spineIndex);
    if (this.host instanceof PaginatedContentHost) {
      return `${chapter} — Page ${this.host.currentPageIndex + 1}`;
    }
    if (this.host instanceof SpreadPaginatedHost) {
      return `${chapter} — Page ${this.host.pageIndex + 1}`;
    }
    return chapter;
  }

  public listBookmarks(): Promise<Bookmark[]> {
    return this.library.listBookmarksForBook(this.bookId);
  }

  public removeBookmark(id: string): Promise<void> {
    this.bookmarksCache = this.bookmarksCache.filter((bookmark) => bookmark.id !== id);
    this.notify();
    return this.library.removeBookmark(id);
  }

  /** The `{ page, document }` pair(s) actually on screen right now — both
   * columns of a two-page spread (or just the primary one, if the
   * companion is hidden — see `SpreadPaginatedHost.currentPagesAndDocuments`),
   * or the single page of ordinary paginated mode. Empty for scroll mode
   * (no discrete "page" to speak of) and fixed-layout content (no
   * reflowable text `Page`/CFI machinery applies to at all) — `toggleBookmark`/
   * `ReaderSnapshot.isBookmarked` are simply inert in both. */
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

  /** Every saved bookmark whose CFI resolves onto whichever page(s) are
   * actually on screen right now (see `currentPagesAndDocuments`) — the
   * shared basis for both `ReaderSnapshot.isBookmarked` (just "is this
   * list non-empty?") and `toggleBookmark`'s "remove every bookmark on
   * this page" behavior. A bookmark whose CFI belongs to a different
   * spine item, or otherwise fails to resolve (corrupted data, or
   * content that's changed since it was created), is silently treated
   * as "not on this page" rather than failing the whole scan — the same
   * "one bad entry shouldn't break everything else" reasoning as
   * `applyHighlightsToDocument`. */
  private bookmarksOnCurrentPage(): Bookmark[] {
    const pagesAndDocuments = this.currentPagesAndDocuments();
    if (pagesAndDocuments.length === 0 || this.bookmarksCache.length === 0) {
      return [];
    }
    const matches: Bookmark[] = [];
    for (const bookmark of this.bookmarksCache) {
      const locator = new Locator(bookmark.cfi);
      for (const { page, document } of pagesAndDocuments) {
        try {
          const resolved = this.locatorResolver.resolveInDocument(locator, this.spineIndex, document);
          if (page.containsPosition(resolved.node, resolved.characterOffset ?? 0, document)) {
            matches.push(bookmark);
            break;
          }
        } catch {
          // Different spine item, or otherwise unresolvable against this
          // document — not on this page; try the next document (spread
          // mode) or just move on to the next bookmark.
        }
      }
    }
    return matches;
  }

  /** Per-visible-page version of `bookmarksOnCurrentPage` — one boolean
   * per entry in `currentPagesAndDocuments()` (so, in the same primary-
   * then-secondary order `PageFurniture`'s own `columnBands` uses),
   * rather than one aggregate "is any of them bookmarked" answer. Backs
   * `ReaderSnapshot.bookmarkedPages`, which `PageFurniture` uses to draw
   * a bookmark ribbon on exactly the page(s) that actually have one —
   * in a two-page spread, a bookmark on the left page shouldn't paint a
   * ribbon on the right page too. */
  private bookmarkFlagsForCurrentPages(): boolean[] {
    const pagesAndDocuments = this.currentPagesAndDocuments();
    if (pagesAndDocuments.length === 0 || this.bookmarksCache.length === 0) {
      return pagesAndDocuments.map(() => false);
    }
    return pagesAndDocuments.map(({ page, document }) => {
      for (const bookmark of this.bookmarksCache) {
        const locator = new Locator(bookmark.cfi);
        try {
          const resolved = this.locatorResolver.resolveInDocument(locator, this.spineIndex, document);
          if (page.containsPosition(resolved.node, resolved.characterOffset ?? 0, document)) {
            return true;
          }
        } catch {
          // Different spine item, or otherwise unresolvable against this
          // page's document — not on this page; try the next bookmark.
        }
      }
      return false;
    });
  }

  /** The toolbar's single bookmark button, per explicit product
   * direction (issue #47): if none of the currently-visible page(s)
   * already have a bookmark, adds one at the current position (exactly
   * like `addBookmark`); if one or more already do, removes *all* of
   * them instead (a reader could in principle have created more than
   * one very close together) — either way, the button's own pressed
   * state (`ReaderSnapshot.isBookmarked`) reflects the *result*, not the
   * state beforehand. */
  public async toggleBookmark(): Promise<void> {
    const existing = this.bookmarksOnCurrentPage();
    if (existing.length === 0) {
      await this.addBookmark();
      return;
    }
    const removedIds = new Set(existing.map((bookmark) => bookmark.id));
    this.bookmarksCache = this.bookmarksCache.filter((bookmark) => !removedIds.has(bookmark.id));
    this.announce(existing.length > 1 ? "Bookmarks removed" : "Bookmark removed");
    this.notify();
    await Promise.all(existing.map((bookmark) => this.library.removeBookmark(bookmark.id)));
  }

  /** Navigates to a saved bookmark's CFI — see `goToCfi`, which does the
   * actual work (shared with `goToHighlight`, since both are "jump to a
   * previously-saved position" and differ only in where the CFI came
   * from). */
  public async goToBookmark(cfi: string): Promise<void> {
    await this.goToCfi(cfi);
  }

  /** Navigates to a highlight's starting position — see `goToBookmark`'s
   * doc comment. */
  public async goToHighlight(cfi: string): Promise<void> {
    await this.goToCfi(cfi);
  }

  /** Navigates to a search result's position — see `goToBookmark`'s doc
   * comment; a search result's CFI is just another "previously
   * generated position" like a bookmark or highlight's. */
  public async goToSearchResult(cfi: string): Promise<void> {
    await this.goToCfi(cfi);
  }

  /** (Re-)starts a book-wide search for `query`, replacing any previous
   * (possibly still in-flight) search's results — see `BookSearch` for
   * the actual progressive, non-indexed search mechanism and its
   * cancellation semantics. Results accumulate into `searchResults` as
   * they stream in, each one triggering a `notify()` so the shell's
   * results list grows live rather than waiting for the whole book to
   * finish. An empty/too-short `query` clears any existing results
   * immediately rather than running a pointless (or, for a 1-2 character
   * query, book-wide-and-meaningless) search. */
  public search(query: string): void {
    this.searchQuery = query;
    this.searchResults = [];
    this.isSearching = query.trim().length > 0;
    this.notify();
    void this.bookSearch.search(
      query,
      (result) => {
        this.searchResults = [
          ...this.searchResults,
          { ...result, chapterLabel: this.chapterLabel(result.spineIndex) },
        ];
        this.notify();
      },
      () => {
        this.isSearching = false;
        this.notify();
      },
    );
  }

  /** Parses `cfi`, finds the spine item it targets by its package steps,
   * and opens it with `cfi` as a bridging position — the same "parse,
   * find owning spine item, open with a bridging CFI" mechanism
   * `tryResume` uses for resuming a session, since resuming, jumping to
   * a bookmark, jumping to a highlight, and jumping to a search result
   * are all the same underlying operation: "go to a previously-saved
   * position." Best-effort: a CFI from a book whose structure has since
   * changed (a re-imported, edited file) silently does nothing rather
   * than crashing the reader. */
  private async goToCfi(cfi: string): Promise<void> {
    try {
      const parsed = EpubCfi.parse(cfi);
      const spineIndex = this.pkg.findSpineIndexByPackageCfiSteps(parsed.packageSteps);
      if (spineIndex === undefined) {
        return;
      }
      await this.openSpineItem(spineIndex, { bridgeCfi: cfi });
    } catch {
      // Best-effort — see doc comment.
    }
  }

  /** Sets the text the shell's `aria-live` region should announce next,
   * and bumps `announcementId` so a repeat of the same text still
   * triggers a fresh announcement (an `aria-live` region only reacts to
   * a DOM text *change*). */
  private announce(text: string): void {
    this.announcement = text;
    this.announcementId++;
  }

  /** A human-readable label for `spineIndex` — the label of the *last*
   * TOC entry (by actual resolved spine order, not TOC listing order)
   * whose target is at or before `spineIndex` (see
   * `nearestPrecedingNavPoint`), so a spine item with no TOC entry of
   * its own (an epigraph, an unlisted section between two listed
   * chapters) still gets a meaningful label — the chapter it's actually
   * part of — rather than a generic, spine-index-derived "Chapter N"
   * that routinely doesn't match the book's own numbering at all. Used
   * for the running header (see `PageFurniture`), live-region
   * chapter-change announcements, and the progress scrubber's drag
   * preview.
   *
   * Falls back to "Start of Book" specifically when the book *has* a
   * TOC but `spineIndex` is before its first real entry (a cover, title
   * page, etc. — the same section `TocPanel`'s synthetic "Start of
   * Book" entry reaches, see `tocHighlightPath`) — this was a real bug:
   * the progress scrubber previously showed "Chapter 1" for this
   * section, disagreeing with what the TOC panel itself highlighted
   * there. Only falls back further to a generic "Chapter N" when the
   * book has no TOC at all, since calling literally every page "Start
   * of Book" for such a book would be actively misleading. */
  private chapterLabel(spineIndex: number): string {
    const nearest = this.nearestPrecedingNavPoint(spineIndex);
    if (nearest) {
      return nearest.label;
    }
    const hasAnyToc = ReaderController.flattenLinkedNavPoints(this.navigation.toc.items).length > 0;
    return hasAnyToc ? "Start of Book" : `Chapter ${spineIndex + 1}`;
  }

  /** Flattens every *linked* entry out of a TOC tree, in document order
   * — a helper for `nearestPrecedingNavPoint`, which needs to consider
   * every entry as a candidate regardless of nesting depth. */
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

  /** The TOC entry (by actual resolved spine order, not TOC listing
   * order) whose target is the *last* one at or before `spineIndex` —
   * shared by `chapterLabel` and `tocHighlightPath`, both of which need
   * to treat a spine item with no TOC entry of its own as "part of
   * whichever listed chapter precedes it," not unlabeled. Returns
   * `undefined` if there's no such entry — either the book's TOC is
   * empty, or `spineIndex` is before its first real entry — callers
   * distinguish those two cases themselves, since they mean different
   * things (a generic "Chapter N" vs. "Start of Book"). */
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

  /** The TOC entry the shell should highlight as "current" — not
   * necessarily the entry whose path exactly matches the open spine
   * item (see `currentSpinePath`), since real books routinely have
   * spine items with no TOC entry of their own at all (an epigraph, a
   * dedication, an unlisted section between two listed chapters).
   * Falls back to the book's very first spine item — i.e. the
   * synthetic "Start of Book" entry `TocPanel` shows when the TOC's own
   * first entry skips ahead of it — if the reader is somewhere before
   * the first real TOC entry's target (a cover, title page, etc. that
   * isn't listed at all). Without this fallback-to-nearest-preceding-
   * entry logic, a reader on such an unlisted spine item would see
   * *nothing* at all highlighted in the TOC, a real bug reported
   * directly. */
  private tocHighlightPath(): string | undefined {
    return (
      this.nearestPrecedingNavPoint(this.spineIndex)?.path ?? this.pkg.spine[0]?.manifestItem.path
    );
  }

  /** Book-wide page number of the first page of every spine item whose
   * page count `bookPagination` has measured so far, keyed by manifest
   * path — see `ReaderSnapshot.tocPageNumbers`'s doc comment for how
   * `TocPanel` uses this. Empty before background pagination has made
   * any progress at all (e.g. scroll mode/fixed-layout-only books,
   * where `bookPagination` is never created — see `refreshBookPagination`). */
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

  /** The content document accessibility (keyboard navigation, focus
   * management) and CFI/fragment resolution key off — the *only* document
   * for every host type except `SpreadPaginatedHost`, where it's
   * specifically the primary (left) column; see that class's doc comment
   * for why the right column is deliberately excluded. */
  private primaryContentDocument(): Document | undefined {
    if (this.host instanceof SpreadPaginatedHost) {
      return this.host.primaryContentDocument();
    }
    return this.host?.element.contentDocument ?? undefined;
  }

  /** Every content document the reader might receive a click in — one for
   * every host type except `SpreadPaginatedHost`, which has two (both
   * columns get working in-content links, even though only the left one
   * participates in keyboard/focus accessibility). Defaults to
   * `this.host`, but accepts an explicit one too — see
   * `applyDisplaySettingsToHost`'s matching parameter, needed by
   * `openSpineItem`'s chapter-crossing animation (issue #83), which
   * must apply settings to the *incoming* host before `this.host` is
   * actually reassigned to it. */
  private allContentDocuments(
    host: FixedContentHost | SpreadPaginatedHost | PaginatedContentHost | ScrollContentHost | undefined = this.host,
  ): Document[] {
    if (host instanceof SpreadPaginatedHost) {
      return host.contentDocuments();
    }
    const doc = host?.element.contentDocument;
    return doc ? [doc] : [];
  }

  /** Updates the current content host's iframe title(s) to reflect the
   * current chapter — split out so an animated page turn (see
   * `animatePageTurn`), which swaps in a brand-new host without going
   * through the full `setUpAccessibility` flow, can keep it in sync too. */
  private updateContentTitle(): void {
    const title = `${this.pkg.metadata.title} — ${this.chapterLabel(this.spineIndex)}`;
    if (this.host instanceof SpreadPaginatedHost) {
      this.host.setTitle(title);
    } else if (this.host) {
      this.host.element.title = title;
    }
  }

  /** (Re-)attaches `ArrowLeft`/`ArrowRight` keyboard navigation to every
   * content document the current host has, *without* moving focus —
   * split out from `setUpAccessibility` so a plain in-chapter page turn
   * (including an animated one — see `animatePageTurn`, which swaps in a
   * brand-new host/document each turn) can re-arm keyboard navigation
   * for that new document without stealing focus away from wherever the
   * reader currently has it, consistent with page turns never forcing
   * focus (only chapter changes/TOC jumps/fragment navigation do — see
   * `setUpAccessibility`).
   *
   * Every content document (not just the primary one) gets the exact
   * same handlers — for every host type except `SpreadPaginatedHost`
   * that's one document anyway, but a spread has two, and a reader who
   * clicks into the companion (right) column to read it directly still
   * expects the arrow keys to keep turning pages from there. The
   * *managed-focus* side of accessibility (`setUpAccessibility`'s
   * `focusContent` call, screen-reader-oriented) stays scoped to the
   * primary column only — see `SpreadPaginatedHost`'s own doc comment —
   * this is purely about keyboard navigation continuing to work for
   * whichever column a sighted mouse/keyboard user happens to have
   * clicked into. */
  private reattachKeyboardNav(): void {
    const documents = this.allContentDocuments();
    if (documents.length === 0) {
      return;
    }
    const isPaginated =
      this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost;
    for (const iframeDocument of documents) {
      this.accessibility.attach(
        iframeDocument,
        {
          onNext: () => void (isPaginated ? this.turnPage(1) : this.goToChapter(1)),
          onPrevious: () => void (isPaginated ? this.turnPage(-1) : this.goToChapter(-1)),
          // Always "chapter", regardless of view mode — the Ctrl/Cmd+
          // Arrow shortcut's whole point is jumping past however many
          // pages/however much scroll remain in the current chapter, not
          // just one more increment of whatever `onNext`/`onPrevious`
          // already do.
          onNextChapter: () => void this.goToChapter(1),
          onPreviousChapter: () => void this.goToChapter(-1),
        },
        // Space keeps its native "scroll down one viewport" behavior in
        // continuous-scroll mode — already a well-understood, finer-
        // grained way to move forward through the book than a
        // hypothetical "next chapter" binding would be (see
        // `AccessibilityController.attach`'s doc comment).
        { interceptSpace: !(this.host instanceof ScrollContentHost) },
      );
    }
  }

  /** `true` if `host`'s own iframe element currently has the parent
   * document's focus — the only way its content document's keyboard
   * listener (see `reattachKeyboardNav`) could have received the very
   * keypress that triggered this turn. Used by `turnPageInternal` to
   * decide whether an animated turn's host swap needs to *restore*
   * focus afterward (see `restoreFocusAfterHostSwap`) — a real,
   * confirmed bug without this: the old iframe (which had focus) gets
   * disposed when the turn commits, and nothing else in the parent
   * document claims focus in its place, so the *next* keyboard page
   * turn's keydown goes nowhere at all, silently. */
  private iframeHasFocus(host: PaginatedContentHost): boolean {
    const iframe = host.element;
    return iframe.ownerDocument.activeElement === iframe;
  }

  /** The spread-mode equivalent of `iframeHasFocus`: which of `host`'s
   * two columns (if either) currently has focus — `0` for the primary
   * (left) column, `1` for the companion (right) one, `undefined` if
   * neither does (a mouse/touch-driven turn, which never moves focus
   * into the content at all). Both columns are checked, not just the
   * primary one, since a reader can click directly into the right
   * column and drive keyboard navigation from there (see
   * `reattachKeyboardNav`'s "every content document" scope) — an
   * animated spread turn disposes *both* of the old spread's iframes,
   * so restoring focus correctly needs to know which one (if either)
   * actually held it. */
  private spreadFocusedColumn(host: SpreadPaginatedHost): 0 | 1 | undefined {
    const docs = host.contentDocuments();
    for (let index = 0; index < docs.length; index++) {
      const iframe = docs[index]?.defaultView?.frameElement;
      if (iframe instanceof HTMLElement && iframe.ownerDocument.activeElement === iframe) {
        return index as 0 | 1;
      }
    }
    return undefined;
  }

  /** Restores keyboard focus into the *new* content host's document
   * after an animated page turn swaps it in — but only if
   * `hadKeyboardFocus` (captured via `iframeHasFocus` *before* the swap)
   * is `true`. Deliberately conditional: an ordinary mouse/touch-driven
   * turn (a click or a drag, never having moved focus into the content
   * at all) must keep the existing "page turns never force focus"
   * behavior (see `AccessibilityController.focusContent`'s callers) —
   * forcibly focusing the content on every turn regardless would be a
   * real regression for mouse users, disorienting focus on every single
   * page turn instead of only when keyboard navigation actually needs
   * it preserved. */
  private restoreFocusAfterHostSwap(hadKeyboardFocus: boolean): void {
    if (!hadKeyboardFocus) {
      return;
    }
    const doc = this.primaryContentDocument();
    if (doc) {
      this.accessibility.focusContent(doc);
    }
  }

  /** The spread-mode equivalent of `restoreFocusAfterHostSwap`: restores
   * focus into whichever column (`focusedColumn`, captured via
   * `spreadFocusedColumn` *before* the old spread was disposed) actually
   * had it — into the *same* column of the new spread, not always the
   * primary one, so a reader driving keyboard navigation from the
   * companion column doesn't get silently bounced back to the primary
   * one on every turn. A no-op if `focusedColumn` is `undefined` (an
   * ordinary mouse/touch-driven turn). */
  private restoreSpreadFocusAfterHostSwap(
    newHost: SpreadPaginatedHost,
    focusedColumn: 0 | 1 | undefined,
  ): void {
    if (focusedColumn === undefined) {
      return;
    }
    const doc = newHost.contentDocuments()[focusedColumn];
    if (doc) {
      this.accessibility.focusContent(doc);
    }
  }

  /** Re-arms keyboard navigation and the click/drag page-turn gesture on
   * the current content document, and restores focus into the content if
   * nothing else in the parent app is deliberately holding it — call
   * whenever the browser window regains OS-level focus (see the reader
   * page's own `window.addEventListener("focus", ...)`).
   *
   * The concrete, reproducible cause this guards against: a plain page
   * turn deliberately never moves focus (see `reattachKeyboardNav`'s doc
   * comment), so if the reader's last interaction before switching away
   * landed focus somewhere in the parent shell (a toolbar button, or
   * simply nowhere in particular after a click on non-focusable chrome),
   * keyboard arrow-key page-turning silently stops working — not because
   * any listener broke, but because the browser correctly delivers
   * keydown events to whatever currently has focus, which is no longer
   * inside the content iframe at all. The previously-reported symptom
   * ("page turning stops working entirely after alt-tabbing away and
   * back, until navigating via the TOC") is exactly this: TOC navigation
   * incidentally "fixes" it only because `setUpAccessibility` explicitly
   * refocuses the content as part of opening a spine item, not because
   * of anything specific to rebuilding the host.
   *
   * Refocuses content whenever the window regains focus *unless* a
   * toolbar menu/popup is currently open (Fluent UI menus manage their
   * own focus trapping — forcibly moving focus away mid-interaction
   * would be actively disruptive, not helpful). A plain toolbar button
   * merely *having* focus (the common case: the reader's last action
   * before switching away was clicking something, or simply clicking
   * back into the window landed on the toolbar's chrome rather than the
   * page itself) is deliberately *not* treated as "leave it alone" —
   * reading is this app's primary activity, so restoring keyboard
   * page-turning takes priority over a transient, non-input control
   * happening to still show a focus ring.
   *
   * Also re-arms the click/drag page-turn gesture (`setUpDragPageTurn`)
   * as a cheap additional safety net — it's already safe to call
   * repeatedly on a still-alive document (it cleans up its own previous
   * listener first), so there's no real cost to re-running it here even
   * if it turns out not to be needed for this particular regression. */
  public handleWindowRefocus(): void {
    this.reattachKeyboardNav();
    this.setUpDragPageTurn();
    this.setUpHighlightSelection();

    const iframeDocument = this.primaryContentDocument();
    const topDocument = this.containerEl?.ownerDocument;
    const menuOpen =
      topDocument?.querySelector('[role="menu"], [role="dialog"], [role="listbox"]') != null;
    if (iframeDocument && topDocument && !menuOpen) {
      this.accessibility.focusContent(iframeDocument);
    }
  }

  /** (Re-)attaches keyboard navigation to the current content host's
   * iframe document and moves focus into it — called every time a new
   * spine item is opened, since each one gets a fresh iframe/document.
   * "Next"/"previous" mean "turn a page" in paginated mode (there's no
   * page concept in scroll/fixed-layout mode, so they mean "go to the
   * next/previous chapter" there instead). */
  private setUpAccessibility(focusTarget?: Element): void {
    this.updateContentTitle();
    this.reattachKeyboardNav();

    const iframeDocument = this.primaryContentDocument();
    if (!iframeDocument) {
      return;
    }
    this.accessibility.focusContent(iframeDocument, focusTarget);
  }

  /**
   * Intercepts clicks on in-content `<a href>` links (footnotes, cross-
   * references, "see chapter N" links — extremely common in real books)
   * and routes them through the reader's own navigation instead of
   * letting the browser attempt to navigate the sandboxed iframe itself.
   * Without this, real-Chromium testing showed Chrome silently blocks the
   * navigation (the sandbox has no `allow-top-navigation` token, nor
   * could it safely be given one — that would let untrusted book content
   * navigate the whole extension tab) but *also* discards the iframe's
   * current content in the process, leaving a blank page — arguably
   * worse than doing nothing. An absolute-URI link (`http:`, `mailto:`,
   * etc.) opens in a new top-level browser tab instead, the standard
   * behavior real readers use for links that lead outside the book.
   *
   * Also wires up the image viewer: every `<img>` at least
   * `MIN_ZOOMABLE_IMAGE_SIZE` px in both rendered dimensions, and not
   * already inside a link (a linked image should still navigate like any
   * other link, not "zoom" instead), is marked focusable
   * (`tabIndex`/`role="button"`/an `aria-label`) so it's independently
   * reachable by keyboard, not just mouse — clicking it, or pressing
   * Enter/Space while it's focused, opens `ReaderController.
   * openImageViewer`. An image not yet finished loading at scan time
   * (rare, but the content host's own render/pagination pass doesn't
   * strictly wait for every image decode) is re-checked once its `load`
   * event fires, rather than being silently skipped.
   *
   * Attached to every document `allContentDocuments()` returns — in
   * spread mode, that's both columns, so a link (or a zoomable image) on
   * the companion (right) page works exactly like one on the primary
   * (left) page, even though only the left page participates in
   * keyboard/focus accessibility.
   */
  private setUpContentInteraction(): void {
    const currentPath = this.pkg.spine[this.spineIndex]?.manifestItem.path;
    const documents = this.allContentDocuments();
    if (documents.length === 0 || !currentPath) {
      return;
    }

    const focusDocument = this.primaryContentDocument();
    const cleanups: Array<() => void> = [];

    const isZoomableImage = (element: Element): element is HTMLImageElement => {
      // Deliberately `localName` rather than `instanceof HTMLImageElement`
      // (`element` was obtained from the *content iframe's own* document,
      // a separate JS realm with its own `HTMLImageElement` constructor;
      // `instanceof` compares against *this* (parent) realm's
      // constructor, which fails for every cross-realm element regardless
      // of its actual type) — and rather than `tagName`, which preserves
      // its as-authored case for an XML/XHTML document (content here is
      // parsed as `application/xhtml+xml`, so a real book's `<img>`
      // reads back as `"img"`, not the `"IMG"` a plain HTML document
      // would normalize it to). `localName` is spec-guaranteed lowercase
      // in both cases — both were real bugs caught via testing in real
      // Chromium.
      if (element.localName !== "img" || element.closest("a[href]")) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width >= MIN_ZOOMABLE_IMAGE_SIZE && rect.height >= MIN_ZOOMABLE_IMAGE_SIZE;
    };

    for (const iframeDocument of documents) {
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
          // An absolute URI (http:, https:, mailto:, ...) — not a path
          // within this book at all.
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }

        const { fragment } = splitHrefFragment(href);
        const targetPath = resolveEpubPath(currentPath, href);
        const targetSpineIndex = this.pkg.spine.findIndex(
          (ref) => ref.manifestItem.path === targetPath,
        );
        if (targetSpineIndex === -1) {
          // Points at something that isn't a spine item (e.g. a resource
          // the manifest declares but the spine doesn't include) — nothing
          // sensible to navigate to; already prevented default above.
          return;
        }

        if (targetSpineIndex === this.spineIndex) {
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

      // Keyboard equivalent of the click handler above, for a focused
      // zoomable image (see `markZoomableImage` below, which is what
      // makes an image focusable in the first place) — Enter and Space
      // are both conventional "activate" keys for a `role="button"`
      // element, matching how a real `<button>` responds to either.
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

      // Marks an already-loaded, currently-eligible image as focusable/
      // announced — re-invoked from the `load` listener below for an
      // image that wasn't finished loading (so its rendered size wasn't
      // known yet) at the time of the initial scan.
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

      // Hides the toolbar immediately on any click into the content —
      // see `contentPointerActivityId`'s doc comment. Attached here
      // (rather than only alongside the paginated/spread click-to-
      // navigate listeners) so this also covers scroll mode and fixed-
      // layout content, which have no page-turn gesture of their own but
      // should still dismiss the toolbar the instant the reader clicks
      // into the page.
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

  /** Relays a resize (e.g. the reader pane changing size, or the user
   * changing font size in a future settings panel) into the active
   * content host, which preserves reading position across the relayout —
   * see `PaginatedContentHost.relayout`/`ScrollContentHost.resize`. A
   * no-op if the size hasn't actually changed (e.g. a deferred resize —
   * see `pendingResize` — turns out to match what was already used),
   * avoiding pointless re-pagination that could otherwise introduce its
   * own drift in the restored position. Crossing the two-page-spread
   * width threshold (see `shouldSwitchSpreadMode`) is handled as a full
   * host swap rather than a plain relayout, since a spread is
   * architecturally two iframes, not one. */
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
    } else if (this.host instanceof ScrollContentHost || this.host instanceof FixedContentHost) {
      this.host.resize(width, height);
    }
    this.refreshBookPagination();
    this.notify();
  }

  /** `true` if the reader pane just crossed the two-page-spread width
   * threshold (`SpreadPaginatedHost.isEligible`) while in paginated mode
   * on a reflowable spine item. Fixed-layout content and scroll mode
   * never use a spread — see `SpreadPaginatedHost`'s doc comment. */
  private shouldSwitchSpreadMode(width: number): boolean {
    if (this.viewMode !== "paginated" || this.host instanceof FixedContentHost) {
      return false;
    }
    return SpreadPaginatedHost.isEligible(width) !== this.host instanceof SpreadPaginatedHost;
  }

  /** Bridges the current reading position via CFI and reopens the
   * current spine item at the (already-updated) `width`/`height` — used
   * when a resize crosses the spread-mode width threshold, the same
   * CFI-bridging `setViewMode` uses for the paginated/scroll switch. */
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

    // Bridge position across the switch: the two modes render into
    // separate content hosts (separate iframes/documents), so a raw DOM
    // position from the old one is meaningless in the new one — resolve
    // it through a CFI instead, exactly the scenario CFI exists for.
    const position = this.host?.currentPosition();
    const bridgeCfi = position
      ? this.locatorResolver.generate(this.spineIndex, position.node, position.offset).cfi
      : undefined;

    this.viewMode = mode;
    await this.library.setDefaultViewMode(mode);
    await this.openSpineItem(this.spineIndex, { bridgeCfi });
    this.announce(mode === "paginated" ? "Paginated view" : "Scroll view");
    this.notify();
  }

  /** Sets the reader-controlled font-size multiplier (clamped to
   * `ReadingTheme`'s supported range), persists it as the new default for
   * future chapters/sessions, and re-measures the current content host at
   * the new size — the same relayout path a window resize uses, so
   * reading position is preserved across the font-size change exactly the
   * way it is across a resize (see `PaginatedContentHost.relayout`/
   * `ScrollContentHost.resize`). A no-op for a fixed-layout spine item,
   * which has no reader-adjustable typography. */
  public async setFontScale(scale: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_FONT_SCALE,
      Math.max(ReadingTheme.MIN_FONT_SCALE, scale),
    );
    if (clamped === this.fontScale || this.host instanceof FixedContentHost) {
      return;
    }
    this.fontScale = clamped;
    await this.library.setDefaultFontScale(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    this.notify();
    await this.saveProgress();
  }

  /** Sets the reader-controlled font family, persists it, and re-measures
   * the current content host — a different typeface has different
   * metrics, so this reflows content the same way a font-scale change
   * does. A no-op for a fixed-layout spine item. */
  public async setFontFamily(family: FontFamilyChoice): Promise<void> {
    if (family === this.fontFamily || this.host instanceof FixedContentHost) {
      return;
    }
    this.fontFamily = family;
    await this.library.setDefaultFontFamily(family);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    this.notify();
    await this.saveProgress();
  }

  /** Sets the reader-controlled line-spacing multiplier (clamped to
   * `ReadingTheme`'s supported range) — same "persist, re-measure,
   * refresh book-wide pagination" shape as `setFontScale`, since a
   * taller/shorter line-height reflows content exactly the same way a
   * font-size change does. A no-op for a fixed-layout spine item. */
  public async setLineSpacing(spacing: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_LINE_SPACING,
      Math.max(ReadingTheme.MIN_LINE_SPACING, spacing),
    );
    if (clamped === this.lineSpacing || this.host instanceof FixedContentHost) {
      return;
    }
    this.lineSpacing = clamped;
    await this.library.setDefaultLineSpacing(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    this.notify();
    await this.saveProgress();
  }

  /** Sets the reader-controlled extra letter-spacing (clamped to
   * `ReadingTheme`'s supported range) — same shape as `setLineSpacing`;
   * wider tracking reflows content (it changes where lines break) just
   * like line-height does. A no-op for a fixed-layout spine item. */
  public async setLetterSpacing(spacing: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_LETTER_SPACING,
      Math.max(ReadingTheme.MIN_LETTER_SPACING, spacing),
    );
    if (clamped === this.letterSpacing || this.host instanceof FixedContentHost) {
      return;
    }
    this.letterSpacing = clamped;
    await this.library.setDefaultLetterSpacing(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    this.notify();
    await this.saveProgress();
  }

  /** Sets the reader-controlled reading column width in `em` (clamped to
   * `ReadingTheme`'s supported range) — what a reader thinks of as
   * "margins" (see `ReadingTheme.CONTENT_WIDTH_PROPERTY`). Same shape as
   * `setLineSpacing`; a narrower/wider column reflows content just like
   * line-height/letter-spacing do. A no-op for a fixed-layout spine
   * item, whose page design is fixed/pixel-precise. */
  public async setContentWidth(widthEm: number): Promise<void> {
    const clamped = Math.min(
      ReadingTheme.MAX_CONTENT_WIDTH_EM,
      Math.max(ReadingTheme.MIN_CONTENT_WIDTH_EM, widthEm),
    );
    if (clamped === this.contentWidthEm || this.host instanceof FixedContentHost) {
      return;
    }
    this.contentWidthEm = clamped;
    await this.library.setDefaultContentWidth(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    this.notify();
    await this.saveProgress();
  }

  /** Sets the reader-controlled page color theme and persists it. Unlike
   * font scale/family, this never needs a relayout — colors don't affect
   * line-wrapping. A no-op for a fixed-layout spine item. */
  public async setPageTheme(theme: PageTheme): Promise<void> {
    if (theme === this.pageTheme || this.host instanceof FixedContentHost) {
      return;
    }
    this.pageTheme = theme;
    await this.library.setDefaultPageTheme(theme);
    this.applyDisplaySettingsToHost({ relayout: false });
    this.notify();
  }

  /** Sets the reader's own chrome color and persists it. Pure UI state —
   * unlike `setPageTheme`/`setFontFamily`, this never touches a content
   * document at all (no fixed-layout exception needed either, since it
   * has nothing to do with the book's own content), so it's just a
   * state update and a notify. */
  public async setChromeTheme(theme: ChromeThemeChoice): Promise<void> {
    if (theme === this.chromeTheme) {
      return;
    }
    this.chromeTheme = theme;
    await this.library.setDefaultChromeTheme(theme);
    this.notify();
  }

  /** Sets which animation click/drag page turns use (see
   * `PageTurnAnimationStyle`) — same "pure UI state, just persist and
   * notify" shape as `setChromeTheme`, since it never touches a content
   * document either. */
  public async setPageTurnAnimationStyle(style: PageTurnAnimationStyle): Promise<void> {
    if (style === this.pageTurnAnimationStyle) {
      return;
    }
    this.pageTurnAnimationStyle = style;
    await this.library.setDefaultPageTurnAnimationStyle(style);
    this.notify();
  }

  /** Opens the image viewer overlay on a specific image — called by the
   * click/keyboard handlers `setUpContentInteraction` attaches to
   * qualifying `<img>` elements. Pure UI state, not persisted (there's
   * nothing meaningful to resume — closing and reopening the same image
   * is a fresh, cheap action, unlike a reading position).
   *
   * `sourceElement` (the image itself) is remembered so `closeImageViewer`
   * can restore focus back onto it — without this, a real, reported bug:
   * the viewer's own close button lives in the *parent* document, so
   * once it (or the backdrop) is what has focus at close time, that
   * focus stays in the parent unless something explicitly moves it back
   * — and `AccessibilityController`'s Left/Right keyboard navigation is
   * attached to the *content* document specifically (keyboard events
   * don't bubble out of an iframe), so a reader who'd been turning pages
   * with the keyboard would suddenly find arrow keys silently doing
   * nothing at all after closing the viewer. */
  public openImageViewer(src: string, alt: string, sourceElement: Element): void {
    this.imageViewer = { src, alt };
    this.imageViewerReturnFocusTarget = sourceElement;
    this.notify();
  }

  /** Closes the image viewer overlay, if open, and restores focus back
   * onto whichever image opened it (see `openImageViewer`'s doc comment)
   * — falling back to the content document's own managed-focus default
   * (its `body`) if that element is no longer around (e.g. the chapter
   * changed while the viewer happened to be open). */
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

  /** Restores focus to the current content document's own managed-focus
   * default (see `AccessibilityController.focusContent`) — call whenever
   * a parent-document overlay (the TOC panel, Book Details panel) closes
   * *without* itself navigating anywhere (a TOC entry click, unlike a
   * bare close, already moves focus into the target content as part of
   * its own navigation — see `goToNavPoint`/`setUpAccessibility`).
   *
   * This was a real, reported bug: closing either panel with the mouse
   * left focus stranded on the panel's own (parent-document) close
   * button, and since `AccessibilityController`'s Left/Right keyboard
   * navigation is attached to the *content* document specifically
   * (keyboard events don't bubble out of an iframe), arrow keys silently
   * did nothing afterward. See `AccessibilityController.focusContent`'s
   * own doc comment for the actual underlying fix (focusing the iframe
   * *element itself*, not just something inside it) — this method is
   * just the call site for the "closed without navigating" case. */
  public restoreContentFocus(): void {
    const iframeDocument = this.primaryContentDocument();
    if (iframeDocument) {
      this.accessibility.focusContent(iframeDocument);
    }
  }

  /** Writes the current font scale/family/line-spacing/letter-spacing and
   * page theme onto every current content document as CSS custom
   * properties (see `ReadingTheme.applyFontScale`/`applyFontFamily`/
   * `applyLineSpacing`/`applyLetterSpacing`/`applyPageTheme`) and, if
   * `relayout` is set, re-measures at the current size — every spine
   * item load applies all of these the same way (see `openSpineItem`),
   * so a book opened mid-session at non-default settings looks correct
   * immediately, not just after the first explicit change. No-op for
   * fixed-layout content, which never gets the reading theme at all. In
   * spread mode, both columns are independent documents and need the
   * properties set individually before the shared relayout re-measures
   * them together.
   *
   * Defaults to `this.host`, but accepts an explicit one too — needed
   * by `openSpineItem`'s chapter-crossing turn animation (issue #83),
   * which must apply settings to the *incoming* host, correctly
   * positioned, before the turn actually plays and well before
   * `this.host` is reassigned to it (see `allContentDocuments`'s
   * matching parameter). */
  private applyDisplaySettingsToHost(
    options: { relayout: boolean },
    host: FixedContentHost | SpreadPaginatedHost | PaginatedContentHost | ScrollContentHost | undefined = this.host,
  ): void {
    if (!host || host instanceof FixedContentHost) {
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

  /** Applies the persisted font scale/family/line-spacing/letter-spacing/
   * content-width/page theme to a freshly-opened host (see
   * `openSpineItem`) — every spine item load needs this, not just
   * explicit in-session changes, so a book opened mid-session at
   * non-default settings looks correct immediately. Skips the (fairly
   * expensive) relayout pass entirely when every setting is already at
   * its theme-default value, since the freshly-opened host was already
   * paginated at those defaults by its own `open()` call.
   *
   * Defaults to `this.host` (the normal case — see
   * `applyDisplaySettingsToHost`'s matching parameter), but accepts an
   * explicit one for `openSpineItem`'s chapter-crossing animation
   * (issue #83), which needs this applied to the *incoming* host before
   * `this.host` actually becomes it. */
  private applyPersistedDisplaySettingsToFreshHost(
    host: FixedContentHost | SpreadPaginatedHost | PaginatedContentHost | ScrollContentHost | undefined = this.host,
  ): void {
    const needsRelayout =
      this.fontScale !== 1 ||
      this.fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY ||
      this.lineSpacing !== ReadingTheme.DEFAULT_LINE_SPACING ||
      this.letterSpacing !== ReadingTheme.DEFAULT_LETTER_SPACING ||
      this.contentWidthEm !== ReadingTheme.DEFAULT_CONTENT_WIDTH_EM;
    if (needsRelayout || this.pageTheme !== ReadingTheme.DEFAULT_PAGE_THEME) {
      this.applyDisplaySettingsToHost({ relayout: needsRelayout }, host);
    }
  }

  /** Rebuilds `highlightsBySpineIndex` from a flat list (see `open`'s
   * initial load, and every add/remove afterwards) — grouping once here
   * keeps `applyHighlightsToCurrentHost` a simple map lookup rather than
   * a linear filter on every single spine item load. */
  private reloadHighlightsCache(all: readonly Highlight[]): void {
    this.highlightsBySpineIndex = new Map();
    for (const highlight of all) {
      const existing = this.highlightsBySpineIndex.get(highlight.spineIndex);
      if (existing) {
        existing.push(highlight);
      } else {
        this.highlightsBySpineIndex.set(highlight.spineIndex, [highlight]);
      }
    }
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
    const highlights = this.highlightsBySpineIndex.get(spineIndex);
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
   * this always at least attempts the (cheap, no-op-if-empty) lookup). */
  private applyHighlightsToCurrentHost(): void {
    if (this.host instanceof FixedContentHost) {
      return;
    }
    for (const doc of this.allContentDocuments()) {
      this.applyHighlightsToDocument(doc, this.spineIndex);
    }
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
  private setUpHighlightSelection(): void {
    this.highlightSelectionCleanup?.();
    this.highlightSelectionCleanup = undefined;
    if (this.host instanceof FixedContentHost) {
      return;
    }
    const documents = this.allContentDocuments();
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
          this.pendingSelectionRange = undefined;
          this.selectionToolbar = undefined;
          return false;
        }
        const range = selection.getRangeAt(0);
        const rangeRect = range.getBoundingClientRect();
        if (rangeRect.width === 0 && rangeRect.height === 0) {
          // A selection can momentarily report a zero-size rect (e.g. right
          // as it's being cleared) — treat exactly like "no selection"
          // rather than showing a toolbar with nowhere sensible to anchor.
          this.pendingSelectionRange = undefined;
          this.selectionToolbar = undefined;
          return false;
        }
        const iframeRect = iframeEl.getBoundingClientRect();
        this.pendingSelectionRange = range.cloneRange();
        this.selectionToolbar = {
          left: iframeRect.left + rangeRect.left + rangeRect.width / 2,
          top: iframeRect.top + rangeRect.top,
        };
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
          this.activeHighlight = undefined;
        }
        this.notify();
      };
      const onKeyUp = (): void => {
        updateFromSelection();
        this.notify();
      };

      doc.addEventListener("pointerup", onPointerUp);
      doc.addEventListener("keyup", onKeyUp);
      cleanups.push(() => {
        doc.removeEventListener("pointerup", onPointerUp);
        doc.removeEventListener("keyup", onKeyUp);
      });
    }
    this.highlightSelectionCleanup = () => {
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
  private findHighlightAtPoint(doc: Document, clientX: number, clientY: number): Highlight | undefined {
    const highlights = this.highlightsBySpineIndex.get(this.spineIndex);
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
      const range = this.resolveHighlightRange(highlight, this.spineIndex, doc);
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
      this.activeHighlight = undefined;
      return;
    }
    const range = this.resolveHighlightRange(highlight, this.spineIndex, doc);
    const iframeRect = iframeEl.getBoundingClientRect();
    this.activeHighlight = {
      highlight,
      left: iframeRect.left + clientX,
      top: iframeRect.top + (range?.getBoundingClientRect().top ?? clientY),
    };
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
    for (const doc of this.allContentDocuments()) {
      doc.getSelection()?.removeAllRanges();
    }
    this.pendingSelectionRange = undefined;
    this.selectionToolbar = undefined;
    this.notify();
  }

  /** Closes the "existing highlight" popup opened by clicking on a
   * highlight while reading (see `checkExistingHighlightClick`) — an
   * explicit dismiss (clicking elsewhere, Escape), or after acting on it
   * (deleting it, saving/canceling a note edit). */
  public dismissActiveHighlight(): void {
    this.activeHighlight = undefined;
    this.notify();
  }

  /** Clears the current error/severity — the shell calls this once a
   * transient error's own toast has been visible long enough (see
   * `FriendlyError`), or on an explicit dismiss. Harmless to call for a
   * blocking error too (there's no separate "retry" state to preserve),
   * though the shell doesn't currently auto-dismiss those. */
  public dismissError(): void {
    this.error = undefined;
    this.errorSeverity = undefined;
    this.notify();
  }

  /** Creates a highlight from the selection `setUpHighlightSelection`
   * last captured (see `pendingSelectionRange`), persists it, applies it
   * immediately (so it renders without waiting for a reload), and
   * dismisses the selection toolbar. A no-op if there's no pending
   * selection (the toolbar isn't showing, or it's since been dismissed)
   * — defensive, since the shell should never be able to call this
   * without one, but never worth crashing over if it somehow did.
   *
   * `openNoteEditor` (issue #60: "add a note directly from the
   * selection menu — no need to highlight, then click, then add a
   * note") skips straight to `activeHighlight`'s note-editing mode for
   * the highlight just created, at the same position the selection
   * toolbar itself was anchored to — the reader never has to go find
   * and re-click the highlight they just made. */
  public async addHighlight(style: HighlightStyle, openNoteEditor = false): Promise<void> {
    const range = this.pendingSelectionRange;
    if (!range || this.host instanceof FixedContentHost) {
      return;
    }
    // Captured before `dismissSelectionToolbar` (in `finally`, below)
    // clears `this.selectionToolbar` — the note editor opens at the
    // exact same anchor point the selection toolbar itself used.
    const anchor = this.selectionToolbar;
    try {
      const startLocator = this.locatorResolver.generate(this.spineIndex, range.startContainer, range.startOffset);
      const endLocator = this.locatorResolver.generate(this.spineIndex, range.endContainer, range.endOffset);
      const highlight = await this.library.addHighlight({
        bookId: this.bookId,
        spineIndex: this.spineIndex,
        startCfi: startLocator.cfi,
        endCfi: endLocator.cfi,
        style,
        text: range.toString(),
        note: undefined,
      });
      const existing = this.highlightsBySpineIndex.get(this.spineIndex);
      if (existing) {
        existing.push(highlight);
      } else {
        this.highlightsBySpineIndex.set(this.spineIndex, [highlight]);
      }
      this.applyHighlightsToCurrentHost();
      this.announce("Highlight added");
      if (openNoteEditor && anchor) {
        this.activeHighlight = { highlight, left: anchor.left, top: anchor.top, openNoteEditor: true };
      }
    } catch {
      // Best-effort — see `saveProgress`'s identical reasoning; a failed
      // highlight save shouldn't surface an error to the reader mid-flow.
    } finally {
      this.dismissSelectionToolbar();
    }
  }

  /** Removes a highlight (from the Highlights list — see `TocPanel`) and
   * re-applies whatever's left to the current host if it belonged to the
   * spine item currently open. */
  public async removeHighlight(id: string): Promise<void> {
    await this.library.removeHighlight(id);
    for (const [spineIndex, highlights] of this.highlightsBySpineIndex) {
      const index = highlights.findIndex((highlight) => highlight.id === id);
      if (index !== -1) {
        highlights.splice(index, 1);
        if (spineIndex === this.spineIndex) {
          this.applyHighlightsToCurrentHost();
        }
        break;
      }
    }
    if (this.activeHighlight?.highlight.id === id) {
      this.activeHighlight = undefined;
    }
    this.notify();
  }

  /** Attaches, edits, or clears (pass `undefined`) a note on an existing
   * highlight — the annotations feature (#25). Never touches rendering
   * (a note has no visual presence of its own on the highlighted text
   * itself, only in the Highlights list — see `TocPanel`), so unlike
   * `removeHighlight` this never needs `applyHighlightsToCurrentHost`. */
  public async setHighlightNote(id: string, note: string | undefined): Promise<void> {
    for (const highlights of this.highlightsBySpineIndex.values()) {
      const index = highlights.findIndex((highlight) => highlight.id === id);
      if (index !== -1) {
        const updated: Highlight = { ...highlights[index]!, note };
        await this.library.updateHighlight(updated);
        highlights[index] = updated;
        if (this.activeHighlight?.highlight.id === id) {
          this.activeHighlight = { ...this.activeHighlight, highlight: updated };
        }
        this.notify();
        return;
      }
    }
  }

  /** Changes an existing highlight's color/style directly from the
   * inline action popup (issue #79) — previously the only way to
   * change a highlight's color was to delete it and re-select the text
   * to make a new one. Mirrors `setHighlightNote`'s find-update-persist
   * shape, but — unlike a note, which has no visual presence on the
   * highlighted text itself — a style change *does* need
   * `applyHighlightsToCurrentHost` to actually repaint it, and only
   * when the highlight belongs to the spine item currently open (the
   * Highlights list can act on a highlight from any spine item, most of
   * which have no live host to repaint right now). */
  public async setHighlightStyle(id: string, style: HighlightStyle): Promise<void> {
    for (const [spineIndex, highlights] of this.highlightsBySpineIndex) {
      const index = highlights.findIndex((highlight) => highlight.id === id);
      if (index !== -1) {
        const updated: Highlight = { ...highlights[index]!, style };
        await this.library.updateHighlight(updated);
        highlights[index] = updated;
        if (this.activeHighlight?.highlight.id === id) {
          this.activeHighlight = { ...this.activeHighlight, highlight: updated };
        }
        if (spineIndex === this.spineIndex) {
          this.applyHighlightsToCurrentHost();
        }
        this.notify();
        return;
      }
    }
  }

  /** Turns one page (or one spread, in spread mode) in paginated mode. In
   * scroll mode, this is a no-op — scrolling is continuous and has no
   * discrete "page" concept; use native scrolling within the content host
   * instead. Crossing the first/last page of the current spine item
   * advances to the adjacent chapter automatically. A single-column
   * paginated turn plays a book-like flip animation (see
   * `animatePageTurn`); spread turns and chapter-boundary turns are
   * instant for now. Ignored entirely if a turn is already in progress —
   * see `isTurningPage`. */
  public async turnPage(direction: 1 | -1): Promise<void> {
    if (this.isTurningPage) {
      return;
    }
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
    // A page turn (unlike a chapter change — see `openSpineItem`, which
    // already does this) doesn't rebuild the content document, so
    // nothing else naturally invalidates a still-open highlight action
    // popup — left alone, it would keep referencing a highlight that,
    // after this turn, is no longer on screen at all (issue #62's
    // second half: this is the fallback for any page turn that manages
    // to happen anyway, not just the specific click-race the same issue
    // also reports and `handleContentClick` now prevents directly).
    this.activeHighlight = undefined;
    let moved: boolean;
    let announcement: string;
    if (this.host instanceof SpreadPaginatedHost) {
      // Captured *before* the old spread is disposed below (inside
      // `animateSpreadTurn`) — mirrors the single-page path's own
      // `iframeHasFocus`/`restoreFocusAfterHostSwap` reasoning, just
      // across whichever of the two columns actually had focus (see
      // `spreadFocusedColumn`'s doc comment: a reader can drive keyboard
      // navigation from either column, not just the primary one).
      const focusedColumn = this.spreadFocusedColumn(this.host);
      const animatedSpread = await this.animateSpreadTurn(this.host, direction);
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
        this.updateContentTitle();
        this.reattachKeyboardNav();
        this.setUpContentInteraction();
        this.setUpDragPageTurn();
        this.setUpHighlightSelection();
        this.applyHighlightsToCurrentHost();
        this.restoreSpreadFocusAfterHostSwap(animatedSpread, focusedColumn);
        const second = animatedSpread.secondPageIndex;
        this.announce(
          second !== undefined
            ? `Pages ${animatedSpread.pageIndex + 1}–${second + 1} of ${animatedSpread.pageCount}`
            : `Page ${animatedSpread.pageIndex + 1} of ${animatedSpread.pageCount}`,
        );
        this.notify();
        await this.saveProgress();
        return;
      }
      moved = direction === 1 ? this.host.nextSpread() : this.host.previousSpread();
      const second = this.host.secondPageIndex;
      announcement =
        second !== undefined
          ? `Pages ${this.host.pageIndex + 1}–${second + 1} of ${this.host.pageCount}`
          : `Page ${this.host.pageIndex + 1} of ${this.host.pageCount}`;
    } else if (this.host instanceof PaginatedContentHost) {
      // Captured *before* the old host is disposed below (inside
      // `animatePageTurn`) — see the restoration right after the host
      // swap for why this matters (a real, confirmed bug: keyboard
      // page-turning going silently dead after exactly one animated
      // turn).
      const hadKeyboardFocus = this.iframeHasFocus(this.host);
      const animatedHost = await this.animatePageTurn(this.host, direction);
      if (animatedHost) {
        if (token !== this.turnToken) {
          // A newer turn (click or drag) has since started and finished
          // while this one's incoming page was loading/animating —
          // discard this stale result instead of clobbering the newer
          // state (see `turnToken`).
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
        this.setUpHighlightSelection();
        this.applyHighlightsToCurrentHost();
        this.restoreFocusAfterHostSwap(hadKeyboardFocus);
        this.announce(`Page ${animatedHost.currentPageIndex + 1} of ${animatedHost.pageCount}`);
        this.notify();
        await this.saveProgress();
        return;
      }
      moved = direction === 1 ? this.host.nextPage() : this.host.previousPage();
      announcement = `Page ${this.host.currentPageIndex + 1} of ${this.host.pageCount}`;
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

  /** Whether the user has `prefers-reduced-motion: reduce` set — checked
   * up front by both `animatePageTurn`/`animateSpreadTurn` (to skip
   * building "turn furniture" overlays at all when there'll be no
   * animation to play them alongside) and by `playPageTurnAnimation`
   * itself (to skip the actual transition). See `shouldSkipPageTurnAnimation`
   * for the combined check that also honors the reader's own explicit
   * "off" page-turn-animation-style choice (issue #69). */
  private prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  /** The actual gate every page-turn animation call site should check
   * before playing a transition — true whenever `prefersReducedMotion()`
   * is set *or* the reader has explicitly chosen the "none" page-turn
   * animation style (issue #69). Kept as its own method (rather than
   * folding the style check directly into `prefersReducedMotion`) since
   * the two are conceptually distinct: one reflects an OS-level
   * accessibility preference the reader never has to think about, the
   * other an explicit in-app choice — but every actual call site wants
   * both honored together, so callers should use this, not
   * `prefersReducedMotion` directly, unless they specifically mean the
   * OS preference alone. */
  private shouldSkipPageTurnAnimation(): boolean {
    return this.pageTurnAnimationStyle === "none" || this.prefersReducedMotion();
  }

  /** The page number the running footer should show for `pageIndex` of
   * `spineIndex`'s `pageCount` total pages — book-wide via
   * `bookPagination` once its background measurement has reached that
   * far, falling back to the plain per-chapter page number otherwise.
   * Mirrors `PageFurniture`'s own `primaryPageNumber` computation exactly
   * (see that component), since `buildTurnFurnitureOverlay`'s imperative
   * footer text needs to read identically to the static one it hands off
   * to/from at the start/end of a turn. */
  private furniturePageNumber(spineIndex: number, pageIndex: number, pageCount: number): number | undefined {
    const bookPageIndex = this.bookPagination?.positionFor(spineIndex, pageIndex).currentPage;
    return bookPageIndex ?? (pageCount > 0 ? pageIndex + 1 : undefined);
  }

  /** Builds an opaque, page-themed backdrop rectangle for the *animating*
   * side of a "slide" turn — a real, reported bug (issue #84) otherwise:
   * "slide" deliberately leaves the animating host at its own natural
   * (often short) height rather than growing it (see the `slide` branch
   * right below in `animatePageTurn`/`animateSpreadTurn`, and
   * `suppressClipPathForAnimation`'s doc comment) — but with `clip-path`
   * also gone for the whole turn's duration, a short page's iframe
   * simply doesn't paint anything below its own (short) box. Without
   * this backdrop, whatever's directly behind it — the *other*, static
   * host, sitting fully rendered and unclipped at its own final resting
   * page — visibly shows through that gap for as long as the animating
   * page is short of the pane's full height, reading as "the wrong
   * page's content" instead of the current one.
   *
   * A plain sibling (like `buildTurnFurnitureOverlay`'s own overlay),
   * sized to `matchEl`'s width but the pane's *full* height (same
   * reasoning as that overlay's own height fix), filled with the active
   * `ReadingTheme` page background. Callers must insert this *before*
   * `matchEl` in DOM order, as a sibling — i.e. via
   * `matchEl.parentElement!.insertBefore(backdrop, matchEl)`, never
   * assuming that parent is `this.containerEl` itself: `matchEl` may
   * instead be nested one level deeper inside `stageHiddenHostElement`'s
   * wrapper (any host still active from a normal, non-animated
   * `openSpineItem` mount, e.g. the very first page turn after opening a
   * book) — but that wrapper is always `inset: 0` within `containerEl`,
   * so positioning this backdrop from `containerEl`'s own rect (below)
   * still lines up correctly either way. This ordering makes it paint
   * *underneath* `matchEl`'s own content at the same z-index — covering
   * only the gap beyond `matchEl`'s own box, never the real content
   * itself — and callers must add it to `playPageTurnAnimation`'s
   * `extraTurnEls` so it slides away in lockstep with `matchEl`, exactly
   * like the furniture overlay already does. */
  private buildTurnBackdrop(matchEl: HTMLElement): HTMLDivElement | undefined {
    if (!this.containerEl) {
      return undefined;
    }
    const containerRect = this.containerEl.getBoundingClientRect();
    const matchRect = matchEl.getBoundingClientRect();
    const backdrop = document.createElement("div");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.style.position = "absolute";
    backdrop.style.left = `${matchRect.left - containerRect.left}px`;
    backdrop.style.top = `${matchRect.top - containerRect.top}px`;
    backdrop.style.width = `${matchRect.width}px`;
    backdrop.style.height = `${this.height}px`;
    backdrop.style.pointerEvents = "none";
    backdrop.style.background = ReadingTheme.PAGE_THEMES[this.pageTheme].background;
    return backdrop;
  }

  /** Builds a plain, page-themed rectangle covering exactly the region
   * `growToFullHeight`/`growColumnToFullHeight` newly exposed on
   * `matchEl` — from its own natural height (`naturalHeight`, measured
   * *before* growing it) down to the pane's full height — for the
   * duration of a "rotate" turn. A real, reported bug otherwise
   * (matching "slide"'s own short-page bleed, issue #84, but via a
   * different mechanism): growing height needs `clip-path` dropped
   * too (see `growToFullHeight`'s own doc comment on why the two can't
   * be separated), and without it, a short page's iframe doesn't just
   * sit at a shorter box — enlarging it exposes however much more of
   * that *same* document's own subsequent flow happens to fit in the
   * newly available height (the next paragraph, or an unrelated image
   * immediately following it in the source document — confirmed
   * directly: a chapter's image-right-after-a-short-page layout showed
   * the image bleeding in below the short page's own text during a
   * rotate turn). Painted *on top* of `matchEl` (unlike
   * `buildTurnBackdrop`, which sits *behind* the animating side to mask
   * a gap the *other* host would otherwise show through) — the bleed
   * here is `matchEl`'s own content, not something behind it. Callers
   * must append this *after* `matchEl` in DOM order (so it paints over
   * it, not under it) and give it the same z-index, and add it to
   * `playPageTurnAnimation`'s `extraTurnEls` so it rotates in lockstep
   * — exactly like the furniture overlay and `buildTurnBackdrop`
   * already do. */
  private buildTurnGrowthMask(matchEl: HTMLElement, naturalHeight: number): HTMLDivElement | undefined {
    if (!this.containerEl) {
      return undefined;
    }
    const containerRect = this.containerEl.getBoundingClientRect();
    const matchRect = matchEl.getBoundingClientRect();
    const maskHeight = this.height - naturalHeight;
    if (maskHeight <= 0) {
      return undefined;
    }
    const mask = document.createElement("div");
    mask.setAttribute("aria-hidden", "true");
    mask.style.position = "absolute";
    mask.style.left = `${matchRect.left - containerRect.left}px`;
    mask.style.top = `${matchRect.top - containerRect.top + naturalHeight}px`;
    mask.style.width = `${matchRect.width}px`;
    mask.style.height = `${maskHeight}px`;
    mask.style.pointerEvents = "none";
    mask.style.background = ReadingTheme.PAGE_THEMES[this.pageTheme].background;
    return mask;
  }

  /** Builds the running header/footer overlay for one side of an
   * animated page turn — either the outgoing page's current furniture or
   * the incoming page's furniture-to-be, depending on which host/element
   * the caller passes in. Returns `undefined` if `this.containerEl` isn't
   * mounted (shouldn't happen mid-turn, just defensive).
   *
   * Positioned via `matchEl.getBoundingClientRect()` rather than by
   * reasoning about `matchEl`'s own layout/transform state — this is
   * deliberately a *separate* sibling element, not a child of `matchEl`
   * itself (an iframe, for a single page or a spread's "rotate" turn
   * element, can't hold light-DOM overlay children at all), so the only
   * way to line it up exactly is to measure where `matchEl` currently
   * sits on screen and place this overlay directly on top of it, in
   * `this.containerEl`'s own coordinate space. Once placed, `stagePageTurn`/
   * `setPageTurnTransform` apply the *exact same* transform to this
   * overlay as to `matchEl` (see `playPageTurnAnimation`'s `extraTurnEls`),
   * so the two move as if they were one piece despite being independent
   * elements.
   *
   * The overlay's own *height*, though, deliberately uses `this.height`
   * (the reader pane's full fixed height) rather than `matchEl`'s own
   * measured height — a real, reported bug otherwise: `matchEl` (an
   * iframe) is sized to *this specific page's* own content height (see
   * `PaginatedContentHost.showCurrentPage`), often noticeably shorter
   * than a full page — most commonly a chapter's last page. The footer
   * band below is positioned `bottom: 0` *within this overlay*, so
   * sizing the overlay to match a short `matchEl` pulled the footer's
   * "Page N" text up toward the visible text instead of leaving it at
   * the reader pane's actual bottom edge, snapping back down the moment
   * the turn settled and the static `PageFurniture` (which *does*
   * position against the full pane, never against any one host's own
   * height) took back over. Safe regardless of `matchEl`'s own height,
   * since every host is always top-aligned within the reader pane (see
   * `stageHiddenHostElement`'s `alignItems: "flex-start"`) — `matchEl`'s
   * top edge and the pane's own top edge always coincide.
   *
   * `bands` describes one visual "page" worth of header+footer content —
   * one entry for a single page or a spread's "rotate" turn (which only
   * ever animates one column), two for a spread's "slide" turn (the
   * whole two-page unit moves as one, so both columns' furniture rides
   * along together). Each band's `left`/`width` are relative to
   * `matchEl`'s own rect, not the whole container — for the single-band
   * cases that's just `{ left: 0, width: matchEl's full width }`; for
   * the two-band spread case it's each column's offset within the whole
   * spread, exactly mirroring `PageFurniture`'s own `columnBands` (just
   * computed against `matchEl`'s own measured width rather than the full
   * pane width, since there's no side margin to account for once we're
   * already positioned to coincide with the spread element itself).
   *
   * Both the header and footer bands below set `box-sizing: border-box`
   * explicitly — a real, reported bug otherwise (the "jump" at the end
   * of a turn, in both single-page and spread mode): with the default
   * `content-box` sizing, an explicit `width` plus non-zero horizontal
   * `padding` (the header band always has 20px each side) adds the
   * padding *outside* that width, so a "space-between"/"center" header
   * actually lays its text out across `band.width + 40px`, not
   * `band.width` — 20px further right than intended on each side. The
   * *static* `PageFurniture` never hits this, since it positions its
   * bands via `left`/`right` (not an explicit `width`) — box-sizing only
   * matters when `width` is one of the properties in play — so the
   * overlay's text visibly sat ~20-40px off from where `PageFurniture`
   * placed the same text the instant the turn settled and control
   * handed back to it. */
  private buildTurnFurnitureOverlay(
    matchEl: HTMLElement,
    bands: Array<{
      left: number;
      width: number;
      header: { mode: "split"; left: string; right: string } | { mode: "single"; text: string };
      footerText: string | undefined;
    }>,
  ): HTMLDivElement | undefined {
    if (!this.containerEl) {
      return undefined;
    }
    const containerRect = this.containerEl.getBoundingClientRect();
    const matchRect = matchEl.getBoundingClientRect();
    const foreground = ReadingTheme.PAGE_THEMES[this.pageTheme].foreground;
    const background = ReadingTheme.PAGE_THEMES[this.pageTheme].background;

    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.position = "absolute";
    overlay.style.left = `${matchRect.left - containerRect.left}px`;
    overlay.style.top = `${matchRect.top - containerRect.top}px`;
    overlay.style.width = `${matchRect.width}px`;
    overlay.style.height = `${this.height}px`;
    overlay.style.pointerEvents = "none";

    // Matches `PageFurniture`'s own `Caption1` text exactly by
    // referencing Fluent's typography tokens as CSS custom properties
    // (`--fontFamilyBase`/`--fontSizeBase200`/`--fontWeightRegular`/
    // `--lineHeightBase200` — see `Caption1`'s own generated styles)
    // rather than hardcoding literal values here — a real, reported bug
    // otherwise (issue #85): a hardcoded font *stack* that happens to
    // share the same first choice ("Segoe UI") as Fluent's real
    // `--fontFamilyBase` can still resolve to a visibly different actual
    // typeface once that first choice isn't installed (as on macOS,
    // where this fell through to "Helvetica Neue" here but to Fluent's
    // own next fallback, `-apple-system`/San Francisco, in the real
    // static furniture) — different typefaces at the same nominal pixel
    // size don't share the same x-height/stroke weight, reading as "the
    // font size changed" even though the CSS `font-size` value never did.
    const textStyle =
      `color: ${foreground}; opacity: 0.55; min-width: 0; ` +
      `font-family: var(--fontFamilyBase); font-size: var(--fontSizeBase200); ` +
      `font-weight: var(--fontWeightRegular); line-height: var(--lineHeightBase200); ` +
      `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

    for (const band of bands) {
      const header = document.createElement("div");
      header.style.cssText =
        `position: absolute; top: 0; left: ${band.left}px; width: ${band.width}px; ` +
        `box-sizing: border-box; height: ${ReadingTheme.PAGE_INSET_TOP}px; display: flex; ` +
        `align-items: flex-start; justify-content: ${band.header.mode === "split" ? "space-between" : "center"}; ` +
        `padding: ${HEADER_TEXT_TOP_OFFSET}px 20px 0; overflow: hidden; background: ${background};`;
      // This band's own opaque `background` (added above) is doing real
      // work, not just matching the page theme for looks: every call
      // site that builds this overlay has *also* called
      // `suppressClipPathForAnimation` on `matchEl` (a prerequisite for
      // dropping `clip-path`, itself required to work around the
      // Chromium overlapping-iframe compositing bug — see that
      // method's own doc comment), which leaves this exact top inset
      // band (`PAGE_INSET_TOP` tall) as part of `matchEl`'s box with
      // nothing clipping it anymore. That band is only blank *by
      // convention* — the previous page's last line sits just above it
      // in the underlying linear flow, routinely far less than
      // `PAGE_INSET_TOP` away — so without an opaque cover here, the
      // previous page's tail visibly bled in above this page's own
      // running header for the whole animation (a real, reported bug:
      // "content above ... the page that should be clipped"). The
      // symmetric bottom-band equivalent of this same risk is handled
      // separately, by `buildTurnGrowthMask`/shrinking `matchEl` itself
      // — but *this* band exists on every animated host regardless of
      // style or which side is moving, unlike that one, so it's fixed
      // once here rather than duplicated at every call site.
      if (band.header.mode === "split") {
        const left = document.createElement("span");
        left.style.cssText = textStyle;
        left.textContent = band.header.left;
        const right = document.createElement("span");
        right.style.cssText = `${textStyle} text-align: right;`;
        right.textContent = band.header.right;
        header.append(left, right);
      } else {
        const span = document.createElement("span");
        span.style.cssText = `${textStyle} text-align: center;`;
        span.textContent = band.header.text;
        header.append(span);
      }
      overlay.appendChild(header);

      if (band.footerText !== undefined) {
        const footer = document.createElement("div");
        footer.style.cssText =
          `position: absolute; bottom: 0; left: ${band.left}px; width: ${band.width}px; ` +
          `box-sizing: border-box; height: ${ReadingTheme.PAGE_INSET_BOTTOM}px; display: flex; ` +
          `align-items: center; justify-content: center; background: ${background};`;
        const span = document.createElement("span");
        span.style.cssText = textStyle;
        span.textContent = band.footerText;
        footer.appendChild(span);
        overlay.appendChild(footer);
      }
    }
    return overlay;
  }

  /** Plays a book-like page-turn flip and returns the fully-paginated
   * *new* host to swap in as `this.host` — or `undefined` if `direction`
   * would cross a chapter boundary (the caller falls back to its normal
   * chapter-advance handling; this pass doesn't animate that case).
   *
   * Real book feel requires the outgoing and incoming pages to be visible
   * *simultaneously* mid-turn, which a single iframe fundamentally can't
   * do (it only ever shows one page at a time) — so this builds the
   * incoming page in a brand-new, independent `PaginatedContentHost` (see
   * `prepareIncomingPage`).
   *
   * For "rotate"/"slide": a **forward** turn (`direction === 1`) animates
   * the *outgoing* page turning away — stacked *above* the incoming page
   * already waiting underneath it, `backface-visibility: hidden` makes it
   * disappear past 90°, revealing the incoming page beneath with no
   * animation of its own. A **backward** turn does the *opposite*, per
   * explicit product direction (issue #41): rather than the current page
   * turning away to reveal the previous one sitting underneath (which
   * reads as backwards for how a real book works — you're not
   * un-covering something, you're placing a previously-turned page back
   * down on top), the *incoming* (previous) page is instead built already
   * "turned away" (see `playPageTurnAnimation`'s `entering` mode),
   * stacked *above* the static, unanimated outgoing page, and animates
   * *in*, settling to rest and covering the current page as it arrives —
   * exactly like flipping a page back over onto the one you're leaving.
   *
   * "scroll" (issue #63) is fundamentally different — see
   * `playScrollTurn`'s doc comment — and its own branch below skips the
   * "only one side ever moves" machinery above entirely, since *both*
   * the outgoing and incoming pages need to move together.
   *
   * Skips the animation (an instant page swap) when
   * `prefers-reduced-motion` is set, consistent with the rest of the
   * reader respecting it. See `beginDragPageTurn` for the interactive,
   * pointer-driven version of this same underlying mechanism, and
   * `animateSpreadTurn` for the two-page-spread equivalent of this
   * method.
   */
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
    // Every overlapping-iframe style ("rotate"/"slide" — "scroll" moves
    // both sides together and they never overlap on screen at all, see
    // `playScrollTurn`) needs `clip-path` dropped from *both* hosts for
    // the animation's duration, not just whichever one is actually
    // moving — see `PaginatedContentHost.suppressClipPathForAnimation`'s
    // doc comment (issue #81) for the confirmed Chromium rendering bug
    // this works around: *any* two overlapping iframes where either one
    // has a `clip-path` set fail to composite opaquely against each
    // other, blending both pages' text together — confirmed via an
    // isolated repro using a plain `translateX`, no rotation/perspective
    // involved at all, so this isn't specific to "rotate"'s 3D transform
    // the way it first looked (issue #81 only ever exercised "rotate").
    //
    // Only "rotate" also grows the animating host's height to
    // `this.height` (see `growToFullHeight`'s doc comment: its own,
    // separate box-shadow-position fix) — "slide" must *not* do the
    // same, a real, confirmed bug of its own: growing a short page's
    // iframe *without* a clip-path to bound it exposes however much
    // more of that page's own document flow happens to fit in the
    // extra height, which reads as stray paragraph fragments bleeding
    // in below the intended page (issue reported directly: "content
    // above and below the visible page that should be clipped"). Left
    // at its natural height, the iframe's own box already bounds what
    // paints regardless of `clip-path` being absent — nothing new is
    // exposed beyond the (already tiny, inset-only) band `clip-path`
    // was ever hiding in the first place.
    //
    // "rotate" has this *exact same* bleed risk for its own grown
    // height, though (a real, reported bug of its own — see
    // `buildTurnGrowthMask`'s doc comment). `growToFullHeight` itself
    // calls `suppressClipPathForAnimation` first (shrinking away the
    // bottom inset band) *before* growing — so measuring height before
    // calling it at all would capture the *pre-shrink* value (with that
    // inset band still included), leaving a real, confirmed gap exactly
    // that band's height tall for bleed to sneak through unmasked.
    // Calling `suppressClipPathForAnimation` explicitly first (a no-op
    // repeat of what `growToFullHeight` does internally, safe to call
    // twice) and measuring *after* that gets the true natural height
    // `buildTurnGrowthMask` needs.
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

    // Fixed a real bug (issue #84) for "slide" specifically: leaving the
    // animating host at its own natural height (deliberately no
    // `growToFullHeight`, per the comment above) means a short page's
    // iframe doesn't paint below its own short box — and with
    // `clip-path` also gone for the duration, the *other* host sitting
    // fully rendered underneath showed straight through that gap,
    // reading as "the wrong page" rather than the current one for
    // however much of the pane the short page didn't fill. See
    // `buildTurnBackdrop`'s own doc comment. Not needed for "rotate"
    // (whose animating side is already grown to full height, so it has
    // no such gap) or "scroll" (whose two sides never overlap at all).
    let turnBackdrop: HTMLDivElement | undefined;
    if (!this.shouldSkipPageTurnAnimation() && this.pageTurnAnimationStyle === "slide") {
      turnBackdrop = this.buildTurnBackdrop(animatingHost.element);
      if (turnBackdrop) {
        turnBackdrop.style.zIndex = "2";
        animatingHost.element.parentElement?.insertBefore(turnBackdrop, animatingHost.element);
      }
    }
    let turnGrowthMask: HTMLDivElement | undefined;
    if (!this.shouldSkipPageTurnAnimation() && this.pageTurnAnimationStyle === "rotate") {
      turnGrowthMask = this.buildTurnGrowthMask(animatingHost.element, animatingNaturalHeight);
      if (turnGrowthMask) {
        turnGrowthMask.style.zIndex = "2";
        animatingHost.element.parentElement?.insertBefore(turnGrowthMask, animatingHost.element.nextSibling);
      }
    }

    // Build the outgoing/incoming "turn furniture" overlays (see
    // `buildTurnFurnitureOverlay`) so the running header/footer turns
    // with the page instead of sitting static on top of it throughout —
    // title/chapter never change mid-turn (an animated turn never
    // crosses a chapter boundary — see `prepareIncomingPage`), only the
    // page number does. `PageFurniture`'s own static rendering is
    // suspended for the duration via `isAnimatingPageTurn` so the two
    // never show on top of each other. Skipped entirely when there's no
    // animation to play them alongside anyway.
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (!this.shouldSkipPageTurnAnimation()) {
      const title = this.pkg.metadata.title;
      const chapterLabel = this.chapterLabel(this.spineIndex);
      const outgoingNumber = this.furniturePageNumber(this.spineIndex, oldHost.currentPageIndex, oldHost.pageCount);
      const incomingNumber = this.furniturePageNumber(this.spineIndex, newHost.currentPageIndex, newHost.pageCount);
      const header = { mode: "split" as const, left: title, right: chapterLabel };
      outgoingOverlay = this.buildTurnFurnitureOverlay(oldHost.element, [
        {
          left: 0,
          width: oldHost.element.getBoundingClientRect().width,
          header,
          footerText: outgoingNumber !== undefined ? `Page ${outgoingNumber}` : undefined,
        },
      ]);
      incomingOverlay = this.buildTurnFurnitureOverlay(newEl, [
        {
          left: 0,
          width: newEl.getBoundingClientRect().width,
          header,
          footerText: incomingNumber !== undefined ? `Page ${incomingNumber}` : undefined,
        },
      ]);
      if (isScroll) {
        // Both overlays move (with their own page) rather than one
        // sitting static underneath the other — z-index doesn't matter
        // here since the two never overlap on screen (see
        // `playScrollTurn`), but they still need to be *in* the
        // document to animate at all.
        if (outgoingOverlay) {
          outgoingOverlay.style.zIndex = "2";
          this.containerEl.appendChild(outgoingOverlay);
        }
        if (incomingOverlay) {
          incomingOverlay.style.zIndex = "2";
          this.containerEl.appendChild(incomingOverlay);
        }
      } else {
        // Whichever overlay pairs with the animating page sits on top
        // (z-index 2); the static one underneath gets 1 — same
        // convention either direction, just swapped for which side is
        // actually moving.
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
      await this.playScrollTurn(oldGroup, newGroup, direction);
    } else {
      const turnEl = entering ? newEl : oldHost.element;
      const extraTurnEls = [
        ...((entering ? incomingOverlay : outgoingOverlay) ? [(entering ? incomingOverlay : outgoingOverlay)!] : []),
        ...(turnBackdrop ? [turnBackdrop] : []),
        ...(turnGrowthMask ? [turnGrowthMask] : []),
      ];
      await this.playPageTurnAnimation(turnEl, turnEl, direction, extraTurnEls, entering);
    }

    outgoingOverlay?.remove();
    incomingOverlay?.remove();
    turnBackdrop?.remove();
    turnGrowthMask?.remove();
    this.isAnimatingPageTurn = false;
    // `newHost` always survives as the new `this.host` (unlike
    // `oldHost`, unconditionally disposed right below) — restore
    // whatever `growToFullHeight`/`suppressClipPathForAnimation` may
    // have touched on it, regardless of turn direction (it's a no-op,
    // via `showCurrentPage`, if neither ever actually applied to it).
    newHost.restoreNaturalHeight();

    // `oldHost.dispose()` removes its iframe from `containerEl`, leaving
    // `newEl` as the sole remaining child — reset its temporary
    // positioning so it behaves like any other freshly-mounted host for
    // every subsequent operation (relayout, resize, etc.).
    oldHost.dispose();
    newEl.style.position = "";
    newEl.style.top = "";
    newEl.style.left = "";
    newEl.style.transform = "";
    newEl.style.zIndex = "";
    return newHost;
  }

  /** The two-page-spread equivalent of `animatePageTurn` — see that
   * method's doc comment for the shared mechanics (incoming content
   * built in a brand-new host underneath the outgoing one, animation
   * skipped for `prefers-reduced-motion`). What actually *moves* differs
   * by `this.pageTurnAnimationStyle`, per explicit product direction:
   * "slide"/"scroll" both treat the whole spread as one rigid sheet
   * (both pages translate together, exactly like `animatePageTurn`'s
   * single page, just wider); "rotate" instead flips only the *one*
   * column nearest the spine — the right column turning forward, the
   * left column turning back — like an actual book page turning over,
   * while its companion column stays completely still. `elementToTurn`
   * is what decides which element actually gets the transform in each
   * case; see its own doc comment. "scroll" (issue #63) additionally
   * moves *both* the outgoing and incoming spread simultaneously — see
   * `playScrollTurn`'s doc comment — so it branches away from the
   * shared "only one side ever moves" `playPageTurnAnimation` machinery
   * below, same as `animatePageTurn` does for this style. */
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
    // See `animatePageTurn`'s doc comment on why backward flips which
    // side actually animates.
    const turnHost = entering ? newHost : oldHost;
    const otherHost = entering ? oldHost : newHost;

    // "rotate" turns only the single column nearest the spine — see
    // `elementToTurn`'s doc comment — and additionally grows that one
    // column's height to `this.height` (see
    // `PaginatedContentHost.growToFullHeight`'s doc comment: its own,
    // separate box-shadow-position fix; `SpreadPaginatedHost`'s own
    // wrapper is already fixed to the full pane height regardless of
    // either column's content, so only the turning column itself needs
    // this, not its already-full-height companion). "slide" moves the
    // *whole* spread as one rigid sheet instead (see this method's own
    // doc comment) and must *not* grow any column's height to match —
    // a real, confirmed bug of its own: growing a short column's iframe
    // *without* a clip-path to bound it exposes however much more of
    // that column's own document flow happens to fit in the extra
    // height, reading as stray paragraph fragments bleeding in below
    // the intended page. Left at its natural height, each column's own
    // box already bounds what paints regardless of `clip-path` being
    // absent.
    //
    // Every column on *both* sides — not just whichever one is
    // "turning" — needs its own `clip-path` dropped for the whole
    // animation's duration, for *both* styles: see
    // `PaginatedContentHost.suppressClipPathForAnimation`'s doc comment
    // (issue #81) for the confirmed Chromium rendering bug this works
    // around — *any* two overlapping iframes where either has a
    // `clip-path` set fail to composite opaquely, blending both pages'
    // text together, confirmed with a plain `translateX` and no
    // rotation/perspective involved at all (i.e. this affects "slide"
    // just as much as "rotate", not something specific to a 3D
    // transform). Restored on whichever host actually survives the turn
    // (always `newHost` — see the bottom of this method).
    if (this.pageTurnAnimationStyle === "rotate") {
      turnHost.suppressColumnClipPathForAnimation("right");
    }
    const turnColumnNaturalHeight = this.spreadColumnElement(turnHost, 1).getBoundingClientRect().height;
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
    const turnEl = this.elementToTurn(turnHost);

    // See `buildTurnBackdrop`'s doc comment / `animatePageTurn`'s
    // identical use of it (issue #84) — the spread wrapper itself is
    // always `this.height` tall (see `SpreadPaginatedHost`'s
    // constructor), but a "slide" turn's individual *columns* are left
    // at their own natural (often short) height with no `clip-path` to
    // bound them, so a short column's gap let the *other* spread,
    // sitting fully rendered directly underneath, show through it. One
    // backdrop the full width of the whole spread (not one per column)
    // is enough, since it sits behind the entire turning wrapper.
    let turnBackdrop: HTMLDivElement | undefined;
    if (!this.shouldSkipPageTurnAnimation() && this.pageTurnAnimationStyle === "slide") {
      turnBackdrop = this.buildTurnBackdrop(turnHost.element);
      if (turnBackdrop) {
        turnBackdrop.style.zIndex = "2";
        turnHost.element.parentElement?.insertBefore(turnBackdrop, turnHost.element);
      }
    }
    // See `buildTurnGrowthMask`'s doc comment / `animatePageTurn`'s
    // identical use of it — "rotate" grows just the turning (right)
    // column to full height, which needs its own bleed masked exactly
    // like the single-page case does.
    let turnGrowthMask: HTMLDivElement | undefined;
    if (!this.shouldSkipPageTurnAnimation() && this.pageTurnAnimationStyle === "rotate") {
      turnGrowthMask = this.buildTurnGrowthMask(turnEl, turnColumnNaturalHeight);
      if (turnGrowthMask) {
        turnGrowthMask.style.zIndex = "2";
        turnEl.parentElement?.insertBefore(turnGrowthMask, turnEl.nextSibling);
      }
    }

    // Issue #81: "complete" the spread's rotate turn — previously it
    // only ever swung the turning column to ~100° (just past edge-on)
    // before the turn's *other* side (the incoming spread, already
    // fully built and sitting statically underneath the whole time —
    // see `prepareIncomingSpread`) simply showed through once
    // `backface-visibility: hidden` made the turning column vanish.
    // That's a real page lifting up toward vertical and disappearing,
    // but it never actually finishes coming back *down* into the left
    // slot the way an actual page turn does — so build a "back face"
    // for it to land on, and let the same rotation run all the way to
    // 180° instead of stopping just past 90 (see `fullTurnDegrees`
    // passed to `playPageTurnAnimation` below).
    const rotateBackFace =
      this.pageTurnAnimationStyle === "rotate" && !this.shouldSkipPageTurnAnimation()
        ? this.buildRotateBackFace(turnEl)
        : undefined;

    // Same "turn furniture" treatment as `animatePageTurn` — see
    // `buildTurnFurnitureOverlay`'s doc comment. Title/chapter never
    // change mid-turn (same reasoning as the single-page case); only
    // the page number(s) do. "slide"/"scroll" both need *both* columns'
    // furniture (the whole spread moves as one sheet); "rotate" needs
    // only the right column (see `elementToTurn`), on whichever host is
    // actually animating. Skipped entirely when there's no animation to
    // play them alongside.
    let outgoingOverlay: HTMLDivElement | undefined;
    let incomingOverlay: HTMLDivElement | undefined;
    if (!this.shouldSkipPageTurnAnimation()) {
      const title = this.pkg.metadata.title;
      const chapterLabel = this.chapterLabel(this.spineIndex);
      const outgoingPrimary = this.furniturePageNumber(this.spineIndex, oldHost.pageIndex, oldHost.pageCount);
      const outgoingSecondary =
        oldHost.secondPageIndex !== undefined && outgoingPrimary !== undefined ? outgoingPrimary + 1 : undefined;
      const incomingPrimary = this.furniturePageNumber(this.spineIndex, newHost.pageIndex, newHost.pageCount);
      const incomingSecondary =
        newHost.secondPageIndex !== undefined && incomingPrimary !== undefined ? incomingPrimary + 1 : undefined;

      if (this.pageTurnAnimationStyle !== "rotate") {
        const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(this.width);
        const gutter = SpreadPaginatedHost.GUTTER_WIDTH;
        const bands = (primary: number | undefined, secondary: number | undefined) => [
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
        outgoingOverlay = this.buildTurnFurnitureOverlay(oldHost.element, bands(outgoingPrimary, outgoingSecondary));
        incomingOverlay = this.buildTurnFurnitureOverlay(newEl, bands(incomingPrimary, incomingSecondary));
      } else {
        // Always the right column now (see `elementToTurn`), which
        // always shows the chapter label + its own "secondary" page
        // number, matching `PageFurniture`'s own left-title/right-
        // chapter convention.
        const header = { mode: "single" as const, text: chapterLabel };
        const oldColumnEl = this.spreadColumnElement(oldHost, 1);
        const newColumnEl = this.spreadColumnElement(newHost, 1);
        outgoingOverlay = this.buildTurnFurnitureOverlay(oldColumnEl, [
          {
            left: 0,
            width: oldColumnEl.getBoundingClientRect().width,
            header,
            footerText: outgoingSecondary !== undefined ? `Page ${outgoingSecondary}` : undefined,
          },
        ]);
        incomingOverlay = this.buildTurnFurnitureOverlay(newColumnEl, [
          {
            left: 0,
            width: newColumnEl.getBoundingClientRect().width,
            header,
            footerText: incomingSecondary !== undefined ? `Page ${incomingSecondary}` : undefined,
          },
        ]);
      }
      if (isScroll) {
        // Both overlays move (with their own spread) rather than one
        // sitting static underneath the other — see `animatePageTurn`'s
        // identical reasoning.
        if (outgoingOverlay) {
          outgoingOverlay.style.zIndex = "2";
          this.containerEl.appendChild(outgoingOverlay);
        }
        if (incomingOverlay) {
          incomingOverlay.style.zIndex = "2";
          this.containerEl.appendChild(incomingOverlay);
        }
      } else {
        // Whichever overlay pairs with the animating page sits on top
        // (z-index 2); the static one underneath gets 1 — same convention
        // either direction, just swapped for which side is actually moving.
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
      await this.playScrollTurn(oldGroup, newGroup, direction);
    } else {
      const animatedOverlayEl = entering ? incomingOverlay : outgoingOverlay;
      await this.playPageTurnAnimation(
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
    turnBackdrop?.remove();
    turnGrowthMask?.remove();
    this.isAnimatingPageTurn = false;
    // `newHost` always survives as the new `this.host` (unlike
    // `oldHost`, unconditionally disposed right below) — restore both
    // of its columns regardless of turn direction, undoing whatever
    // `growColumnToFullHeight`/`suppressColumnClipPathForAnimation` may
    // have touched on either (a no-op, via `showCurrentPage`, for
    // whichever one — or both — never actually needed it).
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

  /** Which element a page turn actually applies its `transform` to —
   * always the relevant host's own `.element`, *except* for a spread's
   * "rotate" style, which turns only the single column nearest the
   * spine (see `animateSpreadTurn`'s doc comment) rather than the whole
   * two-page unit. `host` is whichever side is actually animating —
   * the *outgoing* host for a forward (exiting) turn, or the *incoming*
   * host for a backward (entering) turn (see `playPageTurnAnimation`'s
   * doc comment) — always the *right* column: for a forward exit
   * that's the outgoing spread's right column turning away (hinged at
   * its own left/spine edge); for a backward entry that's the incoming
   * (previous) spread's right column — the page immediately before the
   * current view — swinging back down into place over the current
   * spread's left column, hinged the same way. Resolved via
   * `spreadColumnElement`. Falls back to the whole spread if that
   * somehow can't be resolved (never observed in practice, just
   * defensive) — degrading to the same "whole unit" motion "slide"
   * already uses is a reasonable fallback, not a broken one. */
  private elementToTurn(host: PaginatedContentHost | SpreadPaginatedHost): HTMLElement {
    if (!(host instanceof SpreadPaginatedHost) || this.pageTurnAnimationStyle !== "rotate") {
      return host.element;
    }
    return this.spreadColumnElement(host, 1);
  }

  /** Resolves one column's actual iframe element out of a
   * `SpreadPaginatedHost` — used both by `elementToTurn` (which column
   * a "rotate" turn actually applies its transform to) and by
   * `animateSpreadTurn` (to find the *incoming* spread's matching
   * column, to position that side's furniture overlay against). Same
   * `defaultView.frameElement` technique `spreadFocusedColumn` uses,
   * since `SpreadPaginatedHost` doesn't otherwise expose its two column
   * elements individually. Falls back to the whole spread element if
   * that somehow can't be resolved (never observed in practice, just
   * defensive). */
  private spreadColumnElement(host: SpreadPaginatedHost, columnIndex: 0 | 1): HTMLElement {
    const iframe = host.contentDocuments()[columnIndex]?.defaultView?.frameElement;
    return iframe instanceof HTMLElement ? iframe : host.element;
  }

  /** Builds the "back face" a spread's rotate turn (issue #81) needs to
   * complete the flip past 90° instead of stopping just short of it —
   * see `animateSpreadTurn`'s doc comment on `rotateBackFace` for why.
   * Currently a plain page-themed sheet (no mirrored text of its own —
   * genuinely rendering the *other* side of the same leaf would mean
   * loading and paginating that content a second time purely for this
   * ~380ms animation, a real cost not worth paying yet); still reads as
   * an actual, opaque page landing into place rather than the turning
   * column simply vanishing mid-air, which is what happened before.
   *
   * A plain sibling of `turnEl` (not a wrapper around it — `turnEl`
   * itself, an already-loaded iframe, must never be reparented; see
   * `stageHiddenHostElement`'s doc comment on why that silently reloads
   * an iframe's content in most browsers), sized and positioned to
   * exactly overlay it. Two nested layers: an *outer* div — added to
   * `playPageTurnAnimation`'s `extraTurnEls` by the caller, so it
   * receives the exact same `rotateY` angle/transition/transform-origin
   * as `turnEl` every frame, for free — containing an *inner* div with
   * its own fixed, never-animated `rotateY(180deg)`. Same-axis
   * rotations compose additively, so the inner's effective on-screen
   * angle is always exactly 180° ahead of the outer's (and therefore of
   * `turnEl`'s own): invisible (facing away, `backface-visibility:
   * hidden`) while the outer sits at 0° (matching `turnEl`'s own
   * resting, fully-visible state), and facing the viewer square-on
   * exactly when the outer reaches 180° (matching `turnEl`'s own
   * fully-turned-away, invisible state) — i.e. precisely the "shows up
   * once the front disappears past the midpoint, finishes facing the
   * viewer as the turn completes" behavior the front and back of a
   * single physical sheet actually have. */
  private buildRotateBackFace(turnEl: HTMLElement): HTMLDivElement | undefined {
    const parent = turnEl.parentElement;
    if (!parent) {
      return undefined;
    }
    const doc = parent.ownerDocument;
    const parentRect = parent.getBoundingClientRect();
    const turnRect = turnEl.getBoundingClientRect();

    const outer = doc.createElement("div");
    outer.style.position = "absolute";
    outer.style.left = `${turnRect.left - parentRect.left}px`;
    outer.style.top = `${turnRect.top - parentRect.top}px`;
    outer.style.width = `${turnRect.width}px`;
    outer.style.height = `${turnRect.height}px`;
    outer.style.transformStyle = "preserve-3d";
    outer.style.pointerEvents = "none";

    const inner = doc.createElement("div");
    inner.style.position = "absolute";
    inner.style.inset = "0";
    inner.style.background = ReadingTheme.PAGE_THEMES[this.pageTheme].background;
    inner.style.backfaceVisibility = "hidden";
    inner.style.transform = "rotateY(180deg)";
    outer.appendChild(inner);

    parent.appendChild(outer);
    return outer;
  }

  /** The shared "play the turn, wait for it to finish" mechanics behind
   * both `animatePageTurn` and `animateSpreadTurn`: elevates `hostEl`
   * (the whole outgoing unit — one page, or a whole spread) above the
   * incoming content already waiting underneath it (see
   * `stagePageTurn`), animates `turnEl`'s `transform` (usually the same
   * element as `hostEl`, except a spread's "rotate" style — see
   * `elementToTurn`), and resolves once that transition actually
   * finishes (or a safety-net timeout, or immediately at all if
   * `prefers-reduced-motion` is set). Leaves `this.containerEl`'s
   * `perspective` reset back to empty afterward either way. Does *not*
   * dispose anything or swap in the new host — every caller does that
   * itself immediately after, since exactly what "the new host" means
   * differs between single-page and spread turns.
   *
   * `extraTurnEls` — the outgoing "turn furniture" overlay(s) built by
   * `buildTurnFurnitureOverlay`, if any — get every style mutation
   * `turnEl` itself gets (staging, transform, shadow, transition),
   * applied in the same tick, so the running header/footer visually
   * turns as one piece with the content beneath it rather than staying
   * still while only the page moves. Only `turnEl` is actually listened
   * to for `transitionend`/the safety-net timeout — one reliable signal
   * is enough to resolve the whole turn, and every element here always
   * shares the same 380ms duration regardless.
   *
   * `entering` (used for a *backward* turn — see `animatePageTurn`'s doc
   * comment on why backward flips which side actually animates) reverses
   * the whole sequence: instead of `turnEl` starting at rest and turning
   * away to reveal what's underneath, it starts already fully turned
   * away (the mirror image of what a forward turn's *end* position looks
   * like — since a backward turn is conceptually "un-doing" whichever
   * forward turn originally got here) and animates *down to* rest,
   * sliding/rotating into view on top of whatever's underneath. */
  private async playPageTurnAnimation(
    hostEl: HTMLElement,
    turnEl: HTMLElement,
    direction: 1 | -1,
    extraTurnEls: HTMLElement[] = [],
    entering = false,
    fullTurnDegrees?: number,
  ): Promise<void> {
    if (this.shouldSkipPageTurnAnimation()) {
      return;
    }
    this.stagePageTurn(hostEl, turnEl, direction, extraTurnEls, entering);

    // Rotating slightly past 90° (rather than stopping exactly at it)
    // reads as a page continuing its motion out of view rather than
    // freezing edge-on to the viewer — so "fully turned" overshoots to
    // 100 (translate %, or rotate degrees) rather than stopping at 90.
    // `fullTurnDegrees` (issue #81) overrides this to a full 180 for a
    // spread's "rotate" turn specifically, continuing the same motion
    // all the way down flat onto its own "back face" (see
    // `animateSpreadTurn`'s `rotateBackFace`) instead of stopping just
    // past vertical — every other style/case keeps the original 100.
    const fullyTurnedAmount = direction === 1 ? -(fullTurnDegrees ?? 100) : (fullTurnDegrees ?? 100);

    if (entering) {
      // Establish the "fully turned away" starting point *before* the
      // transition is even set up — mirrored sign, since this is the
      // reverse of whichever forward turn originally sent this same
      // page away. Forcing a reflow (see the loop below) ensures the
      // *next* style change (the transition + final transform) has a
      // real committed "before" state to animate away from, exactly the
      // same reasoning as for a freshly-inserted furniture overlay.
      this.setPageTurnTransform(turnEl, -fullyTurnedAmount, 1, extraTurnEls);
      for (const el of [turnEl, ...extraTurnEls]) {
        void el.offsetHeight;
      }
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        turnEl.removeEventListener("transitionend", onTransitionEnd);
        resolve();
      };
      const onTransitionEnd = (event: TransitionEvent): void => {
        if (event.target === turnEl && event.propertyName === "transform") {
          finish();
        }
      };
      turnEl.addEventListener("transitionend", onTransitionEnd);
      const transition = "transform 380ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 380ms ease";
      for (const el of [turnEl, ...extraTurnEls]) {
        // A freshly-created-and-inserted element (the "turn furniture"
        // overlays built by `buildTurnFurnitureOverlay` always are —
        // `turnEl` itself never is, it was already mounted well before
        // this turn started) hasn't had a style/layout pass committed
        // for its *current* (untransformed) state yet. Setting
        // `transition` and then changing `transform` in the very next
        // frame, with no committed "before" state in between, collapses
        // the whole transition into an instant jump to the final value
        // — confirmed via direct mid-animation DOM inspection, not just
        // guessed at. Reading `offsetHeight` forces the browser to
        // actually compute and commit layout for the element's current
        // style *now*, giving the upcoming transform change something
        // real to animate away from.
        void el.offsetHeight;
        el.style.transition = transition;
      }
      requestAnimationFrame(() => {
        this.setPageTurnTransform(turnEl, entering ? 0 : fullyTurnedAmount, entering ? 0 : 1, extraTurnEls);
      });
      // A safety net in case `transitionend` never fires (e.g. the
      // element was removed mid-transition by a rapid subsequent
      // action) — never leave the turn hung indefinitely.
      setTimeout(finish, 600);
    });
    if (this.containerEl) {
      this.containerEl.style.perspective = "";
    }
  }

  /** The distinct "scroll"/filmstrip page-turn animation (issue #63):
   * unlike "rotate"/"slide" (`playPageTurnAnimation`, above) — where
   * only *one* side ever visibly moves, turning/sliding away to reveal a
   * completely static page waiting underneath — "scroll" moves *both*
   * the outgoing and incoming content simultaneously, by the same
   * amount, in the same direction, so it reads as one continuous
   * horizontal filmstrip the reader is scrolling through rather than a
   * page being lifted off a motionless stack. `oldGroup`/`newGroup` are
   * each the page (or spread) element plus its own "turn furniture"
   * overlay, if built — every element within a group always moves in
   * perfect lockstep, so a page's header/footer visibly travels with it
   * instead of staying behind.
   *
   * The two groups never overlap on screen at any point during the
   * transition (they stay a constant page-width apart throughout, like
   * two train cars), so unlike `playPageTurnAnimation` there's no
   * "elevate above what's underneath" staging step, no 3D perspective,
   * and no box-shadow (see `animatePageTurn`'s `growToFullHeight` call
   * being skipped for this style) — just a plain, flat `translateX` on
   * both sides at once. */
  private async playScrollTurn(
    oldGroup: readonly HTMLElement[],
    newGroup: readonly HTMLElement[],
    direction: 1 | -1,
  ): Promise<void> {
    if (this.shouldSkipPageTurnAnimation()) {
      return;
    }
    // Forward (direction 1): old exits left (-100%), new enters from the
    // right (starts at +100%). Backward (direction -1): mirrored. Both
    // groups always stay exactly 100% (one page-width) apart, so they
    // never visually overlap mid-transition.
    const exitAmount = direction * -100;
    const enterStart = direction * 100;

    for (const el of newGroup) {
      el.style.transform = `translateX(${enterStart}%)`;
    }
    // Forces a reflow so the upcoming transition has a real committed
    // "before" state to animate away from — same reasoning as
    // `playPageTurnAnimation`'s identical step for freshly-inserted
    // furniture overlays.
    for (const el of [...oldGroup, ...newGroup]) {
      void el.offsetHeight;
    }

    const transition = "transform 380ms cubic-bezier(0.4, 0, 0.2, 1)";
    const primaryEl = oldGroup[0];
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        primaryEl?.removeEventListener("transitionend", onTransitionEnd);
        resolve();
      };
      const onTransitionEnd = (event: TransitionEvent): void => {
        if (event.target === primaryEl && event.propertyName === "transform") {
          finish();
        }
      };
      if (primaryEl) {
        primaryEl.addEventListener("transitionend", onTransitionEnd);
      }
      for (const el of [...oldGroup, ...newGroup]) {
        el.style.transition = transition;
      }
      requestAnimationFrame(() => {
        for (const el of oldGroup) {
          el.style.transform = `translateX(${exitAmount}%)`;
        }
        for (const el of newGroup) {
          el.style.transform = "translateX(0%)";
        }
      });
      // Same safety net as `playPageTurnAnimation` — never leave the
      // turn hung indefinitely if `transitionend` somehow never fires.
      setTimeout(finish, 600);
    });
  }

  /** Builds and returns the incoming page for a turn away from
   * `oldHost`'s current page, positioned to sit exactly beneath
   * `oldHost.element` (which stays a normal, flex-centered in-flow child,
   * left completely undisturbed) without needing any wrapper elements —
   * `containerEl` is already `position: absolute` (see `ReaderApp`), so
   * it's a valid containing block for this on its own. Returns
   * `undefined` if `direction` would cross a chapter boundary.
   *
   * `newHost.element` is attached to the live document *before*
   * `open()` is called on it — an iframe generally won't start loading
   * its `src` at all while detached from the document, a real bug this
   * comment exists specifically to prevent regressing (caught via
   * Chromium verification: the load hung until it hit
   * `RenderingSurfaceError`'s timeout). Likewise, `oldHost.element` is
   * never reparented here or anywhere else in the page-turn machinery:
   * most browsers reload an iframe that's ever disconnected and
   * reattached to the document, even synchronously.
   */
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
    // `PaginatedContentHost` is always constructed with `this.width` —
    // the container's own full width — so `left: 0` alone already lines
    // it up exactly; no centering transform is needed (and, unlike the
    // `left: 50%; transform: translateX(-50%)` this used to be, `left:
    // 0` alone leaves `transform` free for `setPageTurnTransform` to set
    // outright during a backward/"entering" turn, where *this* element
    // becomes the one being animated rather than the one revealed
    // statically underneath — see `animatePageTurn`'s doc comment).
    newEl.style.left = "0";
    newEl.style.zIndex = "1";
    // Hidden until fully positioned at `targetIndex` below — a real,
    // reported bug otherwise (issue #84): `newEl` needs to be attached
    // to the live document *before* `open()` even starts (see this
    // method's own doc comment on why), but `open()` itself briefly
    // renders the chapter's very first page while it loads/paginates
    // (see `PaginatedContentHost.open()`), before `goToPageIndex` below
    // corrects it — and since `newEl` is `position: absolute` (already
    // elevated above `oldHost`'s own normal, non-positioned flow,
    // regardless of z-index), that transient first-page render was
    // visible on top of the current page for however long `open()`
    // takes. `opacity: 0` (not `visibility: hidden` — see
    // `prepareIncomingSpread`'s identical fix for why) keeps it fully
    // out of the painted output without affecting layout/pagination
    // measurement, until right before this method returns.
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

  /** The two-page-spread equivalent of `prepareIncomingPage` — builds a
   * whole new `SpreadPaginatedHost` for the *target spread* (both
   * columns), positioned to sit exactly beneath `oldHost.element`,
   * exactly the same way. `targetIndex` is the new primary (left)
   * column's page index — mirrors `SpreadPaginatedHost.nextSpread`/
   * `previousSpread`'s own two-pages-at-a-time clamping, since those are
   * what this replaces for an animated turn. Returns `undefined` only
   * when `oldHost` is already at that edge of the chapter (there's
   * nothing to turn *to*) — unlike the single-page version, a spread one
   * page short of the end still has a valid (if lopsided) next spread to
   * turn to, so this is checked directly rather than by an out-of-range
   * page index. */
  private async prepareIncomingSpread(
    oldHost: SpreadPaginatedHost,
    direction: 1 | -1,
  ): Promise<SpreadPaginatedHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    if (direction === 1 ? oldHost.pageIndex >= oldHost.pageCount - 1 : oldHost.pageIndex <= 0) {
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
    // See `prepareIncomingPage`'s matching comment — `SpreadPaginatedHost`
    // is likewise always constructed with `this.width`, so `left: 0`
    // alone lines it up exactly, leaving `transform` free for a
    // backward/"entering" turn to set outright.
    newEl.style.left = "0";
    newEl.style.zIndex = "1";
    // See `prepareIncomingPage`'s identical fix (issue #84) — doubly
    // important here, since `SpreadPaginatedHost.open()` fully loads and
    // paginates *two* independent columns in sequence (see its own doc
    // comment on why they're separate hosts, not a shared one), roughly
    // doubling the exposure window during which this freshly-attached,
    // `position: absolute` element would otherwise paint its own
    // still-loading (chapter-start) content on top of `oldHost`.
    //
    // `opacity: 0` specifically, not `visibility: hidden`: the right
    // column independently sets its *own* explicit `visibility` (see
    // `syncRight`, called by both `open()` and `goToPageIndex()` below)
    // whenever a companion page exists — a real, confirmed gap this
    // fix's first version had, found via direct DOM inspection: a
    // descendant's own explicit `visibility` declaration overrides an
    // ancestor's inherited one, so the right column could still flash
    // its still-loading content visibly even while this wrapper itself
    // was `visibility: hidden`. `opacity` has no such override — every
    // ancestor's opacity always multiplies into a descendant's final
    // rendered alpha, so a `0` here reliably hides both columns
    // regardless of anything `syncRight` sets on either individually.
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

  /** Puts `hostEl` (the whole outgoing unit) into "ready to turn" state
   * — elevated above the incoming content already waiting underneath it
   * — without yet touching anyone's `transform`. Shared setup between
   * the click-triggered (`animatePageTurn`/`animateSpreadTurn`) and
   * drag-driven (`beginDragPageTurn`, single-page only — see
   * `setUpDragPageTurn`'s doc comment on why a spread has no drag
   * gesture) turn mechanics, for whichever style
   * `this.pageTurnAnimationStyle` is currently set to.
   *
   * `turnEl` is the element that will actually receive the animated
   * `transform` — the same as `hostEl` for a single page, or for a
   * spread's "slide" style (the *whole* two-page unit slides together,
   * per explicit product direction: it should read as one sheet moving,
   * not each page independently); but for a spread's "rotate" style,
   * `turnEl` is just the one column nearest the spine (see
   * `elementToTurn`), while `hostEl` is still the whole spread — needed
   * so `hostEl`'s *companion* column (which never animates at all) stays
   * elevated above the incoming spread underneath it too, not just the
   * column that's actually turning.
   *
   * "rotate" needs perspective on the container (and `transform-style:
   * preserve-3d` on `hostEl`, so that perspective still reaches `turnEl`
   * when it's a grandchild — a spread's column iframes sit one level
   * inside the spread's own wrapper element), the correct hinge edge for
   * `direction`, and a hidden backface; "slide" needs none of that —
   * it's a flat 2D translate of something that's already sitting in the
   * exact same spot the incoming content occupies underneath it (see
   * `prepareIncomingPage`/`prepareIncomingSpread`), so simply sliding it
   * aside reveals what's next with no 3D setup at all.
   *
   * `extraTurnEls` (see `playPageTurnAnimation`'s own doc comment) get
   * the exact same rotate-specific staging as `turnEl` itself — they're
   * always a separate sibling element (the "turn furniture" overlay
   * built by `buildTurnFurnitureOverlay`), positioned to exactly
   * coincide with `turnEl`'s own on-screen rect, so treating them
   * identically keeps them moving as if they were part of it. */
  private stagePageTurn(
    hostEl: HTMLElement,
    turnEl: HTMLElement,
    direction: 1 | -1,
    extraTurnEls: HTMLElement[] = [],
    entering = false,
  ): void {
    if (!this.containerEl) {
      return;
    }
    // For a forward (exiting) turn, `hostEl` is the outgoing host,
    // still sitting in normal flex flow (never explicitly positioned) —
    // `position: relative` elevates it via `z-index` without removing it
    // from flow. For a backward (entering) turn, `hostEl` is the
    // *incoming* host instead, which `prepareIncomingPage`/
    // `prepareIncomingSpread` already made `position: absolute; left:
    // 50%; transform: translateX(-50%)` specifically to overlap the
    // outgoing host exactly — downgrading that to `relative` here would
    // drop it back into normal flex flow as a *sibling* of the outgoing
    // host instead (a real bug, caught via direct DOM inspection: both
    // ended up rendering side by side, each squeezed to half width,
    // instead of stacked on top of each other). Only ever assign
    // `position` when it isn't already meaningfully set.
    if (hostEl.style.position !== "absolute") {
      hostEl.style.position = "relative";
    }
    hostEl.style.zIndex = "2";
    // "none" gets the same flat (non-3D) treatment as "slide" here —
    // there's no sensible "no animation" analogue of a 3D perspective
    // flip for the *live*, pointer-driven drag preview (something has
    // to visually track the pointer while actively dragging), so it
    // falls back to the least flourish-y option rather than showing a
    // 3D flip mid-drag only to then snap instantly on release.
    if (this.pageTurnAnimationStyle !== "rotate") {
      return;
    }
    this.containerEl.style.perspective = "2200px";
    hostEl.style.transformStyle = "preserve-3d";
    // The physical hinge never moves for a given page — only which way
    // it's currently swinging does. A backward turn's `entering` element
    // is the *same page* a forward turn would have sent away in the
    // opposite direction, so its hinge is the mirror of what plain
    // `direction` alone would compute (see `playPageTurnAnimation`'s doc
    // comment on why backward flips the whole sequence).
    const hingeDirection = entering ? (direction === 1 ? -1 : 1) : direction;
    const transformOrigin = `${hingeDirection === 1 ? "left" : "right"} center`;
    for (const el of [turnEl, ...extraTurnEls]) {
      el.style.backfaceVisibility = "hidden";
      // The hinge is the spine edge the page turns away from: the left
      // edge turning forward (the right/free edge lifts up and toward
      // the viewer, like turning the right-hand page of a physical
      // book), the right edge turning back (the left/free edge lifts
      // toward the viewer instead). Confirmed empirically against an
      // isolated CSS 3D transform test — `rotateY`'s sign only reads as
      // "toward the viewer" when paired with the hinge on the *opposite*
      // side from the edge that's lifting. Still correct for a spread's
      // single-column "rotate" turn: the right column's own left edge,
      // and the left column's own right edge, both *are* the spine,
      // exactly where a real page's hinge sits.
      el.style.transformOrigin = transformOrigin;
    }
  }

  /** Scales a 0–1 drag fraction into `this.pageTurnAnimationStyle`'s own
   * natural unit for `setPageTurnTransform` — degrees for "rotate" (a
   * quarter turn at `fraction=1`), percent for "slide"/"none" (a full
   * page-width translate at `fraction=1` — see `stagePageTurn`'s doc
   * comment on why "none" shares "slide"'s flatter treatment here) —
   * signed so the outgoing page always moves the same "out of view" way
   * for a given `direction` regardless of which style is active. */
  private pageTurnPartialAmount(direction: 1 | -1, fraction: number): number {
    const scale = this.pageTurnAnimationStyle !== "rotate" ? 100 : 90;
    return direction * -scale * fraction;
  }

  /** The *entering* page's own transform amount during a "scroll"-style
   * drag (issue #63) — the mirror image of `pageTurnPartialAmount`'s
   * exiting-page amount: starts fully off-screen on the entering side
   * (`direction * 100`) and approaches `0` (fully at rest, arrived) as
   * `fraction` nears 1, so the incoming page arrives in perfect
   * lockstep with the outgoing page leaving. Every other style leaves
   * the entering page completely untouched during a drag — it's
   * revealed statically underneath the one actually moving, not itself
   * animated — so this is only ever called when `this.pageTurnAnimationStyle
   * === "scroll"`. */
  private scrollDragEnterAmount(direction: 1 | -1, fraction: number): number {
    return direction * 100 * (1 - fraction);
  }

  /** Sets `el`'s in-progress transform directly (no transition) for
   * whichever style is active — `amount` is degrees (rotate) or percent
   * (slide); `fraction` (0 to 1) scales a deepening drop shadow (and,
   * for "rotate" specifically, a self-shading inset shadow — see the
   * "rotate" branch below) alongside it, so a partial drag reads as the
   * page physically lifting/sliding, not just moving in place. `el` is whatever
   * `stagePageTurn`'s own `turnEl` was — an iframe for a single page, or
   * (for a spread's "rotate" style) a single column's iframe rather than
   * the whole spread wrapper; the plain `HTMLElement` type here doesn't
   * care which. `extraEls` (see `playPageTurnAnimation`) get the exact
   * same transform/shadow applied in lockstep. */
  private setPageTurnTransform(el: HTMLElement, amount: number, fraction: number, extraEls: HTMLElement[] = []): void {
    for (const target of [el, ...extraEls]) {
      if (this.pageTurnAnimationStyle !== "rotate") {
        target.style.transform = `translateX(${amount}%)`;
        // The shadow falls on the trailing edge — the side most recently
        // uncovered — which is the opposite side from the direction of
        // travel (negative `amount` = moving left = shadow on the right).
        const edge = amount < 0 ? "" : "-";
        target.style.boxShadow = `${edge}16px 0 32px rgba(0, 0, 0, ${(0.3 * fraction).toFixed(3)})`;
        continue;
      }
      target.style.transform = `rotateY(${amount}deg)`;
      // Two shadows: the outer one (unchanged) casts the page's lift
      // onto whatever's behind it; the *inset* one is new (issue #81,
      // "the page seems transparent as it turns... it needs to look
      // more solid") — a real page catches its own shadow as it turns
      // away from the light, growing visibly darker toward a full
      // profile-on turn, not just thinner. A flat 2D rotation with no
      // shading of its own reads as a thin, glassy pane rather than a
      // sheet of paper with actual weight. Scales with the same
      // `fraction` as the outer shadow so both deepen together.
      const selfShade = (0.3 * fraction).toFixed(3);
      target.style.boxShadow =
        `0 12px 40px rgba(0, 0, 0, ${(0.35 * fraction).toFixed(3)}), ` +
        `inset 0 0 ${Math.round(60 * fraction)}px rgba(0, 0, 0, ${selfShade})`;
    }
  }

  /** Fraction of the reader pane's width a drag must cross before
   * releasing completes the turn rather than reverting it — a book page
   * lifted less than halfway falls back closed; lifted further, it
   * carries on over. */
  private static readonly DRAG_COMMIT_THRESHOLD = 0.4;

  /** (Re-)attaches the pointer-driven page-turn gesture(s) to the current
   * content host. Single-column paginated mode gets the full draggable,
   * animated flip (see `beginDragPageTurn`); spread mode gets click-to-
   * navigate only, on each column independently (see
   * `setUpSpreadClickToNavigate`) — a drag/flip animation across two
   * independent side-by-side iframes is a substantially harder visual
   * problem, deliberately out of scope for this pass, same as
   * chapter-crossing drags. Attached directly to each iframe's own
   * document for the same reason `AccessibilityController` attaches its
   * keyboard listener there: pointer events started inside an iframe
   * don't bubble out to the parent window. */
  private setUpDragPageTurn(): void {
    this.dragCleanup?.();
    this.dragCleanup = undefined;

    if (this.host instanceof SpreadPaginatedHost) {
      this.dragCleanup = this.setUpSpreadClickToNavigate(this.host);
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

  /** Single-column counterpart to `setUpSpreadClickToNavigate`'s own
   * container-level fallback listener, for the exact same underlying
   * reason (issue #82): `PaginatedContentHost` sizes its iframe to only
   * *this specific page's* own content height (see
   * `PaginatedContentHost.showCurrentPage`), often noticeably shorter
   * than a full page — most commonly a chapter's very last page. A
   * click landing in the resulting gap below that shrink-wrapped iframe
   * never reaches it at all: from the browser's perspective, that point
   * in the reader pane simply isn't covered by any element with a
   * page-turn listener on it, so it was silently swallowed with no
   * visible effect. Reported as needing "an extra click" to advance at
   * a chapter's end — in practice, depending on how short that last
   * page's real content was, it ranged from "click a little higher" to
   * whole pages near a chapter's end going almost completely inert.
   *
   * Attached to `this.containerEl` — the reader pane's own content-host
   * div (see `ReaderApp.tsx`'s `contentHostRef`), which always spans
   * the full fixed page area regardless of which host is currently
   * mounted inside it or how tall that host's own iframe happens to be
   * — rather than to any specific host element. Reuses the same left/
   * middle/right-third zones as `handleContentClick`, measured against
   * `this.width` (the whole reader pane), since a fallback click here
   * is by definition not on any specific host's own content. */
  private setUpBelowPageClickFallback(): () => void {
    const containerEl = this.containerEl;
    if (!containerEl) {
      return () => {};
    }
    // Each gesture gets its own self-contained, one-shot `pointerup`
    // listener (attached from inside `pointerdown`, removing itself once
    // it fires) rather than a `pointerup` listener shared across every
    // gesture with the start position stashed in an outer closure
    // variable — a real, confirmed bug caught via testing: `setUpDragPageTurn`
    // (which builds this fallback) is explicitly documented, on
    // `handleWindowRefocus`, as safe to call repeatedly at any time,
    // including — as real automated interaction testing demonstrated —
    // in the middle of an already-started gesture (a spurious `window`
    // focus event arriving between one `pointerdown` and its matching
    // `pointerup`). With a shared outer closure, that rebuild throws away
    // the listener pair mid-gesture and attaches a fresh one with its
    // start position back at its unset default, silently misreading
    // where the gesture actually began. A gesture-scoped listener like
    // this one is naturally immune: only the *outer* `pointerdown`
    // listener is ever torn down by a rebuild (via the cleanup this
    // method returns) — a `pointerup` listener already attached for a
    // gesture already in progress keeps its own captured start position
    // and fires normally regardless of how many times the outer listener
    // gets rebuilt around it.
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

  /** Click-to-navigate for spread mode: no drag/flip animation (see
   * `setUpDragPageTurn`'s doc comment), just tap detection independently
   * on each column — reuses `handleContentClick`'s tap-vs-drag/selection/
   * link guards, but with *that column's own width* as the left/right-
   * third reference (via `SpreadPaginatedHost.effectiveColumnWidth`) so
   * "tapping near this page's edge" means the same thing regardless of
   * which of the two side-by-side columns it lands in. Attached to both
   * columns (not just the primary/left one accessibility uses), matching
   * `setUpContentInteraction`'s existing scope: mouse interaction works on
   * both pages of a spread, even though only the left one participates
   * in keyboard/focus accessibility.
   *
   * Also attaches a *third* listener directly to `host.element` (the
   * parent-side container both iframes sit inside, not a cross-document
   * boundary) for the blank-companion-page case: `SpreadPaginatedHost`
   * hides the right column with `visibility: hidden` when there's no
   * next page to show it (see `syncRight`), and a `visibility: hidden`
   * element is never hit-tested at all — a click there passes straight
   * through to whatever's behind it in the *same* document, which is
   * this container, not the (invisible) iframe. Without this, tapping
   * that blank facing page silently did nothing, a real bug caught via
   * real-Chromium interaction: there was simply no listener anywhere
   * that a click landing there could ever reach. Any tap this container-
   * level listener catches — the blank page, or the narrow gutter
   * divider between columns — reasonably means "continue forward", so
   * it always turns the page ahead rather than bucketing into thirds
   * (there's no content there to reference thirds against).
   *
   * Returns a single cleanup function for all three listeners, for
   * `setUpDragPageTurn`'s `dragCleanup` to call as one unit. Every
   * listener pair here is a self-contained, one-shot `pointerup`
   * (attached from inside `pointerdown`, removing itself once it
   * fires) rather than a `pointerup` sharing start-position state with
   * `pointerdown` via an outer closure variable — see
   * `setUpBelowPageClickFallback`'s doc comment for why: this whole
   * method can be, and per `handleWindowRefocus` routinely is, rebuilt
   * in the middle of an already-started gesture, which would otherwise
   * silently separate a `pointerup` from the `pointerdown` that started
   * it. */
  private setUpSpreadClickToNavigate(host: SpreadPaginatedHost): () => void {
    const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(this.width);
    const cleanups: Array<() => void> = [];

    host.contentDocuments().forEach((doc, columnIndex) => {
      // `contentDocuments()` returns the left column first, right
      // second (see its own doc comment) — the right column's own left
      // margin sits at the spine, the *middle* of the whole spread, not
      // its far edge, so a tap there should still mean "forward" like
      // the rest of that page, not "back" (see `handleContentClick`'s
      // `isRightColumn` parameter).
      const isRightColumn = columnIndex === 1;
      const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        const startX = event.clientX;
        const startY = event.clientY;
        const onPointerUp = (upEvent: PointerEvent): void => {
          doc.removeEventListener("pointerup", onPointerUp);
          this.handleContentClick(upEvent, startX, startY, columnWidth, doc, isRightColumn);
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

  /** Tracks one pointer gesture from `pointerdown` through release,
   * turning the page interactively: the outgoing page rotates in direct
   * proportion to how far the pointer has moved (see
   * `setPageTurnTransform`) rather than on a fixed timer, so the reader
   * can see exactly how far "through" the turn they are and change their
   * mind mid-gesture. Direction (forward/back) locks in on the first
   * movement past a small dead zone (so an ordinary tap/click is never
   * misread as a drag), at which point the incoming page begins loading
   * (see `prepareIncomingPage`) — if the pointer is released before that
   * finishes, `settleDragPageTurn` is invoked as soon as it does, using
   * whatever fraction was last recorded. */
  private beginDragPageTurn(startEvent: PointerEvent, doc: Document): void {
    if (this.isTurningPage || !(this.host instanceof PaginatedContentHost)) {
      return;
    }
    const oldHost = this.host;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const containerWidth = Math.max(1, this.width);
    // "scroll" (issue #63) needs the incoming page to visibly move in
    // lockstep with the outgoing one throughout the drag, not just sit
    // revealed-but-static underneath it the way every other style
    // treats it (see `scrollDragEnterAmount`).
    const isScroll = this.pageTurnAnimationStyle === "scroll";

    let direction: 1 | -1 | undefined;
    let newHost: PaginatedContentHost | undefined;
    let preparing = false;
    let released = false;
    let latestFraction = 0;
    let capturedToken: number | undefined;
    // See `animatePageTurn`'s identical use of both — "slide" needs a
    // backdrop behind `oldHost.element` masking the gap a short page's
    // dropped clip-path would otherwise let `prepared` show through;
    // "rotate" needs a mask over the region `growToFullHeight` newly
    // exposes on `oldHost.element` itself. Built once, as soon as
    // `direction` locks in and `prepared` resolves (see below) — same
    // lifetime as the drag gesture itself, cleaned up by
    // `settleDragPageTurn` once the drag finishes either way.
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
            // Every overlapping-iframe style needs `clip-path` dropped
            // from *both* sides for the drag's duration — see
            // `animatePageTurn`'s identical reasoning (issue #81's
            // Chromium compositing bug isn't specific to "rotate" or to
            // a committed/animated turn; it applies just as much to
            // this interactive drag preview). Only "rotate" also grows
            // `oldHost`'s height to `this.height` (its own, separate
            // box-shadow-position fix — see `growToFullHeight`'s doc
            // comment); "slide" must not, since growing a short page's
            // iframe *without* a clip-path to bound it would expose
            // however much more of its own document flow fits in the
            // extra height. `settleDragPageTurn` restores whichever of
            // these was actually touched if the drag ends up reverting
            // rather than committing (a commit discards `oldHost`
            // outright and moves on with `prepared` untouched — its own
            // natural `showCurrentPage` state was never disturbed in
            // the first place, since only `oldHost` — never `prepared`
            // — ever had its height grown here).
            //
            // "slide"/"rotate" also need the exact same bleed-masking
            // this same-style committed turn needs (issue #84's gap
            // bleed for "slide"; the newly-exposed-grown-height bleed
            // for "rotate" — see `buildTurnBackdrop`/
            // `buildTurnGrowthMask`'s own doc comments) — a real,
            // previously-missing gap in this interactive preview path
            // specifically, only ever fixed for the click-triggered
            // committed turn until now.
            if (this.pageTurnAnimationStyle === "rotate") {
              oldHost.suppressClipPathForAnimation();
              const naturalHeight = oldHost.element.getBoundingClientRect().height;
              oldHost.growToFullHeight(this.height);
              prepared.suppressClipPathForAnimation();
              turnGrowthMask = this.buildTurnGrowthMask(oldHost.element, naturalHeight);
              if (turnGrowthMask) {
                turnGrowthMask.style.zIndex = "2";
                oldHost.element.parentElement?.insertBefore(turnGrowthMask, oldHost.element.nextSibling);
              }
            } else if (this.pageTurnAnimationStyle === "slide") {
              oldHost.suppressClipPathForAnimation();
              prepared.suppressClipPathForAnimation();
              turnBackdrop = this.buildTurnBackdrop(oldHost.element);
              if (turnBackdrop) {
                turnBackdrop.style.zIndex = "2";
                oldHost.element.parentElement?.insertBefore(turnBackdrop, oldHost.element);
              }
            }
            this.stagePageTurn(oldHost.element, oldHost.element, lockedDirection);
            this.setPageTurnTransform(
              oldHost.element,
              this.pageTurnPartialAmount(lockedDirection, latestFraction),
              latestFraction,
              [...(turnBackdrop ? [turnBackdrop] : []), ...(turnGrowthMask ? [turnGrowthMask] : [])],
            );
            if (isScroll) {
              prepared.element.style.transform = `translateX(${this.scrollDragEnterAmount(lockedDirection, latestFraction)}%)`;
            }
          } else {
            // A chapter boundary — nothing to drag into in this pass.
            this.isTurningPage = false;
          }
        });
      }

      moveEvent.preventDefault();
      const fraction = Math.max(0, Math.min(1, Math.abs(deltaX) / containerWidth));
      latestFraction = fraction;
      if (newHost && direction !== undefined) {
        this.setPageTurnTransform(
          oldHost.element,
          this.pageTurnPartialAmount(direction, fraction),
          fraction,
          [...(turnBackdrop ? [turnBackdrop] : []), ...(turnGrowthMask ? [turnGrowthMask] : [])],
        );
        if (isScroll) {
          newHost.element.style.transform = `translateX(${this.scrollDragEnterAmount(direction, fraction)}%)`;
        }
      }
    };

    const onPointerUp = (upEvent: PointerEvent): void => {
      cleanupListeners();
      if (direction === undefined || capturedToken === undefined) {
        // Never moved past the dead zone — an ordinary tap/click, not a
        // drag. Treat it as click-to-navigate (see `handleContentClick`)
        // rather than as nothing, but only for a genuine release, not a
        // cancelled gesture (e.g. the pointer leaving the window).
        if (upEvent.type === "pointerup") {
          this.handleContentClick(upEvent, startX, startY, containerWidth, doc);
        }
        return;
      }
      released = true;
      if (preparing) {
        // `onPointerMove`'s promise continuation settles this once the
        // incoming page finishes loading.
        return;
      }
      void this.settleDragPageTurn(oldHost, newHost, direction, latestFraction, capturedToken, turnBackdrop, turnGrowthMask);
    };

    doc.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("pointerup", onPointerUp);
    doc.addEventListener("pointercancel", onPointerUp);
  }

  /** Maximum total pointer movement (in either axis, px) between
   * `pointerdown` and `pointerup` for a gesture to still count as a tap
   * rather than an aborted drag/selection — deliberately generous enough
   * to absorb ordinary hand tremor, but small enough that a real text
   * selection drag (which usually moves well past this before the
   * pointer is released) never gets misread as a page-turn tap. */
  private static readonly CLICK_MOVEMENT_TOLERANCE = 10;

  /** Click-to-navigate: turns the page when a tap/click lands in the
   * left or right third of the reading pane, and does nothing in the
   * middle third (reserved for a future "show/hide chrome" tap target,
   * and simply safe to leave inert for now). Only reachable when
   * `beginDragPageTurn`'s pointer gesture never crossed its drag
   * dead-zone, so this never fires alongside an actual page-turn drag.
   * Two additional guards keep it from misfiring: an active text
   * selection (the user was dragging to select, not tapping) and a click
   * that landed on an `<a href>` (already handled, and already
   * navigated, by `setUpContentInteraction`'s own click listener — turning
   * the page *as well* would be a confusing double-navigation).
   *
   * `isRightColumn` (spread mode only — always `false` for a single
   * page, which has no "which column" to speak of) flips the left
   * third's meaning from "back" to "forward": the right column's own
   * left margin sits right at the book's spine, the *middle* of the
   * whole two-page spread, not its far edge — physically nothing like
   * the true "go back" gesture of tapping the spread's actual left
   * edge (the left column's own left margin). Only that one zone means
   * "back"; every other tap zone across the whole spread means
   * "forward" (or is inert, for the two middle thirds). */
  private handleContentClick(
    upEvent: PointerEvent,
    startX: number,
    startY: number,
    containerWidth: number,
    doc: Document,
    isRightColumn = false,
  ): void {
    const deltaX = Math.abs(upEvent.clientX - startX);
    const deltaY = Math.abs(upEvent.clientY - startY);
    if (
      deltaX > ReaderController.CLICK_MOVEMENT_TOLERANCE ||
      deltaY > ReaderController.CLICK_MOVEMENT_TOLERANCE
    ) {
      return;
    }

    // `doc` is passed in directly by the caller (which already knows
    // exactly which content document this gesture belongs to) rather
    // than derived here via `upEvent.target instanceof Node` — a real,
    // confirmed bug found via testing: `Node` inside `ReaderController`
    // resolves to the *parent* window's own `Node` constructor, but
    // `upEvent.target` for a pointer event dispatched inside a
    // cross-document iframe is an instance of *that iframe's own*,
    // separate-realm `Node` class. `instanceof` checks identity against
    // a specific constructor, so this always evaluated to `false` for
    // every content-iframe event, silently disabling the selection
    // guard below (issue #74): a Shift+click (or any tap) that landed
    // in the left/right third of a two-page spread's column turned the
    // page even with an active, non-collapsed text selection, since the
    // guard's `selection` was always `undefined` and so never actually
    // blocked anything.
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }

    if ((upEvent.target as Element | null)?.closest?.("a[href]")) {
      return;
    }

    // A tap that landed on an existing highlight (issue #62): don't
    // *also* treat it as a page-turn tap just because it happens to sit
    // in one of the left/right third-of-the-page turn zones —
    // `setUpHighlightSelection`'s own `pointerup` listener is about to
    // open that highlight's action popup for this exact same click, and
    // turning the page out from under it at the same time left a popup
    // referencing a highlight no longer on screen (its "close" was
    // still wired to the page that's no longer there).
    if (this.findHighlightAtPoint(doc, upEvent.clientX, upEvent.clientY)) {
      return;
    }

    const thirdWidth = containerWidth / 3;
    if (startX < thirdWidth) {
      void this.turnPage(isRightColumn ? 1 : -1);
    } else if (startX > containerWidth - thirdWidth) {
      void this.turnPage(1);
    }
    // Middle third: no-op for now.
  }

  /** Resolves a drag gesture once released (and, if it was still loading,
   * once the incoming page finishes preparing): animates the rest of the
   * way to completion if the drag crossed `DRAG_COMMIT_THRESHOLD`, or back
   * to closed otherwise, then either swaps in the new host (committed —
   * the same finalization `animatePageTurn`'s caller does: re-attach
   * link/keyboard/drag handling, announce, persist progress) or disposes
   * it unused (cancelled). `newHost` is `undefined` if the drag crossed a
   * chapter boundary, in which case there's nothing to animate or commit —
   * this pass doesn't support dragging across a chapter. `token` is
   * this gesture's `turnToken`, checked before committing — see
   * `turnToken`'s doc comment. */
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

    // Captured up front, before anything below disposes `oldHost` — see
    // `iframeHasFocus`/`restoreFocusAfterHostSwap`'s doc comments.
    const hadKeyboardFocus = this.iframeHasFocus(oldHost);
    const oldEl = oldHost.element;
    const newEl = newHost.element;
    const commit = fraction >= ReaderController.DRAG_COMMIT_THRESHOLD;
    const reduceMotion = this.shouldSkipPageTurnAnimation();
    // "scroll" (issue #63) moved `newEl` in lockstep with `oldEl`
    // throughout the drag (see `beginDragPageTurn`'s `scrollDragEnterAmount`
    // calls) — every other style leaves it completely static, revealed
    // rather than moved, so only "scroll" needs to also animate it here.
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
        // "scroll" draws no box-shadow (see `playScrollTurn`'s doc
        // comment) — only the other styles need that second transitioned
        // property.
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
            this.setPageTurnTransform(oldEl, direction === 1 ? -100 : 100, 1, extraEls);
            if (isScroll) {
              newEl.style.transform = "translateX(0%)";
            }
          } else {
            this.setPageTurnTransform(oldEl, 0, 0, extraEls);
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
      // A newer turn started and finished while this one's completion
      // animation was still running — discard this stale result instead
      // of clobbering the newer state (see `turnToken`).
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
      // Same reasoning as `turnPageInternal`'s identical line — a
      // committed drag page turn also swaps in new content without
      // otherwise invalidating a still-open highlight action popup.
      this.activeHighlight = undefined;
      oldHost.dispose();
      newEl.style.position = "";
      newEl.style.top = "";
      newEl.style.left = "";
      newEl.style.transform = "";
      newEl.style.zIndex = "";
      // `newHost` survives as the new `this.host` — restore whatever
      // `suppressClipPathForAnimation` (see `beginDragPageTurn`) may
      // have touched on it while it sat revealed underneath for the
      // drag's duration (a no-op, via `showCurrentPage`, if it never
      // actually applied).
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
      this.setUpHighlightSelection();
      this.applyHighlightsToCurrentHost();
      this.restoreFocusAfterHostSwap(hadKeyboardFocus);
      this.announce(`Page ${newHost.currentPageIndex + 1} of ${newHost.pageCount}`);
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

  /** Assembles the Book Details panel's data — combines metadata already
   * parsed from the OPF (no I/O needed) with the original file name and
   * cover image, which live in `LibraryDatabase` and need an async read.
   * The cover's object URL is created at most once per controller (see
   * `cachedCoverUrl`) since repeatedly creating one on every panel open
   * would leak URLs that are never revoked until `dispose()` anyway. */
  public async getBookDetails(): Promise<BookDetails> {
    const libraryRecord = await this.library.getBookMetadata(this.bookId);

    if (this.cachedCoverUrl === undefined) {
      const coverBlob = await this.library.getCoverBlob(this.bookId);
      if (coverBlob) {
        this.cachedCoverUrl = URL.createObjectURL(coverBlob);
      }
    }

    // The EPUB's own author-supplied description always wins; the
    // fetched fallback is only ever shown in its absence, and only ever
    // rendered with attribution back to whichever free source it came
    // from (see `BookDetails.descriptionSourceName`).
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
    };
  }

  /** Triggered once from `open()` (fire-and-forget, never awaited) for
   * every book that has no author-supplied `dc:description` — tries to
   * fetch a free fallback description (see
   * `BookDescriptionEnrichment.fetchBookDescription`) and persists
   * whatever the result is (found, or "nothing, attempt N") back to
   * `LibraryDatabase`. Skips entirely, with no network request at all,
   * once a description has already been found or the retry budget
   * (`MAX_DESCRIPTION_FETCH_ATTEMPTS`) is used up — so a book that will
   * plainly never have one doesn't cause a request on every future open. */
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

  /** Assembles the EPUB Inspector panel's data (issue #46) — the raw
   * archive's file list plus a parsed view of the book's own metadata/
   * manifest/spine. Everything here is already in memory (parsed once
   * at `open`), so unlike `getBookDetails` this needs no I/O at all —
   * only reading a *specific* file's raw source (see
   * `readInspectionFileText`) touches the archive again. */
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
      })),
    };
  }

  /** Orders the Inspector's file list so the "standard" EPUB structure
   * files (the mimetype marker, the OCF container's own META-INF/*
   * files, the OPF package document, the NCX, and the Nav Document) come
   * first — the handful of files that establish how the rest of the book
   * is organized — followed by the spine's chapters in reading order,
   * then every other manifest resource (images/fonts/css/etc.), and
   * finally anything left over that isn't a manifest resource at all.
   * Without this, the list is just whatever order the ZIP's central
   * directory happened to store entries in, which tells an author
   * nothing about the book's actual structure. */
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
          // Within the spine group, reading order rather than original
          // archive order — the whole point of singling this group out.
          return (spineOrder.get(a.file.path) ?? 0) - (spineOrder.get(b.file.path) ?? 0);
        }
        return a.originalIndex - b.originalIndex;
      })
      .map(({ file }) => file);
  }

  /** Reads one archive file's raw text as-is, for the EPUB Inspector's
   * file browser (issue #46) — an EPUB author viewing their own book's
   * actual OPF/NCX/Nav/CSS/etc. source, not a rendering path (no XHTML
   * parsing, no CSP/resource-URL rewriting the way `ContentLoader.
   * loadContentDocument` does for the reading surface). Rejects if
   * `path` doesn't exist in the archive — the shell should only ever
   * call this with a path taken from `getEpubInspectionData().files`. */
  public readInspectionFileText(path: string): Promise<string> {
    return this.contentLoader.readArchiveFileText(path);
  }

  /** Builds (and caches, per path) an object URL for an archive member
   * the Inspector's Files tab wants to preview as an image/audio/video
   * element rather than text — the binary counterpart to
   * `readInspectionFileText`, since those media types should never be
   * decoded and displayed as text (see `classifyInspectionFile`). The
   * caller supplies `mediaType` (already resolved via
   * `classifyInspectionFile`/`guessMediaType`) so the `Blob` carries the
   * right type for the `<img>`/`<audio>`/`<video>` element to use it. */
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

  /** Basic reader state, gathered fresh each time — included alongside
   * the recent-events trail in `getDiagnosticsText`/the auto-`console.error`
   * dump on a real navigation error, so a report doesn't also need to
   * separately ask "what book, what view mode, what size window." */
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

  /** Formats the current diagnostics trail (see `DiagnosticsLog`) plus
   * basic reader state as plain text — the "Copy diagnostics" action
   * shown alongside a navigation error calls this to put a full report
   * on the clipboard in one step, in place of a screenshot plus guesswork. */
  public getDiagnosticsText(): string {
    return this.diagnostics.format(this.diagnosticsContext());
  }

  /** Loads the adjacent chapter directly (both view modes) — the
   * "previous/next chapter" toolbar actions, as distinct from `turnPage`
   * which only steps by one page within paginated mode. */
  public async goToChapter(direction: 1 | -1): Promise<void> {
    const nextSpineIndex = this.spineIndex + direction;
    if (nextSpineIndex < 0 || nextSpineIndex >= this.pkg.spine.length) {
      return;
    }
    await this.openSpineItem(nextSpineIndex);
  }

  /** A live, side-effect-free preview of where a progress-scrubber drag
   * at `fraction` (0 to 1 across the whole book) would land, for the
   * scrubber to show in its drag popup without actually navigating
   * there on every pointer move — only `seekToFraction` (called once,
   * on release) actually commits it. Prefers an exact, book-wide page
   * number when `bookPagination` has fully measured the book; falls
   * back to a coarser chapter-level preview otherwise (see
   * `seekToFraction`'s doc comment for why).
   *
   * Returns raw position data (`position`) rather than an already-
   * formatted string — this class has no access to the current UI
   * locale (it isn't a React component and can't call
   * `useTranslation()`), so `ProgressScrubber` itself does the actual
   * `t("scrubber.pageOfTotal", ...)`/`t("scrubber.chapterOfTotal", ...)`
   * formatting once this data reaches it. `chapterLabel` is different:
   * it's the book's *own* chapter name (from its TOC), not a piece of
   * this app's UI text, so there's nothing to translate there — it's
   * passed through as-is regardless of UI locale. */
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

  /** Jumps to `fraction` (0 to 1) of the way through the whole book —
   * the progress scrubber's "drop" action, once a drag settles.
   * Prefers exact, book-wide page-level seeking when `bookPagination`
   * has fully measured every spine item (via `resolveGlobalPage`,
   * landing on the precise page); falls back to coarser spine-level
   * seeking (landing *partway through* whichever chapter the fraction
   * points at, via `resolveSpineFraction` — not always its very first
   * page, which was a real bug: a chapter spanning many pages made the
   * scrubber feel like it always undershot wherever the reader actually
   * released it) when the book isn't fully measured yet — a very large
   * book's background pagination can take a while, and the scrubber
   * should still be usable in the meantime, just less precisely. */
  public async seekToFraction(fraction: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.diagnostics.record(`seekToFraction fraction=${fraction} clamped=${clamped}`);
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

  /** Picks a spine item and a 0-to-1 fraction within it for a coarse,
   * spine-level seek — shared by `previewSeek`'s label and
   * `seekToFraction`'s actual navigation when `bookPagination` hasn't
   * fully measured the book yet. Treats the whole book as
   * `spine.length` equal-width slots (a simplifying assumption — real
   * chapters vary widely in length — but the best available one without
   * full measurement, and far better than treating every chapter as a
   * single point): `fraction` selects both which slot it falls in and
   * how far through that slot, so a drag partway through a long
   * chapter's share of the book lands partway through that chapter, not
   * always at its very first page. */
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
    await this.openSpineItem(spineIndex, { fragment: navPoint.fragment });
  }

  /** Animates the reveal of `stagingEl` (an already-loaded
   * `openSpineItem` host, correctly positioned at its opening
   * page/spread, but still hidden per `stageHiddenHostElement`) in
   * place of whatever `previousWrapperEl` (or `previousHost.element`,
   * if the previous turn was itself an animated one that left no
   * wrapper — see `clearStaleHostWrapper`) currently shows — playing
   * the *same* rotate/slide/scroll page-turn animation an in-chapter
   * page turn already uses, so crossing a chapter boundary via
   * `turnPage` reads as "just another page turn" instead of the abrupt
   * instant snap it used to be (issue #83).
   *
   * "rotate" is treated the same way `animatePageTurn`'s single-page
   * case treats it (growing the animating side to full height, no
   * `buildRotateBackFace`/full-180° completion) even in spread mode —
   * deliberately simpler than `animateSpreadTurn`'s own "rotate" turn,
   * which flips only the single column nearest the spine (see
   * `elementToTurn`): a distinction that stops making much sense across
   * a whole chapter boundary, where the *entire* incoming spread is a
   * new unit, not "the back of the same physical leaf" the way a
   * same-chapter spread turn's column swap is. Reads as a slightly
   * plainer flip than an in-chapter spread turn, but consistent and
   * correct rather than needing its own bespoke back-face geometry for
   * a style that's no longer even the default.
   *
   * Requires `previousHost`/`newHost` to be the same concrete type as
   * each other (both `PaginatedContentHost` or both
   * `SpreadPaginatedHost`) — always true in practice, since the
   * reader's width and view mode (which together decide which of the
   * two a spine item resolves to) never change mid-turn — and returns
   * `false` without doing anything if that invariant somehow doesn't
   * hold, rather than throwing.
   *
   * Follows `animatePageTurn`'s own "entering" convention exactly (see
   * its doc comment): a backward turn (`direction === -1`) plays as the
   * *incoming* (previous chapter's) content turning in on top, not the
   * current content turning away to reveal it underneath — crossing a
   * chapter boundary should feel identical to turning within one.
   *
   * Returns `true` once the animation has actually played (the caller
   * should then treat `stagingEl` as already fully revealed); `false`
   * if skipped for any reason above, `prefers-reduced-motion`, or the
   * reader's own "none" choice (`shouldSkipPageTurnAnimation`) — the
   * caller's own existing instant-reveal code runs unconditionally
   * right after regardless, which is a harmless no-op once this has
   * already revealed everything itself. */
  private async animateChapterCrossingReveal(
    previousHost: PaginatedContentHost | SpreadPaginatedHost,
    previousWrapperEl: HTMLDivElement | undefined,
    newHost: PaginatedContentHost | SpreadPaginatedHost,
    stagingEl: HTMLDivElement,
    direction: 1 | -1,
    oldSpineIndex: number,
    newSpineIndex: number,
  ): Promise<boolean> {
    if (!this.containerEl || this.shouldSkipPageTurnAnimation()) {
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
      // See `animatePageTurn`'s identical single-page reasoning: the
      // animating side grows to `this.height` (its own, separate box-
      // shadow-position fix), while the other side just needs
      // `clip-path` dropped so it doesn't fail to composite opaquely
      // against the animating side's own 3D transform (issue #81).
      //
      // Measuring natural height *after* `suppressClipPathForAnimation`
      // (which `growToFullHeight`/`growColumnToFullHeight` call
      // internally anyway, first thing, before growing) rather than
      // before it — see `buildTurnGrowthMask`'s doc comment and
      // `animatePageTurn`'s identical fix: measuring before it would
      // capture the *pre-shrink* height (with the bottom inset band
      // still included), leaving a real gap exactly that band's height
      // tall for bleed to sneak through unmasked.
      //
      // Both masks are inserted as *siblings of `animatingEl`* (not of
      // the column/iframe element `buildTurnGrowthMask` measured to
      // position them) — unlike the single-page/same-chapter case,
      // where the iframe getting the rotation transform *is*
      // `animatingEl` itself, here `animatingEl` is the *wrapper*
      // (`stageHiddenHostElement`'s div, or a previous turn's leftover
      // one) with the actual iframe(s) nested one level inside it.
      // Inserting a mask as a *child* of that wrapper (a sibling of the
      // iframe) would have it inherit the wrapper's own rotation
      // transform from `playPageTurnAnimation` *and* get its own
      // (`extraTurnEls`) applied on top — doubling the rotation. As a
      // sibling of the wrapper instead, it only ever gets the one
      // rotation `extraTurnEls` applies directly.
      if (bothSpread) {
        const spreadAnimatingHost = animatingHost as SpreadPaginatedHost;
        const leftEl = this.spreadColumnElement(spreadAnimatingHost, 0);
        const rightEl = this.spreadColumnElement(spreadAnimatingHost, 1);
        spreadAnimatingHost.suppressColumnClipPathForAnimation("left");
        spreadAnimatingHost.suppressColumnClipPathForAnimation("right");
        const leftNaturalHeight = leftEl.getBoundingClientRect().height;
        const rightNaturalHeight = rightEl.getBoundingClientRect().height;
        spreadAnimatingHost.growColumnToFullHeight("left", this.height);
        spreadAnimatingHost.growColumnToFullHeight("right", this.height);
        (otherHost as SpreadPaginatedHost).suppressColumnClipPathForAnimation("left");
        (otherHost as SpreadPaginatedHost).suppressColumnClipPathForAnimation("right");
        turnGrowthMaskLeft = this.buildTurnGrowthMask(leftEl, leftNaturalHeight);
        turnGrowthMaskRight = this.buildTurnGrowthMask(rightEl, rightNaturalHeight);
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
        turnGrowthMaskLeft = this.buildTurnGrowthMask(singleAnimatingHost.element, naturalHeight);
        if (turnGrowthMaskLeft) {
          turnGrowthMaskLeft.style.zIndex = "2";
          animatingEl.parentElement?.insertBefore(turnGrowthMaskLeft, animatingEl.nextSibling);
        }
      }
    } else if (this.pageTurnAnimationStyle === "slide") {
      // See `animatePageTurn`'s identical reasoning (issues #81/#84):
      // every overlapping-iframe style needs `clip-path` dropped from
      // *both* sides for the whole duration, regardless of which one
      // is actually animating.
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

    // Reveal the staging element so it can actually participate in the
    // animation — its content is already fully loaded and positioned on
    // the correct opening page/spread (see `openSpineItem`'s caller).
    // Also clears the loading spinner (`openSpineItem`'s `isLoading`)
    // before it would otherwise hang, centered, over the whole ~380ms
    // transition — a real, would-be-reported bug of its own otherwise.
    stagingEl.style.opacity = "";
    stagingEl.style.pointerEvents = "";
    this.isLoading = false;

    let turnBackdrop: HTMLDivElement | undefined;
    if (this.pageTurnAnimationStyle === "slide") {
      turnBackdrop = this.buildTurnBackdrop(animatingEl);
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
      outgoingOverlay = this.buildTurnFurnitureOverlay(oldEl, bands(oldChapterLabel, oldPrimary, oldSecondary));
      incomingOverlay = this.buildTurnFurnitureOverlay(newEl, bands(newChapterLabel, newPrimary, newSecondary));
    } else {
      const oldSingle = previousHost as PaginatedContentHost;
      const newSingle = newHost as PaginatedContentHost;
      const oldNumber = this.furniturePageNumber(oldSpineIndex, oldSingle.currentPageIndex, oldSingle.pageCount);
      const newNumber = this.furniturePageNumber(newSpineIndex, newSingle.currentPageIndex, newSingle.pageCount);
      outgoingOverlay = this.buildTurnFurnitureOverlay(oldEl, [
        {
          left: 0,
          width: oldEl.getBoundingClientRect().width,
          header: { mode: "split" as const, left: title, right: oldChapterLabel },
          footerText: oldNumber !== undefined ? `Page ${oldNumber}` : undefined,
        },
      ]);
      incomingOverlay = this.buildTurnFurnitureOverlay(newEl, [
        {
          left: 0,
          width: newEl.getBoundingClientRect().width,
          header: { mode: "split" as const, left: title, right: newChapterLabel },
          footerText: newNumber !== undefined ? `Page ${newNumber}` : undefined,
        },
      ]);
    }

    if (isScroll) {
      // Both overlays move (with their own page) rather than one
      // sitting static underneath the other — see `animatePageTurn`'s
      // identical reasoning.
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
      await this.playScrollTurn(oldGroup, newGroup, direction);
    } else {
      const animatedOverlayEl = entering ? incomingOverlay : outgoingOverlay;
      await this.playPageTurnAnimation(
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
      // `newHost` always survives this turn (the caller disposes
      // `previousHost` right after) — restore whatever
      // `growColumnToFullHeight`/`suppressColumnClipPathForAnimation`/
      // `suppressClipPathForAnimation` may have touched on it,
      // mirroring `animatePageTurn`'s identical cleanup (a no-op, via
      // `showCurrentPage`, for whichever style never actually needed
      // it).
      if (bothSpread) {
        (newHost as SpreadPaginatedHost).restoreColumnNaturalHeight("left");
        (newHost as SpreadPaginatedHost).restoreColumnNaturalHeight("right");
      } else {
        (newHost as PaginatedContentHost).restoreNaturalHeight();
      }
    }

    // Only `stagingEl` survives this turn (`oldEl`/`previousWrapperEl`
    // is disposed by the caller right after) — reset whatever transform/
    // z-index/box-shadow the animation above may have applied to it
    // (only actually touched when `entering`, i.e. `animatingEl ===
    // newEl === stagingEl`; a harmless no-op otherwise) back to
    // `stageHiddenHostElement`'s own plain resting state.
    stagingEl.style.transform = "";
    stagingEl.style.zIndex = "";
    stagingEl.style.boxShadow = "";
    stagingEl.style.transition = "";
    if (otherEl === oldEl) {
      // Defensive only — `oldEl` is about to be disposed by the caller
      // regardless, but leaves nothing dangling if that ever changes.
      otherEl.style.zIndex = "";
    }

    return true;
  }

  /** Creates a hidden, out-of-flow staging wrapper inside `containerEl`
   * and attaches `el` to it — used by `openSpineItem` to load a new
   * spine item's host *without* disturbing whatever is currently
   * displayed. `opacity: 0` plus `position: absolute` keeps it
   * invisible and out of the normal-flow flex layout the currently-
   * visible host relies on for centering, so the old content is
   * completely undisturbed until/unless the new load actually succeeds.
   *
   * Critically, whatever's inside this wrapper is *never* moved to a
   * different parent afterwards — only ever revealed in place by
   * clearing the wrapper's own `opacity`/`pointer-events`, or removed
   * outright (wrapper and all) via `.remove()`. This was a real,
   * confirmed regression the first version of this mechanism had: moving
   * an already-loaded `<iframe>` to a new DOM parent (even within the
   * same still-attached document) reloads its content in most browsers
   * — silently discarding every JS mutation applied to that content
   * after it first loaded, including `PaginatedContentHost.open`'s own
   * `iframeDocument.documentElement.style.overflow = "hidden"`. The
   * *outer* iframe element's own styling (`clip-path`/`transform`, which
   * `PaginatedContentHost` also sets, and which live on the iframe
   * element itself, not inside its content document) survived the
   * reload, so pagination still looked correct — but the reloaded
   * content's overflow was back to its un-hidden default, exposing the
   * content's own native scrollbar as a visible artifact. See the
   * same hazard already documented on `prepareIncomingPage`, which this
   * mechanism now follows the same discipline as. */
  private stageHiddenHostElement(el: HTMLElement): HTMLDivElement {
    const containerEl = this.containerEl!;
    const stagingEl = containerEl.ownerDocument.createElement("div");
    stagingEl.style.position = "absolute";
    stagingEl.style.inset = "0";
    // `opacity: 0`, not `visibility: hidden` — see `prepareIncomingPage`/
    // `prepareIncomingSpread`'s identical fix (issue #84) for the
    // confirmed reason: a `SpreadPaginatedHost`'s right column sets its
    // *own* explicit `visibility` (`syncRight`, called by `open()`
    // itself as soon as the opening page has a companion) — which
    // overrides an ancestor's inherited `hidden` state, so the right
    // column could flash its own (still being paginated, momentarily
    // unclipped/oversized) content on top of whatever this wrapper was
    // supposed to be hiding it behind. `opacity` has no such override:
    // every ancestor's opacity always multiplies into a descendant's
    // final rendered alpha, regardless of what the descendant sets its
    // own opacity to.
    stagingEl.style.opacity = "0";
    stagingEl.style.pointerEvents = "none";
    stagingEl.style.display = "flex";
    stagingEl.style.justifyContent = "center";
    stagingEl.style.alignItems = "flex-start";
    // The current host's element (once revealed) sits one level deeper
    // in the DOM than it used to (a child of this wrapper, not of
    // `containerEl` directly) — `transform-style: preserve-3d` here lets
    // `containerEl.style.perspective` (set for the "rotate" page-turn
    // animation — see `animatePageTurn`) still apply through this
    // wrapper to reach it, exactly as if it were still a direct child.
    // Without this, `perspective` only establishes a 3D space for an
    // element's own *direct* children, and the rotate animation would
    // silently fall flat (a plain 2D transform, no hinge depth).
    stagingEl.style.transformStyle = "preserve-3d";
    stagingEl.appendChild(el);
    containerEl.appendChild(stagingEl);
    return stagingEl;
  }

  /** An animated page/spread turn (`animatePageTurn`/`animateSpreadTurn`)
   * swaps in a brand-new host attached *directly* to `containerEl` (see
   * `prepareIncomingPage`/`prepareIncomingSpread`) rather than inside
   * whatever wrapper `openSpineItem`'s staged-hidden-host swap (see
   * `stageHiddenHostElement`) mounted the *previous* host in — so once a
   * turn commits, `this.hostWrapperEl` is stale: it still refers to that
   * now-empty wrapper (the old host it contained was just disposed by
   * the turn), not anything actually holding the new host. Harmless to
   * leave sitting in the DOM indefinitely — it's invisible, and (being
   * earlier in DOM order with no explicit stacking of its own) paints
   * behind the real content, so it never intercepts a click meant for
   * anything real — but confusing and wrong to leave `this.hostWrapperEl`
   * pointing at it. Call this right after swapping in an animated turn's
   * new host so the field accurately reflects "not currently wrapped"
   * until the next `openSpineItem` call wraps a fresh host again. */
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
      /** Set by `turnPageInternal`'s chapter-boundary fallback (issue
       * #83) — plays the same slide/scroll page-turn animation an
       * in-chapter turn already uses for this chapter *crossing*
       * instead of the instant snap every other `openSpineItem` caller
       * gets (TOC jumps, resume-reading, deep links, etc., which have
       * no "direction" to animate along in the first place). See
       * `animateChapterCrossingReveal`'s own doc comment for exactly
       * which styles/host types this actually covers. */
      animateDirection?: 1 | -1;
    } = {},
  ): Promise<void> {
    if (!this.containerEl) {
      return;
    }

    this.error = undefined;
    this.errorSeverity = undefined;
    this.isLoadInFlight = true;
    // See this method's doc comment on `spineOpenToken` for why every
    // return path below (including the catch block) must check this
    // before touching any shared state.
    const token = ++this.spineOpenToken;
    // Issue #88: only actually *show* the loading spinner if this load
    // takes long enough to be worth interrupting the reader over — most
    // spine-item loads (including every chapter-boundary crossing while
    // turning pages) resolve near-instantly, and flashing a spinner for
    // a handful of milliseconds read as more distracting than no
    // feedback at all. `finished` (not just `token === this.spineOpenToken`,
    // which stays true for this exact call until a *newer* one starts)
    // guards against the timer firing after this same call has already
    // completed — e.g. a fast load finishing before the 200ms elapses —
    // which would otherwise flip the spinner back on with nothing left
    // to ever turn it back off again.
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
      this.highlightSelectionCleanup?.();
      this.highlightSelectionCleanup = undefined;
      this.pendingSelectionRange = undefined;
      this.selectionToolbar = undefined;
      this.activeHighlight = undefined;

      // The new host is opened hidden, alongside whatever is already on
      // screen, rather than disposing the old one up front — see
      // `stageHiddenHostElement`'s doc comment. `previousHost` is only
      // disposed once the new content has *actually* loaded
      // successfully, so a load failure (a real hazard: malformed
      // chapters, missing resources — this isn't hypothetical, see
      // issue #27) leaves the reader exactly where it was instead of a
      // blank pane, and makes the "transient" severity classification in
      // the catch block below actually true rather than a stale
      // reference to an already-disposed host.
      const previousHost = this.host;
      const previousWrapperEl = this.hostWrapperEl;
      const resolvedLayout = this.pkg.spine[spineIndex]?.resolveRenditionLayout(
        this.pkg.metadata.renditionLayout,
      );
      let stagingEl: HTMLDivElement | undefined;
      // Assigned as soon as the host object is *constructed* (not once
      // `open()` succeeds) so the catch block below can always dispose
      // whatever was created, even a load that never finished — without
      // this, a failed load leaked that attempt's blob URL(s) forever.
      let createdHost: FixedContentHost | SpreadPaginatedHost | PaginatedContentHost | ScrollContentHost | undefined;
      let applyDisplaySettings = false;
      try {
        if (resolvedLayout === "pre-paginated") {
          const fixedHost = new FixedContentHost(this.width, this.height);
          createdHost = fixedHost;
          stagingEl = this.stageHiddenHostElement(fixedHost.element);
          await fixedHost.open(
            this.contentLoader,
            this.resolver,
            spineIndex,
            this.pkg.metadata.renditionViewport,
          );
        } else if (this.viewMode === "paginated" && SpreadPaginatedHost.isEligible(this.width)) {
          const host = new SpreadPaginatedHost(this.width, this.height);
          createdHost = host;
          stagingEl = this.stageHiddenHostElement(host.element);
          await host.open(this.contentLoader, this.resolver, spineIndex);
          applyDisplaySettings = true;
        } else {
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
        // `.remove()`-ing `stagingEl` (rather than moving anything out of
        // it first) is a plain DOM removal, not a reparent — no risk of
        // the reload hazard `stageHiddenHostElement` documents. Disposing
        // `createdHost` too (not just discarding the wrapper) matters
        // even though its iframe is about to be removed either way: a
        // `PaginatedContentHost`/etc. also owns a blob URL for its
        // content, only released via its own `dispose()`.
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
        stagingEl.remove();
        return;
      }

      // Play the chapter-crossing turn animation (issue #83) before the
      // reveal below, if eligible — see `animateChapterCrossingReveal`'s
      // own doc comment for exactly when this applies. Positions the
      // new host on its target page *first* (`landOnLastPage` normally
      // gets applied further down, well after the reveal — too late for
      // an animation to show the right content throughout), since
      // everything else about "which page to land on" for this specific
      // caller (`turnPageInternal`'s chapter-boundary fallback) is
      // already fully decided by `landOnLastPage` alone (a forward
      // crossing already lands on page 0 by default, no options.* need
      // apply at all). Persisted font/theme settings likewise need to
      // land *before* the animation plays, not after — otherwise the
      // turn would visibly play at default settings and only snap to
      // the reader's actual choices once the (normally `this.host`-
      // dependent, called again further below) reveal step ran —
      // hence explicitly passing `newHost` to both here rather than
      // waiting for `this.host` to actually become it.
      let animatedReveal = false;
      if (
        options.animateDirection !== undefined &&
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

      // Success: reveal the new host in place of whatever was showing
      // before, *without ever moving either host's element to a
      // different parent* (see `stageHiddenHostElement`'s doc comment on
      // why that specifically must never happen to an already-loaded
      // iframe). `previousHost.dispose()` removes its own iframe(s) from
      // `previousWrapperEl`, which — now empty — is simply removed
      // outright; the new host's wrapper, in turn, is just revealed in
      // place by clearing the hiding styles `stageHiddenHostElement` set
      // (a no-op if `animatedReveal` already did, right above) — never
      // touching its child's parentage at all.
      previousHost?.dispose();
      previousWrapperEl?.remove();
      stagingEl.style.opacity = "";
      stagingEl.style.pointerEvents = "";
      this.host = newHost;
      this.hostWrapperEl = stagingEl;
      // Skipped if the animation above already applied these — no need
      // to pay for a second (potentially real, relayout-triggering)
      // pass of the exact same settings against the exact same host.
      if (applyDisplaySettings && !animatedReveal) {
        this.applyPersistedDisplaySettingsToFreshHost();
      }

      this.spineIndex = spineIndex;
      this.appliedWidth = this.width;
      this.appliedHeight = this.height;
      this.setUpContentInteraction();
      this.setUpDragPageTurn();
      this.setUpHighlightSelection();
      this.applyHighlightsToCurrentHost();
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
          // The coarse, spine-level progress-scrubber fallback (see
          // `resolveSpineFraction`) only knows a 0-to-1 fraction through
          // this chapter, not an exact page index, until *after* the
          // chapter is open and its real page count is known — unlike
          // `landOnPageIndex`, which already has an exact index computed
          // from a fully-measured book.
          const targetIndex = Math.round(
            options.landOnFractionInItem * Math.max(0, this.host.pageCount - 1),
          );
          this.host.goToPageIndex(targetIndex);
        }
        this.setUpAccessibility();
      }
      this.announce(this.chapterLabel(spineIndex));
      await this.saveProgress();
      this.diagnostics.record(`openSpineItem success spineIndex=${spineIndex} token=${token}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (token === this.spineOpenToken) {
        this.error = message;
        // `this.host` is only ever reassigned *after* a new host has
        // genuinely finished loading (see the staged-hidden-host swap
        // above) — a failed load never disposes or replaces whatever was
        // already showing. So if `this.host` is still set here, that
        // content is still visible on screen right now, and the reader
        // isn't stuck with a blank pane. `undefined` only when this was
        // the very first load (e.g. a corrupt/unreadable book) and there
        // was never anything to fall back to.
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
      // A stale call's failure (see `spineOpenToken`) is expected and
      // silent — its iframe was deliberately detached by whichever newer
      // call superseded it, so of course loading it never completed;
      // that's not a real failure worth alarming the reader over,
      // especially since the newer navigation it lost to has already
      // shown *something* in its place.
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
    this.contentInteractionCleanup?.();
    this.dragCleanup?.();
    this.highlightSelectionCleanup?.();
    this.bookSearch.cancel();
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
