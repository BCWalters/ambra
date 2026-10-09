import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FC, MouseEvent } from "react";
import { Body1, Button, Caption1, makeStyles, Select, Tooltip } from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  ArrowUploadRegular,
  BookmarkFilled,
  DeleteRegular,
  DismissRegular,
  DocumentRegular,
  NoteRegular,
  PinOffRegular,
  PinRegular,
} from "@fluentui/react-icons";
import { HighlightTheme, hasUnloadedAnnotationBody } from "@ambra/engine";
import { CHROME_BORDER, CHROME_HOVER_BACKGROUND, CHROME_SHADOW, SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useFocusOnOpen } from "../useFocusOnOpen.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import { useLocale, useTranslation } from "../../i18n/LocaleContext.js";
import { EPUB_TOOLTIP_STYLE } from "../../components/EpubTextStyles.js";
import type { Bookmark, Highlight } from "../../library/LibraryDatabase.js";
import type { ReadOnlyAnnotationView } from "../ReaderTypes.js";
import type { BookmarkLocation } from "../BookmarkManager.js";
import { HighlightNoteEditor } from "./HighlightNoteEditor.js";
import { CHROME_TOOLBAR_HEIGHT } from "../../components/ChromeToolbarStyles.js";

interface BookmarkListProps {
  bookmarks: readonly Bookmark[];
  locations?: Readonly<Record<string, BookmarkLocation>>;
  /** Publisher-embedded, read-only bookmarks (issue #109/#116) — merged
   * in after the reader's own, without a remove button. */
  embedded: readonly ReadOnlyAnnotationView[];
  onSelect: (cfi: string) => void;
  onRemove: (id: string) => void;
  /** Distinct from `onSelect` — navigating to a read-only annotation
   * reports its own "that note" wording on a stale/broken CFI rather
   * than "that bookmark" (see `ReaderController.goToReadOnlyAnnotation`). */
  onSelectEmbedded: (cfi: string) => void;
}

const ANNOTATION_CARD_STYLE: CSSProperties = {
  marginBottom: 8,
  border: `1px solid ${CHROME_BORDER}`,
  borderRadius: 8,
  background: "rgba(255, 255, 255, 0.16)",
  overflowWrap: "anywhere",
};

const AttachmentStatus: FC<{ unavailable?: boolean }> = ({ unavailable }) => {
  const t = useTranslation();
  return unavailable ? <Caption1 block style={{ margin: "0 10px 8px" }}>
    {t("annotations.attachmentNotLoaded")}
  </Caption1> : null;
};

const useBookmarkStyles = makeStyles({
  jump: {
    width: "100%",
    minWidth: 0,
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "7px",
    color: "var(--colorNeutralForeground1, #242424)",
    cursor: "pointer",
    padding: "12px 10px 10px",
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: "14px",
    lineHeight: "20px",
    ":hover": { backgroundColor: CHROME_HOVER_BACKGROUND },
    ":focus-visible": {
      outline: "2px solid var(--colorStrokeFocus2, #242424)",
      outlineOffset: "-2px",
    },
  },
  title: {
    minWidth: 0,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    overflowWrap: "anywhere",
    wordBreak: "normal",
    fontWeight: 600,
  },
});

const BookmarkCard: FC<{
  title: string;
  bodyUnavailable?: boolean;
  location?: BookmarkLocation;
  onSelect: () => void;
  onRemove?: (event: MouseEvent<HTMLButtonElement>) => void;
}> = ({ title, location, bodyUnavailable, onSelect, onRemove }) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const chromeTheme = useChromeTheme();
  const styles = useBookmarkStyles();
  const pageId = useId();
  const page = location?.page;
  const pageLabel = page?.status === "known"
    ? t("annotations.bookmarkPage", { page: new Intl.NumberFormat(locale).format(page.number) })
    : t(page?.status === "pending" ? "annotations.bookmarkPagePending" : "annotations.bookmarkPageUnavailable");

  return (
    <li style={ANNOTATION_CARD_STYLE} data-bookmark-card="">
      <Tooltip content={{ children: title, style: EPUB_TOOLTIP_STYLE }} relationship="inaccessible">
        <button type="button" className={styles.jump} onClick={onSelect}
          aria-describedby={pageId} data-bookmark-link="">
          <BookmarkFilled aria-hidden="true" fontSize={18}
            style={{ flexShrink: 0, marginTop: 1, color: chromeTheme.bookmark }} />
          <span className={styles.title} data-bookmark-title="">{title}</span>
        </button>
      </Tooltip>
      <AttachmentStatus unavailable={bodyUnavailable} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 8px 8px 10px" }}>
        <span id={pageId} data-bookmark-page="" style={{
          minWidth: 0,
          padding: "2px 7px",
          borderRadius: 4,
          background: "var(--colorNeutralBackground1, #fff)",
          color: "var(--colorNeutralForeground2, #424242)",
          fontSize: 12,
          fontWeight: 600,
          lineHeight: "20px",
          fontVariantNumeric: "tabular-nums",
        }}>{pageLabel}</span>
        {onRemove ? (
          <Tooltip content={{ children: t("annotations.removeBookmark", { label: title }), style: EPUB_TOOLTIP_STYLE }} relationship="label">
            <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={onRemove} />
          </Tooltip>
        ) : (
          <Caption1 style={{ color: "var(--colorNeutralForeground3, #616161)", textAlign: "right" }}>
            {t("annotations.publisherNoteTag")}
          </Caption1>
        )}
      </div>
    </li>
  );
};

/** Saved positions in reading order; publisher bookmarks keep their own navigation and read-only actions. */
const BookmarkList: FC<BookmarkListProps> = ({ bookmarks, locations, embedded, onSelect, onRemove, onSelectEmbedded }) => {
  const t = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<{ id: string; index: number; button: HTMLButtonElement; fallback: HTMLElement | null } | undefined>(undefined);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || bookmarks.some(bookmark => bookmark.id === pending.id)) return;
    pendingFocus.current = undefined;
    if (document.activeElement !== document.body && document.activeElement !== pending.button) return;
    const links = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-bookmark-link]");
    const target = links?.[Math.min(pending.index, links.length - 1)] ?? pending.fallback;
    target?.focus();
  }, [bookmarks]);

  if (bookmarks.length === 0 && embedded.length === 0) {
    return (
      <Body1 as="p" block style={{ padding: "16px 12px", opacity: 0.75, margin: 0 }}>
        {t("annotations.noBookmarksYet")}
      </Body1>
    );
  }

  return (
    <ul ref={listRef} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {bookmarks.map((bookmark, index) => (
        <BookmarkCard key={bookmark.id} title={locations?.[bookmark.id]?.chapterTitle ?? bookmark.label}
          bodyUnavailable={bookmark.importedAnnotation && hasUnloadedAnnotationBody(bookmark.importedAnnotation)}
          location={locations?.[bookmark.id]} onSelect={() => onSelect(bookmark.cfi)}
          onRemove={event => {
            pendingFocus.current = {
              id: bookmark.id, index, button: event.currentTarget,
              fallback: event.currentTarget.closest("nav")?.querySelector("select") ?? null,
            };
            onRemove(bookmark.id);
          }} />
      ))}
      {embedded.map((annotation) => (
        <BookmarkCard key={annotation.id} title={annotation.label} location={annotation.location}
          bodyUnavailable={annotation.bodyUnavailable}
          onSelect={() => onSelectEmbedded(annotation.cfi)} />
      ))}
    </ul>
  );
};


export type AnnotationFilter = "all" | "highlights" | "notes" | "bookmarks";

interface HighlightListProps {
  highlights: readonly Highlight[];
  /** Publisher-embedded, read-only highlights/comments (issue #109/
   * #116) — merged in after the reader's own, each rendered with
   * `ReadOnlyRow`'s read-only treatment instead of note/remove buttons. */
  embedded: readonly ReadOnlyAnnotationView[];
  onSelect: (cfi: string) => void;
  onRemove: (id: string) => void;
  onSetNote: (id: string, note: string | undefined) => Promise<boolean>;
  /** Distinct from `onSelect` — see `BookmarkListProps.onSelectEmbedded`. */
  onSelectEmbedded: (cfi: string) => void;
  filter: AnnotationFilter;
  panelVisible: boolean;
  focusOnOpen: boolean;
  focusFilter: () => void;
}

/** Rows stay mounted while filtered out to retain drafts and pending persistence. */
const HighlightList: FC<HighlightListProps> = ({
  highlights,
  embedded,
  onSelect,
  onRemove,
  onSetNote,
  onSelectEmbedded,
  filter,
  panelVisible,
  focusOnOpen,
  focusFilter,
}) => {
  const t = useTranslation();
  const notesOnly = filter === "notes";
  const hasEntries = highlights.some(highlight => !notesOnly || !!highlight.note)
    || embedded.some(annotation => !notesOnly || !!annotation.note);
  if (highlights.length === 0 && embedded.length === 0) {
    return (
      <Body1 as="p" block style={{ padding: "16px 12px", opacity: 0.75, margin: 0 }}>
        {t(notesOnly ? "annotations.noNotesYet" : "annotations.noHighlightsYet")}
      </Body1>
    );
  }

  return (
    <>
    {!hasEntries && <Body1 as="p" style={{ padding: "16px 12px", margin: 0 }}>{t("annotations.noNotesYet")}</Body1>}
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {highlights.map((highlight) => (
        <HighlightListItem
          key={highlight.id}
          highlight={highlight}
          onSelect={onSelect}
          onRemove={onRemove}
          onSetNote={onSetNote}
          visible={filter !== "bookmarks" && (!notesOnly || !!highlight.note)}
          panelVisible={panelVisible}
          focusOnOpen={focusOnOpen}
          focusFilter={focusFilter}
        />
      ))}
      {embedded.filter(annotation => !notesOnly || !!annotation.note).map((annotation) => (
        <ReadOnlyRow key={annotation.id} annotation={annotation} onSelect={onSelectEmbedded} clampLines={2} />
      ))}
    </ul>
    </>
  );
};

interface HighlightListItemProps {
  highlight: Highlight;
  onSelect: (cfi: string) => void;
  onRemove: (id: string) => void;
  onSetNote: (id: string, note: string | undefined) => Promise<boolean>;
  visible: boolean;
  panelVisible: boolean;
  focusOnOpen: boolean;
  focusFilter: () => void;
}

/** One highlight's row, plus its own local "note editor open?" state —
 * split out from `HighlightList` specifically so each row can hold that
 * state independently (a `useState` inside a `.map()` callback isn't
 * possible; a real sub-component is the correct fix, not a workaround). */
const HighlightListItem: FC<HighlightListItemProps> = ({
  highlight,
  onSelect,
  onRemove,
  onSetNote,
  visible,
  panelVisible,
  focusOnOpen,
  focusFilter,
}) => {
  const t = useTranslation();
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState(highlight.note ?? "");
  const noteButtonRef = useRef<HTMLButtonElement | null>(null);
  const itemRef = useRef<HTMLLIElement | null>(null);
  const ownedFocus = useRef(false);
  const previouslyVisible = useRef(visible);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorId = useId();
  const option = HighlightTheme.STYLES[highlight.style];
  const activeRef = useRef(false);
  activeRef.current = panelVisible && visible;
  const closeNoteEditor = () => {
    setIsEditingNote(false);
    if (activeRef.current) noteButtonRef.current?.focus();
  };
  useLayoutEffect(() => {
    if (!visible && previouslyVisible.current && panelVisible
      && (itemRef.current?.contains(document.activeElement)
        || (ownedFocus.current && document.activeElement === document.body))) focusFilter();
    previouslyVisible.current = visible;
  }, [visible, panelVisible, focusFilter]);

  return (
    <li
      ref={itemRef}
      hidden={!visible}
      onFocusCapture={() => { ownedFocus.current = true; }}
      onBlurCapture={event => {
        if (event.relatedTarget !== null) ownedFocus.current = event.currentTarget.contains(event.relatedTarget);
      }}
      style={ANNOTATION_CARD_STYLE}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 8px 6px 10px",
        }}
      >
        <Caption1 style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--colorNeutralForeground3, #616161)" }}>
          <span aria-hidden="true" style={{
            flexShrink: 0, width: 12, height: 12, borderRadius: "50%",
            border: "1px solid rgba(0, 0, 0, 0.15)",
            background: highlight.style === "underline"
              ? `linear-gradient(to bottom, transparent 0%, transparent 65%, ${option.swatch} 65%, ${option.swatch} 80%, transparent 80%)`
              : option.swatch,
          }} />
          {t(highlight.note || isEditingNote ? "annotations.yourNote" : "annotations.highlightLabel")}
        </Caption1>
        <Tooltip
          content={{
            children: highlight.note
              ? t("annotations.editNote", { text: highlight.text })
              : t("annotations.addNote", { text: highlight.text }),
            style: EPUB_TOOLTIP_STYLE,
          }}
          relationship="label"
        >
          <Button
            ref={noteButtonRef}
            appearance="subtle"
            size="small"
            icon={<NoteRegular />}
            aria-expanded={isEditingNote}
            aria-controls={isEditingNote ? editorId : undefined}
            onClick={() => {
              if (isEditingNote) {
                editorRef.current?.querySelector("textarea")?.focus();
                return;
              }
              setDraftNote(highlight.note ?? "");
              setIsEditingNote(true);
            }}
          >
            {t(highlight.note ? "highlight.editNote" : "highlight.addNote")}
          </Button>
        </Tooltip>
      </div>
      <AttachmentStatus unavailable={highlight.importedAnnotation && hasUnloadedAnnotationBody(highlight.importedAnnotation)} />
      {highlight.note && !isEditingNote && (
        <Body1 as="p" block style={{ margin: "0 10px 12px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6 }}>
          {highlight.note}
        </Body1>
      )}
      {isEditingNote && (
        <div ref={editorRef} id={editorId} style={{ padding: "0 10px 10px" }}>
          <HighlightNoteEditor
            value={draftNote}
            onChange={setDraftNote}
            hasExistingNote={!!highlight.note}
            onSave={(note) => onSetNote(highlight.id, note)}
            onSaved={closeNoteEditor}
            onCancel={closeNoteEditor}
            autoFocus
            autoFocusOnActivate={focusOnOpen}
            active={panelVisible && visible}
          />
        </div>
      )}
      <blockquote style={{
        margin: "4px 10px 10px",
        paddingLeft: 10,
        borderLeft: `3px solid ${option.swatch}`,
        color: highlight.note || isEditingNote ? "var(--colorNeutralForeground3, #616161)" : "var(--colorNeutralForeground1, #242424)",
        fontSize: highlight.note || isEditingNote ? 12 : 14,
        whiteSpace: "pre-wrap",
        lineHeight: 1.6,
      }}>{highlight.text}</blockquote>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "0 8px 8px" }}>
        <Button appearance="subtle" size="small" onClick={() => onSelect(highlight.startCfi)}>
          {t("annotations.goToPassage")}
        </Button>
        <Tooltip
          content={{ children: t("annotations.removeHighlight", { text: highlight.text }), style: EPUB_TOOLTIP_STYLE }}
          relationship="label"
        >
          <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={() => onRemove(highlight.id)} />
        </Tooltip>
      </div>
    </li>
  );
};

interface ReadOnlyRowProps {
  annotation: ReadOnlyAnnotationView;
  onSelect: (cfi: string) => void;
  /** How many lines of `annotation.label` to show before truncating — 1
   * (single-line ellipsis, matching `BookmarkList`'s own rows) or more
   * (a line-clamped block, matching `HighlightList`'s own rows), since
   * this one row shape is shared between both tabs (see issue #116). */
  clampLines: 1 | 2;
}

/** One publisher-embedded, read-only annotation (issue #109), styled to
 * read clearly as *not* one of the reader's own: a muted document icon
 * instead of the tab's own bookmark/highlight glyph, a small "Publisher
 * note" tag, and no remove/edit affordance at all — there's nothing
 * here for the reader to edit, since it lives in the EPUB itself, not
 * this app's own library. Shared between `BookmarkList` and
 * `HighlightList` (issue #116 removed the dedicated "Notes" tab these
 * used to get, which routinely didn't fit the panel's fixed width for
 * what's usually zero or one item). */
const ReadOnlyRow: FC<ReadOnlyRowProps> = ({ annotation, onSelect, clampLines }) => {
  const t = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(annotation.cfi)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          background: "none",
          border: "none",
          borderRadius: 6,
          color: "var(--colorNeutralForeground2, #333)",
          cursor: "pointer",
          padding: "7px 10px",
          textAlign: "left",
          font: "inherit",
          lineHeight: 1.35,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = CHROME_HOVER_BACKGROUND;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
        }}
      >
        <DocumentRegular fontSize={16} style={{ flexShrink: 0, marginTop: 2, opacity: 0.6 }} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <Caption1 as="span" block style={{ opacity: 0.6 }}>
            {t("annotations.publisherNoteTag")}
          </Caption1>
          <AttachmentStatus unavailable={annotation.bodyUnavailable} />
          <span
            style={
              clampLines === 1
                ? { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
                : {
                    display: "-webkit-box",
                    WebkitLineClamp: clampLines,
                    WebkitBoxOrient: "vertical" as const,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    overflowWrap: "anywhere",
                  }
            }
          >
            {annotation.label}
          </span>
        </span>
      </button>
    </li>
  );
};

export interface AnnotationsPanelProps {
  bookmarks: readonly Bookmark[];
  bookmarkLocations?: Readonly<Record<string, BookmarkLocation>>;
  onSelectBookmark: (cfi: string) => void;
  onRemoveBookmark: (id: string) => void;
  highlights: readonly Highlight[];
  onSelectHighlight: (cfi: string) => void;
  onRemoveHighlight: (id: string) => void;
  onSetHighlightNote: (id: string, note: string | undefined) => Promise<boolean>;
  /** A publisher-embedded, read-only annotation collection (issue #109)
   * — empty for the overwhelming majority of books, in which case
   * nothing extra shows up in either tab below (issue #116: these used
   * to get a dedicated "Notes" tab, merged away since it routinely
   * didn't fit the panel's own fixed width for what's usually zero or
   * one item). */
  readOnlyAnnotations: readonly ReadOnlyAnnotationView[];
  onSelectReadOnlyAnnotation: (cfi: string) => void;
  /** Downloads the current book's bookmarks/highlights as a file (issue
   * #107). */
  onExport: () => void | Promise<void>;
  /** Imports bookmarks/highlights from a previously-exported (or
   * third-party) annotation file (issue #108). */
  onImportFile: (file: File) => void | Promise<void>;
  /** Keep this component mounted when closed: both drafts and pending note
   * saves must survive switching reference panels, as well as the closing animation. */
  open: boolean;
  focusOnOpen?: boolean;
  /** `true` docks the panel in the normal layout flow, pushing the
   * content pane over; `false` (the default) makes it fly out as a
   * translucent overlay on top of the content pane instead,
   * auto-dismissing on selection, an outside click, or Escape. */
  pinned: boolean;
  canPin?: boolean;
  onTogglePin: () => void;
  onRequestClose: () => void;
  onOutsideClick?: () => void;
  /** One-shot filter command: increment requestId for every external action,
   * including repeated requests for the same filter. Open the panel in the same
   * parent update. The Show control receives focus, including for a pinned or
   * already-open panel; subsequent user filter choices remain local. Omit this
   * prop on ordinary opens to restore the user's filter and default focus. */
  filterRequest?: { readonly filter: AnnotationFilter; readonly requestId: number };
  /** Whether the progress scrubber is currently shown (paginated
   * reflowable content only — see `ProgressScrubber`'s own identical
   * condition) — this panel needs to stop *above* it rather than
   * running the full pane height, or the scrubber bar ends up covering
   * its last few rows (issue #59). */
  scrubberVisible: boolean;
}

/** Bookmarks and highlights/annotations, sharing one panel with its own
 * toolbar button — distinct from the Table of Contents (see `TocPanel`),
 * per explicit product direction: bookmarks/annotations are things the
 * *reader* created while reading, not part of the book's own authored
 * structure, so they don't belong mixed into the same panel as the TOC.
 * Structurally a near-twin of `TocPanel`'s own flyout/pin/close chrome
 * (same behavior, same visual language) — intentionally duplicated
 * rather than shared, since the two panels' actual *content* has nothing
 * in common beyond that chrome. */
export const AnnotationsPanel: FC<AnnotationsPanelProps> = ({
  bookmarks,
  bookmarkLocations,
  onSelectBookmark,
  onRemoveBookmark,
  highlights,
  onSelectHighlight,
  onRemoveHighlight,
  onSetHighlightNote,
  readOnlyAnnotations,
  onSelectReadOnlyAnnotation,
  onExport,
  onImportFile,
  open,
  focusOnOpen = true,
  pinned,
  canPin = true,
  onTogglePin,
  onRequestClose,
  onOutsideClick,
  filterRequest,
  scrubberVisible,
}) => {
  const [filter, setFilter] = useState<AnnotationFilter>("all");
  const manualFilter = useRef<AnnotationFilter>("all");
  const filterId = useId();
  const filterRef = useRef<HTMLSelectElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const t = useTranslation();
  const { locale } = useLocale();
  const chromeTheme = useChromeTheme();
  const navRef = useRef<HTMLElement | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  // Split once here rather than in `ReaderController` itself: which tab
  // a read-only annotation belongs in is purely a presentation
  // decision, not part of its own data model — see
  // `classifyReadOnlyAnnotationKind`.
  const embeddedBookmarks = readOnlyAnnotations.filter((annotation) => annotation.kind === "bookmark");
  const embeddedHighlights = readOnlyAnnotations.filter((annotation) => annotation.kind === "highlight");
  const counts = {
    all: bookmarks.length + highlights.length + readOnlyAnnotations.length,
    bookmarks: bookmarks.length + embeddedBookmarks.length,
    highlights: highlights.length + embeddedHighlights.length,
    notes: highlights.filter(highlight => !!highlight.note).length + embeddedHighlights.filter(annotation => !!annotation.note).length,
  };
  const focusFilter = useCallback(() => filterRef.current?.focus(), []);
  const requestedFilter = filterRequest?.filter;
  const filterRequestId = filterRequest?.requestId ?? 0;

  useLayoutEffect(() => {
    setFilter(requestedFilter ?? manualFilter.current);
  }, [requestedFilter, filterRequestId]);

  useEffect(() => {
    if (!open || pinned) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
        onRequestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, pinned, onRequestClose]);

  // See `TocPanel`'s matching effect's doc comment for why this is
  // needed at all (this panel is likewise rendered earlier in the DOM
  // than the toolbar button that opens it).
  useFocusOnOpen(navRef, open && focusOnOpen && filterRequest === undefined);
  useFocusOnOpen(filterRef, (open || pinned) && focusOnOpen && filterRequest !== undefined, filterRequestId);

  return (
    <>
      {!pinned && (
        <div
          aria-hidden="true"
          onClick={onOutsideClick ?? onRequestClose}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 7,
            background: "rgba(15, 23, 42, 0.18)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: reduceMotion ? "none" : "opacity 260ms ease",
          }}
        />
      )}

      <nav
        data-ambra-reference-panel="annotations"
        ref={navRef}
        tabIndex={-1}
        aria-label={t("annotations.panelAriaLabel")}
        style={{
          position: pinned ? "relative" : "absolute",
          outline: "none",
          top: pinned ? 0 : CHROME_TOOLBAR_HEIGHT,
          right: 0,
          bottom: pinned ? 0
            : `calc(${scrubberVisible ? SCRUBBER_HEIGHT : 8}px + var(--ambra-narration-height, 0px))`,
          zIndex: 8,
          width: 300,
          maxWidth: "100%",
          boxSizing: "border-box",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: chromeTheme.backgroundSolid,
          backdropFilter: pinned ? undefined : "blur(16px)",
          borderLeft: `1px solid ${CHROME_BORDER}`,
          borderRadius: pinned ? 0 : "12px 0 0 12px",
          boxShadow: pinned ? "none" : CHROME_SHADOW,
          transform: pinned ? "none" : `translateX(${open ? "0" : "100%"})`,
          opacity: pinned || open ? 1 : 0,
          pointerEvents: pinned || open ? "auto" : "none",
          visibility: pinned || open ? "visible" : "hidden",
          transition: reduceMotion
            ? "none"
            : "transform 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease, visibility 280ms",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "10px 8px 10px 14px",
            borderBottom: `1px solid ${CHROME_BORDER}`,
          }}
        >
          <Body1 as="h2" style={{ flex: 1, fontWeight: 600, margin: 0 }}>
            {t("annotations.panelAriaLabel")}
          </Body1>
          <Tooltip content={!canPin ? t("reader.pinUnavailable") : pinned ? t("annotations.unpinPanel") : t("annotations.pinPanel")} relationship={canPin ? "label" : "description"}>
            <Button
              aria-label={pinned ? t("annotations.unpinPanel") : t("annotations.pinPanel")}
              aria-description={!canPin ? t("reader.pinUnavailable") : undefined}
              disabledFocusable={!canPin}
              appearance="subtle"
              size="small"
              icon={pinned ? <PinOffRegular /> : <PinRegular />}
              onClick={onTogglePin}
            />
          </Tooltip>
          {!pinned && (
            <Tooltip content={t("annotations.closePanel")} relationship="label">
              <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onRequestClose} />
            </Tooltip>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px", borderBottom: `1px solid ${CHROME_BORDER}` }}>
          <label htmlFor={filterId} style={{ flexShrink: 0, fontSize: 12 }}>{t("annotations.show")}</label>
          <Select ref={filterRef} id={filterId} value={filter} size="small"
            onChange={(_event, data) => {
              manualFilter.current = data.value as AnnotationFilter;
              setFilter(manualFilter.current);
            }}
            style={{ flex: 1, minWidth: 0 }} select={{ style: { minWidth: 0, width: "100%" } }}>
            <option value="all">{t("annotations.allAnnotations")} ({new Intl.NumberFormat(locale).format(counts.all)})</option>
            <option value="highlights">{t("annotations.highlightsTab")} ({new Intl.NumberFormat(locale).format(counts.highlights)})</option>
            <option value="notes">{t("annotations.notesFilter")} ({new Intl.NumberFormat(locale).format(counts.notes)})</option>
            <option value="bookmarks">{t("annotations.bookmarksTab")} ({new Intl.NumberFormat(locale).format(counts.bookmarks)})</option>
          </Select>
        </div>
        <div role="region" aria-label={t("annotations.panelAriaLabel")}
          style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 6px" }}>
          {filter === "all" && counts.all === 0 && (
            <Body1 as="p" style={{ padding: "16px 12px", margin: 0 }}>{t("annotations.noAnnotationsYet")}</Body1>
          )}
          {/* Keep editors mounted across filters so unsaved drafts and pending saves survive. */}
          <div hidden={filter === "bookmarks" || (filter === "all" && counts.highlights === 0)}>
            <HighlightList
              highlights={highlights}
              embedded={embeddedHighlights}
              onSelect={onSelectHighlight}
              onRemove={onRemoveHighlight}
              onSetNote={onSetHighlightNote}
              onSelectEmbedded={onSelectReadOnlyAnnotation}
              filter={filter}
              panelVisible={open || pinned}
              focusOnOpen={focusOnOpen}
              focusFilter={focusFilter}
            />
          </div>
          <div hidden={filter !== "bookmarks" && (filter !== "all" || counts.bookmarks === 0)}>
            <BookmarkList
              bookmarks={bookmarks}
              locations={bookmarkLocations}
              embedded={embeddedBookmarks}
              onSelect={onSelectBookmark}
              onRemove={onRemoveBookmark}
              onSelectEmbedded={onSelectReadOnlyAnnotation}
            />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "8px 10px",
            borderTop: `1px solid ${CHROME_BORDER}`,
          }}
        >
          <Tooltip content={t("annotations.exportTooltip")} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowDownloadRegular />}
              style={{ flex: 1 }}
              onClick={() => void onExport()}
            >
              {t("annotations.exportButton")}
            </Button>
          </Tooltip>
          <Tooltip content={t("annotations.importTooltip")} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowUploadRegular />}
              style={{ flex: 1 }}
              onClick={() => importInputRef.current?.click()}
            >
              {t("annotations.importButton")}
            </Button>
          </Tooltip>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json,application/ld+json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void onImportFile(file);
              }
            }}
          />
        </div>
      </nav>
    </>
  );
};
