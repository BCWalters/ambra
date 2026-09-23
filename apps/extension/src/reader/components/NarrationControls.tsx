import { useEffect, useRef } from "react";
import type { FC } from "react";
import { Button, Caption1, Select, Tooltip } from "@fluentui/react-components";
import {
  DismissRegular,
  NextRegular,
  PauseRegular,
  PlayRegular,
  PreviousRegular,
} from "@fluentui/react-icons";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { CHROME_BORDER } from "../chromeTheme.js";
import type { NarrationState } from "../MediaOverlayNarration.js";

export interface NarrationControlsProps {
  state: NarrationState;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReturnToNarration: () => void;
  onListenFromHere: () => void;
  onRateChange: (rate: number) => void;
  onClose: () => void;
  focusOnOpen?: boolean;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

/** In-flow chrome: the reader pane and its book scrubber remain above this strip. */
export const NarrationControls: FC<NarrationControlsProps> = ({
  state,
  onPlayPause,
  onPrevious,
  onNext,
  onReturnToNarration,
  onListenFromHere,
  onRateChange,
  onClose,
  focusOnOpen = false,
}) => {
  const t = useTranslation();
  const palette = useChromeTheme();
  const playButton = useRef<HTMLButtonElement>(null);
  const focusOnMount = useRef(focusOnOpen);
  useEffect(() => {
    if (focusOnMount.current) {
      playButton.current?.focus();
      focusOnMount.current = false;
    }
  }, []);
  const playing = state.status === "playing" || state.status === "loading";
  const canReturn = state.hasTarget && !state.following && state.status !== "idle" && state.status !== "error";
  const playLabel = t(playing ? "narration.pause" : "narration.play");
  const status = state.status === "error"
    ? t("narration.error")
    : state.status === "loading"
      ? t("narration.loading")
      : canReturn
        ? t("narration.browsing")
        : "";

  if (!state.available) return null;

  return (
    <section
      data-narration-controls
      aria-label={t("narration.controls")}
      style={{
        flexShrink: 0,
        minWidth: 0,
        boxSizing: "border-box",
        padding: "6px 8px",
        borderTop: `1px solid ${CHROME_BORDER}`,
        background: palette.backgroundSolid,
        color: "var(--colorNeutralForeground1, #242424)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 4 }}>
        <Tooltip content={t("narration.previous")} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<PreviousRegular />}
            aria-label={t("narration.previous")}
            disabled={!state.hasPrevious}
            onClick={onPrevious}
          />
        </Tooltip>
        <Tooltip content={playLabel} relationship="label">
          <Button
            ref={playButton}
            appearance="primary"
            size="small"
            icon={playing ? <PauseRegular /> : <PlayRegular />}
            aria-label={playLabel}
            onClick={onPlayPause}
            style={{ background: palette.accentForeground, color: "#fff" }}
          />
        </Tooltip>
        <Tooltip content={t("narration.next")} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<NextRegular />}
            aria-label={t("narration.next")}
            disabled={!state.hasNext}
            onClick={onNext}
          />
        </Tooltip>
        <Select
          size="small"
          aria-label={t("narration.speed")}
          value={String(state.rate)}
          onChange={(_, data) => onRateChange(Number(data.value))}
          style={{ minWidth: 76 }}
        >
          {RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </Select>
        <Tooltip content={t("narration.close")} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<DismissRegular />}
            aria-label={t("narration.close")}
            onClick={onClose}
          />
        </Tooltip>
      </div>
      <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 4 }}>
        <Button
          appearance="subtle"
          size="small"
          onClick={onReturnToNarration}
          aria-hidden={!canReturn}
          tabIndex={canReturn ? undefined : -1}
          disabled={!canReturn}
          style={{ maxWidth: "100%", whiteSpace: "normal", visibility: canReturn ? "visible" : "hidden" }}
        >
          {t("narration.return")}
        </Button>
        <Button
          appearance="subtle"
          size="small"
          onClick={onListenFromHere}
          style={{ maxWidth: "100%", whiteSpace: "normal" }}
        >
          {t("narration.listenFromHere")}
        </Button>
      </div>
      <div style={{ display: "grid", textAlign: "center", overflowWrap: "anywhere" }}>
        {/* Reserve wrapped translations too, so following never changes the reading viewport. */}
        <Caption1 aria-hidden="true" style={{ gridArea: "1 / 1", visibility: "hidden" }}>
          {t("narration.browsing")}
        </Caption1>
        <div role="status" aria-live="polite" aria-atomic="true" style={{ gridArea: "1 / 1", minHeight: 16 }}>
          {status && <Caption1 block>{status}</Caption1>}
        </div>
      </div>
      {state.status === "error" && state.error && (
        <Caption1 style={{ textAlign: "center", overflowWrap: "anywhere" }}>{state.error}</Caption1>
      )}
    </section>
  );
};
