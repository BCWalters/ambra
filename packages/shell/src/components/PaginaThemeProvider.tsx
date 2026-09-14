import type { FC, PropsWithChildren } from "react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

/**
 * Root provider for Pagina's shell UI. Wraps the Fluent UI v9 theming
 * provider so every shell surface (library, reader toolbar, TOC panel,
 * settings) shares consistent, accessible theming.
 *
 * TODO(reader-shell-ui): support theme switching (light/dark/sepia) driven
 * by reader settings, and expose it alongside the paginated/scroll
 * view-mode toggle.
 */
export const PaginaThemeProvider: FC<PropsWithChildren> = ({ children }) => {
  return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
};
