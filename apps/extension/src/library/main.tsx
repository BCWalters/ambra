import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AmbraThemeProvider } from "@ambra/shell";
import { LibraryApp } from "./LibraryApp.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Ambra library: #root element not found.");
}

createRoot(container).render(
  <StrictMode>
    <AmbraThemeProvider>
      <LibraryApp />
    </AmbraThemeProvider>
  </StrictMode>,
);
