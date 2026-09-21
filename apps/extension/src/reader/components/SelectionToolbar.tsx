import { useRef } from "react";
import type { FC } from "react";
import { Tooltip } from "@fluentui/react-components";
import { NoteRegular } from "@fluentui/react-icons";
import { HighlightTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { SelectionToolbarState } from "../ReaderController.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import type { StringCatalog } from "../../i18n/locales/en.js";
import { useClampedPopupOffset } from "../useClampedPopupOffset.js";

/** `HighlightTheme.STYLES[style].label` is engine-owned English (the
 * engine itself has no notion of UI locale) — these are genuinely
 * descriptive color/style words, unlike e.g. a font's own proper name,
 * so unlike those they get a translated label here at the display
 * layer, shared by this toolbar and `HighlightActionPopup`'s own color
 * picker (the same six swatches, offered in two different moments —
 * see this file's own doc comment). */
export const HIGHLIGHT_STYLE_LABEL_KEYS: Readonly<Record<HighlightStyle, keyof StringCatalog>> = {
  yellow: "highlightStyle.yellow",
  green: "highlightStyle.green",
  blue: "highlightStyle.blue",
  pink: "highlightStyle.pink",
  purple: "highlightStyle.purple",
  underline: "highlightStyle.underline",
};

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
  const t = useTranslation();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  // See `HighlightActionPopup`'s identical use of this hook — this
  // toolbar's own size never actually changes (always the same six
  // swatches + note button), so only the anchor point itself needs
  // watching.
  const clampOffset = useClampedPopupOffset(
    toolbarRef,
    state ? { left: state.left, top: state.top } : undefined,
    10,
    [],
  );

  if (!state) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t("highlight.selectionToolbarAriaLabel")}
      // Prevents a mousedown on this toolbar from collapsing the content
      // iframe's own text selection before `onPick` ever runs — clicking
      // *anywhere* outside a selection normally clears it immediately.
      onMouseDown={(event) => event.preventDefault()}
      style={{
        position: "fixed",
        left: state.left,
        top: state.top,
        transform: `translate(calc(-50% + ${clampOffset.x}px), calc(-100% - 10px + ${clampOffset.y}px))`,
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
      {HighlightTheme.STYLE_ORDER.map((style) => {
        const option = HighlightTheme.STYLES[style];
        const label = t(HIGHLIGHT_STYLE_LABEL_KEYS[style]);
        return (
          <Tooltip key={style} content={label} relationship="label">
            <button
              type="button"
              aria-label={label}
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

      <Tooltip content={t("highlight.addNote")} relationship="label">
        <button
          type="button"
          aria-label={t("highlight.addNote")}
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
