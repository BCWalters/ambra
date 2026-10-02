import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button, Checkbox, Portal, Spinner, ToggleButton, useThemeClassName, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { createAmbraFluentTheme, getInterfaceTheme, getInterfaceCssVariables } from "@ambra/shell";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeThemeProvider, useChromeTheme } from "./ChromeThemeContext.js";
import { CHROME_THEMES, type ChromeThemeChoice } from "./chromeTheme.js";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "../library/ReadingSettings.js";

const choices = Object.keys(CHROME_THEMES) as ChromeThemeChoice[];

function Probe() {
  const palette = useChromeTheme();
  const className = useThemeClassName();
  return <div data-testid="probe" data-appearance={palette.appearance} data-theme={palette.choice} className={className}>
    <Button appearance="primary">Import</Button>
    <Button size="small" data-testid="compact-action">Compact action</Button>
    <ToggleButton checked>Bookmark</ToggleButton>
    <Checkbox checked label="Selected" />
    <Button disabled appearance="primary">Unavailable</Button>
    <Spinner label="Working" />
    <Portal><Button appearance="primary" data-testid="portal-action">Portalled action</Button></Portal>
  </div>;
}

describe("shared interface provider", () => {
  let container: HTMLDivElement;
  let root: Root;
  let dark: boolean;
  let listeners: Set<() => void>;

  beforeEach(() => {
    dark = false;
    listeners = new Set();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(prefers-color-scheme: dark)" && dark,
      media: query, onchange: null,
      addEventListener: (_type: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_type: string, callback: () => void) => listeners.delete(callback),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList);
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

  function render(theme: ChromeThemeChoice) {
    act(() => root.render(<ChromeThemeProvider theme={theme}><Probe /></ChromeThemeProvider>));
  }

  function themeRule(element: Element): CSSStyleRule {
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSStyleRule && [...element.classList].some((name) => rule.selectorText === `.${name}`)
          && rule.style.getPropertyValue("--colorBrandBackground")) return rule;
      }
    }
    throw new Error(`Missing theme rule for ${element.className}`);
  }

  it.each(choices)("%s reaches ordinary Fluent controls and portals in both browser appearances", (choice) => {
    for (const appearance of ["light", "dark"] as const) {
      act(() => { dark = appearance === "dark"; listeners.forEach((listener) => listener()); });
      render(choice);
      const probe = container.querySelector('[data-testid="probe"]')!;
      expect(probe.getAttribute("data-appearance")).toBe(appearance);
      const palette = getInterfaceTheme(choice, appearance);
      const provider = container.querySelector(".fui-FluentProvider")!;
      const portalButton = document.querySelector('[data-testid="portal-action"]')!;
      expect(container.contains(portalButton)).toBe(false);
      const portalRoot = portalButton.parentElement!;
      const providerRule = themeRule(probe);
      // Portal adds positioning classes but retains the provider's atomic focus/media styles.
      for (const name of provider.classList) {
        if (!name.startsWith("___")) expect(portalRoot.classList.contains(name)).toBe(true);
      }
      expect(themeRule(portalRoot)).toBe(providerRule);
      expect(getComputedStyle(provider).colorScheme).toBe(appearance);
      expect(getComputedStyle(portalRoot).colorScheme).toBe(appearance);
      const primary = probe.querySelector("button")!;
      expect(getComputedStyle(primary).backgroundColor).toBe(palette.actionBackground);
      expect(getComputedStyle(portalButton).backgroundColor).toBe(palette.actionBackground);
      expect(getComputedStyle(probe.querySelector('[data-testid="compact-action"]')!).fontWeight).toBe("550");
      expect(providerRule.style.getPropertyValue("--colorBrandBackground")).toBe(palette.actionBackground);
      expect(providerRule.style.getPropertyValue("--colorNeutralForegroundOnBrand")).toBe(palette.actionForeground);
      expect(providerRule.style.getPropertyValue("--colorCompoundBrandBackground")).toBe(palette.actionBackground);
      expect(providerRule.style.getPropertyValue("--colorStrokeFocus2")).toBe(palette.focus);
      expect(providerRule.style.getPropertyValue("--ambraBookmark")).toBe(palette.bookmark);
      expect(providerRule.style.getPropertyValue("--fontFamilyBase"))
        .toBe('-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
      expect(providerRule.style.getPropertyValue("--lineHeightBase300")).toBe("21px");
      expect(providerRule.style.getPropertyValue("--fontWeightSemibold")).toBe("550");
      expect(container.querySelector('button[disabled]')).not.toBeNull();
      expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
      expect(container.querySelector('input[type="checkbox"]')?.getAttribute("aria-checked")).not.toBe("false");
    }
  });

  it("updates an already-open portal when the persisted choice or browser appearance changes", () => {
    render("ambra");
    const portal = document.querySelector('[data-testid="portal-action"]')!;
    render("purple");
    act(() => { dark = true; listeners.forEach((listener) => listener()); });
    expect(document.querySelector('[data-testid="portal-action"]')).toBe(portal);
    expect(container.querySelector('[data-testid="probe"]')?.getAttribute("data-theme")).toBe("purple");
    expect(container.querySelector('[data-testid="probe"]')?.getAttribute("data-appearance")).toBe("dark");
    expect(themeRule(portal.parentElement!).style.getPropertyValue("--colorBrandBackground"))
      .toBe(getInterfaceTheme("purple", "dark").actionBackground);
  });

  it("provides scoped focus, forced-colors and reduced-motion rules to portals too", () => {
    render("ambra");
    const css = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("var(--ambraFocus)");
    expect(css).toContain("var(--ambraSurface)");
    expect(css).toContain("forced-colors: active");
    // happy-dom drops system-color declarations; Chromium validates their rendering.
    expect(css).toContain("box-shadow: none");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("transition-duration: 0s");
  });
});

describe("theme ownership and persistence", () => {
  it.each(choices)("%s reads and writes the existing key without changing independent page settings", async (choice) => {
    const database = Object.create(LibraryDatabase.prototype) as LibraryDatabase;
    Object.assign(database, {
      getAll: vi.fn(async () => [
        { key: "defaultChromeTheme", value: choice }, { key: "defaultPageTheme", value: "sepia" },
      ]),
    });
    expect(await database.getGlobalReadingSettings()).toEqual({
      ...DEFAULT_GLOBAL_READING_SETTINGS, chromeTheme: choice, pageTheme: "sepia",
    });
    const put = vi.fn();
    const changed = vi.fn();
    Object.assign(database, {
      transaction: vi.fn(async (_stores, _mode, _message, write) =>
        write({ objectStore: () => ({ put }) })),
      preferencesChanged: changed,
    });
    await database.patchGlobalReadingSettings({ chromeTheme: choice });
    expect(put).toHaveBeenCalledExactlyOnceWith({ key: "defaultChromeTheme", value: choice });
    expect(changed).toHaveBeenCalledOnce();
  });

  it.each(["light", "dark"] as const)("preserves Fluent status/disabled colors in %s appearance", (appearance) => {
    const baseline = appearance === "dark" ? webDarkTheme : webLightTheme;
    for (const choice of choices) {
      const palette = getInterfaceTheme(choice, appearance);
      const fluent = createAmbraFluentTheme(palette);
      for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) {
        if (/Status|Palette|Disabled/.test(key)) expect(fluent[key]).toBe(baseline[key]);
      }
      const bridge = getInterfaceCssVariables(palette);
      expect(bridge["--ambraBookmark"]).toBe(palette.bookmark);
      expect(Object.keys(bridge).every((key) => key.startsWith("--ambra"))).toBe(true);
    }
  });
});
