import { isKeyboardNavigationScope } from "@ambra/engine";

export type ReaderCommandId = "previousPage" | "nextPage" | "previousSection" | "nextSection" |
  "toggleBookmark" | "searchBook" | "showKeyboardShortcuts" | "switchToScrolling" | "switchToPaginated";
export type ShortcutPlatform = "mac" | "other";
export interface ShortcutBinding {
  readonly key: string;
  readonly mod?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}
export interface ShortcutPreferences {
  readonly enabled: boolean;
}
export const READER_COMMANDS: readonly {
  id: ReaderCommandId;
  labelKey: `shortcuts.${ReaderCommandId}`;
  group: "navigation" | "reading" | "help";
}[] = [
  { id: "previousPage", labelKey: "shortcuts.previousPage", group: "navigation" },
  { id: "nextPage", labelKey: "shortcuts.nextPage", group: "navigation" },
  { id: "previousSection", labelKey: "shortcuts.previousSection", group: "navigation" },
  { id: "nextSection", labelKey: "shortcuts.nextSection", group: "navigation" },
  { id: "toggleBookmark", labelKey: "shortcuts.toggleBookmark", group: "reading" },
  { id: "searchBook", labelKey: "shortcuts.searchBook", group: "reading" },
  { id: "switchToScrolling", labelKey: "shortcuts.switchToScrolling", group: "reading" },
  { id: "switchToPaginated", labelKey: "shortcuts.switchToPaginated", group: "reading" },
  { id: "showKeyboardShortcuts", labelKey: "shortcuts.showKeyboardShortcuts", group: "help" },
];
export const DEFAULT_SHORTCUT_PREFERENCES: ShortcutPreferences = { enabled: true };
export const DISABLED_SHORTCUT_PREFERENCES: ShortcutPreferences = { enabled: false };

export function getShortcutPlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "mac" : "other";
}

export function getCommandBindings(
  commandId: ReaderCommandId,
  _platform: ShortcutPlatform,
  direction: "ltr" | "rtl" = "ltr",
): readonly ShortcutBinding[] {
  switch (commandId) {
    case "previousPage": return [{ key: direction === "rtl" ? "ArrowRight" : "ArrowLeft" }, { key: "PageUp" }, { key: " ", shift: true }];
    case "nextPage": return [{ key: direction === "rtl" ? "ArrowLeft" : "ArrowRight" }, { key: "PageDown" }, { key: " " }];
    case "previousSection": return [{ key: "PageUp", alt: true }];
    case "nextSection": return [{ key: "PageDown", alt: true }];
    case "toggleBookmark": return [{ key: "b", mod: true }];
    case "searchBook": return [{ key: "f", mod: true }];
    case "showKeyboardShortcuts": return [{ key: "/", mod: true }];
    case "switchToScrolling": return [{ key: "PageDown", alt: true, shift: true }];
    case "switchToPaginated": return [{ key: "PageUp", alt: true, shift: true }];
  }
}

const keyLabels: Record<string, string> = {
  " ": "Space", ArrowLeft: "Left", ArrowRight: "Right", PageUp: "PageUp", PageDown: "PageDown",
};
export function formatShortcut(binding: ShortcutBinding, platform: ShortcutPlatform): string {
  return [
    binding.mod ? platform === "mac" ? "⌘" : "Ctrl" : "",
    binding.alt ? platform === "mac" ? "⌥" : "Alt" : "",
    binding.shift ? platform === "mac" ? "⇧" : "Shift" : "",
    keyLabels[binding.key] ?? binding.key.toUpperCase(),
  ].filter(Boolean).join(platform === "mac" ? "" : "+");
}
export function ariaShortcut(binding: ShortcutBinding, platform: ShortcutPlatform): string {
  return [
    binding.mod ? platform === "mac" ? "Meta" : "Control" : "",
    binding.alt ? "Alt" : "", binding.shift ? "Shift" : "",
    binding.key === " " ? "Space" : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key,
  ].filter(Boolean).join("+");
}

export function shortcutFromEvent(event: KeyboardEvent, platform: ShortcutPlatform): ShortcutBinding | undefined {
  if (event.isComposing || event.getModifierState?.("AltGraph") || event.ctrlKey && event.altKey) return undefined;
  // Never treat the non-primary platform modifier as Mod.
  if (platform === "mac" ? event.ctrlKey : event.metaKey) return undefined;
  if (["Control", "Meta", "Alt", "Shift", "AltGraph", "Dead", "Unidentified", "Tab", "Escape"].includes(event.key)) return undefined;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return {
    key,
    ...((platform === "mac" ? event.metaKey : event.ctrlKey) ? { mod: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
    // Slash is a character binding, including layouts where producing it needs Shift.
    ...(event.shiftKey && key !== "/" ? { shift: true } : {}),
  };
}

function sameBinding(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return a.key === b.key && !!a.mod === !!b.mod && !!a.alt === !!b.alt && !!a.shift === !!b.shift;
}
/** Discard development-era binding overrides; only a valid enabled flag survives. */
export function parseShortcutPreferences(value: unknown): ShortcutPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof (value as ShortcutPreferences).enabled !== "boolean") {
    throw new Error("Invalid keyboard shortcut preferences.");
  }
  return { enabled: (value as ShortcutPreferences).enabled };
}

export interface ReaderCommandContext {
  preferences: ShortcutPreferences;
  platform: ShortcutPlatform;
  direction?: "ltr" | "rtl";
  viewMode?: "paginated" | "scroll";
  scope?: "content" | "shell";
  modalOpen?: boolean;
  canSwitchViewMode?: boolean;
  commands?: readonly ReaderCommandId[];
}
export function matchReaderCommand(
  event: KeyboardEvent, document: Document, context: ReaderCommandContext,
): ReaderCommandId | undefined {
  if (!context.preferences.enabled || context.modalOpen) return undefined;
  const binding = shortcutFromEvent(event, context.platform);
  if (!binding) return undefined;
  if (context.viewMode === "scroll" && !binding.mod && !binding.alt &&
      ["PageUp", "PageDown", " "].includes(binding.key)) return undefined;
  for (const command of READER_COMMANDS) {
    if (context.commands && !context.commands.includes(command.id)) continue;
    if (context.canSwitchViewMode === false &&
        (command.id === "switchToScrolling" || command.id === "switchToPaginated")) continue;
    if (context.viewMode === "scroll" && (command.id === "previousPage" || command.id === "nextPage") &&
        (binding.mod || binding.alt || binding.shift || !["ArrowLeft", "ArrowRight"].includes(binding.key))) continue;
    if (event.repeat && command.id === "toggleBookmark") continue;
    if (getCommandBindings(command.id, context.platform, context.direction)
      .some(candidate => sameBinding(candidate, binding))) {
      const toolbarCommand = command.group !== "navigation" && !!(binding.mod || binding.alt);
      return isKeyboardNavigationScope(event, document, {
        scope: toolbarCommand ? undefined : context.scope,
        preserveSelection: true,
        allControls: !toolbarCommand,
        nestedScroll: true,
        readingImageNavigation: true,
        readingLinkNavigation: context.scope === "content",
      }) ? command.id : undefined;
    }
  }
  return undefined;
}
