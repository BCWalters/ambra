import { useId, useRef, useState, type FocusEvent, type FC } from "react";
import {
  Button,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Switch,
  Tooltip,
} from "@fluentui/react-components";
import type { MenuProps } from "@fluentui/react-components";
import {
  BookOpenRegular,
  DocumentOnePageColumnsRegular,
  QuestionCircleRegular,
  LocalLanguageRegular,
  SettingsRegular,
  TextColumnOneRegular,
  TextFontRegular,
} from "@fluentui/react-icons";
import { ReadingTheme } from "@ambra/engine";
import type { FontFamilyChoice, PageTheme } from "@ambra/engine";
import { useLocale, useTranslation } from "../../i18n/LocaleContext.js";
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from "../../i18n/Locale.js";
import type { LocalePreference } from "../../i18n/Locale.js";
import type { StringCatalog } from "../../i18n/locales/en.js";
import { CHROME_THEMES } from "../chromeTheme.js";
import type { ChromeThemeChoice } from "../chromeTheme.js";
import type { PageTurnAnimationStyle } from "../PageTurnAnimationStyle.js";
import type { ViewMode } from "../ViewMode.js";
import { DefaultableSlider } from "./DefaultableSlider.js";
import type { DefaultableSliderProps } from "./DefaultableSlider.js";
import { useCommandPresentation } from "../../shortcuts/useCommandPresentation.js";
import { scrollMenuFocusIntoView } from "./MenuFocusVisibility.js";

// Leave room for fractional-position rounding and visible focus outlines.
const MENU_POSITIONING = {
  autoSize: true,
  overflowBoundaryPadding: 4,
} satisfies MenuProps["positioning"];

const TOP_LEVEL_MENU_POSITIONING: MenuProps["positioning"] = {
  ...MENU_POSITIONING,
  position: "below",
  align: "end",
};

// Allow submenus to overlap their parent rather than leave the viewport at high zoom.
const SUBMENU_POSITIONING: MenuProps["positioning"] = {
  ...MENU_POSITIONING,
  shiftToCoverTarget: true,
};
function revealMenuFocus({ currentTarget, target }: FocusEvent<HTMLDivElement>): void {
  requestAnimationFrame(() => {
    if (currentTarget.isConnected && currentTarget.contains(target) &&
      currentTarget.ownerDocument.activeElement === target) {
      scrollMenuFocusIntoView(currentTarget, target);
    }
  });
}

export interface TypographyMenuActions {
  onSetFontScale: (scale: number) => void;
  onSetLineSpacing: (spacing: number) => void;
  onSetLetterSpacing: (spacing: number) => void;
  onSetContentWidth: (widthEm: number) => void;
  onSetFontFamily: (family: FontFamilyChoice) => void;
  onSetAlwaysShowOnePage: (enabled: boolean) => void;
}

interface ReaderMenuState {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface TypographyMenuProps extends TypographyMenuActions, ReaderMenuState {
  fontScale: number;
  lineSpacing: number;
  letterSpacing: number;
  contentWidthEm: number;
  fontFamily: FontFamilyChoice;
  alwaysShowOnePage: boolean;
}

export interface ReaderSettingsMenuActions {
  onSetPageTheme: (theme: PageTheme) => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSetBrightness: (brightness: number) => void;
  onSetChromeTheme: (theme: ChromeThemeChoice) => void;
  onSetPageTurnAnimationStyle: (style: PageTurnAnimationStyle) => void;
  onOpenHelp?: (returnFocusTo: HTMLElement | null) => void;
}

export interface ReaderSettingsMenuProps extends ReaderSettingsMenuActions, ReaderMenuState {
  pageTheme: PageTheme;
  disabled?: boolean;
  showReadingModeShortcuts?: boolean;
  isFixedLayout: boolean;
  viewMode: ViewMode;
  brightness: number;
  chromeTheme: ChromeThemeChoice;
  pageTurnAnimationStyle: PageTurnAnimationStyle;
}

const PAGE_THEME_LABEL_KEYS: Readonly<Record<PageTheme, keyof StringCatalog>> = {
  white: "pageTheme.white",
  sepia: "pageTheme.sepia",
  dark: "pageTheme.dark",
};
const CHROME_THEME_LABEL_KEYS: Readonly<Partial<Record<ChromeThemeChoice, keyof StringCatalog>>> = {
  silver: "chromeTheme.silver",
  green: "chromeTheme.green",
  blue: "chromeTheme.blue",
  purple: "chromeTheme.purple",
};
const ANIMATION_LABEL_KEYS: Readonly<Record<PageTurnAnimationStyle, keyof StringCatalog>> = {
  slide: "settings.slide",
  scroll: "settings.filmStrip",
  rotate: "settings.pageFlip",
  none: "settings.off",
};
const ANIMATION_ORDER: readonly PageTurnAnimationStyle[] = ["slide", "scroll", "rotate", "none"];

const MENU_TITLE_STYLE = {
  fontSize: 14,
  fontWeight: 600,
  lineHeight: "20px",
  color: "var(--colorNeutralForeground1, #242424)",
  marginBottom: 4,
};

const PageStyleSwatch: FC<{ background: string; foreground: string }> = ({ background, foreground }) => (
  <span aria-hidden="true" style={{
    display: "inline-flex", flexDirection: "column", justifyContent: "center",
    gap: 3, width: 20, height: 20, borderRadius: 4, background,
    border: "1px solid rgba(0, 0, 0, 0.15)", boxSizing: "border-box", padding: "0 4px",
  }}>
    <span style={{ display: "block", height: 2, borderRadius: 1, background: foreground, width: "100%" }} />
    <span style={{ display: "block", height: 2, borderRadius: 1, background: foreground, width: "65%" }} />
  </span>
);

const PreferenceSlider: FC<DefaultableSliderProps & { label: string }> = ({ label, ...props }) => (
  <MenuGroup>
    <MenuGroupHeader>{label}</MenuGroupHeader>
    <div style={{ padding: "6px 12px 10px" }}>
      <DefaultableSlider {...props} />
    </div>
  </MenuGroup>
);

const ThemeSwatch: FC<{ background: string; accent: string }> = ({ background, accent }) => (
  <span
    aria-hidden="true"
    style={{
      position: "relative",
      display: "inline-block",
      width: 20,
      height: 20,
      borderRadius: 4,
      background,
      border: "1px solid rgba(0, 0, 0, 0.15)",
      boxSizing: "border-box",
    }}
  >
    <span
      style={{
        position: "absolute",
        bottom: -2,
        right: -2,
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: accent,
        border: "1.5px solid var(--colorNeutralBackground1, #fff)",
        boxSizing: "border-box",
      }}
    />
  </span>
);

/** Each submenu owns its Fluent radio state; the caller owns persistence. */
export const TypographyMenu: FC<TypographyMenuProps> = ({
  open,
  onOpenChange,
  fontScale,
  lineSpacing,
  letterSpacing,
  contentWidthEm,
  fontFamily,
  alwaysShowOnePage,
  onSetFontScale,
  onSetLineSpacing,
  onSetLetterSpacing,
  onSetContentWidth,
  onSetFontFamily,
  onSetAlwaysShowOnePage,
}) => {
  const t = useTranslation();
  const scopeId = useId();
  return (
    <Menu open={open} onOpenChange={(_event, data) => onOpenChange?.(data.open)} positioning={TOP_LEVEL_MENU_POSITIONING}>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t("toolbar.textOptions")} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<TextFontRegular />}
            style={{ marginLeft: "var(--ambra-toolbar-cluster-gap, 8px)" }}
          />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover onFocusCapture={revealMenuFocus}>
        <MenuList aria-describedby={scopeId}>
          <MenuGroupHeader id={scopeId} style={MENU_TITLE_STYLE}>{t("text.bookScope")}</MenuGroupHeader>
          <Menu
            positioning={SUBMENU_POSITIONING}
            persistOnItemClick
            checkedValues={{ fontFamily: [fontFamily] }}
            onCheckedValueChange={(_event, data) => {
              if (data.name === "fontFamily")
                onSetFontFamily(data.checkedItems[0] as FontFamilyChoice);
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={<TextFontRegular />}>{t("text.textMenuLabel")}</MenuItem>
            </MenuTrigger>
            <MenuPopover onFocusCapture={revealMenuFocus}>
              <MenuList>
                <PreferenceSlider
                  label={t("text.size")}
                  aria-label={t("text.fontSizeAriaLabel")}
                  min={ReadingTheme.MIN_FONT_SCALE}
                  max={ReadingTheme.MAX_FONT_SCALE}
                  step={ReadingTheme.FONT_SCALE_STEP}
                  value={fontScale}
                  defaultValue={ReadingTheme.DEFAULT_FONT_SCALE}
                  onChange={onSetFontScale}
                />
                <MenuDivider />
                <PreferenceSlider
                  label={t("text.lineSpacing")}
                  aria-label={t("text.lineSpacing")}
                  min={ReadingTheme.MIN_LINE_SPACING}
                  max={ReadingTheme.MAX_LINE_SPACING}
                  step={ReadingTheme.LINE_SPACING_STEP}
                  value={lineSpacing}
                  defaultValue={ReadingTheme.DEFAULT_LINE_SPACING}
                  onChange={onSetLineSpacing}
                />
                <MenuDivider />
                <PreferenceSlider
                  label={t("text.characterSpacing")}
                  aria-label={t("text.characterSpacing")}
                  min={ReadingTheme.MIN_LETTER_SPACING}
                  max={ReadingTheme.MAX_LETTER_SPACING}
                  step={ReadingTheme.LETTER_SPACING_STEP}
                  value={letterSpacing}
                  defaultValue={ReadingTheme.DEFAULT_LETTER_SPACING}
                  onChange={onSetLetterSpacing}
                />
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>{t("text.font")}</MenuGroupHeader>
                  {(Object.keys(ReadingTheme.FONT_FAMILIES) as FontFamilyChoice[]).map((key) => {
                    const { stack, label } = ReadingTheme.FONT_FAMILIES[key];
                    // Typeface names stay untranslated; only descriptive choices translate.
                    const translatedLabel =
                      key === "sans"
                        ? t("fontFamily.sansSerif")
                        : key === "book-default"
                          ? t("fontFamily.bookDefault")
                          : label;
                    return (
                      <MenuItemRadio
                        key={key}
                        name="fontFamily"
                        value={key}
                        style={stack ? { fontFamily: stack } : undefined}
                      >
                        {translatedLabel}
                      </MenuItemRadio>
                    );
                  })}
                </MenuGroup>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu
            positioning={SUBMENU_POSITIONING}
            persistOnItemClick
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={<DocumentOnePageColumnsRegular />}>
                {t("text.pageMenuLabel")}
              </MenuItem>
            </MenuTrigger>
            <MenuPopover onFocusCapture={revealMenuFocus}>
              <MenuList>
                <PreferenceSlider
                  label={t("text.columnWidth")}
                  aria-label={t("text.columnWidth")}
                  min={ReadingTheme.MIN_CONTENT_WIDTH_EM}
                  max={ReadingTheme.MAX_CONTENT_WIDTH_EM}
                  step={ReadingTheme.CONTENT_WIDTH_STEP}
                  value={contentWidthEm}
                  defaultValue={ReadingTheme.DEFAULT_CONTENT_WIDTH_EM}
                  onChange={onSetContentWidth}
                />
                <MenuDivider />
                <div style={{ padding: "6px 12px" }}>
                  <Switch
                    label={t("text.alwaysShowOnePage")}
                    labelPosition="before"
                    checked={alwaysShowOnePage}
                    onChange={(_event, data) => onSetAlwaysShowOnePage(data.checked)}
                    style={{ width: "100%", justifyContent: "space-between" }}
                  />
                </div>
              </MenuList>
            </MenuPopover>
          </Menu>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};

const LanguageMenu: FC = () => {
  const t = useTranslation();
  const { preference, setPreference, ready, error } = useLocale();
  return (
    <>
      <Menu
        positioning={SUBMENU_POSITIONING}
        persistOnItemClick
        checkedValues={{ locale: [preference] }}
        onCheckedValueChange={(_event, data) => {
          if (data.name === "locale") setPreference(data.checkedItems[0] as LocalePreference);
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <MenuItem
            disabled={!ready}
            icon={<LocalLanguageRegular />}
            secondaryContent={{
              children: preference === "system"
                ? t("settings.languageSystemDefault")
                : LOCALE_NATIVE_NAMES[preference],
              style: { fontSize: 14 },
            }}
          >
            {t("settings.language")}
          </MenuItem>
        </MenuTrigger>
        <MenuPopover onFocusCapture={revealMenuFocus}>
          <MenuList>
            <MenuItemRadio name="locale" value="system">
              {t("settings.languageSystemDefault")}
            </MenuItemRadio>
            {SUPPORTED_LOCALES.map((locale) => (
              <MenuItemRadio key={locale} name="locale" value={locale}>
                {LOCALE_NATIVE_NAMES[locale]}
              </MenuItemRadio>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
      {error && <div role="alert" style={{ padding: "6px 12px", maxWidth: 280 }}>{error}</div>}
    </>
  );
};

export const ReaderSettingsMenu: FC<ReaderSettingsMenuProps> = ({
  open: controlledOpen,
  onOpenChange,
  disabled,
  showReadingModeShortcuts = false,
  isFixedLayout,
  viewMode,
  brightness,
  pageTheme,
  chromeTheme,
  pageTurnAnimationStyle,
  onSetViewMode,
  onSetBrightness,
  onSetPageTheme,
  onSetChromeTheme,
  onSetPageTurnAnimationStyle,
  onOpenHelp,
}) => {
  const t = useTranslation();
  const scopeId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean): void => {
    // A lingering trigger tooltip captures Escape before the menu or Help can.
    setTooltipVisible(false);
    setInternalOpen(next);
    onOpenChange?.(next);
  };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const scrollingShortcut = useCommandPresentation("switchToScrolling");
  const paginatedShortcut = useCommandPresentation("switchToPaginated");
  const chromeThemeLabel = CHROME_THEME_LABEL_KEYS[chromeTheme]
    ? t(CHROME_THEME_LABEL_KEYS[chromeTheme]!)
    : CHROME_THEMES[chromeTheme].label;
  return (
    <Menu
      open={open}
      onOpenChange={(_event, data) => setOpen(data.open)}
      positioning={TOP_LEVEL_MENU_POSITIONING}
      persistOnItemClick
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip
          content={t("toolbar.settings")}
          relationship="label"
          visible={tooltipVisible && !open}
          onVisibleChange={(_event, data) => setTooltipVisible(data.visible && !open)}
        >
          <Button
            ref={triggerRef}
            appearance="subtle"
            size="small"
            icon={<SettingsRegular />}
            disabled={disabled}
            style={isFixedLayout ? { marginLeft: "var(--ambra-toolbar-cluster-gap, 8px)" } : undefined}
          />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover onFocusCapture={revealMenuFocus} style={{ width: 288, maxWidth: "calc(100vw - 16px)" }}>
        <MenuList aria-describedby={scopeId}>
          <MenuGroupHeader id={scopeId} style={MENU_TITLE_STYLE}>{t("settings.globalScope")}</MenuGroupHeader>
          <Menu
            positioning={SUBMENU_POSITIONING}
            persistOnItemClick
            checkedValues={{ chromeTheme: [chromeTheme] }}
            onCheckedValueChange={(_event, data) => {
              if (data.name === "chromeTheme")
                onSetChromeTheme(data.checkedItems[0] as ChromeThemeChoice);
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem secondaryContent={{ children: chromeThemeLabel, style: { fontSize: 14 } }}>{t("settings.readerTheme")}</MenuItem>
            </MenuTrigger>
            <MenuPopover onFocusCapture={revealMenuFocus}>
              <MenuList>
                {(Object.keys(CHROME_THEMES) as ChromeThemeChoice[]).map((key) => (
                  <MenuItemRadio key={key} name="chromeTheme" value={key}
                    icon={<ThemeSwatch background={CHROME_THEMES[key].backgroundSolid} accent={CHROME_THEMES[key].accent} />}>
                    {CHROME_THEME_LABEL_KEYS[key] ? t(CHROME_THEME_LABEL_KEYS[key]!) : CHROME_THEMES[key].label}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <Menu
            positioning={SUBMENU_POSITIONING}
            persistOnItemClick
            checkedValues={{ pageTheme: [pageTheme] }}
            onCheckedValueChange={(_event, data) => {
              if (data.name === "pageTheme") onSetPageTheme(data.checkedItems[0] as PageTheme);
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem secondaryContent={{ children: t(PAGE_THEME_LABEL_KEYS[pageTheme]), style: { fontSize: 14 } }}>
                {t("text.pageStyle")}
              </MenuItem>
            </MenuTrigger>
            <MenuPopover onFocusCapture={revealMenuFocus}>
              <MenuList>
                {(Object.keys(ReadingTheme.PAGE_THEMES) as PageTheme[]).map((key) => (
                  <MenuItemRadio key={key} name="pageTheme" value={key}
                    icon={<PageStyleSwatch {...ReadingTheme.PAGE_THEMES[key]} />}>
                    {t(PAGE_THEME_LABEL_KEYS[key])}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <div style={{
            padding: "6px 12px", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)",
            alignItems: "center", gap: 12,
          }}>
            <span>{t("settings.brightness")}</span>
            <DefaultableSlider
              aria-label={t("settings.brightness")}
              min={ReadingTheme.MIN_BRIGHTNESS}
              max={ReadingTheme.MAX_BRIGHTNESS}
              step={ReadingTheme.BRIGHTNESS_STEP}
              value={brightness}
              defaultValue={ReadingTheme.DEFAULT_BRIGHTNESS}
              onChange={onSetBrightness}
            />
          </div>
          <MenuDivider />
          {!isFixedLayout && (
            <Menu
              positioning={SUBMENU_POSITIONING}
              persistOnItemClick
              checkedValues={{ viewMode: [viewMode] }}
              onCheckedValueChange={(_event, data) => {
                if (data.name === "viewMode") onSetViewMode(data.checkedItems[0] as ViewMode);
              }}
            >
              <MenuTrigger disableButtonEnhancement>
                <MenuItem secondaryContent={{
                  children: t(viewMode === "scroll" ? "settings.scroll" : "settings.paginated"),
                  style: { fontSize: 14 },
                }}>{t("settings.readingMode")}</MenuItem>
              </MenuTrigger>
              <MenuPopover onFocusCapture={revealMenuFocus}>
                <MenuList>
                  <MenuItemRadio name="viewMode" value="paginated"
                    aria-label={t("settings.paginated")} icon={<BookOpenRegular />}
                    secondaryContent={showReadingModeShortcuts ? paginatedShortcut.shortcutLabel : undefined}
                    aria-keyshortcuts={showReadingModeShortcuts ? paginatedShortcut.ariaKeyShortcuts : undefined}>
                    {t("settings.paginated")}
                  </MenuItemRadio>
                  <MenuItemRadio name="viewMode" value="scroll"
                    aria-label={t("settings.scroll")} icon={<TextColumnOneRegular />}
                    secondaryContent={showReadingModeShortcuts ? scrollingShortcut.shortcutLabel : undefined}
                    aria-keyshortcuts={showReadingModeShortcuts ? scrollingShortcut.ariaKeyShortcuts : undefined}>
                    {t("settings.scroll")}
                  </MenuItemRadio>
                </MenuList>
              </MenuPopover>
            </Menu>
          )}
          <Menu
            positioning={SUBMENU_POSITIONING}
            persistOnItemClick
            checkedValues={{ pageTurnAnimation: [pageTurnAnimationStyle] }}
            onCheckedValueChange={(_event, data) => {
              if (data.name === "pageTurnAnimation")
                onSetPageTurnAnimationStyle(data.checkedItems[0] as PageTurnAnimationStyle);
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem disabled={viewMode === "scroll"}
                secondaryContent={{ children: t(ANIMATION_LABEL_KEYS[pageTurnAnimationStyle]), style: { fontSize: 14 } }}>
                {t("settings.pageTurn")}
              </MenuItem>
            </MenuTrigger>
            <MenuPopover onFocusCapture={revealMenuFocus}>
              <MenuList>
                {ANIMATION_ORDER.map((style) => (
                  <MenuItemRadio key={style} name="pageTurnAnimation" value={style}
                    disabled={viewMode === "scroll"}
                    secondaryContent={style === "rotate" ? t("settings.experimental") : undefined}>
                    {t(ANIMATION_LABEL_KEYS[style])}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
          <MenuDivider />
          <LanguageMenu />
          {onOpenHelp && (
            <>
              <MenuItem
                icon={<QuestionCircleRegular />}
                onClick={() => {
                  setOpen(false);
                  onOpenHelp(triggerRef.current);
                }}
              >
                {t("settings.helpAbout")}
              </MenuItem>
            </>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};
