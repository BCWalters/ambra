import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AmbraThemeProvider } from "@ambra/shell";
import { ReaderApp } from "./ReaderApp.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Ambra reader: #root element not found.");
}

createRoot(container).render(
  <StrictMode>
    <AmbraThemeProvider>
      <ReaderApp />
    </AmbraThemeProvider>
  </StrictMode>,
);
