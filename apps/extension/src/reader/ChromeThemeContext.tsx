import { createContext, useContext } from "react";
import type { FC, ReactNode } from "react";
import { CHROME_THEMES, DEFAULT_CHROME_THEME } from "./chromeTheme.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";

type ChromeThemePalette = (typeof CHROME_THEMES)[ChromeThemeChoice];

const ChromeThemeContext = createContext<ChromeThemeChoice>(DEFAULT_CHROME_THEME);

export interface ChromeThemeProviderProps {
  theme: ChromeThemeChoice;
  children: ReactNode;
}

/** Makes the reader's current chrome color (see `ChromeThemeChoice`)
 * available to every chrome component (`Toolbar`, `TocPanel`,
 * `ProgressScrubber`, `BookDetailsPanel`) without prop-drilling it
 * through each one individually — they all need the exact same value at
 * once, the textbook case for context over props. `ReaderApp` provides
 * it once, from `ReaderSnapshot.chromeTheme`. */
export const ChromeThemeProvider: FC<ChromeThemeProviderProps> = ({ theme, children }) => (
  <ChromeThemeContext.Provider value={theme}>{children}</ChromeThemeContext.Provider>
);

/** The current chrome theme's color palette (`background`/
 * `backgroundSolid` — see `CHROME_THEMES`). Falls back to
 * `DEFAULT_CHROME_THEME` if read outside a `ChromeThemeProvider` (should
 * never happen in practice, but a silvery default is a reasonable,
 * harmless fallback rather than a thrown error over a purely cosmetic
 * setting). */
export function useChromeTheme(): ChromeThemePalette {
  const choice = useContext(ChromeThemeContext);
  return CHROME_THEMES[choice];
}
