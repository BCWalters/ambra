import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslate, useTranslation } from "../../i18n/LocaleContext.js";
import { ChromeThemeProvider } from "../ChromeThemeContext.js";
import { CHROME_THEMES } from "../chromeTheme.js";
import type { NarrationState } from "../MediaOverlayNarration.js";
import { NarrationControls } from "./NarrationControls.js";
import type { NarrationControlsProps } from "./NarrationControls.js";

vi.mock("../../i18n/LocaleContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../i18n/LocaleContext.js")>();
  return { ...actual, useTranslation: vi.fn(() => actual.getTranslate("en")) };
});

describe("NarrationControls", () => {
  let root: Root;
  let container: HTMLDivElement;
  let callbacks: Omit<NarrationControlsProps, "state">;
  const initial: NarrationState = {
    available: true,
    status: "paused",
    following: true,
    rate: 1,
    hasPrevious: true,
    hasNext: true,
    hasTarget: true,
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(useTranslation).mockReturnValue(getTranslate("en"));
    // Happy DOM eagerly rejects Animation.finished on cancellation; Fluent uses oncancel instead.
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, ...args) {
      const animation = animate.apply(this, args);
      void animation.finished.catch(() => {});
      return animation;
    });
    callbacks = {
      onPlayPause: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onReturnToNarration: vi.fn(),
      onListenFromHere: vi.fn(),
      onRateChange: vi.fn(),
      onClose: vi.fn(),
    };
    container = document.createElement("div");
    container.style.width = "360px";
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function render(state: Partial<NarrationState> = {}, focusOnOpen = false, hasSelection = false) {
    act(() => root.render(
      <FluentProvider theme={webLightTheme}>
        <ChromeThemeProvider theme="blue">
          <NarrationControls state={{ ...initial, ...state }} {...callbacks} focusOnOpen={focusOnOpen} hasSelection={hasSelection} />
        </ChromeThemeProvider>
      </FluentProvider>,
    ));
  }

  function button(name: string) {
    const match = Array.from(container.querySelectorAll("button"))
      .find((element) => element.getAttribute("aria-label") === name || element.textContent === name);
    expect(match, `Button: ${name}`).toBeDefined();
    return match!;
  }

  it("wires passage, playback, and close controls without a native select or audio seek slider", () => {
    render();
    for (const [name, callback] of [
      ["Previous narrated passage", callbacks.onPrevious],
      ["Play narration", callbacks.onPlayPause],
      ["Next narrated passage", callbacks.onNext],
      ["Close narration", callbacks.onClose],
    ] as const) {
      act(() => button(name).click());
      expect(callback).toHaveBeenCalledOnce();
    }
    expect(container.querySelector('select, [role="slider"], input[type="range"]')).toBeNull();
    expect(button("Close narration").querySelector('svg')).not.toBeNull();
  });

  it("offers a themed speed menu with the current rate checked and updates through the callback", async () => {
    render();
    const speed = button("Narration speed: 1×");
    expect(speed.textContent).toBe("1×");
    expect(speed.getAttribute("aria-haspopup")).toBe("menu");
    expect(speed.getAttribute("aria-expanded")).not.toBe("true");
    await act(async () => speed.click());
    const rates = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    expect(rates.map(rate => rate.textContent)).toEqual(["0.75×", "1×", "1.25×", "1.5×", "2×"]);
    expect(rates.map(rate => rate.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false", "false"]);
    expect(document.querySelector('[role="menu"]')!.getAttribute("aria-label")).toBe("Narration speed");
    const popup = document.querySelector<HTMLElement>(".fui-MenuPopover")!;
    expect(popup.style.minWidth).toBe("96px");
    expect(popup.style.maxWidth).toBe("112px");
    expect(popup.style.padding).toBe("4px");
    expect(popup.style.borderRadius).toBe("10px");
    expect(getComputedStyle(rates[0]!).minHeight).toBe("28px");
    expect(getComputedStyle(rates[1]!).fontWeight).toBe("600");
    const swatch = document.createElement("span");
    swatch.style.background = CHROME_THEMES.blue.backgroundSolid;
    expect(speed.style.background).toBe(swatch.style.background);
    await act(async () => rates[3]!.click());
    expect(callbacks.onRateChange).toHaveBeenCalledWith(1.5);
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    expect(speed.getAttribute("aria-expanded")).not.toBe("true");
    render({ rate: 1.5 });
    expect(button("Narration speed: 1.5×").textContent).toBe("1.5×");
    await act(async () => button("Narration speed: 1.5×").click());
    expect(document.querySelector('[role="menuitemradio"][aria-checked="true"]')!.textContent).toBe("1.5×");
  });

  it("opens the speed menu with the keyboard and returns focus on Escape without closing narration", async () => {
    render();
    const speed = button("Narration speed: 1×");
    act(() => speed.focus());
    await act(async () => {
      speed.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });
    expect(speed.getAttribute("aria-expanded")).toBe("true");
    const firstRate = document.querySelector<HTMLElement>('[role="menuitemradio"]')!;
    expect(firstRate).not.toBeNull();
    await act(async () => {
      firstRate.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(speed.getAttribute("aria-expanded")).not.toBe("true");
    expect(document.activeElement).toBe(speed);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(callbacks.onRateChange).not.toHaveBeenCalled();
  });

  it("supports keyboard speed selection without changing playback", async () => {
    render();
    const speed = button("Narration speed: 1×");
    act(() => speed.focus());
    await act(async () => {
      speed.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });
    const rate = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
      .find(item => item.textContent === "2×")!;
    await act(async () => {
      rate.focus();
      rate.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(callbacks.onRateChange).toHaveBeenCalledOnce();
    expect(callbacks.onRateChange).toHaveBeenCalledWith(2);
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    expect(speed.getAttribute("aria-expanded")).not.toBe("true");
    expect(document.activeElement).toBe(speed);
  });

  it.each(["playing", "loading"] as const)("allows pausing while %s", (status) => {
    render({ status });
    act(() => button("Pause narration").click());
    expect(callbacks.onPlayPause).toHaveBeenCalledOnce();
  });

  it.each(["idle", "paused", "ended", "error"] as const)("allows starting or resuming while %s", (status) => {
    render({ status });
    expect(button("Play narration").disabled).toBe(false);
  });

  it("disables unavailable neighboring passages", () => {
    render({ hasPrevious: false, hasNext: false });
    act(() => {
      button("Previous narrated passage").click();
      button("Next narrated passage").click();
    });
    expect(button("Previous narrated passage").disabled).toBe(true);
    expect(button("Next narrated passage").disabled).toBe(true);
    expect(callbacks.onPrevious).not.toHaveBeenCalled();
    expect(callbacks.onNext).not.toHaveBeenCalled();
  });

  it.each(["loading", "paused"] as const)("does not offer Return without a target while %s", status => {
    render({ status, following: false, hasTarget: false });
    expect(button("Return to narration").style.visibility).toBe("hidden");
    expect(button("Return to narration").disabled).toBe(true);
  });

  it("keeps returning to narration distinct from listening at the browsed location or resuming", () => {
    render({ following: false });
    const returnButton = button("Return to narration");
    expect(returnButton.style.visibility).toBe("visible");
    expect(returnButton.getAttribute("aria-hidden")).toBe("false");
    expect(container.querySelector('[role="status"]')!.textContent).toBe("Browsing away from narration.");
    act(() => button("Return to narration").click());
    expect(callbacks.onReturnToNarration).toHaveBeenCalledOnce();
    expect(callbacks.onListenFromHere).not.toHaveBeenCalled();
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    act(() => button("Listen from this page").click());
    expect(callbacks.onListenFromHere).toHaveBeenCalledOnce();
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    render({ following: true });
    expect(button("Return to narration")).toBe(returnButton);
    expect(returnButton.style.visibility).toBe("hidden");
    expect(returnButton.getAttribute("aria-hidden")).toBe("true");
    expect(returnButton.tabIndex).toBe(-1);
    expect(returnButton.disabled).toBe(true);
    act(() => returnButton.click());
    expect(callbacks.onReturnToNarration).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')!.textContent).toBe("");
    expect(getComputedStyle(container.querySelector<HTMLElement>('[role="status"]')!).position).toBe("absolute");
  });

  it("changes the listening target label without changing either reserved label or the button identity", () => {
    render();
    const listen = button("Listen from this page");
    const labels = Array.from(listen.querySelectorAll<HTMLElement>('[aria-hidden]'))
      .filter(label => label.tagName === "SPAN");
    expect(labels.map(label => label.textContent)).toEqual(["Listen from this page", "Listen from selection"]);
    expect(labels.map(label => label.style.visibility)).toEqual(["visible", "hidden"]);
    expect(labels.every(label => label.style.gridArea === "1 / 1")).toBe(true);
    act(() => listen.focus());
    render({}, false, true);
    expect(button("Listen from selection")).toBe(listen);
    expect(document.activeElement).toBe(listen);
    expect(labels.map(label => label.style.visibility)).toEqual(["hidden", "visible"]);
    expect(labels.map(label => label.getAttribute("aria-hidden"))).toEqual(["true", "false"]);
    act(() => listen.click());
    expect(callbacks.onListenFromHere).toHaveBeenCalledOnce();
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    render();
    expect(button("Listen from this page")).toBe(listen);
    expect(labels.map(label => label.style.visibility)).toEqual(["visible", "hidden"]);
  });

  it.each(["idle", "error"] as const)("does not offer return without a known active target in %s", (status) => {
    render({ following: false, status });
    expect(button("Return to narration").style.visibility).toBe("hidden");
    expect(button("Return to narration").disabled).toBe(true);
  });

  it("announces only loading and the translated error heading, not raw diagnostics or playback updates", () => {
    render({ status: "loading" });
    const status = container.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Loading narration…");
    expect(getComputedStyle(status).position).toBe("absolute");
    expect(getComputedStyle(status).height).toBe("1px");
    render({ status: "playing" });
    expect(status.textContent).toBe("");
    render({ status: "paused" });
    expect(status.textContent).toBe("");
    render({ status: "error", error: "Audio decode failed <script>alert(1)</script>" });
    expect(status.textContent).toBe("Narration could not be played.");
    expect(status.className).toBe("");
    expect(status.hasAttribute("aria-hidden")).toBe(false);
    expect(container.textContent).toContain("Audio decode failed <script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("keeps all commands in one compact adaptive row without moving focus", () => {
    const focused = document.activeElement;
    render();
    const region = container.querySelector("section")!;
    expect(region.hasAttribute("data-narration-controls")).toBe(true);
    expect(region.getAttribute("aria-label")).toBe("Narration controls");
    expect(region.style.position).toBe("relative");
    expect(region.style.zIndex).toBe("1");
    expect(region.style.flexShrink).toBe("0");
    expect(region.style.background).not.toBe("");
    expect(region.style.padding).toBe("6px 8px");
    expect(region.style.containerType).toBe("inline-size");
    expect(region.style.containerName).toBe("narration");
    const commands = container.querySelector<HTMLElement>("[data-narration-commands]")!;
    expect(commands.style.gridTemplateColumns).toBe("minmax(0, 1fr) auto");
    expect(commands.style.minHeight).toBe("28px");
    expect(commands.querySelectorAll("button")).toHaveLength(7);
    expect(commands.lastElementChild).toBe(button("Close narration"));
    const primary = container.querySelector<HTMLElement>("[data-narration-primary-commands]")!;
    expect(primary.style.flexWrap).toBe("wrap");
    expect(primary.querySelectorAll("button")).toHaveLength(6);
    expect(region.querySelectorAll(":scope > div")).toHaveLength(2);
    for (const name of ["Return to narration", "Listen from this page"]) {
      const action = button(name);
      expect(action.parentElement).toBe(primary);
      expect(action.querySelector("svg")).not.toBeNull();
      expect(getComputedStyle(action).borderTopStyle).toBe("solid");
      expect(getComputedStyle(action).whiteSpace).toBe("nowrap");
      expect(getComputedStyle(action).borderRadius).toBe("999px");
    }
    const css = Array.from(document.styleSheets)
      .flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join("\n");
    expect(css).toContain("@container narration (max-width: 720px)");
    expect(css).toMatch(/@container narration \(max-width: 720px\)[^{]*\{[^}]*display: none/);
    expect(document.activeElement).toBe(focused);
    const swatch = document.createElement("span");
    swatch.style.background = CHROME_THEMES.blue.accentForeground;
    swatch.style.color = "#fff";
    expect(button("Play narration").style.background).toBe(swatch.style.background);
    expect(button("Play narration").style.color).toBe(swatch.style.color);
  });

  it("focuses playback only on explicit open, never again on narration updates", () => {
    render({ status: "loading" }, true);
    expect(document.activeElement).toBe(button("Pause narration"));
    act(() => button("Close narration").focus());
    render({ status: "playing", hasPrevious: false }, true);
    expect(document.activeElement).toBe(button("Close narration"));
    render({ status: "paused", following: false }, true);
    expect(document.activeElement).toBe(button("Close narration"));
  });

  it("does not treat later focusOnOpen changes as an explicit open", () => {
    render();
    act(() => button("Close narration").focus());
    render({ status: "playing" }, true);
    expect(document.activeElement).toBe(button("Close narration"));
  });

  it("hides controls for books without narration", () => {
    render({ available: false });
    expect(container.querySelector("[data-narration-controls]")).toBeNull();
  });

  it.each(["en", "de", "es", "fr", "it", "ja", "ko", "ru", "zh"] as const)(
    "localizes labels and browsing actions in %s",
    (locale) => {
      const t = getTranslate(locale);
      vi.mocked(useTranslation).mockReturnValue(t);
      render({ following: false });
      expect(button(t("narration.previous")).disabled).toBe(false);
      expect(button(t("narration.next")).disabled).toBe(false);
      expect(button(t("narration.return"))).toBeDefined();
      expect(button(t("narration.listenFromPage"))).toBeDefined();
      expect(button(t("narration.close"))).toBeDefined();
      expect(button(`${t("narration.speed")}: 1×`)).toBeDefined();
      expect(container.querySelector('[role="status"]')!.textContent).toBe(t("narration.browsing"));
      render({ following: false }, false, true);
      expect(button(t("narration.listenFromSelection"))).toBeDefined();
      if (locale !== "en") {
        expect(t("narration.listenFromPage")).not.toBe(getTranslate("en")("narration.listenFromPage"));
        expect(t("narration.listenFromSelection")).not.toBe(getTranslate("en")("narration.listenFromSelection"));
      }
      if (locale !== "en") expect(t("narration.controls")).not.toBe(getTranslate("en")("narration.controls"));
    },
  );
});
