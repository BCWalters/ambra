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
      onListenFromHere: vi.fn(),
      onListenFromSelection: vi.fn(),
      onRateChange: vi.fn(),
      collapsed: false,
      onCollapsedChange: vi.fn(),
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

  function render(state: Partial<NarrationState> = {}, focusOnOpen = false, hasSelection = false, collapsed = false) {
    act(() => root.render(
      <FluentProvider theme={webLightTheme}>
        <ChromeThemeProvider theme="blue">
          <NarrationControls state={{ ...initial, ...state }} {...callbacks} collapsed={collapsed}
            focusOnOpen={focusOnOpen} hasSelection={hasSelection} />
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

  it("wires passage, playback, and collapse controls without a native select or audio seek slider", () => {
    render();
    for (const [name, callback] of [
      ["Previous narrated passage", callbacks.onPrevious],
      ["Play narration", callbacks.onPlayPause],
      ["Next narrated passage", callbacks.onNext],
      ["Collapse read-along controls", callbacks.onCollapsedChange],
    ] as const) {
      act(() => button(name).click());
      expect(callback).toHaveBeenCalledOnce();
    }
    expect(container.querySelector('select, [role="slider"], input[type="range"]')).toBeNull();
    expect(button("Collapse read-along controls").querySelector('svg')).not.toBeNull();
    expect(callbacks.onCollapsedChange).toHaveBeenCalledWith(true);
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
    expect(callbacks.onCollapsedChange).not.toHaveBeenCalled();
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

  it("keeps page restart distinct from playback and removes detached browsing controls", () => {
    render({ following: false });
    expect(container.querySelector('[aria-label="Return to narration"]')).toBeNull();
    act(() => button("Restart page audio").click());
    expect(callbacks.onListenFromHere).toHaveBeenCalledOnce();
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')!.textContent).toBe("");
  });

  it("keeps Play available while loading a paused navigation cue", () => {
    render({ status: "loading", playbackRequested: false });
    expect(button("Play narration")).toBeDefined();
    expect(container.querySelector('[aria-label="Pause narration"]')).toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toBe("Loading narration…");
  });

  it("keeps page restart available independently of Jump to selection", () => {
    render();
    const listen = button("Restart page audio");
    expect(container.querySelector('[aria-label="Jump to selection"]')).toBeNull();
    act(() => listen.focus());
    render({}, false, true);
    expect(button("Restart page audio")).toBe(listen);
    expect(document.activeElement).toBe(listen);
    act(() => button("Jump to selection").click());
    expect(callbacks.onListenFromSelection).toHaveBeenCalledOnce();
    expect(callbacks.onListenFromHere).not.toHaveBeenCalled();
    act(() => listen.click());
    expect(callbacks.onListenFromHere).toHaveBeenCalledOnce();
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    render();
    expect(button("Restart page audio")).toBe(listen);
    expect(container.querySelector('[aria-label="Jump to selection"]')).toBeNull();
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

  it("separates position commands from a centered primary transport row without moving focus", () => {
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
    expect(commands.style.flexWrap).toBe("wrap");
    expect(commands.style.minHeight).toBe("28px");
    expect(commands.querySelectorAll("button")).toHaveLength(3);
    expect(commands.lastElementChild).toBe(button("Collapse read-along controls"));
    expect(commands.textContent).toContain("Read along");
    const primary = container.querySelector<HTMLElement>("[data-narration-primary-commands]")!;
    expect(primary.style.gridTemplateColumns).toBe("minmax(0, 1fr) auto minmax(0, 1fr)");
    expect(primary.querySelectorAll("button")).toHaveLength(3);
    expect(button("Play narration").style.minHeight).toBe("48px");
    for (const name of ["Restart page audio"]) {
      const action = button(name);
      expect(commands.contains(action)).toBe(true);
      expect(primary.contains(action)).toBe(false);
      expect(action.querySelector("svg")).not.toBeNull();
      expect(getComputedStyle(action).whiteSpace).toBe("normal");
    }
    const css = Array.from(document.styleSheets)
      .flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join("\n");
    expect(css).not.toContain("@container narration (max-width: 720px)");
    expect(document.activeElement).toBe(focused);
    expect(getComputedStyle(button("Play narration")).backgroundColor).toBe(CHROME_THEMES.blue.actionBackground);
    expect(getComputedStyle(button("Play narration")).color).toBe(CHROME_THEMES.blue.actionForeground);
  });

  it("retains compact playback when collapsed and never treats collapse or expansion as a playback command", () => {
    render({ status: "playing" });
    const collapse = button("Collapse read-along controls");
    act(() => { collapse.focus(); collapse.click(); });
    expect(callbacks.onCollapsedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    render({ status: "playing" }, false, false, true);
    expect(container.querySelector("[data-narration-primary-commands]")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(2);
    expect(button("Pause narration").style.minHeight).toBe("36px");
    expect(document.activeElement).toBe(button("Expand read-along controls"));
    expect(button("Expand read-along controls")).toBe(collapse);
    act(() => button("Expand read-along controls").click());
    expect(callbacks.onCollapsedChange).toHaveBeenLastCalledWith(false);
    expect(callbacks.onPlayPause).not.toHaveBeenCalled();
    act(() => button("Pause narration").click());
    expect(callbacks.onPlayPause).toHaveBeenCalledOnce();
  });

  it("focuses playback only on explicit open, never again on narration updates", () => {
    render({ status: "loading" }, true);
    expect(document.activeElement).toBe(button("Pause narration"));
    act(() => button("Collapse read-along controls").focus());
    render({ status: "playing", hasPrevious: false }, true);
    expect(document.activeElement).toBe(button("Collapse read-along controls"));
    render({ status: "paused", following: false }, true);
    expect(document.activeElement).toBe(button("Collapse read-along controls"));
  });

  it("does not treat later focusOnOpen changes as an explicit open", () => {
    render();
    act(() => button("Collapse read-along controls").focus());
    render({ status: "playing" }, true);
    expect(document.activeElement).toBe(button("Collapse read-along controls"));
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
      expect(button(t("narration.previous")).textContent).toBe(t("narration.previousLabel"));
      expect(button(t("narration.next")).textContent).toBe(t("narration.nextLabel"));
      expect(button(t("narration.play")).querySelector('[aria-hidden="false"]')?.textContent).toBe(t("narration.playLabel"));
      expect(container.querySelector(`[aria-label="${t("narration.return")}"]`)).toBeNull();
      expect(button(t("narration.listenFromPage"))).toBeDefined();
      expect(button(t("narration.collapse"))).toBeDefined();
      expect(button(t("narration.collapse")).textContent).toBe(t("narration.collapseLabel"));
      expect(container.textContent).toContain(t("narration.speedLabel"));
      expect(button(`${t("narration.speed")}: 1×`)).toBeDefined();
      expect(container.querySelector('[role="status"]')!.textContent).toBe("");
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
