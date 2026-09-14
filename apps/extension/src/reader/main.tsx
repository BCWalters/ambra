import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PaginaThemeProvider } from "@pagina/shell";
import { ReaderApp } from "./ReaderApp.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Pagina reader: #root element not found.");
}

createRoot(container).render(
  <StrictMode>
    <PaginaThemeProvider>
      <ReaderApp />
    </PaginaThemeProvider>
  </StrictMode>,
);
