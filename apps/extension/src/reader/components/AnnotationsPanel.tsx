import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Body1, Button, Caption1, Tab, TabList, Textarea, Tooltip } from "@fluentui/react-components";
import {
  BookmarkFilled,
  BookmarkRegular,
  DeleteRegular,
  DismissRegular,
  HighlightRegular,
  NoteRegular,
  PinOffRegular,
  PinRegular,
} from "@fluentui/react-icons";
import { HighlightTheme } from "@ambra/engine";
import { BOOKMARK_COLOR, CHROME_BORDER, CHROME_HOVER_BACKGROUND, CHROME_SHADOW, SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useFocusOnOpen } from "../useFocusOnOpen.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import type { Bookmark, Highlight } from "../../library/LibraryDatabase.js";

interface BookmarkListProps {
  bookmarks: readonly Bookmark[];
  onSelect: (cfi: string) => void;
  onRemove: (id: string) => void;
}

/** The "Bookmarks" tab's contents — a flat, creation-order list (oldest
 * first, matching `LibraryDatabase.listBookmarksForBook`), each showing
 * its label (chapter + page — see `BookmarkManager`'s private `label`
 * method in `ReaderController.ts`) and
 * an inline remove button. No "current position" highlight the way the
 * TOC tree has one: unlike TOC entries, a bookmark is exactly one saved
 * position, not a section the reader might currently be inside. */
const BookmarkList: FC<BookmarkListProps> = ({ bookmarks, onSelect, onRemove }) => {
  const t = useTranslation();
  if (bookmarks.length === 0) {
    return (
      <Caption1 as="p" style={{ padding: "12px 10px", opacity: 0.6, margin: 0 }}>
        {t("annotations.noBookmarksYet")}
      </Caption1>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            onClick={() => onSelect(bookmark.cfi)}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
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
            <BookmarkFilled fontSize={16} style={{ flexShrink: 0, color: BOOKMARK_COLOR }} />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {bookmark.label}
            </span>
          </button>
          <Tooltip content={t("annotations.removeBookmark", { label: bookmark.label })} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<DeleteRegular />}
              onClick={() => onRemove(bookmark.id)}
            />
          </Tooltip>
        </li>
      ))}
    </ul>
  );
};

interface HighlightListProps {
  highlights: readonly Highlight[];
  onSelect: (cfi: string) => void;
  onRemove: (id: string) => void;
  onSetNote: (id: string, note: string | undefined) => void;
}

/** The "Highlights" tab's contents — each entry shows a small color
 * swatch (matching `HighlightTheme`'s style — an underline preview for
 * that one style, same as the selection toolbar's own swatches), an
 * excerpt of the highlighted text itself (snapshotted at creation time —
 * see `Highlight.text` — so this never needs to re-resolve/re-extract
 * from the DOM just to render a list), and its note (if any — see
 * `HighlightListItem`). */
const HighlightList: FC<HighlightListProps> = ({ highlights, onSelect, onRemove, onSetNote }) => {
  const t = useTranslation();
  if (highlights.length === 0) {
    return (
      <Caption1 as="p" style={{ padding: "12px 10px", opacity: 0.6, margin: 0 }}>
        {t("annotations.noHighlightsYet")}
      </Caption1>
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
    </ul>
  );
};

interface HighlightListItemProps {
  highlight: Highlight;
  onSelect: (cfi: string) => void;
  onRemove: (id: string) => void;
  onSetNote: (id: string, note: string | undefined) => void;
}

/** One highlight's row, plus its own local "note editor open?" state —
 * split out from `HighlightList` specifically so each row can hold that
 * state independently (a `useState` inside a `.map()` callback isn't
 * possible; a real sub-component is the correct fix, not a workaround). */
const HighlightListItem: FC<HighlightListItemProps> = ({ highlight, onSelect, onRemove, onSetNote }) => {
  const t = useTranslation();
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState(highlight.note ?? "");
  const option = HighlightTheme.STYLES[highlight.style];

  const saveNote = (): void => {
    const trimmed = draftNote.trim();
    onSetNote(highlight.id, trimmed === "" ? undefined : trimmed);
    setIsEditingNote(false);
  };

  // See `HighlightActionPopup`'s identical guard: an empty note is a
  // real, intentional "clear it" action in edit mode (there's an
  // existing note to clear), but plain nothing-to-save in add mode.
  const isAddMode = !highlight.note;
  const isSaveDisabled = isAddMode && draftNote.trim() === "";

  return (
    <li style={{ padding: "2px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
        <button
          type="button"
          onClick={() => onSelect(highlight.startCfi)}
          style={{
            flex: 1,
            minWidth: 0,
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
            {highlight.note && !isEditingNote && (
              <Caption1 as="span" block style={{ marginTop: 2, fontStyle: "italic", opacity: 0.75 }}>
                {highlight.note}
              </Caption1>
            )}
          </span>
        </button>
        <Tooltip
          content={
            highlight.note
              ? t("annotations.editNote", { text: highlight.text })
              : t("annotations.addNote", { text: highlight.text })
          }
          relationship="label"
        >
          <Button
            appearance="subtle"
            size="small"
            icon={<NoteRegular />}
            onClick={() => {
              setDraftNote(highlight.note ?? "");
              setIsEditingNote((open) => !open);
            }}
          />
        </Tooltip>
        <Tooltip content={t("annotations.removeHighlight", { text: highlight.text })} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<DeleteRegular />}
            onClick={() => onRemove(highlight.id)}
          />
        </Tooltip>
      </div>
      {isEditingNote && (
        <div style={{ padding: "0 10px 8px 34px" }}>
          <Textarea
            value={draftNote}
            onChange={(_event, data) => setDraftNote(data.value)}
            placeholder={t("annotations.notePlaceholder")}
            resize="vertical"
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
            <Button size="small" onClick={() => setIsEditingNote(false)}>
              {t("annotations.cancelNote")}
            </Button>
            <Button size="small" appearance="primary" disabled={isSaveDisabled} onClick={saveNote}>
              {t("annotations.saveNote")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
};

export interface AnnotationsPanelProps {
  bookmarks: readonly Bookmark[];
  onSelectBookmark: (cfi: string) => void;
  onRemoveBookmark: (id: string) => void;
  highlights: readonly Highlight[];
  onSelectHighlight: (cfi: string) => void;
  onRemoveHighlight: (id: string) => void;
  onSetHighlightNote: (id: string, note: string | undefined) => void;
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
  onSelectBookmark,
  onRemoveBookmark,
  highlights,
  onSelectHighlight,
  onRemoveHighlight,
  onSetHighlightNote,
  open,
  pinned,
  onTogglePin,
  onRequestClose,
  scrubberVisible,
}) => {
  const [activeTab, setActiveTab] = useState<"bookmarks" | "highlights">("bookmarks");

  const t = useTranslation();
  const chromeTheme = useChromeTheme();
  const navRef = useRef<HTMLElement | null>(null);
  const reduceMotion = usePrefersReducedMotion();

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
          onClick={onRequestClose}
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
          top: pinned ? 0 : 44,
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
        <TabList
          size="small"
          selectedValue={activeTab}
          onTabSelect={(_event, data) => setActiveTab(data.value as "bookmarks" | "highlights")}
          style={{ padding: "4px 8px 0", borderBottom: `1px solid ${CHROME_BORDER}` }}
        >
          <Tab value="bookmarks" icon={<BookmarkRegular />}>
            {t("annotations.bookmarksTab")}
            {bookmarks.length > 0 ? ` (${bookmarks.length})` : ""}
          </Tab>
          <Tab value="highlights" icon={<HighlightRegular />}>
            {t("annotations.highlightsTab")}
            {highlights.length > 0 ? ` (${highlights.length})` : ""}
          </Tab>
        </TabList>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          {activeTab === "bookmarks" ? (
            <BookmarkList bookmarks={bookmarks} onSelect={onSelectBookmark} onRemove={onRemoveBookmark} />
          ) : (
            <HighlightList
              highlights={highlights}
              onSelect={onSelectHighlight}
              onRemove={onRemoveHighlight}
              onSetNote={onSetHighlightNote}
            />
          )}
        </div>
      </nav>
    </>
  );
};
