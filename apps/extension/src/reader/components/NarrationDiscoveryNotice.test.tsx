import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHROME_TOOLBAR_HEIGHT } from "../../components/ChromeToolbarStyles.js";
import { getTranslate, useTranslation } from "../../i18n/LocaleContext.js";
import { ChromeThemeProvider } from "../ChromeThemeContext.js";
import { CHROME_THEMES } from "../chromeTheme.js";
import type { ChromeThemeChoice } from "../chromeTheme.js";
import { NarrationDiscoveryNotice } from "./NarrationDiscoveryNotice.js";

vi.mock("../../i18n/LocaleContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n/LocaleContext.js")>();
  return { ...actual, useTranslation: vi.fn(() => actual.getTranslate("en")) };
});

describe("NarrationDiscoveryNotice", () => {
  let root: Root;
  let container: HTMLDivElement;
  let readerButton: HTMLButtonElement;
  const onListen = vi.fn();
  const onDismiss = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(useTranslation).mockReturnValue(getTranslate("en"));
    onListen.mockClear();
    onDismiss.mockClear();
    container = document.createElement("div");
    readerButton = document.createElement("button");
    readerButton.textContent = "Reader";
    document.body.append(readerButton, container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    readerButton.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function render(theme: ChromeThemeChoice = "ambra") {
    act(() => root.render(
      <ChromeThemeProvider theme={theme}>
        <NarrationDiscoveryNotice onListen={onListen} onDismiss={onDismiss} />
      </ChromeThemeProvider>,
    ));
  }

  function button(name: string) {
    const match = Array.from(container.querySelectorAll("button"))
      .find((element) => element.textContent === name);
    expect(match, `Button: ${name}`).toBeDefined();
    return match!;
  }

  it("names a nonmodal region with its heading and announces only the explanatory text politely", () => {
    render();
    const region = container.querySelector('[role="region"]')!;
    const heading = region.querySelector("h2")!;
    expect(heading.textContent).toBe("This book has narration");
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.id).not.toBe("");
    const status = region.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.contains(heading)).toBe(false);
    expect(region.querySelector("p")!.textContent).toBe(
      "Listen to recorded audio while the text is highlighted. You can start anytime with the headphones button.",
    );
    expect(status.textContent).toBe("");
    act(() => vi.advanceTimersByTime(50));
    expect(status.textContent).toBe(
      "This book has narration. Listen to recorded audio while the text is highlighted. You can start anytime with the headphones button.",
    );
    expect(region.querySelector("h2")).toBe(heading);
    expect(status.getAttribute("style")).toContain("position: absolute");
    expect(status.querySelector("button")).toBeNull();
    expect(container.querySelector('[role="dialog"], [aria-modal], [role="alert"]')).toBeNull();
    expect(region.contains(button("Listen now"))).toBe(true);
    expect(region.contains(button("Not now"))).toBe(true);
  });

  it("announces once after mounting without clearing on rerender or automatically dismissing", () => {
    render();
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toBe("");
    act(() => vi.advanceTimersByTime(50));
    const announcement = status.textContent;
    expect(announcement).toContain("This book has narration.");
    render("blue");
    expect(status.textContent).toBe(announcement);
    act(() => vi.advanceTimersByTime(60_000));
    expect(status.textContent).toBe(announcement);
    expect(container.querySelector('[role="region"]')).not.toBeNull();
    expect(onListen).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("only invokes the requested action and leaves visibility to the parent", () => {
    render();
    expect(onListen).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => button("Listen now").click());
    expect(onListen).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => button("Not now").click());
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onListen).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="region"]')).not.toBeNull();
  });

  it("does not steal focus on mount or rerender, and keeps native buttons keyboard accessible", () => {
    readerButton.focus();
    render();
    expect(document.activeElement).toBe(readerButton);
    for (const name of ["Listen now", "Not now"]) {
      const action = button(name);
      expect(action.disabled).toBe(false);
      expect(action.tabIndex).toBe(0);
      act(() => action.focus());
      expect(document.activeElement).toBe(action);
    }
    render("blue");
    expect(document.activeElement).toBe(button("Not now"));
    expect(onListen).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not intercept reader navigation or dismissal keystrokes", () => {
    render();
    const onKeyDown = vi.fn();
    container.addEventListener("keydown", onKeyDown);
    for (const key of ["ArrowLeft", "ArrowRight", "PageDown", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => button("Not now").dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onKeyDown).toHaveBeenCalledTimes(4);
    expect(onListen).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it.each(["ambra", "silver", "green", "blue", "purple"] as const)(
    "uses compact, wrapping %s chrome below the toolbar without changing the reading layout",
    (theme) => {
      render(theme);
      const region = container.querySelector<HTMLElement>('[role="region"]')!;
      expect(region.hasAttribute("data-narration-discovery")).toBe(true);
      expect(region.style.position).toBe("absolute");
      expect(region.style.top).toBe(`${CHROME_TOOLBAR_HEIGHT + 12}px`);
      expect(region.style.right).toBe("16px");
      expect(region.style.width).toBe("calc(100% - 32px)");
      expect(region.style.maxWidth).toBe("380px");
      expect(region.style.boxSizing).toBe("border-box");
      expect(region.style.zIndex).toBe("7");
      expect(region.style.overflowWrap).toBe("anywhere");
      const swatch = document.createElement("span");
      swatch.style.background = CHROME_THEMES[theme].backgroundSolid;
      expect(region.style.background).toBe(swatch.style.background);
      swatch.style.background = CHROME_THEMES[theme].accentForeground;
      expect(button("Listen now").style.background).toBe(swatch.style.background);
      expect(button("Listen now").parentElement!.style.flexWrap).toBe("wrap");
      expect(button("Listen now").style.whiteSpace).toBe("normal");
      expect(button("Not now").style.whiteSpace).toBe("normal");
    },
  );

  it.each(["en", "de", "es", "fr", "it", "ja", "ko", "ru", "zh"] as const)(
    "localizes the heading, explanation, and actions in %s",
    (locale) => {
      const t = getTranslate(locale);
      vi.mocked(useTranslation).mockReturnValue(t);
      render();
      expect(container.querySelector("h2")!.textContent).toBe(t("narration.discoveryTitle"));
      expect(container.querySelector("p")!.textContent).toBe(t("narration.discoveryMessage"));
      expect(button(t("narration.noticeListen"))).toBeDefined();
      expect(t("narration.noticeListen")).not.toBe(t("narration.listen"));
      expect(button(t("narration.notNow"))).toBeDefined();
      act(() => vi.advanceTimersByTime(50));
      expect(container.querySelector('[role="status"]')!.textContent).toBe(
        `${t("narration.discoveryTitle")}. ${t("narration.discoveryMessage")}`,
      );
      if (locale !== "en") {
        for (const key of ["narration.discoveryTitle", "narration.discoveryMessage", "narration.notNow", "narration.noticeListen"] as const) {
          expect(t(key)).not.toBe(getTranslate("en")(key));
          expect(t(key)).not.toBe(key);
        }
      }
    },
  );
});
