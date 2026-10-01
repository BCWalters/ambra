import {
  DEFAULT_INTERFACE_THEME, getInterfaceTheme,
  type BrowserAppearance, type InterfaceThemeChoice,
} from "@ambra/shell/theme";

/** Compatibility aliases for existing chrome styles; provider variables also reach portals. */
export const CHROME_BORDER = "var(--ambraBorder, #d8d1c6)";
export const CHROME_SHADOW = "var(--ambraShadow, 0 8px 28px #302c2618)";
export const CHROME_HOVER_BACKGROUND = "var(--ambraHover, #eee9de)";
export const CHROME_SELECTED_BACKGROUND = "var(--ambraSelected, #ffebbb)";
export const CHROME_BACKDROP_FILTER = "blur(12px) saturate(1.1)";

/** @deprecated Migrate chrome to palette.bookmark, page overlays to getPageBookmarkColor.
 * Retained while publication-adjacent consumers migrate with independent page contrast. */
export const BOOKMARK_COLOR = "#0f6cbd";
export const SCRUBBER_HEIGHT = 72;
export type ChromeThemeChoice = InterfaceThemeChoice;
export const DEFAULT_CHROME_THEME: ChromeThemeChoice = DEFAULT_INTERFACE_THEME;

function rgb(hex: string): string {
  return `rgb(${hex.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16)).join(", ")})`;
}

/** Opaque quiet surfaces keep contrast independent of publication content beneath chrome. */
export function getChromeTheme(choice: ChromeThemeChoice, appearance: BrowserAppearance) {
  const palette = getInterfaceTheme(choice, appearance);
  const background = `linear-gradient(135deg, ${rgb(palette.surface)}, ${rgb(palette.canvas)})`;
  return { ...palette, background, backgroundSolid: background };
}

export type ChromeThemePalette = ReturnType<typeof getChromeTheme>;

/** Stable light previews/settings enumeration. Runtime chrome uses useChromeTheme instead. */
export const CHROME_THEMES: Readonly<Record<ChromeThemeChoice, ChromeThemePalette>> = {
  ambra: getChromeTheme("ambra", "light"),
  silver: getChromeTheme("silver", "light"),
  green: getChromeTheme("green", "light"),
  blue: getChromeTheme("blue", "light"),
  purple: getChromeTheme("purple", "light"),
};
