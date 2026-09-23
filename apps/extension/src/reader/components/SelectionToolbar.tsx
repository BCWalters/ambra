import { useRef } from "react";
import type { FC } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { NoteRegular } from "@fluentui/react-icons";
import { HighlightTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { SelectionToolbarState } from "../ReaderTypes.js";
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
  // The shared observer also re-clamps when a translated note label wraps.
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
        // Above page furniture, below panel backdrops and reader chrome.
        zIndex: 6,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        borderRadius: 10,
        background: chromeTheme.backgroundSolid,
        border: `1px solid ${CHROME_BORDER}`,
        boxShadow: CHROME_SHADOW,
        width: "max-content",
        maxWidth: "calc(100vw - 20px)",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
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
                  width: 28,
                  height: 28,
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
      </div>

      <Tooltip content={t("highlight.addNote")} relationship="label">
        <Button appearance="subtle" size="small" icon={<NoteRegular />} onClick={onAddNote}>
          {t("highlight.addNote")}
        </Button>
      </Tooltip>
    </div>
  );
};
