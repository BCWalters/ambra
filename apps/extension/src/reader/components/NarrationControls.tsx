import { useEffect, useRef } from "react";
import type { FC } from "react";
import {
  Button,
  Caption1,
  Menu,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Tooltip,
  buttonClassNames,
  makeStyles,
  shorthands,
} from "@fluentui/react-components";
import {
  ArrowUndoRegular,
  ChevronDownRegular,
  DismissRegular,
  HeadphonesRegular,
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
  hasSelection?: boolean;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

const useStyles = makeStyles({
  auxiliary: {
    whiteSpace: "nowrap",
    borderRadius: "999px",
    backgroundColor: "color-mix(in srgb, var(--narration-accent) 9%, white)",
    ...shorthands.borderColor("color-mix(in srgb, var(--narration-accent) 18%, transparent)"),
    color: "var(--narration-accent)",
    paddingInline: "10px",
    ":hover": {
      backgroundColor: "color-mix(in srgb, var(--narration-accent) 14%, white)",
      ...shorthands.borderColor("color-mix(in srgb, var(--narration-accent) 28%, transparent)"),
      color: "var(--narration-accent)",
    },
    ":active": {
      backgroundColor: "color-mix(in srgb, var(--narration-accent) 19%, white)",
      color: "var(--narration-accent)",
    },
    "@container narration (max-width: 720px)": {
      minWidth: "28px",
      width: "28px",
      paddingInline: "4px",
      [`& .${buttonClassNames.icon}`]: { marginRight: 0 },
    },
  },
  auxiliaryLabel: {
    display: "inline-grid",
    "@container narration (max-width: 720px)": { display: "none" },
  },
  rate: {
    minHeight: "28px",
    padding: "3px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    lineHeight: "18px",
    fontVariantNumeric: "tabular-nums",
    ":hover": { backgroundColor: "rgba(15, 23, 42, 0.06)" },
    '&[aria-checked="true"]': {
      backgroundColor: "rgba(15, 23, 42, 0.08)",
      fontWeight: 600,
    },
  },
  hiddenStatus: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  },
});

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
  hasSelection = false,
}) => {
  const t = useTranslation();
  const palette = useChromeTheme();
  const styles = useStyles();
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
  const listenLabel = t(hasSelection ? "narration.listenFromSelection" : "narration.listenFromPage");
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
        ...{ "--narration-accent": palette.accentForeground },
        // Scroll view's chrome-reveal transform can extend beneath the footer.
        position: "relative",
        zIndex: 1,
        flexShrink: 0,
        minWidth: 0,
        boxSizing: "border-box",
        padding: "6px 8px",
        containerType: "inline-size",
        containerName: "narration",
        borderTop: `1px solid ${CHROME_BORDER}`,
        background: palette.backgroundSolid,
        color: "var(--colorNeutralForeground1, #242424)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        data-narration-commands
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 8, minHeight: 28 }}
      >
        <div
          data-narration-primary-commands
          style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 6, minWidth: 0 }}
        >
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
          <Menu
            checkedValues={{ rate: [String(state.rate)] }}
            onCheckedValueChange={(_, data) => {
              if (data.name === "rate") onRateChange(Number(data.checkedItems[0]));
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="secondary"
                size="small"
                shape="circular"
                icon={<ChevronDownRegular />}
                iconPosition="after"
                aria-label={`${t("narration.speed")}: ${state.rate}×`}
                style={{ minWidth: 64, background: palette.backgroundSolid }}
              >
                {state.rate}×
              </Button>
            </MenuTrigger>
            <MenuPopover style={{ background: palette.backgroundSolid, minWidth: 96, maxWidth: 112, padding: 4, borderRadius: 10 }}>
              <MenuList aria-label={t("narration.speed")}>
                {RATES.map((rate) => (
                  <MenuItemRadio key={rate} name="rate" value={String(rate)} className={styles.rate}>
                    {rate}×
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <Tooltip content={t("narration.return")} relationship="label">
            <Button
              appearance="secondary"
              size="small"
              icon={<ArrowUndoRegular />}
              className={styles.auxiliary}
              onClick={onReturnToNarration}
              aria-label={t("narration.return")}
              aria-hidden={!canReturn}
              tabIndex={canReturn ? undefined : -1}
              disabled={!canReturn}
              style={{ visibility: canReturn ? "visible" : "hidden" }}
            >
              <span className={styles.auxiliaryLabel}>{t("narration.return")}</span>
            </Button>
          </Tooltip>
          <Tooltip content={listenLabel} relationship="label">
            <Button
              appearance="secondary"
              size="small"
              icon={<HeadphonesRegular />}
              className={styles.auxiliary}
              aria-label={listenLabel}
              onClick={onListenFromHere}
            >
              <span className={styles.auxiliaryLabel}>
                <span aria-hidden={hasSelection} style={{ gridArea: "1 / 1", visibility: hasSelection ? "hidden" : "visible" }}>
                  {t("narration.listenFromPage")}
                </span>
                <span aria-hidden={!hasSelection} style={{ gridArea: "1 / 1", visibility: hasSelection ? "visible" : "hidden" }}>
                  {t("narration.listenFromSelection")}
                </span>
              </span>
            </Button>
          </Tooltip>
        </div>
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
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={state.status === "error" ? undefined : styles.hiddenStatus}
        style={state.status === "error" ? { textAlign: "center", overflowWrap: "anywhere", marginTop: 4 } : undefined}
      >
        {status && <Caption1 block>{status}</Caption1>}
      </div>
      {state.status === "error" && state.error && (
        <Caption1 style={{ textAlign: "center", overflowWrap: "anywhere" }}>{state.error}</Caption1>
      )}
    </section>
  );
};
