import { createContext, useContext, useMemo } from "react";
import type { FC, ReactNode } from "react";
import { AmbraThemeProvider, useBrowserAppearance } from "@ambra/shell";
import { DEFAULT_CHROME_THEME, getChromeTheme } from "./chromeTheme.js";
import type { ChromeThemeChoice, ChromeThemePalette } from "./chromeTheme.js";

const ChromeThemeContext = createContext<ChromeThemeChoice>(DEFAULT_CHROME_THEME);

export interface ChromeThemeProviderProps {
  theme: ChromeThemeChoice;
  children: ReactNode;
}

/** One stored interface choice drives custom chrome, Fluent controls and portals.
 * Browser appearance is observed by the shell; publication appearance is separate. */
export const ChromeThemeProvider: FC<ChromeThemeProviderProps> = ({ theme, children }) => (
  <ChromeThemeContext.Provider value={theme}>
    <AmbraThemeProvider theme={theme}>{children}</AmbraThemeProvider>
  </ChromeThemeContext.Provider>
);

/** Existing palette fields plus semantic action/text/surface/focus/bookmark roles. */
export function useChromeTheme(): ChromeThemePalette {
  const choice = useContext(ChromeThemeContext);
  const appearance = useBrowserAppearance();
  return useMemo(() => getChromeTheme(choice, appearance), [choice, appearance]);
}
