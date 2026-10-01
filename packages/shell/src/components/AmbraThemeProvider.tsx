import { useMemo, useSyncExternalStore, type FC, type PropsWithChildren } from "react";
import { FluentProvider, makeStyles, mergeClasses } from "@fluentui/react-components";
import { createAmbraFluentTheme, DEFAULT_INTERFACE_THEME, getInterfaceTheme } from "../theme.js";
import type { BrowserAppearance, InterfaceThemeChoice } from "../theme.js";

function subscribeAppearance(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Browser appearance is observed, never persisted as a competing app preference. */
export function useBrowserAppearance(): BrowserAppearance {
  return useSyncExternalStore(subscribeAppearance,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    () => "light");
}

const useStyles = makeStyles({
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
  root: {
    // Controls with their own focus indicator take precedence over this fallback.
    ":where(&) :where(:focus-visible)": {
      outline: "2px solid var(--ambraFocus)",
      outlineOffset: "2px",
      // A solid backing keeps the outer indicator legible over arbitrary cover art.
      boxShadow: "0 0 0 2px var(--ambraSurface)",
    },
    "@media (forced-colors: active)": {
      ":where(&) :where(:focus-visible)": { outlineColor: "Highlight", boxShadow: "none" },
    },
    "@media (prefers-reduced-motion: reduce)": {
      "& *, & *::before, & *::after": {
        transitionDuration: "0s",
        animationDuration: "0s",
      },
    },
  },
});

export interface AmbraThemeProviderProps extends PropsWithChildren {
  theme?: InterfaceThemeChoice;
}

/** The persisted choice is supplied by the existing extension settings owner. */
export const AmbraThemeProvider: FC<AmbraThemeProviderProps> = ({
  children, theme = DEFAULT_INTERFACE_THEME,
}) => {
  const appearance = useBrowserAppearance();
  const fluentTheme = useMemo(() => createAmbraFluentTheme(getInterfaceTheme(theme, appearance)), [theme, appearance]);
  const styles = useStyles();
  return <FluentProvider theme={fluentTheme} className={mergeClasses(styles.root, styles[appearance])}
    applyStylesToPortals>
    {children}
  </FluentProvider>;
};
