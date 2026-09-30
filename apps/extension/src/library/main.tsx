import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AmbraThemeProvider } from "@ambra/shell";
import { LibraryApp } from "./LibraryApp.js";
import { LocaleProvider } from "../i18n/LocaleContext.js";
import { ShortcutPreferencesProvider } from "../shortcuts/ShortcutPreferencesContext.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Ambra library: #root element not found.");
}

// Chrome starts action popups at 25x25 before measuring their preferred size.
// Give only that native surface fixed size hints; tabs stay viewport-responsive.
if (chrome.extension.getViews({ type: "popup" }).includes(window)) {
  document.documentElement.style.width = "360px";
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
} else {
  document.body.style.width = "auto";
  document.body.style.minWidth = "0";
  document.body.style.minHeight = "0";
}

createRoot(container).render(
  <StrictMode>
    <AmbraThemeProvider>
      <LocaleProvider>
        <ShortcutPreferencesProvider>
          <LibraryApp />
        </ShortcutPreferencesProvider>
      </LocaleProvider>
    </AmbraThemeProvider>
  </StrictMode>,
);
