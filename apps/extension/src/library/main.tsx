import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AmbraThemeProvider } from "@ambra/shell";
import { LibraryApp } from "./LibraryApp.js";
import { LocaleProvider } from "../i18n/LocaleContext.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Ambra library: #root element not found.");
}

createRoot(container).render(
  <StrictMode>
    <AmbraThemeProvider>
      <LocaleProvider>
        <LibraryApp />
      </LocaleProvider>
    </AmbraThemeProvider>
  </StrictMode>,
);
