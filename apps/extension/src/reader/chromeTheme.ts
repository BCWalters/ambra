/** Shared visual constants for the reader's chrome (toolbar, TOC panel,
 * progress scrubber, Book Details panel) — kept in one place so all of
 * them stay visually consistent, and so "chrome should read as a
 * distinct color from the book page, not smudged onto it" only needs to
 * be decided once. Deliberately a cool-toned palette rather than the
 * warm paper tone `ReadingTheme` uses for the page itself.
 *
 * `background`/`backgroundSolid` are the only pieces that vary by
 * `ChromeThemeChoice` (see `CHROME_THEMES`) — border/shadow/hover/
 * selected colors and the backdrop blur stay neutral and shared across
 * every color choice, since a semi-transparent neutral overlay already
 * reads as a natural darker/lighter shade of whatever tinted background
 * it sits on, without needing its own per-theme variant. Every
 * `CHROME_THEMES` background is deliberately kept light enough that the
 * existing dark neutral text/icons (Fluent's own defaults, used
 * throughout the toolbar/TOC/panels) stay comfortably above WCAG AAA
 * contrast (10:1+) against all four, without needing to re-theme
 * Fluent's own component internals (icons, menu popovers) per color —
 * out of scope for this pass, which only themes the toolbar/TOC/
 * scrubber/details-panel *backgrounds* the issue asked for. */
export const CHROME_BORDER = "rgba(15, 23, 42, 0.09)";
export const CHROME_SHADOW = "0 2px 16px rgba(15, 23, 42, 0.10)";
export const CHROME_HOVER_BACKGROUND = "rgba(15, 23, 42, 0.05)";
export const CHROME_SELECTED_BACKGROUND = "rgba(15, 23, 42, 0.08)";
export const CHROME_BACKDROP_FILTER = "blur(12px) saturate(1.1)";

/** The reader's own chrome color, as opposed to `PageTheme` (the book
 * *page's* background, picked in the font menu, renamed "Page Style" to
 * avoid the two being confused as the same setting) — this one lives in
 * the Settings ("gear") menu as "Reader Theme" instead, since it's an
 * app-chrome preference, not a book-reading-experience one. */
export type ChromeThemeChoice = "silver" | "green" | "blue" | "purple";

interface ChromeThemePalette {
  readonly label: string;
  /** Translucent — used for the toolbar and progress scrubber bars,
   * which float over the page content with a backdrop blur. */
  readonly background: string;
  /** Fully opaque — used for the TOC and Book Details panels, which
   * need to stay legible without any book content showing through
   * (unlike the toolbar/scrubber, these can cover a large portion of
   * the page). */
  readonly backgroundSolid: string;
}

export const DEFAULT_CHROME_THEME: ChromeThemeChoice = "silver";

export const CHROME_THEMES: Readonly<Record<ChromeThemeChoice, ChromeThemePalette>> = {
  silver: {
    label: "Silver",
    background: "rgba(226, 228, 233, 0.86)",
    backgroundSolid: "rgb(226, 228, 233)",
  },
  green: {
    label: "Green",
    background: "rgba(188, 220, 205, 0.86)",
    backgroundSolid: "rgb(188, 220, 205)",
  },
  blue: {
    label: "Blue",
    background: "rgba(181, 202, 227, 0.86)",
    backgroundSolid: "rgb(181, 202, 227)",
  },
  purple: {
    label: "Purple",
    background: "rgba(212, 191, 222, 0.86)",
    backgroundSolid: "rgb(212, 191, 222)",
  },
};
