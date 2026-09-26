import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FC, MouseEvent } from "react";
import { Body1, Button, Caption1, makeStyles, Tab, TabList, Tooltip } from "@fluentui/react-components";
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
import { HighlightTheme } from "@ambra/engine";
import { BOOKMARK_COLOR, CHROME_BORDER, CHROME_HOVER_BACKGROUND, CHROME_SHADOW, SCRUBBER_HEIGHT } from "../chromeTheme.js";
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
  location?: BookmarkLocation;
  onSelect: () => void;
  onRemove?: (event: MouseEvent<HTMLButtonElement>) => void;
}> = ({ title, location, onSelect, onRemove }) => {
  const t = useTranslation();
  const { locale } = useLocale();
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
            style={{ flexShrink: 0, marginTop: 1, color: BOOKMARK_COLOR }} />
          <span className={styles.title} data-bookmark-title="">{title}</span>
        </button>
      </Tooltip>
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
          location={locations?.[bookmark.id]} onSelect={() => onSelect(bookmark.cfi)}
          onRemove={event => {
            pendingFocus.current = {
              id: bookmark.id, index, button: event.currentTarget,
              fallback: event.currentTarget.closest<HTMLElement>('[role="tabpanel"]'),
            };
            onRemove(bookmark.id);
          }} />
      ))}
      {embedded.map((annotation) => (
        <BookmarkCard key={annotation.id} title={annotation.label} location={annotation.location}
          onSelect={() => onSelectEmbedded(annotation.cfi)} />
      ))}
    </ul>
  );
};


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
}

/** The "Highlights" tab's contents — each entry shows a small color
 * swatch (matching `HighlightTheme`'s style — an underline preview for
 * that one style, same as the selection toolbar's own swatches), an
 * excerpt of the highlighted text itself (snapshotted at creation time —
 * see `Highlight.text` — so this never needs to re-resolve/re-extract
 * from the DOM just to render a list), and its note (if any — see
 * `HighlightListItem`). */
const HighlightList: FC<HighlightListProps> = ({
  highlights,
  embedded,
  onSelect,
  onRemove,
  onSetNote,
  onSelectEmbedded,
}) => {
  const t = useTranslation();
  if (highlights.length === 0 && embedded.length === 0) {
    return (
      <Body1 as="p" block style={{ padding: "16px 12px", opacity: 0.75, margin: 0 }}>
        {t("annotations.noHighlightsYet")}
      </Body1>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {highlights.map((highlight) => (
        <HighlightListItem
          key={highlight.id}
          highlight={highlight}
          onSelect={onSelect}
          onRemove={onRemove}
          onSetNote={onSetNote}
        />
      ))}
      {embedded.map((annotation) => (
        <ReadOnlyRow key={annotation.id} annotation={annotation} onSelect={onSelectEmbedded} clampLines={2} />
      ))}
    </ul>
  );
};

interface HighlightListItemProps {
  highlight: Highlight;
  onSelect: (cfi: string) => void;
  onRemove: (id: string) => void;
  onSetNote: (id: string, note: string | undefined) => Promise<boolean>;
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
}) => {
  const t = useTranslation();
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState(highlight.note ?? "");
  const noteButtonRef = useRef<HTMLButtonElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorId = useId();
  const option = HighlightTheme.STYLES[highlight.style];
  const closeNoteEditor = () => {
    setIsEditingNote(false);
    noteButtonRef.current?.focus();
  };

  return (
    <li
      style={ANNOTATION_CARD_STYLE}
    >
      <button
        type="button"
        onClick={() => onSelect(highlight.startCfi)}
        style={{
          width: "100%",
          minWidth: 0,
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          background: "none",
          border: "none",
          borderRadius: 6,
          color: "var(--colorNeutralForeground2, #333)",
          cursor: "pointer",
          padding: "10px",
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
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            marginTop: 4,
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: "1px solid rgba(0, 0, 0, 0.15)",
            background:
              highlight.style === "underline"
                ? `linear-gradient(to bottom, transparent 0%, transparent 65%, ${option.swatch} 65%, ${option.swatch} 80%, transparent 80%)`
                : option.swatch,
          }}
        />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {highlight.text}
          </span>
        </span>
      </button>
      {highlight.note && !isEditingNote && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "0 10px 8px" }}>
          <NoteRegular aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <Body1 as="p" block style={{ margin: 0, whiteSpace: "pre-wrap", minWidth: 0 }}>
            {highlight.note}
          </Body1>
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "0 8px 8px",
        }}
      >
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
        <Tooltip
          content={{ children: t("annotations.removeHighlight", { text: highlight.text }), style: EPUB_TOOLTIP_STYLE }}
          relationship="label"
        >
          <Button
            appearance="subtle"
            size="small"
            icon={<DeleteRegular />}
            onClick={() => onRemove(highlight.id)}
          />
        </Tooltip>
      </div>
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
          />
        </div>
      )}
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
  /** Whether the panel should currently be shown at all. Always rendered
   * (never conditionally unmounted) so it can animate closed instead of
   * simply vanishing — see the `transform`/`opacity` transition below. */
  open: boolean;
  /** `true` docks the panel in the normal layout flow, pushing the
   * content pane over; `false` (the default) makes it fly out as a
   * translucent overlay on top of the content pane instead,
   * auto-dismissing on selection, an outside click, or Escape. */
  pinned: boolean;
  onTogglePin: () => void;
  onRequestClose: () => void;
  onOutsideClick?: () => void;
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
  pinned,
  onTogglePin,
  onRequestClose,
  onOutsideClick,
  scrubberVisible,
}) => {
  const [activeTab, setActiveTab] = useState<"bookmarks" | "highlights">("bookmarks");
  const tabsId = useId();
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const t = useTranslation();
  const chromeTheme = useChromeTheme();
  const navRef = useRef<HTMLElement | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  // Split once here rather than in `ReaderController` itself: which tab
  // a read-only annotation belongs in is purely a presentation
  // decision, not part of its own data model — see
  // `classifyReadOnlyAnnotationKind`.
  const embeddedBookmarks = readOnlyAnnotations.filter((annotation) => annotation.kind === "bookmark");
  const embeddedHighlights = readOnlyAnnotations.filter((annotation) => annotation.kind === "highlight");

  useEffect(() => {
    if (!open || pinned) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onRequestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, pinned, onRequestClose]);

  // See `TocPanel`'s matching effect's doc comment for why this is
  // needed at all (this panel is likewise rendered earlier in the DOM
  // than the toolbar button that opens it).
  useFocusOnOpen(navRef, open && !pinned);

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
        ref={navRef}
        tabIndex={-1}
        aria-label={t("annotations.panelAriaLabel")}
        style={{
          position: pinned ? "relative" : "absolute",
          outline: "none",
          top: pinned ? 0 : CHROME_TOOLBAR_HEIGHT,
          left: 0,
          bottom: scrubberVisible ? SCRUBBER_HEIGHT : pinned ? 0 : 8,
          zIndex: 8,
          width: 300,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: chromeTheme.backgroundSolid,
          backdropFilter: pinned ? undefined : "blur(16px)",
          borderRight: `1px solid ${CHROME_BORDER}`,
          borderRadius: pinned ? 0 : "0 12px 12px 0",
          boxShadow: pinned ? "none" : CHROME_SHADOW,
          transform: pinned ? "none" : `translateX(${open ? "0" : "-100%"})`,
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
          <Body1 as="span" style={{ flex: 1, fontWeight: 600 }}>
            {activeTab === "bookmarks" ? t("annotations.bookmarksTab") : t("annotations.highlightsTab")}
          </Body1>
          <Tooltip content={pinned ? t("annotations.unpinPanel") : t("annotations.pinPanel")} relationship="label">
            <Button
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
        {/* No icons (they read as empty/decorative rather than
         * meaningful) and no horizontal scrollbar — each tab clips its
         * own label with an ellipsis instead, so a longer translated
         * label plus its "(N)" count can lose a few trailing characters
         * but never bleeds a scrollbar or overflowing text past the
         * pane's edge (issue #118). The ellipsis styling lives on a
         * plain nested `<span>` rather than Tab's own `content` slot
         * prop — passing that prop forces Tab's internal
         * width-reservation mirror span to always render (even while
         * selected) instead of only when unselected, which doubled up
         * matching accessible text for the active tab. */}
        <TabList
          aria-label={t("annotations.panelAriaLabel")}
          size="small"
          selectedValue={activeTab}
          onTabSelect={(_event, data) => setActiveTab(data.value as "bookmarks" | "highlights")}
          style={{ padding: "4px 8px 0", borderBottom: `1px solid ${CHROME_BORDER}` }}
        >
          <Tab id={`${tabsId}-bookmarks`} aria-controls={`${tabsId}-panel`} value="bookmarks" style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("annotations.bookmarksTab")}
              {bookmarks.length + embeddedBookmarks.length > 0
                ? ` (${bookmarks.length + embeddedBookmarks.length})`
                : ""}
            </span>
          </Tab>
          <Tab id={`${tabsId}-highlights`} aria-controls={`${tabsId}-panel`} value="highlights" style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("annotations.highlightsTab")}
              {highlights.length + embeddedHighlights.length > 0
                ? ` (${highlights.length + embeddedHighlights.length})`
                : ""}
            </span>
          </Tab>
        </TabList>
        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${activeTab}`}
          tabIndex={0} style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          {activeTab === "bookmarks" ? (
            <BookmarkList
              bookmarks={bookmarks}
              locations={bookmarkLocations}
              embedded={embeddedBookmarks}
              onSelect={onSelectBookmark}
              onRemove={onRemoveBookmark}
              onSelectEmbedded={onSelectReadOnlyAnnotation}
            />
          ) : (
            <HighlightList
              highlights={highlights}
              embedded={embeddedHighlights}
              onSelect={onSelectHighlight}
              onRemove={onRemoveHighlight}
              onSetNote={onSetHighlightNote}
              onSelectEmbedded={onSelectReadOnlyAnnotation}
            />
          )}
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
