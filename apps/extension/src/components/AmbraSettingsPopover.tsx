import { useEffect, useRef, useState, type FC } from "react";
import { ReadingTheme, type PageTheme } from "@ambra/engine";
import { Button, Field, Popover, PopoverSurface, PopoverTrigger, Select, Tooltip } from "@fluentui/react-components";
import { FullScreenMaximizeRegular, FullScreenMinimizeRegular, SettingsRegular } from "@fluentui/react-icons";
import type { GlobalReadingSettings } from "../library/ReadingSettings.js";
import { CHROME_THEMES, type ChromeThemeChoice } from "../reader/chromeTheme.js";
import { DefaultableSlider } from "../reader/components/DefaultableSlider.js";
import type { ViewMode } from "../reader/ViewMode.js";
import type { PageTurnAnimationStyle } from "../reader/PageTurnAnimationStyle.js";
import type { ProgressMarkerStyle } from "../reader/ProgressMarkerStyle.js";
import { useLocale, useTranslation } from "../i18n/LocaleContext.js";
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, type LocalePreference } from "../i18n/Locale.js";
import type { StringCatalog } from "../i18n/locales/en.js";

export interface AmbraSettingsPopoverProps {
  settings: GlobalReadingSettings;
  onChange: (patch: Partial<GlobalReadingSettings>) => void;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  readingFirst?: boolean;
  isFixedLayout?: boolean;
  showFullscreen?: boolean;
}

const themeLabels: Partial<Record<ChromeThemeChoice, keyof StringCatalog>> = {
  silver: "chromeTheme.silver", green: "chromeTheme.green", blue: "chromeTheme.blue", purple: "chromeTheme.purple",
};

/** App-wide values only. Book typography/layout remain owned by Book options. */
export const AmbraSettingsPopover: FC<AmbraSettingsPopoverProps> = ({
  settings, onChange, disabled, open: controlledOpen, onOpenChange, readingFirst = false, isFixedLayout = false,
  showFullscreen = true,
}) => {
  const t = useTranslation();
  const language = useLocale();
  const [internalOpen, setOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(document.fullscreenElement !== null);
  const [fullscreenError, setFullscreenError] = useState<string>();
  const pageThemeRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (open && readingFirst) pageThemeRef.current?.focus({ preventScroll: true });
  }, [open, readingFirst]);
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
      setFullscreenError(undefined);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  const toggleFullscreen = async (): Promise<void> => {
    setFullscreenError(undefined);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setFullscreenError(t("settings.fullscreenError"));
    }
  };
  const interfaceControls = (
    <div style={{ display: "grid", gap: 12 }}>
      <Field label={t("settings.interfaceTheme")}>
        <Select value={settings.chromeTheme} onChange={(_event, data) => onChange({ chromeTheme: data.value as ChromeThemeChoice })}>
          {(Object.keys(CHROME_THEMES) as ChromeThemeChoice[]).map((theme) => (
            <option key={theme} value={theme}>{themeLabels[theme] ? t(themeLabels[theme]!) : CHROME_THEMES[theme].label}</option>
          ))}
        </Select>
      </Field>
      <Field label={t("settings.language")}>
        <Select disabled={!language.ready} value={language.preference}
          onChange={(_event, data) => language.setPreference(data.value as LocalePreference)}>
          <option value="system">{t("settings.languageSystemDefault")}</option>
          {SUPPORTED_LOCALES.map((locale) => <option key={locale} value={locale}>{LOCALE_NATIVE_NAMES[locale]}</option>)}
        </Select>
      </Field>
      {language.error && <div role="alert">{language.error}</div>}
    </div>
  );
  const readingControls = (
    <details open={readingFirst}>
      <summary style={{ cursor: "pointer", minHeight: 32, lineHeight: "32px", fontWeight: 600 }}>{t("settings.readingPreferences")}</summary>
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        <Field label={t("text.pageStyle")}>
          <Select ref={pageThemeRef} value={settings.pageTheme} onChange={(_event, data) => onChange({ pageTheme: data.value as PageTheme })}>
            <option value="white">{t("pageTheme.white")}</option>
            <option value="sepia">{t("pageTheme.sepia")}</option>
            <option value="dark">{t("pageTheme.dark")}</option>
          </Select>
        </Field>
        <Field label={t("settings.brightness")}>
          <DefaultableSlider aria-label={t("settings.brightness")} min={ReadingTheme.MIN_BRIGHTNESS}
            max={ReadingTheme.MAX_BRIGHTNESS} step={ReadingTheme.BRIGHTNESS_STEP}
            defaultValue={ReadingTheme.DEFAULT_BRIGHTNESS} value={settings.brightness}
            onChange={(brightness) => onChange({ brightness })} />
        </Field>
        {!isFixedLayout && <Field label={t("settings.readingMode")}>
          <Select value={settings.viewMode} onChange={(_event, data) => onChange({ viewMode: data.value as ViewMode })}>
            <option value="paginated">{t("settings.paginated")}</option>
            <option value="scroll">{t("settings.scroll")}</option>
          </Select>
        </Field>}
        <Field label={t("settings.pageTurn")}>
          <Select disabled={settings.viewMode === "scroll"} value={settings.pageTurnAnimationStyle}
            onChange={(_event, data) => onChange({ pageTurnAnimationStyle: data.value as PageTurnAnimationStyle })}>
            <option value="slide">{t("settings.slide")}</option>
            <option value="scroll">{t("settings.filmStrip")}</option>
            <option value="rotate">{t("settings.pageFlip")}</option>
            <option value="none">{t("settings.off")}</option>
          </Select>
        </Field>
        <Field label={t("settings.progressLandmarks")}>
          <Select value={settings.progressMarkerStyle} onChange={(_event, data) => onChange({ progressMarkerStyle: data.value as ProgressMarkerStyle })}>
            <option value="upcoming">{t("settings.progressLandmarksShow")}</option>
            <option value="off">{t("settings.progressLandmarksHide")}</option>
          </Select>
        </Field>
      </div>
    </details>
  );
  return (
    <Popover open={open} trapFocus positioning="below-end" onOpenChange={(_event, data) => {
      setTooltipVisible(false);
      setOpen(data.open);
      onOpenChange?.(data.open);
    }}>
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip content={t("settings.ambraTitle")} relationship="label" visible={tooltipVisible && !open}
          onVisibleChange={(_event, data) => setTooltipVisible(data.visible && !open)}>
          <Button appearance="subtle" icon={<SettingsRegular />} aria-label={t("settings.ambraTitle")} disabled={disabled} />
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface aria-label={t("settings.ambraTitle")} style={{ width: 288, boxSizing: "border-box",
        maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 72px)", overflowY: "auto", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>{t("settings.ambraTitle")}</h2>
          {showFullscreen && <Tooltip content={t(isFullscreen ? "settings.exitFullscreen" : "settings.enterFullscreen")} relationship="label">
            <Button appearance="subtle" size="small"
              icon={isFullscreen ? <FullScreenMinimizeRegular /> : <FullScreenMaximizeRegular />}
              aria-label={t(isFullscreen ? "settings.exitFullscreen" : "settings.enterFullscreen")}
              onClick={() => void toggleFullscreen()} />
          </Tooltip>}
        </div>
        {fullscreenError && <div role="alert" style={{ marginBottom: 12 }}>{fullscreenError}</div>}
        <div style={{ display: "grid", gap: 12 }}>
          {readingFirst ? <>{readingControls}{interfaceControls}</> : <>{interfaceControls}{readingControls}</>}
        </div>
      </PopoverSurface>
    </Popover>
  );
};
