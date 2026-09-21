import type {
  BookIdentifier,
  FontFamilyChoice,
  NavPoint,
  OpfMetaEntry,
  PageTheme,
} from "@ambra/engine";
import type { Highlight } from "../library/LibraryDatabase.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";
import type { SearchResultItem } from "./SearchCoordinator.js";
import type { ViewMode } from "./ViewMode.js";

/** Plain data types describing `ReaderController`'s state and public
 * shapes — kept separate from the controller class itself so anything
 * that only needs, say, `BookDetails` or a `ReaderSnapshot` (React
 * components, other reader modules, tests) never needs to import
 * `ReaderController.ts` itself just to get a type. */

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
  /** This `<itemref>`'s own `properties` attribute (issue #96) — e.g.
   * `page-spread-left`/`page-spread-right`/`page-spread-center` for
   * fixed-layout spread placement, verbatim as declared in the OPF
   * (with or without their `rendition:` prefix; see `SpineItemRef`). */
  readonly properties: readonly string[];
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
  /** `true` when the left column of a spread is showing the *previous*
   * chapter's borrowed last page rather than this chapter's own content
   * (see `SpreadPaginatedHost.isShowingMergedTail`, issue #90/#92) —
   * `bookPageIndex`/`pageIndex` here already describe the *right*
   * column's page (this chapter's own real page 0), not the left
   * column's, so `PageFurniture` needs this to know not to label the
   * left column with a number that's actually the right column's. */
  isPrimaryPageMergedTail: boolean;
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
   * whichever page(s) are on screen right now (see `BookmarkManager.onCurrentPage`)
   * — drives the toolbar's single bookmark button's pressed state (see
   * `toggleBookmark`). Always `false` for scroll mode/fixed-layout
   * content, which have no discrete "page" for a bookmark to be "on". */
  isBookmarked: boolean;
  /** Per-visible-page version of `isBookmarked` (see
   * `BookmarkManager.flagsForCurrentPages`) — one boolean per currently-visible
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
  /** The current reader-controlled page brightness multiplier — see
   * `ReadingTheme.MIN_BRIGHTNESS`/`setBrightness`. Applied by `ReaderApp`
   * itself, as a single `filter` on the whole reading pane, rather than
   * injected into each content document the way every other setting
   * here is — so unlike `fontScale`/`contentWidthEm`/etc., this has no
   * fixed-layout exception to speak of: the same reading-pane `filter`
   * dims fixed-layout content exactly as well as reflowable content. */
  brightness: number;
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
  /** Small on-page markers (parent-viewport coordinates, same anchoring
   * scheme `selectionToolbar`/`activeHighlight` use) for every highlight
   * *with a note* currently visible in the content pane — issue #99: a
   * highlight otherwise looks identical whether or not it has a note
   * attached, so there was no way to tell "this one has more to it"
   * without tapping every highlight in turn to check. Recomputed
   * whenever the current host's highlights are (re)painted, the reader
   * resizes, a note is added/removed, or (continuous-scroll mode only)
   * the content scrolls — see `updateNoteMarkers`. Empty for
   * fixed-layout content, matching every other highlight-related field
   * here. */
  noteMarkers: readonly NoteMarkerState[];
  /** Every highlight in the book, across all spine items, oldest first
   * — for the Highlights tab (see `TocPanel`). Read straight from
   * `HighlightManager`'s in-memory cache on every snapshot, not a
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
   * highlight (issue #60) — tells the shell to open `HighlightActionPopup`
   * for it immediately, the same way clicking an existing highlight
   * later does (`checkExistingHighlightClick`), rather than leaving a
   * plain color-swatch pick with no popup at all. The popup itself no
   * longer has a distinct "note-editing mode" to enter (issue #97: it
   * always shows both the color swatches and the note field at once),
   * so this flag now only decides *whether* the popup opens right after
   * creation, not what it looks like once it has. */
  readonly openNoteEditor?: boolean;
}

/** See `ReaderSnapshot.noteMarkers`. */
export interface NoteMarkerState {
  readonly id: string;
  readonly left: number;
  readonly top: number;
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
