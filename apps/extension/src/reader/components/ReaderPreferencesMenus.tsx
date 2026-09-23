import type { FC } from "react";
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
  Tooltip,
} from "@fluentui/react-components";
import {
  BookOpenRegular,
  DocumentOnePageColumnsRegular,
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

export interface TypographyMenuActions {
  onSetFontScale: (scale: number) => void;
  onSetLineSpacing: (spacing: number) => void;
  onSetLetterSpacing: (spacing: number) => void;
  onSetContentWidth: (widthEm: number) => void;
  onSetFontFamily: (family: FontFamilyChoice) => void;
  onSetPageTheme: (theme: PageTheme) => void;
}

export interface TypographyMenuProps extends TypographyMenuActions {
  fontScale: number;
  lineSpacing: number;
  letterSpacing: number;
  contentWidthEm: number;
  fontFamily: FontFamilyChoice;
  pageTheme: PageTheme;
}

export interface ReaderSettingsMenuActions {
  onSetViewMode: (mode: ViewMode) => void;
  onSetBrightness: (brightness: number) => void;
  onSetChromeTheme: (theme: ChromeThemeChoice) => void;
  onSetPageTurnAnimationStyle: (style: PageTurnAnimationStyle) => void;
}

export interface ReaderSettingsMenuProps extends ReaderSettingsMenuActions {
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

const PageStyleSwatch: FC<{ background: string; foreground: string }> = ({
  background,
  foreground,
}) => (
  <span
    aria-hidden="true"
    style={{
      display: "inline-flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: 3,
      width: 20,
      height: 20,
      borderRadius: 4,
      background,
      border: "1px solid rgba(0, 0, 0, 0.15)",
      boxSizing: "border-box",
      padding: "0 4px",
    }}
  >
    <span
      style={{
        display: "block",
        height: 2,
        borderRadius: 1,
        background: foreground,
        width: "100%",
      }}
    />
    <span
      style={{ display: "block", height: 2, borderRadius: 1, background: foreground, width: "65%" }}
    />
  </span>
);

/** Each submenu owns its Fluent radio state; the caller owns persistence. */
export const TypographyMenu: FC<TypographyMenuProps> = ({
  fontScale,
  lineSpacing,
  letterSpacing,
  contentWidthEm,
  fontFamily,
  pageTheme,
  onSetFontScale,
  onSetLineSpacing,
  onSetLetterSpacing,
  onSetContentWidth,
  onSetFontFamily,
  onSetPageTheme,
}) => {
  const t = useTranslation();
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t("toolbar.textOptions")} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<TextFontRegular />}
            style={{ marginLeft: 8 }}
          />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <Menu
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
            <MenuPopover>
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
            persistOnItemClick
            checkedValues={{ pageTheme: [pageTheme] }}
            onCheckedValueChange={(_event, data) => {
              if (data.name === "pageTheme") onSetPageTheme(data.checkedItems[0] as PageTheme);
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={<DocumentOnePageColumnsRegular />}>
                {t("text.pageMenuLabel")}
              </MenuItem>
            </MenuTrigger>
            <MenuPopover>
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
                <MenuGroup>
                  <MenuGroupHeader>{t("text.pageStyle")}</MenuGroupHeader>
                  {(Object.keys(ReadingTheme.PAGE_THEMES) as PageTheme[]).map((key) => (
                    <MenuItemRadio
                      key={key}
                      name="pageTheme"
                      value={key}
                      icon={<PageStyleSwatch {...ReadingTheme.PAGE_THEMES[key]} />}
                    >
                      {t(PAGE_THEME_LABEL_KEYS[key])}
                    </MenuItemRadio>
                  ))}
                </MenuGroup>
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
  const { preference, setPreference } = useLocale();
  return (
    <Menu
      persistOnItemClick
      checkedValues={{ locale: [preference] }}
      onCheckedValueChange={(_event, data) => {
        if (data.name === "locale") setPreference(data.checkedItems[0] as LocalePreference);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <MenuItem
          icon={<LocalLanguageRegular />}
          secondaryContent={
            preference === "system"
              ? t("settings.languageSystemDefault")
              : LOCALE_NATIVE_NAMES[preference]
          }
        >
          {t("settings.language")}
        </MenuItem>
      </MenuTrigger>
      <MenuPopover>
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
  );
};

export const ReaderSettingsMenu: FC<ReaderSettingsMenuProps> = ({
  isFixedLayout,
  viewMode,
  brightness,
  chromeTheme,
  pageTurnAnimationStyle,
  onSetViewMode,
  onSetBrightness,
  onSetChromeTheme,
  onSetPageTurnAnimationStyle,
}) => {
  const t = useTranslation();
  return (
    <Menu
      persistOnItemClick
      checkedValues={{
        viewMode: [viewMode],
        chromeTheme: [chromeTheme],
        pageTurnAnimation: [pageTurnAnimationStyle],
      }}
      onCheckedValueChange={(_event, data) => {
        if (data.name === "viewMode") onSetViewMode(data.checkedItems[0] as ViewMode);
        else if (data.name === "chromeTheme")
          onSetChromeTheme(data.checkedItems[0] as ChromeThemeChoice);
        else if (data.name === "pageTurnAnimation")
          onSetPageTurnAnimationStyle(data.checkedItems[0] as PageTurnAnimationStyle);
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={t("toolbar.settings")} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<SettingsRegular />}
            style={isFixedLayout ? { marginLeft: 8 } : undefined}
          />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <LanguageMenu />
          <MenuDivider />
          {!isFixedLayout && (
            <>
              <MenuGroup>
                <MenuGroupHeader>{t("settings.readingMode")}</MenuGroupHeader>
                <MenuItemRadio name="viewMode" value="paginated" icon={<BookOpenRegular />}>
                  {t("settings.paginated")}
                </MenuItemRadio>
                <MenuItemRadio name="viewMode" value="scroll" icon={<TextColumnOneRegular />}>
                  {t("settings.scroll")}
                </MenuItemRadio>
              </MenuGroup>
              <MenuDivider />
            </>
          )}
          <MenuGroup>
            <MenuGroupHeader>{t("settings.pageTurn")}</MenuGroupHeader>
            {ANIMATION_ORDER.map((style) => (
              <MenuItemRadio
                key={style}
                name="pageTurnAnimation"
                value={style}
                disabled={viewMode === "scroll"}
                secondaryContent={style === "rotate" ? t("settings.experimental") : undefined}
              >
                {t(ANIMATION_LABEL_KEYS[style])}
              </MenuItemRadio>
            ))}
          </MenuGroup>
          <MenuDivider />
          <MenuGroup>
            <MenuGroupHeader>{t("settings.readerTheme")}</MenuGroupHeader>
            {(Object.keys(CHROME_THEMES) as ChromeThemeChoice[]).map((key) => (
              <MenuItemRadio
                key={key}
                name="chromeTheme"
                value={key}
                icon={
                  <ThemeSwatch
                    background={CHROME_THEMES[key].backgroundSolid}
                    accent={CHROME_THEMES[key].accent}
                  />
                }
              >
                {CHROME_THEME_LABEL_KEYS[key]
                  ? t(CHROME_THEME_LABEL_KEYS[key]!)
                  : CHROME_THEMES[key].label}
              </MenuItemRadio>
            ))}
          </MenuGroup>
          <MenuDivider />
          <PreferenceSlider
            label={t("settings.brightness")}
            aria-label={t("settings.brightness")}
            min={ReadingTheme.MIN_BRIGHTNESS}
            max={ReadingTheme.MAX_BRIGHTNESS}
            step={ReadingTheme.BRIGHTNESS_STEP}
            value={brightness}
            defaultValue={ReadingTheme.DEFAULT_BRIGHTNESS}
            onChange={onSetBrightness}
          />
        </MenuList>
      </MenuPopover>
    </Menu>
  );
};
