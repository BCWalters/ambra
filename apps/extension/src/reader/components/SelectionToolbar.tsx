import type { FC } from "react";
import { Tooltip } from "@fluentui/react-components";
import { NoteRegular } from "@fluentui/react-icons";
import { HighlightTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { SelectionToolbarState } from "../ReaderController.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";

export interface SelectionToolbarProps {
  /** `undefined` when there's no active text selection — see
   * `ReaderController.setUpHighlightSelection`. */
  state: SelectionToolbarState | undefined;
  onPick: (style: HighlightStyle) => void;
  /** Issue #60: creates a highlight (in the same default style
   * `STYLE_ORDER[0]` uses) *and* immediately opens its note editor,
   * skipping the otherwise-required "highlight, then click it, then
   * click the note icon" sequence. */
  onAddNote: () => void;
}

const STYLE_ORDER: readonly HighlightStyle[] = ["yellow", "green", "blue", "pink", "purple", "underline"];

/**
 * A small floating toolbar of highlight-color swatches (plus underline)
 * and a "add note" shortcut, anchored just above whatever text the
 * reader currently has selected inside the content iframe — see
 * `ReaderController.setUpHighlightSelection` for how `state`'s position
 * is computed (the selection's own rect, combined with the content
 * iframe's position, since a `Range` inside a cross-document iframe has
 * no meaningful coordinates in the parent document on its own).
 *
 * Deliberately not a `Menu`/`Dialog` — a text selection is an inherently
 * transient, fast interaction (make a selection, tap a color, done), so
 * this is a plain, always-cheap-to-render floating strip that appears
 * and disappears with the selection itself, never trapping focus or
 * requiring a dismiss action of its own.
 */
export const SelectionToolbar: FC<SelectionToolbarProps> = ({ state, onPick, onAddNote }) => {
  const chromeTheme = useChromeTheme();

  if (!state) {
    return null;
  }

  return (
    <div
      role="toolbar"
      aria-label="Highlight this selection"
      // Prevents a mousedown on this toolbar from collapsing the content
      // iframe's own text selection before `onPick` ever runs — clicking
      // *anywhere* outside a selection normally clears it immediately.
      onMouseDown={(event) => event.preventDefault()}
      style={{
        position: "fixed",
        left: state.left,
        top: state.top,
        transform: "translate(-50%, calc(-100% - 10px))",
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        borderRadius: 10,
        background: chromeTheme.backgroundSolid,
        border: `1px solid ${CHROME_BORDER}`,
        boxShadow: CHROME_SHADOW,
      }}
    >
      {STYLE_ORDER.map((style) => {
        const option = HighlightTheme.STYLES[style];
        return (
          <Tooltip key={style} content={option.label} relationship="label">
            <button
              type="button"
              aria-label={option.label}
              onClick={() => onPick(style)}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: "1px solid rgba(0, 0, 0, 0.15)",
                cursor: "pointer",
                padding: 0,
                background:
                  style === "underline"
                    ? `linear-gradient(to bottom, transparent 0%, transparent 65%, ${option.swatch} 65%, ${option.swatch} 80%, transparent 80%)`
                    : option.swatch,
              }}
            />
          </Tooltip>
        );
      })}

      <div aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: CHROME_BORDER }} />

      <Tooltip content="Add note" relationship="label">
        <button
          type="button"
          aria-label="Add note"
          onClick={onAddNote}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            padding: 0,
            background: "none",
            color: "inherit",
          }}
        >
          <NoteRegular fontSize={16} />
        </button>
      </Tooltip>
    </div>
  );
};
