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
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowUndoRegular,
  ChevronDownRegular,
  ChevronUpRegular,
  HeadphonesRegular,
  PauseRegular,
  PlayRegular,
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
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  focusOnOpen?: boolean;
  hasSelection?: boolean;
}

const RATES = [0.75, 1, 1.25, 1.5, 2];

const useStyles = makeStyles({
  auxiliary: {
    whiteSpace: "normal",
    minWidth: 0,
    maxWidth: "100%",
    paddingInline: "8px",
    overflowWrap: "anywhere",
  },
  auxiliaryLabel: {
    display: "inline-grid",
  },
  rate: {
    minHeight: "28px",
    padding: "3px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    lineHeight: "18px",
    fontVariantNumeric: "tabular-nums",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    '&[aria-checked="true"]': {
      backgroundColor: tokens.colorNeutralBackground1Selected,
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
  collapsed,
  onCollapsedChange,
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
  const collapseLabel = t(collapsed ? "narration.expand" : "narration.collapse");
  const playback = (
    <Tooltip content={playLabel} relationship="label">
      <Button ref={playButton} appearance="primary" size={collapsed ? "small" : "large"}
        icon={playing ? <PauseRegular /> : <PlayRegular />}
        aria-label={playLabel} onClick={onPlayPause}
        style={{ minWidth: collapsed ? 92 : 120, minHeight: collapsed ? 36 : 48, fontSize: collapsed ? 13 : 15 }}>
        <span className={styles.auxiliaryLabel}>
          <span aria-hidden={playing} style={{ gridArea: "1 / 1", visibility: playing ? "hidden" : "visible" }}>{t("narration.playLabel")}</span>
          <span aria-hidden={!playing} style={{ gridArea: "1 / 1", visibility: playing ? "visible" : "hidden" }}>{t("narration.pauseLabel")}</span>
        </span>
      </Button>
    </Tooltip>
  );

  if (!state.available) return null;

  return (
    <section
      data-narration-controls
      data-collapsed={collapsed}
      aria-label={t("narration.controls")}
      style={{
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
        color: tokens.colorNeutralForeground1,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        data-narration-commands
        style={{ display: collapsed ? "grid" : "flex", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          flexWrap: "wrap", alignItems: "center", gap: 8, minHeight: 28 }}
      >
        <div
          data-narration-position-commands
          style={{ display: collapsed ? "contents" : "flex", alignItems: "center", flexWrap: "wrap", gap: 6, minWidth: 0, flex: 1 }}
        >
          <Caption1 style={{ fontSize: 14, lineHeight: "21px", fontWeight: 600 }}>{t("narration.readAlong")}</Caption1>
          {collapsed ? playback : <>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Caption1>{t("narration.speedLabel")}</Caption1>
          <Menu
            checkedValues={{ rate: [String(state.rate)] }}
            onCheckedValueChange={(_, data) => {
              if (data.name === "rate") onRateChange(Number(data.checkedItems[0]));
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
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
          </div>
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
              style={{ visibility: canReturn ? "visible" : "hidden", marginInlineStart: "auto" }}
            >
              <span className={styles.auxiliaryLabel}>{t("narration.return")}</span>
            </Button>
          </Tooltip>
          <Tooltip content={listenLabel} relationship="label">
            <Button
              appearance="subtle"
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
          </>}
        </div>
        <Tooltip content={collapseLabel} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={collapsed ? <ChevronUpRegular /> : <ChevronDownRegular />}
            aria-label={collapseLabel}
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
            className={styles.auxiliary}
            style={{ marginInlineStart: "auto", alignSelf: collapsed ? "center" : "flex-start", justifySelf: "end" }}
          >
            {t(collapsed ? "narration.expandLabel" : "narration.collapseLabel")}
          </Button>
        </Tooltip>
      </div>
      {!collapsed && <div data-narration-primary-commands
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          alignItems: "center", gap: 8, minHeight: 48, width: "100%", maxWidth: 480, marginInline: "auto" }}>
        <Tooltip content={t("narration.previous")} relationship="label">
          <Button appearance="secondary" size="small" className={styles.auxiliary} style={{ justifySelf: "end" }}
            aria-label={t("narration.previous")} disabled={!state.hasPrevious} onClick={onPrevious}>
            {t("narration.previousLabel")}
          </Button>
        </Tooltip>
        {playback}
        <Tooltip content={t("narration.next")} relationship="label">
          <Button appearance="secondary" size="small" className={styles.auxiliary} style={{ justifySelf: "start" }}
            aria-label={t("narration.next")} disabled={!state.hasNext} onClick={onNext}>
            {t("narration.nextLabel")}
          </Button>
        </Tooltip>
      </div>}
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
        <Caption1 tabIndex={0} style={{
          textAlign: "center", overflowWrap: "anywhere", maxHeight: 96, overflowY: "auto",
        }}>{state.error}</Caption1>
      )}
    </section>
  );
};
