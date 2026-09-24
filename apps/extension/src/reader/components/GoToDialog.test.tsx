import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoToDialog, type GoToDialogProps } from "./GoToDialog.js";
import { ReaderDiagnosticContext } from "../ReaderDiagnosticContext.js";
import { SUPPORTED_LOCALES, type Locale } from "../../i18n/Locale.js";
import { getTranslate } from "../../i18n/translate.js";

const language = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("../../i18n/LocaleContext.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../i18n/LocaleContext.js")>();
  return { ...actual, useTranslation: () => actual.getTranslate(language.locale) };
});

describe("GoToDialog with native form and Fluent modal ownership", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onGo = vi.fn();
  const onOpenChange = vi.fn();
  const record = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    language.locale = "en";
    onGo.mockReset();
    onOpenChange.mockClear();
    record.mockClear();
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      void animation.finished.catch(() => undefined);
      queueMicrotask(() => animation.finish());
      return animation;
    });
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
  async function render(props: Partial<GoToDialogProps> = {}) {
    await act(async () => root.render(
      <FluentProvider theme={webLightTheme}>
        <ReaderDiagnosticContext.Provider value={record}>
          <GoToDialog mode="page" open isPaginated isFixedLayout={false} bookPageCount={200}
            onGo={onGo} onOpenChange={onOpenChange} {...props} />
        </ReaderDiagnosticContext.Provider>
      </FluentProvider>,
    ));
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  const go = () => dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  async function enter(value: string) {
    const input = dialog().querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }
  async function submit() {
    await act(async () => dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  }

  it.each(["1e2", "2e-1", "9.9", "0", "-1", "201", "9007199254740993", ""])("rejects %j rather than guessing a page", async value => {
    await render();
    await enter(value);
    expect(go().disabled).toBe(true);
    await submit();
    expect(onGo).not.toHaveBeenCalled();
  });
  it.each([
    ["page", "1", 1 / 200], ["page", "200", 1],
    ["percentage", "1", 0.01], ["percentage", "25", 0.25], ["percentage", "100", 1],
  ] as const)("submits %s %s through the existing seek fraction", async (mode, value, fraction) => {
    await render({ mode });
    const input = await enter(value);
    expect(document.activeElement).toBe(input);
    expect(input.min).toBe("1");
    expect(input.step).toBe("1");
    expect(input.max).toBe(mode === "page" ? "200" : "100");
    expect(input.labels?.length).toBe(1);
    expect(go().disabled).toBe(false);
    await submit();
    expect(onGo).toHaveBeenCalledExactlyOnceWith(fraction);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it.each([undefined, 0, -1, NaN, Infinity, 1.5])("does not invent pages for count %s", async bookPageCount => {
    await render({ bookPageCount });
    expect(dialog().querySelector("input")).toBeNull();
    expect(dialog().textContent).toContain(getTranslate("en")("goTo.pageCountMeasuring"));
    expect(go().disabled).toBe(true);
    await submit();
    expect(onGo).not.toHaveBeenCalled();
  });
  it("enables and focuses page input when measurement completes and revalidates changed bounds", async () => {
    await render({ bookPageCount: undefined });
    await render({ bookPageCount: 40 });
    expect(document.activeElement).toBe(dialog().querySelector("input"));
    await enter("40");
    expect(go().disabled).toBe(false);
    await render({ bookPageCount: 20 });
    expect(go().disabled).toBe(true);
    expect(dialog().querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
  });
  it("allows percentage seeking before book pagination is ready", async () => {
    await render({ mode: "percentage", bookPageCount: undefined });
    await enter("25");
    await submit();
    expect(onGo).toHaveBeenCalledWith(0.25);
  });
  it.each(["page", "percentage"] as const)("explains unsupported modes for %s without seeking", async mode => {
    for (const props of [{ isPaginated: false }, { isFixedLayout: true }]) {
      await render({ mode, ...props });
      expect(dialog().querySelector("input")).toBeNull();
      expect(dialog().querySelector('[role="status"]')?.textContent).toBe(
        getTranslate("en")("isFixedLayout" in props ? "goTo.fixedLayoutUnavailable" : "goTo.scrollingUnavailable"),
      );
      await submit();
      expect(onGo).not.toHaveBeenCalled();
    }
  });
  it("shows asynchronous seek failure and permits retry without an unhandled rejection", async () => {
    onGo.mockRejectedValueOnce(new Error("private path")).mockResolvedValueOnce(undefined);
    await render();
    await enter("30");
    await submit();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(getTranslate("en")("goTo.seekFailed"));
    expect(dialog().textContent).not.toContain("private path");
    expect(onOpenChange).not.toHaveBeenCalled();
    await submit();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("ignores duplicate submissions and does not close a reopened dialog when an old seek settles", async () => {
    let finish!: () => void;
    onGo.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await render();
    await enter("30");
    await submit();
    await submit();
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(go().disabled).toBe(true);
    await render({ open: false });
    await render({ mode: "percentage" });
    await act(async () => finish());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialog().querySelector("input")?.disabled).toBe(false);
  });
  it("closes on Escape once without dismissing underlying panels", async () => {
    await render();
    const parentEscape = vi.fn();
    document.addEventListener("keydown", parentEscape);
    try {
      await act(async () => dialog().querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      })));
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(parentEscape).not.toHaveBeenCalled();
      expect(JSON.parse(dialog().getAttribute("data-tabster") ?? "{}").modalizer).toBeDefined();
    } finally {
      document.removeEventListener("keydown", parentEscape);
    }
  });
  it("resets input on reopen and mode change, recording only dialog state", async () => {
    await render();
    await enter("42");
    expect(record).toHaveBeenCalledExactlyOnceWith({ "go-to": { open: true, mode: "page" } });
    await render({ open: false });
    expect(record).toHaveBeenLastCalledWith({ "go-to": { open: false, mode: "page" } });
    await render();
    expect(dialog().querySelector("input")?.value).toBe("");
    await enter("32");
    await render({ mode: "percentage" });
    expect(dialog().querySelector("input")?.value).toBe("");
    expect(JSON.stringify(record.mock.calls)).not.toContain("42");
  });
  it.each(SUPPORTED_LOCALES)("localizes the new command guide and unavailable dialog in %s", async locale => {
    language.locale = locale;
    const t = getTranslate(locale);
    await render({ isPaginated: false });
    expect(dialog().textContent).toContain(t("goTo.scrollingUnavailable"));
    for (const key of ["shortcuts.goToPage", "shortcuts.goToPercentage", "shortcuts.goToHint",
      "goTo.fixedLayoutUnavailable", "goTo.scrollingUnavailable", "goTo.seekFailed"] as const) {
      expect(t(key)).not.toBe(key);
      if (locale !== "en") expect(t(key)).not.toBe(getTranslate("en")(key));
    }
  });
});
