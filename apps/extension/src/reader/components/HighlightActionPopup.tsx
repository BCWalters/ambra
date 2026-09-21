import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Button, Textarea, Tooltip } from "@fluentui/react-components";
import { DeleteRegular, DismissRegular } from "@fluentui/react-icons";
import { HighlightTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { ActiveHighlightState } from "../ReaderController.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { HIGHLIGHT_STYLE_LABEL_KEYS } from "./SelectionToolbar.js";
import { useClampedPopupOffset } from "../useClampedPopupOffset.js";

export interface HighlightActionPopupProps {
  /** `undefined` when nothing's currently "opened" this way — see
   * `ReaderController.checkExistingHighlightClick`. */
  state: ActiveHighlightState | undefined;
  onSetNote: (id: string, note: string | undefined) => void;
  /** Issue #79: changes this highlight's color/style directly from the
   * popup, the same set of swatches `SelectionToolbar` offers when
   * first creating one — previously the only way to change color was
   * deleting the highlight and re-selecting the text to make a new
   * one. */
  onSetStyle: (id: string, style: HighlightStyle) => void;
  onRemove: (id: string) => void;
  onDismiss: () => void;
}

/**
 * A small floating popup for an *existing* highlight tapped/clicked
 * while reading — offering the same note/delete/color actions the
 * Highlights panel already has (see `HighlightListItem`), directly in
 * the book, per explicit product direction (issue #48: "anything I do
 * inside the annotations tab, I should also be able to do directly in
 * the book"). Always opens straight into "edit" mode (issue #97): the
 * color swatches (issue #79) and the note field are both immediately
 * visible, with no separate collapsed/view-only state to toggle out of
 * first — a reader tapping a highlight is almost always about to act on
 * it (recolor it or note it), not just glance at it. The highlighted
 * text itself isn't echoed back here at all, unlike an earlier version
 * — it's already visible, highlighted, in the book right behind this
 * popup.
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
export const HighlightActionPopup: FC<HighlightActionPopupProps> = ({
  state,
  onSetNote,
  onSetStyle,
  onRemove,
  onDismiss,
}) => {
  const chromeTheme = useChromeTheme();
  const t = useTranslation();
  const [draftNote, setDraftNote] = useState("");
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // Keeps this popup fully on-screen even when the highlight it's
  // anchored to sits near the top/left/right edge of the viewport (an
  // otherwise-unclamped `translate(-50%, calc(-100% - 10px))` has no
  // notion of the viewport's own edges at all — see the hook's own doc
  // comment).
  const clampOffset = useClampedPopupOffset(
    popupRef,
    state ? { left: state.left, top: state.top } : undefined,
    10,
    [],
  );

  // Resets the note draft whenever a *different* highlight is opened
  // (or this one closes) — without this, opening a second highlight
  // would show the first highlight's leftover draft text for a moment.
  useEffect(() => {
    setDraftNote(state?.highlight.note ?? "");
  }, [state?.highlight.id]);

  // This popup always opens straight into "edit" mode (issue #97: no
  // separate view-only state to toggle out of first) — color swatches
  // and the note field are both immediately visible and usable the
  // moment a highlight is tapped/clicked, not gated behind a
  // color-dot/note-icon toggle the reader has to find and click first.
  // Focusing the note field to match follows the same reasoning
  // `onAddNote`'s `openNoteEditor` flag already established: the whole
  // point of opening this popup is almost always to act on the
  // highlight (recolor it or note it), not just to look at it.
  useEffect(() => {
    if (state) {
      noteTextareaRef.current?.focus();
    }
  }, [state?.highlight.id]);

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

  const saveNote = (): void => {
    const trimmed = draftNote.trim();
    onSetNote(highlight.id, trimmed === "" ? undefined : trimmed);
    onDismiss();
  };

  const cancelNoteEdit = (): void => {
    setDraftNote(highlight.note ?? "");
    onDismiss();
  };

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label={t("highlight.optionsDialogAriaLabel")}
      style={{
        position: "fixed",
        left: state.left,
        top: state.top,
        transform: `translate(calc(-50% + ${clampOffset.x}px), calc(-100% - 10px + ${clampOffset.y}px))`,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: 10,
        // 1.5x this popup's old 220–280px range (issue #98): wide enough
        // that the note field below reads as a real writing surface,
        // not a cramped afterthought — this popup is now always in
        // "edit" mode (see below), so it's sized for that from the
        // start rather than for the old, narrower "just glance at it"
        // default.
        minWidth: 330,
        maxWidth: 420,
        background: chromeTheme.backgroundSolid,
        border: `1px solid ${CHROME_BORDER}`,
        boxShadow: CHROME_SHADOW,
      }}
    >
      {/* Always open into "edit" mode (issue #97) — the color swatches
          and note field below are both immediately visible and usable,
          not gated behind a color-dot/note-icon toggle the reader has
          to find and click first. Delete/close still get their own
          row, pushed to the far right by `marginLeft: auto` on their
          wrapping span. The highlighted text itself is deliberately not
          repeated here anymore — it's already visible, highlighted, in
          the book right behind this popup, so echoing it back was pure
          redundancy. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div role="radiogroup" aria-label={t("highlight.colorGroupAriaLabel")} style={{ display: "flex", gap: 6 }}>
          {HighlightTheme.STYLE_ORDER.map((style) => {
            const swatchOption = HighlightTheme.STYLES[style];
            const label = t(HIGHLIGHT_STYLE_LABEL_KEYS[style]);
            const selected = style === highlight.style;
            return (
              <Tooltip key={style} content={label} relationship="label">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  onClick={() => onSetStyle(highlight.id, style)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: selected ? "2px solid rgba(15, 23, 42, 0.75)" : "1px solid rgba(0, 0, 0, 0.15)",
                    boxShadow: selected ? "0 0 0 2px rgba(255, 255, 255, 0.9)" : "none",
                    cursor: "pointer",
                    padding: 0,
                    background:
                      style === "underline"
                        ? `linear-gradient(to bottom, transparent 0%, transparent 65%, ${swatchOption.swatch} 65%, ${swatchOption.swatch} 80%, transparent 80%)`
                        : swatchOption.swatch,
                  }}
                />
              </Tooltip>
            );
          })}
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <Tooltip content={t("highlight.deleteHighlight")} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={<DeleteRegular />}
              onClick={() => {
                onRemove(highlight.id);
                onDismiss();
              }}
            />
          </Tooltip>
          <Tooltip content={t("highlight.close")} relationship="label">
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onDismiss} />
          </Tooltip>
        </span>
      </div>

      <div>
        <Textarea
          ref={noteTextareaRef}
          value={draftNote}
          onChange={(_event, data) => setDraftNote(data.value)}
          placeholder={t("annotations.notePlaceholder")}
          resize="vertical"
          rows={4}
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
          <Button size="small" onClick={cancelNoteEdit}>
            {t("annotations.cancelNote")}
          </Button>
          <Button size="small" appearance="primary" onClick={saveNote}>
            {t("annotations.saveNote")}
          </Button>
        </div>
      </div>
    </div>
  );
};
