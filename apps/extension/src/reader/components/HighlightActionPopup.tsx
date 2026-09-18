import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Button, Textarea, Tooltip } from "@fluentui/react-components";
import { DeleteRegular, DismissRegular, NoteRegular } from "@fluentui/react-icons";
import { HighlightTheme } from "@ambra/engine";
import type { ActiveHighlightState } from "../ReaderController.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";

export interface HighlightActionPopupProps {
  /** `undefined` when nothing's currently "opened" this way — see
   * `ReaderController.checkExistingHighlightClick`. */
  state: ActiveHighlightState | undefined;
  onSetNote: (id: string, note: string | undefined) => void;
  onRemove: (id: string) => void;
  onDismiss: () => void;
}

/**
 * A small floating popup for an *existing* highlight tapped/clicked
 * while reading — offering the same note/delete actions the Highlights
 * panel already has (see `HighlightListItem`), directly in the book, per
 * explicit product direction (issue #48: "anything I do inside the
 * annotations tab, I should also be able to do directly in the book").
 *
 * Deliberately a separate component from `SelectionToolbar` (a *fresh*
 * selection's color picker) rather than one shared popup — the two
 * represent genuinely different moments (making a new highlight vs.
 * acting on one that already exists) with different actions, and
 * forcing them into one shape would only make either harder to read.
 *
 * Unlike `SelectionToolbar`, this popup does *not* guard its own
 * `onMouseDown` with `preventDefault()` (issue #61: an earlier version
 * did, copied from `SelectionToolbar`'s pattern, and it silently broke
 * focusing the "Add a note" `Textarea` — `preventDefault()` on
 * `mousedown` suppresses the browser's own default focus-on-click
 * behavior for *every* descendant, textarea included). That guard
 * exists on `SelectionToolbar` to keep the content iframe's live
 * `Selection` from collapsing when a color swatch is clicked in the
 * parent document; this popup has no live `Selection` to protect at
 * all (it acts on an already-created, CFI-anchored highlight), so
 * there's nothing here that guard would actually be defending against.
 */
export const HighlightActionPopup: FC<HighlightActionPopupProps> = ({ state, onSetNote, onRemove, onDismiss }) => {
  const chromeTheme = useChromeTheme();
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Resets the note editor's own open/draft state whenever a *different*
  // highlight is opened (or this one closes) — without this, closing and
  // reopening a note editor on a second highlight would show the first
  // highlight's leftover draft text for a moment.
  useEffect(() => {
    setIsEditingNote(false);
    setDraftNote(state?.highlight.note ?? "");
  }, [state?.highlight.id]);

  // Moves focus into the note textarea the moment it appears (clicking
  // the note icon), rather than leaving a reader who wants to type a
  // note to go find and click into it themselves — the field is the
  // entire point of having just opened this editor.
  useEffect(() => {
    if (isEditingNote) {
      noteTextareaRef.current?.focus();
    }
  }, [isEditingNote]);

  useEffect(() => {
    if (!state) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [state, onDismiss]);

  if (!state) {
    return null;
  }
  const { highlight } = state;
  const option = HighlightTheme.STYLES[highlight.style];

  const saveNote = (): void => {
    const trimmed = draftNote.trim();
    onSetNote(highlight.id, trimmed === "" ? undefined : trimmed);
    setIsEditingNote(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Highlight options"
      style={{
        position: "fixed",
        left: state.left,
        top: state.top,
        transform: "translate(-50%, calc(-100% - 10px))",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        borderRadius: 10,
        minWidth: 220,
        maxWidth: 280,
        background: chromeTheme.backgroundSolid,
        border: `1px solid ${CHROME_BORDER}`,
        boxShadow: CHROME_SHADOW,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
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
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 13,
          }}
        >
          {highlight.text}
        </span>
        <Tooltip content={highlight.note ? "Edit note" : "Add note"} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<NoteRegular />}
            aria-label={highlight.note ? "Edit note" : "Add note"}
            onClick={() => setIsEditingNote((open) => !open)}
          />
        </Tooltip>
        <Tooltip content="Delete highlight" relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<DeleteRegular />}
            aria-label="Delete highlight"
            onClick={() => {
              onRemove(highlight.id);
              onDismiss();
            }}
          />
        </Tooltip>
        <Tooltip content="Close" relationship="label">
          <Button appearance="subtle" size="small" icon={<DismissRegular />} aria-label="Close" onClick={onDismiss} />
        </Tooltip>
      </div>

      {!isEditingNote && highlight.note && (
        <span style={{ fontSize: 13, fontStyle: "italic", opacity: 0.75 }}>{highlight.note}</span>
      )}

      {isEditingNote && (
        <div>
          <Textarea
            ref={noteTextareaRef}
            value={draftNote}
            onChange={(_event, data) => setDraftNote(data.value)}
            placeholder="Add a note…"
            resize="vertical"
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
            <Button size="small" onClick={() => setIsEditingNote(false)}>
              Cancel
            </Button>
            <Button size="small" appearance="primary" onClick={saveNote}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
