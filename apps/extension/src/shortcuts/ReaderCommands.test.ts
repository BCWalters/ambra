import { afterEach, describe, expect, it } from "vitest";
import {
  ariaShortcut, DEFAULT_SHORTCUT_PREFERENCES as defaults, formatShortcut, getCommandBindings,
  matchReaderCommand, parseShortcutPreferences, READER_COMMANDS, shortcutFromEvent,
} from "./ReaderCommands.js";
import type { ReaderCommandContext } from "./ReaderCommands.js";

function match(key: string, init: KeyboardEventInit = {}, context: Partial<ReaderCommandContext> = {}, target = document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  // happy-dom reports ordinary Alt as AltGraph; browsers distinguish them.
  Object.defineProperty(event, "getModifierState", { value: () => false });
  target.dispatchEvent(event);
  return matchReaderCommand(event, document, { preferences: defaults, platform: "other", ...context });
}
afterEach(() => { document.body.replaceChildren(); document.getSelection()?.removeAllRanges(); });
describe("reader command registry", () => {
  it("defines exactly the approved defaults", () => {
    expect(Object.fromEntries(READER_COMMANDS.map(({ id }) => [id, getCommandBindings(id, "other")]))).toEqual({
      previousPage: [{ key: "ArrowLeft" }, { key: "PageUp" }, { key: " ", shift: true }],
      nextPage: [{ key: "ArrowRight" }, { key: "PageDown" }, { key: " " }],
      previousSection: [{ key: "PageUp", alt: true }],
      nextSection: [{ key: "PageDown", alt: true }],
      goToPage: [{ key: "g", mod: true }],
      goToPercentage: [{ key: "g", mod: true, shift: true }],
      toggleBookmark: [{ key: "b", mod: true }],
      searchBook: [{ key: "f", mod: true }],
      showKeyboardShortcuts: [{ key: "/", mod: true }],
      switchToScrolling: [{ key: "PageDown", alt: true, shift: true }],
      switchToPaginated: [{ key: "PageUp", alt: true, shift: true }],
    });
  });
    it.each(["mac", "other"] as const)("matches and labels Go to without stealing native ownership on %s", platform => {
      const mod = platform === "mac" ? { metaKey: true } : { ctrlKey: true };
      for (const [command, shiftKey] of [["goToPage", false], ["goToPercentage", true]] as const) {
        const init = { ...mod, shiftKey };
        expect(match(shiftKey ? "G" : "g", init, { platform, scope: "content" })).toBe(command);
        expect(match("g", init, { platform, scope: "shell" })).toBe(command);
        expect(match("g", init, { platform, preferences: { enabled: false } })).toBeUndefined();
        expect(match("g", init, { platform, modalOpen: true })).toBeUndefined();
        expect(match("g", { ...init, repeat: true }, { platform })).toBeUndefined();
        expect(match("g", { ...init, isComposing: true }, { platform })).toBeUndefined();
        expect(match("g", init, { platform, commands: ["showKeyboardShortcuts"] })).toBeUndefined();
        const binding = getCommandBindings(command, platform)[0]!;
        expect(formatShortcut(binding, platform)).toBe(platform === "mac"
          ? `⌘${shiftKey ? "⇧" : ""}G` : `Ctrl+${shiftKey ? "Shift+" : ""}G`);
        expect(ariaShortcut(binding, platform)).toBe(`${platform === "mac" ? "Meta" : "Control"}+${shiftKey ? "Shift+" : ""}G`);
        for (const tag of ["input", "textarea", "select", "button", "dialog"]) {
          const element = document.createElement(tag);
          document.body.append(element);
          expect(match("g", init, { platform }, element)).toBeUndefined();
          if (tag !== "button") expect(match("g", init, { platform, scope: "shell" }, element)).toBeUndefined();
          element.remove();
        }
        for (const role of ["slider", "menu", "dialog", "grid", "tablist", "textbox", "combobox", "switch"]) {
          const element = document.createElement("div");
          element.setAttribute("role", role);
          document.body.append(element);
          expect(match("g", init, { platform }, element)).toBeUndefined();
          expect(match("g", init, { platform, scope: "shell" }, element)).toBeUndefined();
          element.remove();
        }
        const editor = document.createElement("div");
        editor.contentEditable = "true";
        document.body.append(editor);
        expect(match("g", init, { platform }, editor)).toBeUndefined();
        expect(match("g", init, { platform, scope: "shell" }, editor)).toBeUndefined();
        editor.remove();
        const text = document.createTextNode("Selected text");
        document.body.append(text);
        document.getSelection()!.setBaseAndExtent(text, 0, text, 2);
        expect(match("g", init, { platform })).toBeUndefined();
        expect(match("g", init, { platform, scope: "shell" })).toBeUndefined();
        document.getSelection()!.removeAllRanges();
        text.remove();
      }
      expect(match("g", {}, { platform })).toBeUndefined();
      expect(match("g", platform === "mac" ? { ctrlKey: true } : { metaKey: true }, { platform })).toBeUndefined();
    });
  it("uses only the platform primary modifier and removes modifier-arrow navigation", () => {
    expect(match("b", { ctrlKey: true })).toBe("toggleBookmark");
    expect(match("b", { metaKey: true })).toBeUndefined();
    expect(match("b", { metaKey: true }, { platform: "mac" })).toBe("toggleBookmark");
    expect(match("b", { ctrlKey: true }, { platform: "mac" })).toBeUndefined();
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      expect(match(key, { ctrlKey: true })).toBeUndefined();
      expect(match(key, { metaKey: true }, { platform: "mac" })).toBeUndefined();
    }
  });
  it("uses physical RTL arrows but logical page and section keys", () => {
    expect(match("ArrowLeft", {}, { direction: "rtl" })).toBe("nextPage");
    expect(match("PageDown", {}, { direction: "rtl" })).toBe("nextPage");
    expect(match("PageUp", { altKey: true }, { direction: "rtl" })).toBe("previousSection");
  });
  it.each(["scroll", "paginated"] as const)("switches modes explicitly from %s without confusing sections or native scrolling", viewMode => {
    expect(match("PageDown", { altKey: true, shiftKey: true }, { viewMode })).toBe("switchToScrolling");
    expect(match("PageUp", { altKey: true, shiftKey: true }, { viewMode })).toBe("switchToPaginated");
    expect(match("PageDown", { altKey: true }, { viewMode })).toBe("nextSection");
    expect(match("PageUp", { altKey: true }, { viewMode })).toBe("previousSection");
    expect(match("PageDown", { ctrlKey: true, shiftKey: true }, { viewMode })).toBeUndefined();
    expect(match("PageDown", { altKey: true, shiftKey: true }, { viewMode, canSwitchViewMode: false })).toBeUndefined();
  });
  it("leaves native scroll keys but retains arrow commands in scroll mode", () => {
    for (const key of ["PageUp", "PageDown", " "]) {
      expect(match(key, {}, { viewMode: "scroll" })).toBeUndefined();
      expect(match(key, { shiftKey: true }, { viewMode: "scroll" })).toBeUndefined();
    }
    expect(match("ArrowRight", {}, { viewMode: "scroll" })).toBe("nextPage");
    expect(match("PageDown", { altKey: true }, { viewMode: "scroll" })).toBe("nextSection");
  });
  it("does not repeat bookmark toggles or interfere with native text selection/navigation", () => {
    expect(match("b", { ctrlKey: true, repeat: true })).toBeUndefined();
    expect(match("ArrowRight", { shiftKey: true })).toBeUndefined();
    const text = document.createTextNode("select me");
    document.body.append(text);
    document.getSelection()!.setBaseAndExtent(text, 0, text, 2);
    expect(match("ArrowRight")).toBeUndefined();
  });
  it("rejects composition, prevented events, AltGraph and assistive technology modifiers", () => {
    expect(match("ArrowRight", { isComposing: true })).toBeUndefined();
    expect(match("PageDown", { ctrlKey: true, altKey: true })).toBeUndefined();
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    event.preventDefault();
    expect(matchReaderCommand(event, document, { preferences: defaults, platform: "other" })).toBeUndefined();
    Object.defineProperty(event, "getModifierState", { value: () => true });
    expect(shortcutFromEvent(event, "other")).toBeUndefined();
  });
  it.each(["input", "textarea", "select", "button", "a", "summary", "dialog"])("preserves %s interactions", tag => {
    const control = document.createElement(tag);
    if (tag === "a") control.setAttribute("href", "#");
    document.body.append(control);
    expect(match("PageDown", {}, {}, control)).toBeUndefined();
    expect(match("f", { ctrlKey: true }, {}, control)).toBe(
      ["button", "a", "summary"].includes(tag) ? "searchBook" : undefined,
    );
  });
  it("allows modified reading/help commands from toolbar buttons without taking button navigation", () => {
    const nav = document.createElement("nav");
    const button = document.createElement("button");
    nav.append(button);
    document.body.append(nav);
    expect(match("ArrowRight", {}, { scope: "shell" }, button)).toBeUndefined();
    expect(match(" ", {}, { scope: "shell" }, button)).toBeUndefined();
    expect(match("f", { ctrlKey: true }, { scope: "shell" }, button)).toBe("searchBook");
    expect(match("b", { ctrlKey: true }, { scope: "shell" }, button)).toBe("toggleBookmark");
    expect(match("/", { ctrlKey: true }, { scope: "shell" }, button)).toBe("showKeyboardShortcuts");
    expect(match("g", { ctrlKey: true }, { scope: "shell" }, button)).toBe("goToPage");
    expect(match("g", { ctrlKey: true, shiftKey: true }, { scope: "shell" }, button)).toBe("goToPercentage");
    expect(match("g", { metaKey: true }, { scope: "shell", platform: "mac" }, button)).toBe("goToPage");
    expect(match("g", { metaKey: true, shiftKey: true }, { scope: "shell", platform: "mac" }, button)).toBe("goToPercentage");
    expect(match("g", { ctrlKey: true }, { scope: "content" }, button)).toBeUndefined();
    nav.setAttribute("role", "menu");
    expect(match("f", { ctrlKey: true }, { scope: "shell" }, button)).toBeUndefined();
    expect(match("g", { ctrlKey: true }, { scope: "shell" }, button)).toBeUndefined();
    expect(match("g", { ctrlKey: true, shiftKey: true }, { scope: "shell" }, button)).toBeUndefined();
  });
  it("keeps navigation moving from reader zoom images while preserving activation and authored controls", () => {
    const image = document.createElement("img");
    image.setAttribute("role", "button");
    image.setAttribute("data-ambra-image-zoom", "");
    document.body.append(image);
    expect(match("ArrowRight", {}, {}, image)).toBe("nextPage");
    expect(match("PageDown", {}, {}, image)).toBe("nextPage");
    expect(match("PageUp", { altKey: true }, {}, image)).toBe("previousSection");
    expect(match(" ", {}, {}, image)).toBeUndefined();
    expect(match("Enter", {}, {}, image)).toBeUndefined();
    const button = document.createElement("button");
    document.body.append(button);
    button.append(image);
    expect(match("ArrowRight", {}, {}, image)).toBeUndefined();
    document.body.append(image);
    image.removeAttribute("data-ambra-image-zoom");
    expect(match("ArrowRight", {}, {}, image)).toBeUndefined();
  });
  it("lets content links retain Enter/Space activation without trapping reading-page navigation", () => {
    const nav = document.createElement("nav");
    nav.setAttribute("role", "doc-toc");
    const link = document.createElement("a");
    link.href = "#chapter";
    link.textContent = "Next chapter";
    nav.append(link);
    document.body.append(nav);
    expect(match("ArrowRight", {}, { scope: "content" }, link)).toBe("nextPage");
    expect(match("PageDown", {}, { scope: "content" }, link)).toBe("nextPage");
    expect(match("PageUp", { altKey: true }, { scope: "content" }, link)).toBe("previousSection");
    expect(match("Enter", {}, { scope: "content" }, link)).toBeUndefined();
    expect(match(" ", {}, { scope: "content" }, link)).toBeUndefined();
    expect(match("ArrowRight", {}, { scope: "shell" }, link)).toBeUndefined();
    link.setAttribute("role", "button");
    expect(match("ArrowRight", {}, { scope: "content" }, link)).toBeUndefined();
    link.removeAttribute("role");
    nav.setAttribute("role", "menu");
    expect(match("ArrowRight", {}, { scope: "content" }, link)).toBeUndefined();
  });
  it.each(["slider", "menu", "dialog", "grid", "tablist", "textbox", "combobox", "switch", "scrollbar"])("preserves role=%s", role => {
    const widget = document.createElement("div");
    widget.setAttribute("role", role);
    document.body.append(widget);
    expect(match("ArrowRight", {}, {}, widget)).toBeUndefined();
  });
  it("preserves editing and nested scrolling, including vertical scrollers for arrows", () => {
    const element = document.createElement("div");
    document.body.append(element);
    element.contentEditable = "true";
    expect(match("ArrowRight", {}, {}, element)).toBeUndefined();
    element.removeAttribute("contenteditable");
    element.style.overflowY = "auto";
    Object.defineProperty(element, "scrollHeight", { value: 100 });
    Object.defineProperty(element, "clientHeight", { value: 20 });
    expect(match("ArrowRight", {}, {}, element)).toBeUndefined();
  });
  it("disabled commands have no legacy fallback and legacy overrides never execute", () => {
    expect(match("ArrowRight", {}, { preferences: { enabled: false } })).toBeUndefined();
    const preferences = parseShortcutPreferences({
      enabled: true, bindings: { nextPage: [], nextSection: [{ key: "ArrowRight" }] },
    });
    expect(preferences).toEqual({ enabled: true });
    expect(match("PageDown", {}, { preferences })).toBe("nextPage");
    expect(match("ArrowRight", {}, { preferences })).toBe("nextPage");
    expect(match("PageDown", { altKey: true }, { preferences })).toBe("nextSection");
  });
  it("routes only help in the library and suppresses commands under a modal", () => {
    expect(match("f", { ctrlKey: true }, { commands: ["showKeyboardShortcuts"] })).toBeUndefined();
    expect(match("/", { ctrlKey: true }, { commands: ["showKeyboardShortcuts"] })).toBe("showKeyboardShortcuts");
    expect(match("/", { ctrlKey: true }, { modalOpen: true })).toBeUndefined();
  });
  it("normalizes layout Shift for slash and shares display/ARIA labels", () => {
    const binding = shortcutFromEvent(new KeyboardEvent("keydown", { key: "/", metaKey: true, shiftKey: true }), "mac")!;
    expect(binding).toEqual({ key: "/", mod: true });
    expect(formatShortcut(binding, "mac")).toBe("⌘/");
    expect(ariaShortcut(binding, "mac")).toBe("Meta+/");
    expect(formatShortcut({ key: " ", shift: true }, "other")).toBe("Shift+Space");
    expect(shortcutFromEvent(new KeyboardEvent("keydown", { key: "Shift" }), "other")).toBeUndefined();
    expect(shortcutFromEvent(new KeyboardEvent("keydown", { key: "Tab" }), "other")).toBeUndefined();
    expect(shortcutFromEvent(new KeyboardEvent("keydown", { key: "Escape" }), "other")).toBeUndefined();
  });
  it("retains only enabled from legacy storage and rejects invalid enabled values", () => {
    for (const bindings of [null, {}, { nextPage: [] }, { unknownCommand: [{ key: "l", mod: true }] }]) {
      expect(parseShortcutPreferences({ enabled: false, bindings })).toEqual({ enabled: false });
    }
    for (const value of [null, {}, [], { enabled: "false" }, { enabled: 0 }]) {
      expect(() => parseShortcutPreferences(value)).toThrow();
    }
  });
  it.each(["mac", "other"] as const)("leaves browser keys, bare letters and removed custom chords untouched on %s", platform => {
    const modifier = platform === "mac" ? { metaKey: true } : { ctrlKey: true };
    for (const key of ["l", "t", "w", "r", "0", "+", "-", "ArrowLeft", "Tab", "Escape", "F8", "F9"]) {
      expect(match(key, modifier, { platform })).toBeUndefined();
    }
    expect(match("e", { ...modifier, shiftKey: true }, { platform })).toBeUndefined();
    expect(match("b", {}, { platform })).toBeUndefined();
  });
});
