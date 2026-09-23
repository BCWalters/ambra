import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
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
  });

  function render(state: Partial<NarrationState> = {}, focusOnOpen = false) {
    act(() => root.render(
      <ChromeThemeProvider theme="blue">
        <NarrationControls state={{ ...initial, ...state }} {...callbacks} focusOnOpen={focusOnOpen} />
      </ChromeThemeProvider>,
    ));
  }

  function button(name: string) {
    const match = Array.from(container.querySelectorAll("button"))
      .find((element) => element.getAttribute("aria-label") === name || element.textContent === name);
    expect(match, `Button: ${name}`).toBeDefined();
    return match!;
  }

  it("wires passage, playback, speed, and close controls without an audio seek slider", () => {
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
    const speed = container.querySelector("select")!;
    expect(speed.getAttribute("aria-label")).toBe("Narration speed");
    expect(Array.from(speed.options, (option) => option.value)).toEqual(["0.75", "1", "1.25", "1.5", "2"]);
    act(() => {
      speed.value = "1.5";
      speed.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(callbacks.onRateChange).toHaveBeenCalledWith(1.5);
    render({ rate: 1.5 });
    expect(speed.value).toBe("1.5");
    expect(container.querySelector('[role="slider"], input[type="range"]')).toBeNull();
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
    act(() => button("Listen from here").click());
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
    expect(container.querySelector<HTMLElement>('[role="status"]')!.style.minHeight).toBe("16px");
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
    render({ status: "playing" });
    expect(status.textContent).toBe("");
    render({ status: "paused" });
    expect(status.textContent).toBe("");
    render({ status: "error", error: "Audio decode failed <script>alert(1)</script>" });
    expect(status.textContent).toBe("Narration could not be played.");
    expect(container.textContent).toContain("Audio decode failed <script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("uses wrapping, themed normal-flow chrome without moving focus", () => {
    const focused = document.activeElement;
    render();
    const region = container.querySelector("section")!;
    expect(region.hasAttribute("data-narration-controls")).toBe(true);
    expect(region.getAttribute("aria-label")).toBe("Narration controls");
    expect(region.style.position).toBe("");
    expect(region.style.flexShrink).toBe("0");
    expect(region.style.background).not.toBe("");
    expect(region.querySelector("div")!.style.flexWrap).toBe("wrap");
    const statusSizer = container.querySelector<HTMLElement>('[role="status"]')!
      .parentElement!.querySelector<HTMLElement>('[aria-hidden="true"]')!;
    expect(statusSizer.style.visibility).toBe("hidden");
    expect(statusSizer.textContent).toBe("Browsing away from narration.");
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
    expect(container.innerHTML).toBe("");
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
      expect(button(t("narration.listenFromHere"))).toBeDefined();
      expect(container.querySelector('[role="status"]')!.textContent).toBe(t("narration.browsing"));
      if (locale !== "en") expect(t("narration.controls")).not.toBe(getTranslate("en")("narration.controls"));
    },
  );
});
