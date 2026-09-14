import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PaginaThemeProvider } from "@pagina/shell";
import { LibraryApp } from "./LibraryApp.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Pagina library: #root element not found.");
}

createRoot(container).render(
  <StrictMode>
    <PaginaThemeProvider>
      <LibraryApp />
    </PaginaThemeProvider>
  </StrictMode>,
);
