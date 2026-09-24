import {
  ariaShortcut,
  formatShortcut,
  getCommandBindings,
  type ReaderCommandId,
} from "./ReaderCommands.js";
import { useShortcutPreferences } from "./ShortcutPreferencesContext.js";

export function useCommandPresentation(command: ReaderCommandId, direction: "ltr" | "rtl" = "ltr") {
  const { preferences, platform, ready } = useShortcutPreferences();
  const bindings = ready && preferences.enabled
    ? getCommandBindings(command, platform, direction)
    : [];
  return {
    shortcutLabel: bindings.length ? bindings.map(binding => formatShortcut(binding, platform)).join(" / ") : undefined,
    ariaKeyShortcuts: bindings.length ? bindings.map(binding => ariaShortcut(binding, platform)).join(" ") : undefined,
  };
}
