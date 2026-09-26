import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpAboutFlyout } from "./HelpAboutFlyout.js";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog.js";
import { getTranslate, CATALOGS } from "../i18n/translate.js";
import { SUPPORTED_LOCALES, type Locale } from "../i18n/Locale.js";
import { READER_COMMANDS, DEFAULT_SHORTCUT_PREFERENCES } from "../shortcuts/ReaderCommands.js";
import type { ShortcutPlatform, ShortcutPreferences } from "../shortcuts/ReaderCommands.js";
import { useShortcutPreferences } from "../shortcuts/ShortcutPreferencesContext.js";

const language = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("../shortcuts/ShortcutPreferencesContext.js", () => ({ useShortcutPreferences: vi.fn() }));
vi.mock("../i18n/LocaleContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../i18n/LocaleContext.js")>();
  return { ...actual, useTranslation: () => actual.getTranslate(language.locale) };
});
vi.mock("@fluentui/react-components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fluentui/react-components")>();
  return {
    ...actual,
    OverlayDrawer: ({ open, children, "aria-labelledby": labelledBy }: {
      open: boolean; children: ReactNode; "aria-labelledby"?: string;
    }) => open ? <section role="dialog" aria-labelledby={labelledBy}>{children}</section> : null,
  };
});

describe("shared Help & About and read-only keyboard shortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let preferences: ShortcutPreferences;
  let platform: ShortcutPlatform;
  let ready: boolean;
  let error: string | undefined;
  let setPreferences: ReturnType<typeof vi.fn<(next: ShortcutPreferences) => Promise<void>>>;
  const close = vi.fn();
  const openShortcuts = vi.fn();
  const openTips = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.2.3" }) } });
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      queueMicrotask(() => animation.finish());
      return animation;
    });
    language.locale = "en";
    preferences = DEFAULT_SHORTCUT_PREFERENCES;
    platform = "other";
    ready = true;
    error = undefined;
    close.mockReset();
    openShortcuts.mockReset();
    openTips.mockReset();
    setPreferences = vi.fn(async (next) => { preferences = next; });
    vi.mocked(useShortcutPreferences).mockImplementation(() => ({ preferences, platform, ready, error, setPreferences }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function help(getReaderDiagnostics?: () => string | undefined, readingTips = false) {
    await act(async () => root.render(<HelpAboutFlyout
      open onRequestClose={close} backgroundSolid="#fff" accentForeground="#7a3e00"
      onOpenKeyboardShortcuts={openShortcuts} getReaderDiagnostics={getReaderDiagnostics}
      onOpenReadingTips={readingTips ? openTips : undefined}
    />));
  }
  async function shortcuts(direction: "ltr" | "rtl" = "ltr", open = true) {
    await act(async () => root.render(<KeyboardShortcutsDialog open={open} onRequestClose={close} pageProgressionDirection={direction} />));
  }
  function button(label: string) {
    const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
      entry.textContent === label || entry.getAttribute("aria-label") === label);
    expect(found, label).toBeDefined();
    return found!;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  function checkbox() { return container.querySelector<HTMLInputElement>('input[type="checkbox"]')!; }
  function assignment(label: string) {
    return [...container.querySelectorAll("dt")].find((term) => term.textContent === label)?.nextElementSibling;
  }

  it.each(SUPPORTED_LOCALES)("localizes Help actions and the read-only grouped reference in %s", async (locale) => {
    language.locale = locale;
    const t = getTranslate(locale);
    await help();
    expect(container.querySelector("h2")?.textContent).toBe(t("about.title"));
    const shortcutLink = button(t("shortcuts.showKeyboardShortcuts"));
    expect(shortcutLink.className).toContain("fui-Button");
    expect(shortcutLink.getAttribute("aria-keyshortcuts")).toBe("Control+/");
    expect(shortcutLink.closest("section")).toBe(container.querySelector('[role="dialog"]'));
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).not.toContain(t("shortcuts.title"));
    expect(container.querySelector('a[href="mailto:AmbraEPUB@outlook.com"]')?.textContent).toBe(t("about.feedback"));
    expect(container.querySelector('a[href="https://github.com/BCWalters/ambra/issues"]')?.textContent).toBe(t("about.issues"));
    const guide = container.querySelector<HTMLAnchorElement>('a[href="https://github.com/BCWalters/ambra/blob/main/docs/user-guide/README.md"]');
    expect(guide?.textContent).toBe(t("about.userGuide"));
    expect(guide?.target).toBe("_blank");
    expect(guide?.rel).toBe("noreferrer");
    expect(container.querySelector('a[href="https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md"]')?.textContent).toBe(t("about.privacy"));
    const standards = button(t("about.standards"));
    expect(standards.getAttribute("aria-expanded")).toBe("false");
    await click(t("about.standards"));
    expect(standards.getAttribute("aria-expanded")).toBe("true");
    await click(t("shortcuts.showKeyboardShortcuts"));
    expect(openShortcuts).toHaveBeenCalledOnce();
    await shortcuts();
    expect(container.querySelector("h2")?.textContent).toBe(t("shortcuts.title"));
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      t("shortcuts.navigation"), t("shortcuts.reading"), t("shortcuts.help"),
    ]);
    for (const command of READER_COMMANDS) expect(assignment(t(command.labelKey))?.querySelector("kbd")).not.toBeNull();
    expect(assignment(t("shortcuts.dismiss"))?.textContent).toBe("Escape");
    expect(container.querySelectorAll("dt")).toHaveLength(READER_COMMANDS.length + 1);
    expect(container.querySelectorAll("dl button, dl input, [aria-pressed]")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(checkbox().labels?.[0]?.textContent).toBe(t("shortcuts.enabled"));
    expect(container.textContent).toContain(t("shortcuts.layoutNote"));
    expect(container.textContent).toContain(t("shortcuts.scope"));
    expect(container.textContent).toContain(t("shortcuts.goToHint"));
    expect(CATALOGS[locale]["about.title"]).toBe(CATALOGS[locale]["settings.helpAbout"]);
    expect(CATALOGS[locale]["library.about"]).toBe(CATALOGS[locale]["settings.helpAbout"]);
  });

  it("uses separate button rows for reader actions and a link for the external guide", async () => {
    await help(undefined, true);
    const tips = button("Reading tips");
    const shortcuts = button("Show keyboard shortcuts");
    expect(tips.className).toContain("fui-Button");
    expect(shortcuts.className).toContain("fui-Button");
    expect(tips.parentElement?.style.flexDirection).toBe("column");
    expect(tips.parentElement?.children).toHaveLength(3);
    await click("Reading tips");
    expect(openTips).toHaveBeenCalledOnce();
    expect(openShortcuts).not.toHaveBeenCalled();
  });

  it("copies only environment data in the library and announces success", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await help();
    expect(container.textContent).toContain(getTranslate("en")("about.diagnosticsHint"));
    expect(container.textContent).not.toContain(getTranslate("en")("about.readerDiagnosticsWarning"));
    await click(getTranslate("en")("about.copyDiagnostics"));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).toContain("Ambra environment info\n");
    expect(writeText.mock.calls[0]?.[0]).toContain("Extension version: 1.2.3");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(getTranslate("en")("about.copied"));
  });

  it("warns before collecting a reader report and copies only on request", async () => {
    const report = vi.fn(() => "Book title\n/Books/private.epub\nLocation: 42\nDiagnostic text");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const t = getTranslate("en");
    await help(report);
    expect(report).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    const copy = button(t("about.copyDiagnostics"));
    expect(document.getElementById(copy.getAttribute("aria-describedby")!)?.textContent).toBe(t("about.readerDiagnosticsWarning"));
    expect(container.textContent).not.toContain(t("about.diagnosticsHint"));
    await click(t("about.copyDiagnostics"));
    expect(report).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("Book title\n/Books/private.epub\nLocation: 42\nDiagnostic text");
    expect(container.textContent).not.toContain("/Books/private.epub");
  });

  it("shows clipboard failures as an alert without claiming success", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permission denied"));
    const t = getTranslate("en");
    await help();
    await click(t("about.copyDiagnostics"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(t("about.copyError"));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(button(t("about.copyDiagnostics")).disabled).toBe(false);
  });

  it.each(SUPPORTED_LOCALES)("does not fall back to environment data for unavailable reader diagnostics in %s", async (locale) => {
    language.locale = locale;
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const report = vi.fn(() => undefined);
    const t = getTranslate(locale);
    await help(report);
    await click(t("about.copyDiagnostics"));
    expect(report).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(t("about.readerDiagnosticsUnavailable"));
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it.each(["other", "mac"] as const)("shows OS-specific bindings and active opener metadata on %s", async (currentPlatform) => {
    platform = currentPlatform;
    await help();
    expect(button("Show keyboard shortcuts").getAttribute("aria-keyshortcuts")).toBe(platform === "mac" ? "Meta+/" : "Control+/");
    expect(container.textContent).not.toContain(platform === "mac" ? "⌘/" : "Ctrl+/");
    await shortcuts();
    expect(assignment("Toggle bookmark")?.textContent).toBe(platform === "mac" ? "⌘B" : "Ctrl+B");
    expect(assignment("Go to page")?.textContent).toBe(platform === "mac" ? "⌘G" : "Ctrl+G");
    expect(assignment("Go to percentage")?.textContent).toBe(platform === "mac" ? "⌘⇧G" : "Ctrl+Shift+G");
    expect(assignment("Switch to scrolling")?.textContent).toBe(platform === "mac" ? "⌥⇧PageDown" : "Alt+Shift+PageDown");
    expect(assignment("Switch to paginated")?.textContent).toBe(platform === "mac" ? "⌥⇧PageUp" : "Alt+Shift+PageUp");
  });

  it("persists the master preference, retains the static list, and keeps Help manually accessible", async () => {
    await shortcuts();
    const lists = container.querySelectorAll("dl");
    expect(lists[lists.length - 1]!.compareDocumentPosition(checkbox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => checkbox().click());
    expect(setPreferences).toHaveBeenLastCalledWith({ enabled: false });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Shortcut settings saved.");
    await shortcuts("ltr", false);
    await shortcuts();
    expect(checkbox().checked).toBe(false);
    expect(assignment("Next page")?.querySelectorAll("kbd")).toHaveLength(3);
    expect(container.textContent).toContain("Shortcuts are off.");
    await help();
    expect(button("Show keyboard shortcuts").hasAttribute("aria-keyshortcuts")).toBe(false);
    await click("Show keyboard shortcuts");
    expect(openShortcuts).toHaveBeenCalledOnce();
  });

  it("can re-enable shortcuts without any binding settings", async () => {
    preferences = { enabled: false };
    await shortcuts();
    await act(async () => checkbox().click());
    expect(setPreferences).toHaveBeenCalledWith({ enabled: true });
    expect(checkbox().checked).toBe(true);
  });

  it("waits for persistence and announces save rejection without changing the checked state", async () => {
    let reject!: (error: Error) => void;
    setPreferences.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await shortcuts();
    await act(async () => checkbox().focus());
    await act(async () => checkbox().click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Saving…");
    expect(checkbox().disabled).toBe(false);
    expect(checkbox().getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(checkbox());
    await act(async () => checkbox().click());
    expect(setPreferences).toHaveBeenCalledOnce();
    expect(checkbox().checked).toBe(true);
    await act(async () => reject(new Error("Database unavailable")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save shortcut settings");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(checkbox().checked).toBe(true);
    expect(checkbox().disabled).toBe(false);
    expect(document.activeElement).toBe(checkbox());
    expect(preferences).toEqual(DEFAULT_SHORTCUT_PREFERENCES);
  });

  it("shows loading failures and prevents toggling before preferences are ready", async () => {
    ready = false;
    await shortcuts();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Loading shortcut settings…");
    expect(checkbox().disabled).toBe(true);
    error = "Storage blocked";
    await shortcuts();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded");
  });

  it("shows direction-aware page bindings and does not capture Escape or Tab", async () => {
    await shortcuts("rtl");
    expect(assignment("Previous page")?.textContent).toContain("Right");
    expect(assignment("Next page")?.textContent).toContain("Left");
    await act(async () => checkbox().focus());
    expect(document.activeElement).toBe(checkbox());
    for (const key of ["Escape", "Tab"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => checkbox().dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(setPreferences).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(close).toHaveBeenCalledOnce();
  });
});
