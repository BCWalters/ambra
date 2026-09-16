/** Shared visual constants for the reader's chrome (toolbar + TOC panel) —
 * kept in one place so both stay visually consistent, and so the
 * "silvery, distinct from the book page" color decision only needs to be
 * made once. Deliberately a cool neutral gray rather than the warm paper
 * tone `ReadingTheme` uses for the page itself: chrome should read as
 * "the app," the page as "the book," and using the same warm tone for
 * both made the toolbar look like it was smudged onto the page instead
 * of floating above it. */
export const CHROME_BACKGROUND = "rgba(238, 240, 243, 0.86)";
export const CHROME_BACKGROUND_SOLID = "rgb(238, 240, 243)";
export const CHROME_BORDER = "rgba(15, 23, 42, 0.09)";
export const CHROME_SHADOW = "0 2px 16px rgba(15, 23, 42, 0.10)";
export const CHROME_HOVER_BACKGROUND = "rgba(15, 23, 42, 0.05)";
export const CHROME_SELECTED_BACKGROUND = "rgba(15, 23, 42, 0.08)";
export const CHROME_BACKDROP_FILTER = "blur(12px) saturate(1.1)";
