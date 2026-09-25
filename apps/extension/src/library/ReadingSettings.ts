import { ReadingTheme, type FontFamilyChoice, type PageTheme } from "@ambra/engine";
import { DEFAULT_CHROME_THEME, type ChromeThemeChoice } from "../reader/chromeTheme.js";
import { DEFAULT_PAGE_TURN_ANIMATION_STYLE, type PageTurnAnimationStyle } from "../reader/PageTurnAnimationStyle.js";
import type { ViewMode } from "../reader/ViewMode.js";

/** Text and page options belong to a book, not to the next book opened. */
export interface BookReadingSettings {
  fontScale: number;
  fontFamily: FontFamilyChoice;
  lineSpacing: number;
  letterSpacing: number;
  contentWidthEm: number;
  /** Reflowable pagination only; fixed-layout spreads and scrolling are unchanged. */
  alwaysShowOnePage: boolean;
}

export const DEFAULT_BOOK_READING_SETTINGS: Readonly<BookReadingSettings> = {
  fontScale: ReadingTheme.DEFAULT_FONT_SCALE,
  fontFamily: ReadingTheme.DEFAULT_FONT_FAMILY,
  lineSpacing: ReadingTheme.DEFAULT_LINE_SPACING,
  letterSpacing: ReadingTheme.DEFAULT_LETTER_SPACING,
  contentWidthEm: ReadingTheme.DEFAULT_CONTENT_WIDTH_EM,
  alwaysShowOnePage: false,
};

/** Settings-menu choices apply throughout the app. Locale is owned by LocaleProvider. */
export interface GlobalReadingSettings {
  viewMode: ViewMode;
  brightness: number;
  pageTheme: PageTheme;
  chromeTheme: ChromeThemeChoice;
  pageTurnAnimationStyle: PageTurnAnimationStyle;
}

export const DEFAULT_GLOBAL_READING_SETTINGS: Readonly<GlobalReadingSettings> = {
  viewMode: "paginated",
  brightness: ReadingTheme.DEFAULT_BRIGHTNESS,
  pageTheme: ReadingTheme.DEFAULT_PAGE_THEME,
  chromeTheme: DEFAULT_CHROME_THEME,
  pageTurnAnimationStyle: DEFAULT_PAGE_TURN_ANIMATION_STYLE,
};
