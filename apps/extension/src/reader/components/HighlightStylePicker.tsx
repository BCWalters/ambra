import { useRef } from "react";
import type { FC } from "react";
import { Tooltip } from "@fluentui/react-components";
import { HighlightTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { HIGHLIGHT_STYLE_LABEL_KEYS } from "./SelectionToolbar.js";

export interface HighlightStylePickerProps {
  value: HighlightStyle;
  onChange: (style: HighlightStyle) => void;
}

export const HighlightStylePicker: FC<HighlightStylePickerProps> = ({ value, onChange }) => {
  const t = useTranslation();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      role="radiogroup"
      aria-label={t("highlight.colorGroupAriaLabel")}
      style={{ display: "flex", gap: 6 }}
    >
      {HighlightTheme.STYLE_ORDER.map((style, index, styles) => {
        const selected = style === value;
        const label = t(HIGHLIGHT_STYLE_LABEL_KEYS[style]);
        const swatch = HighlightTheme.STYLES[style].swatch;
        return (
          <Tooltip key={style} content={label} relationship="label">
            <button
              ref={(button) => {
                buttons.current[index] = button;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(style)}
              onKeyDown={(event) => {
                const step =
                  event.key === "ArrowRight" || event.key === "ArrowDown"
                    ? 1
                    : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? -1
                      : 0;
                if (!step) return;
                event.preventDefault();
                event.stopPropagation();
                // Start from the focused button, not a possibly still-persisting selection.
                const next = (index + step + styles.length) % styles.length;
                buttons.current[next]?.focus();
                onChange(styles[next]!);
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: selected
                  ? "2px solid rgba(15, 23, 42, 0.75)"
                  : "1px solid rgba(0, 0, 0, 0.15)",
                boxShadow: selected ? "0 0 0 2px rgba(255, 255, 255, 0.9)" : "none",
                cursor: "pointer",
                padding: 0,
                background:
                  style === "underline"
                    ? `linear-gradient(to bottom, transparent 0%, transparent 65%, ${swatch} 65%, ${swatch} 80%, transparent 80%)`
                    : swatch,
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
};
