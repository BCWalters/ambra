import { createContext } from "react";
import type { DiagnosticSurfaces } from "./DiagnosticsLog.js";

/** Optional: shared dialogs also render outside a live reader session. */
export const ReaderDiagnosticContext =
  createContext<((surfaces: DiagnosticSurfaces) => void) | undefined>(undefined);
