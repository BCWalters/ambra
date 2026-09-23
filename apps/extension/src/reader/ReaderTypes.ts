import type {
  AccessibilityMetadata,
  BookIdentifier,
  FontFamilyChoice,
  NavPoint,
  OpfMetaEntry,
  PageTheme,
} from "@ambra/engine";
import type { Bookmark, Highlight } from "../library/LibraryDatabase.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";
import type { SearchResultItem } from "./SearchCoordinator.js";
import type { ViewMode } from "./ViewMode.js";

/** Plain data types describing `ReaderController`'s state and public
 * shapes, kept separate so consumers don't need to import the
 * controller class itself just to get a type. */

export type PreviewPosition =
  | { readonly kind: "page"; readonly current: number; readonly total: number }
  | { readonly kind: "chapter"; readonly current: number; readonly total: number };

/** What the Book Details panel shows. */
export interface BookDetails {
  readonly title: string;
  readonly creator: string | undefined;
  readonly description: string | undefined;
  /** Set when `description` came from `fetchBookDescription` rather
   * than the EPUB's own metadata, for the "via ..." attribution link. */
  readonly descriptionSourceName: "Open Library" | "Wikipedia" | undefined;
  readonly descriptionSourceUrl: string | undefined;
  readonly publisher: string | undefined;
  readonly language: string;
  readonly identifiers: readonly BookIdentifier[];
  readonly fileName: string | undefined;
  readonly rights: string | undefined;
  /** Object URL for the cover image, revoked on `dispose()`. */
  readonly coverUrl: string | undefined;
  readonly accessibility: AccessibilityMetadata;
}

/** One file inside the EPUB archive, for the file-structure tab of the
 * EPUB inspection panel (issue #46). */
export interface EpubInspectionFile {
  readonly path: string;
  readonly size: number;
  readonly isDirectory: boolean;
  /** Manifest media type, if any; falls back to extension-based
   * guessing for non-manifest files (e.g. `mimetype`). */
  readonly mediaType: string | undefined;
}

/** One manifest entry, for the inspection panel's Metadata tab. */
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
  /** This `<itemref>`'s own `properties` (issue #96), e.g. spread
   * placement for fixed-layout content. */
  readonly properties: readonly string[];
}

/** Everything the EPUB inspection panel shows: the archive's file list
 * plus parsed metadata/manifest/spine. */
export interface EpubInspectionData {
  readonly files: readonly EpubInspectionFile[];
  readonly rootFilePath: string;
  readonly title: string;
  readonly identifiers: readonly BookIdentifier[];
  readonly language: string;
  readonly creator: string | undefined;
  /** Every `dc:creator` element, not just the first. */
  readonly creators: readonly string[];
  readonly publisher: string | undefined;
  readonly description: string | undefined;
  readonly renditionLayout: string;
  readonly renditionOrientation: string;
  readonly rights: string | undefined;
  readonly date: string | undefined;
  readonly subjects: readonly string[];
  readonly contributors: readonly string[];
  readonly metaEntries: readonly OpfMetaEntry[];
  readonly manifest: readonly EpubInspectionManifestItem[];
  readonly spine: readonly EpubInspectionSpineItem[];
}

/** A plain-data snapshot of `ReaderController`'s state — what React
 * reads via `useReaderController`. */
export interface ReaderSnapshot {
  title: string;
  toc: readonly NavPoint[];
  spineIndex: number;
  spineLength: number;
  /** Manifest path of the current spine item, for `TocPanel` to
   * highlight the matching entry. */
  currentSpinePath: string | undefined;
  /** Manifest path of the book's first spine item, so `TocPanel` can
   * offer a synthetic "Start of Book" entry for unlisted front matter. */
  firstSpinePath: string | undefined;
  /** The TOC entry path the shell should highlight as "current". */
  highlightedTocPath: string | undefined;
  /** Book-wide page number of each spine item's first page, keyed by
   * manifest path, for `TocPanel`'s page numbers. */
  tocPageNumbers: ReadonlyMap<string, number>;
  currentChapterLabel: string;
  viewMode: ViewMode;
  /** True when the current spine item is fixed-layout. */
  isFixedLayout: boolean;
  pageIndex: number;
  pageCount: number;
  /** Page position across the whole book, not just the chapter.
   * `undefined` until background pagination measures far enough. */
  bookPageIndex: number | undefined;
  bookPageCount: number | undefined;
  /** True when showing as a two-page spread. */
  isSpread: boolean;
  /** Companion page index in spread mode. */
  secondPageIndex: number | undefined;
  /** True when the spread's left column shows the previous chapter's
   * borrowed last page rather than this chapter's own content. */
  isPrimaryPageMergedTail: boolean;
  /** Book progression, independent of the EPUB text's own CSS direction. */
  pageProgressionDirection?: "ltr" | "rtl";
  /** Page numbers in reading order, including cross-chapter pairs. */
  spreadPageNumbers?: readonly (number | undefined)[];
  /** Reader pane width in CSS pixels. */
  paneWidth: number;
  /** True during an animated page-turn transition. */
  isAnimatingPageTurn: boolean;
  /** True when a bookmark is on the current page. */
  isBookmarked: boolean;
  /** Per-visible-page version of `isBookmarked`. */
  bookmarkedPages: readonly boolean[];
  bookmarks: readonly Bookmark[];
  /** Font-size multiplier; always 1 for fixed-layout content. */
  fontScale: number;
  lineSpacing: number;
  letterSpacing: number;
  contentWidthEm: number;
  fontFamily: FontFamilyChoice;
  pageTheme: PageTheme;
  brightness: number;
  chromeTheme: ChromeThemeChoice;
  pageTurnAnimationStyle: PageTurnAnimationStyle;
  isLoading: boolean;
  error: string | undefined;
  errorNotificationId: number;
  /** "blocking" (nothing readable on screen), "transient" (a navigation
   * failed but the previous content is still shown, auto-dismisses),
   * "actionFailed" (a reader-initiated action, e.g. an annotation
   * import, produced nothing usable — weightier than "transient" and
   * doesn't auto-dismiss, since silently timing out on a deliberate
   * action reads as broken — see issue #114), or "info" (a non-error
   * acknowledgement, e.g. "you already had all of these annotations" —
   * see issue #115 — same quiet placement/timing as "transient" but
   * without its "that didn't work" framing, since nothing failed). */
  errorSeverity: "blocking" | "transient" | "actionFailed" | "info" | undefined;
  /** A smaller, de-emphasized technical detail shown alongside `error`
   * for "actionFailed" errors — see issue #119. */
  errorDetail: string | undefined;
  /** Text for the shell's `aria-live` region. */
  announcement: string | undefined;
  /** Increments on every announcement so `LiveRegion` re-announces even
   * repeated identical text. */
  announcementId: number;
  /** Increments on every pointerdown in the content, so `Toolbar` can
   * hide itself immediately. */
  contentPointerActivityId: number;
  imageViewer: ImageViewerState | undefined;
  selectionToolbar: SelectionToolbarState | undefined;
  activeHighlight: ActiveHighlightState | undefined;
  noteMarkers: readonly NoteMarkerState[];
  highlights: readonly Highlight[];
  searchQuery: string;
  searchResults: readonly SearchResultItem[];
  isSearching: boolean;
  footnotePopup: FootnotePopupState | undefined;
}

export interface SelectionToolbarState {
  readonly left: number;
  readonly top: number;
}

export interface ActiveHighlightState {
  readonly highlight: Highlight;
  readonly left: number;
  readonly top: number;
  /** True right after creation, to open the note editor immediately
   * (issue #60). */
  readonly openNoteEditor?: boolean;
}

export interface NoteMarkerState {
  readonly id: string;
  readonly left: number;
  readonly top: number;
}

/** One entry from a publisher-embedded, read-only annotation collection
 * (issue #109) — merged directly into the Bookmarks/Highlights panel's
 * own two tabs (issue #116: a separate, rarely-populated third "Notes"
 * tab didn't fit the panel's fixed width alongside the other two, and
 * having a whole extra tab for what's usually zero or one item wasn't
 * worth it anyway). Unlike `Bookmark`/`Highlight`, never persisted to
 * `LibraryDatabase`: these live entirely in the EPUB itself and are
 * simply re-read (via `ReaderController.listEmbeddedAnnotations`) every
 * time the book opens. */
export interface ReadOnlyAnnotationView {
  readonly id: string;
  /** The CFI to navigate to on selection — the start of the range for a
   * highlight-shaped annotation, the sole point for anything else. */
  readonly cfi: string;
  readonly label: string;
  readonly note: string | undefined;
  /** Which tab this shows up in — see `classifyReadOnlyAnnotationKind`. */
  readonly kind: "highlight" | "bookmark";
}

export interface ImageViewerState {
  readonly src: string;
  readonly alt: string;
}

/** An `epub:type="noteref"` link's target content (an `epub:type=
 * "footnote"`/`"endnote"` element, per spec) shown inline instead of
 * navigating there — see `ReaderController`'s content click handler. */
export interface FootnotePopupState {
  readonly content: string;
  readonly left: number;
  readonly top: number;
}
