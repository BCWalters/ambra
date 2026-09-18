import type { FC } from "react";
import { Button, Slider, Tooltip } from "@fluentui/react-components";
import { ArrowResetRegular } from "@fluentui/react-icons";

export interface DefaultableSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  /** Where this slider started out, before any change — shown as a
   * small tick mark on the rail and, via the adjoining reset button, one
   * click to return to. Every reading-preference slider in the toolbar
   * (font size, line spacing, character spacing, column width) has a
   * meaningful "book default" a reader may want to find their way back
   * to after experimenting, but a bare `Slider` gives no visual hint at
   * all of where that was — this wrapper is that hint. */
  defaultValue: number;
  onChange: (value: number) => void;
  "aria-label": string;
}

/** Matches Fluent's medium-size `Slider` thumb radius (half of its 20px
 * thumb — see `useSliderStyles.styles`'s `--fui-Slider__thumb--size`/
 * `--fui-Slider__inner-thumb--radius` CSS variables): the thumb's own
 * travel is inset by this many pixels from each edge of the rail, so a
 * value-to-position mapping that ignores the inset would drift out of
 * alignment with where the thumb itself actually lands, worst at the
 * extremes. Recomputing this from the slider's own rendered box would
 * need a `ResizeObserver`/ref for a purely cosmetic tick mark — not
 * worth the complexity for a fixed, documented constant that only ever
 * changes if `Slider`'s own default size does. */
const SLIDER_THUMB_INSET_PX = 10;

/** Tolerance for "is this slider currently at its default", since a
 * `<input type="range">`'s own step arithmetic can leave a value like
 * `0.30000000000000004` instead of exactly `0.3` — a strict `===`
 * against `defaultValue` would then never consider it "at default" even
 * when a reader has visually returned the thumb to the tick mark. */
const DEFAULT_EPSILON = 1e-6;

/**
 * A `Slider` with a visible tick mark at `defaultValue`'s position on
 * the rail, plus a small reset button (disabled once already at
 * default) beside it — so a reader who nudges a reading-preference
 * slider away from the book's/app's default always has an obvious way
 * to tell where that default was and a one-click way back, rather than
 * having to remember or hunt for it by feel.
 */
export const DefaultableSlider: FC<DefaultableSliderProps> = ({
  min,
  max,
  step,
  value,
  defaultValue,
  onChange,
  "aria-label": ariaLabel,
}) => {
  const fraction = max === min ? 0 : (defaultValue - min) / (max - min);
  const isAtDefault = Math.abs(value - defaultValue) < DEFAULT_EPSILON;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(_event, data) => onChange(data.value)}
          aria-label={ariaLabel}
          style={{ width: "100%" }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: `calc(${SLIDER_THUMB_INSET_PX}px + ${fraction} * (100% - ${2 * SLIDER_THUMB_INSET_PX}px))`,
            width: 2,
            height: 8,
            marginLeft: -1,
            transform: "translateY(-50%)",
            background: "var(--colorNeutralForeground3, #605e5c)",
            borderRadius: 1,
            pointerEvents: "none",
          }}
        />
      </div>
      <Tooltip content="Reset to default" relationship="label">
        <Button
          appearance="subtle"
          size="small"
          icon={<ArrowResetRegular />}
          disabled={isAtDefault}
          onClick={() => onChange(defaultValue)}
          aria-label={`Reset ${ariaLabel} to default`}
        />
      </Tooltip>
    </div>
  );
};
