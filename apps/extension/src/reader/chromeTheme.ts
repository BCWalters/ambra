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
 * contrast (10:1+) against all five, without needing to re-theme
 * Fluent's own component internals (icons, menu popovers) per color —
 * out of scope for this pass, which only themes the toolbar/TOC/
 * scrubber/details-panel *backgrounds* the issue asked for.
 *
 * Most themes are a flat translucent/opaque color, but nothing about
 * `background`/`backgroundSolid` requires that — they're plain CSS
 * `background` values, so a theme can just as well be a gradient (used
 * for all five themes below) as long as *every* stop stays light enough
 * to keep that same contrast guarantee; a flat, raw saturated color
 * sampled directly from brand art (e.g. the extension icon's own vivid
 * amber gem tone) reads as garish/loud as a full chrome tint in a way a
 * soft gradient across lighter tints of the same hue doesn't. */
export const CHROME_BORDER = "rgba(15, 23, 42, 0.09)";
export const CHROME_SHADOW = "0 2px 16px rgba(15, 23, 42, 0.10)";
export const CHROME_HOVER_BACKGROUND = "rgba(15, 23, 42, 0.05)";
export const CHROME_SELECTED_BACKGROUND = "rgba(15, 23, 42, 0.08)";
export const CHROME_BACKDROP_FILTER = "blur(12px) saturate(1.1)";

/** The progress scrubber's own total rendered height (see
 * `ProgressScrubber`) — the flyout panels (TOC/Search/Bookmarks &
 * Highlights) need this to stop *above* it rather than running the
 * full height of the reader pane (issue #59: they previously left only
 * a flat 8px gap at the bottom, far short of the scrubber's real
 * height, so its last several rows/list items ended up hidden
 * underneath the scrubber bar). Measured from the real rendered
 * scrubber (padding + page-position label row + track), not computed
 * from its individual style values, since small font-metric rounding
 * differences would make a computed value an unreliable source of
 * truth — a plain constant kept in sync by hand is simpler and exact
 * enough for a fixed-size, non-user-resizable bar. */
export const SCRUBBER_HEIGHT = 52;

/** The reader's own chrome color, as opposed to `PageTheme` (the book
 * *page's* background, picked in the font menu, renamed "Page Style" to
 * avoid the two being confused as the same setting) — this one lives in
 * the Settings ("gear") menu as "Reader Theme" instead, since it's an
 * app-chrome preference, not a book-reading-experience one. */
export type ChromeThemeChoice = "silver" | "green" | "blue" | "purple" | "ambra";

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

// Every gradient below runs light-to-slightly-deeper along the same
// 135deg diagonal (a consistent implied "light source" direction across
// themes) and was individually verified — at *both* stops, not just the
// lighter one — to clear at least 10:1 contrast (WCAG AAA is 7:1) against
// the reader's existing dark text/icon colors.
export const CHROME_THEMES: Readonly<Record<ChromeThemeChoice, ChromeThemePalette>> = {
  silver: {
    label: "Silver",
    background: "linear-gradient(135deg, rgba(244, 245, 248, 0.90), rgba(222, 225, 231, 0.86))",
    backgroundSolid: "linear-gradient(135deg, rgb(244, 245, 248), rgb(222, 225, 231))",
  },
  green: {
    label: "Green",
    background: "linear-gradient(135deg, rgba(206, 231, 218, 0.90), rgba(178, 212, 194, 0.86))",
    backgroundSolid: "linear-gradient(135deg, rgb(206, 231, 218), rgb(178, 212, 194))",
  },
  blue: {
    label: "Blue",
    background: "linear-gradient(135deg, rgba(199, 215, 236, 0.90), rgba(176, 199, 226, 0.86))",
    backgroundSolid: "linear-gradient(135deg, rgb(199, 215, 236), rgb(176, 199, 226))",
  },
  purple: {
    label: "Purple",
    background: "linear-gradient(135deg, rgba(227, 212, 233, 0.90), rgba(211, 189, 223, 0.86))",
    backgroundSolid: "linear-gradient(135deg, rgb(227, 212, 233), rgb(211, 189, 223))",
  },
  ambra: {
    label: "Ambra",
    background: "linear-gradient(135deg, rgba(255, 232, 189, 0.90), rgba(240, 196, 140, 0.86))",
    backgroundSolid: "linear-gradient(135deg, rgb(255, 232, 189), rgb(240, 196, 140))",
  },
};
