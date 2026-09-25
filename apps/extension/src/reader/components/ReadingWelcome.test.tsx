import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadingWelcome } from "./ReadingWelcome.js";
import { SUPPORTED_LOCALES, type Locale } from "../../i18n/Locale.js";
import { getTranslate } from "../../i18n/translate.js";

const settings = vi.hoisted(() => ({ locale: "en" as Locale, enabled: true, ready: true }));
vi.mock("../../i18n/LocaleContext.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../i18n/LocaleContext.js")>();
  return { ...actual, useTranslation: () => actual.getTranslate(settings.locale) };
});
vi.mock("../../shortcuts/ShortcutPreferencesContext.js", () => ({
  useShortcutPreferences: () => ({ ready: settings.ready, preferences: { enabled: settings.enabled } }),
}));
let root: Root;
let container: HTMLDivElement;
const dismiss = vi.fn();
const library = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(settings, { locale: "en", enabled: true, ready: true });
  dismiss.mockClear();
  library.mockClear();
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
async function render(scrolling = false, rtl = false, open = true) {
  await act(async () => root.render(<FluentProvider theme={webLightTheme}>
    <ReadingWelcome open={open} scrolling={scrolling} rtl={rtl} onDismiss={dismiss}
      onLibrary={library} onAfterClose={() => {}} />
  </FluentProvider>));
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
it.each(SUPPORTED_LOCALES)("localizes the welcome and its mode/direction-specific tips in %s", async locale => {
  settings.locale = locale;
  const t = getTranslate(locale);
  await render();
  expect(dialog().getAttribute("aria-modal")).toBe("true");
  expect(dialog().querySelector("h2")?.textContent).toBe(t("welcome.title"));
  expect(dialog().querySelector("svg.reading-welcome-art")?.getAttribute("aria-hidden")).toBe("true");
  expect(dialog().textContent).toContain(t("welcome.marginsLtr"));
  expect(dialog().textContent).toContain(t("welcome.keysLtr"));
  expect(dialog().textContent).toContain(t("welcome.library"));
  await render(false, true);
  expect(dialog().textContent).toContain(t("welcome.marginsRtl"));
  expect(dialog().textContent).toContain(t("welcome.keysRtl"));
  await render(true);
  expect(dialog().textContent).toContain(t("welcome.scroll"));
  expect(dialog().textContent).not.toContain(t("welcome.marginsLtr"));
  expect(dialog().textContent).not.toContain(t("welcome.keysLtr"));
});
it.each(["disabled", "loading"])("omits arrow instructions while shortcuts are %s", async state => {
  settings.enabled = state !== "disabled";
  settings.ready = state !== "loading";
  await render();
  expect(dialog().textContent).toContain(getTranslate("en")("welcome.marginsLtr"));
  expect(dialog().textContent).not.toContain(getTranslate("en")("welcome.keysLtr"));
});
it("only dismisses on Start reading, navigates only on Library, and leaves no hidden welcome", async () => {
  await render();
  const buttons = [...dialog().querySelectorAll("button")];
  await act(async () => buttons.find(button => button.textContent === "Start reading")!.click());
  expect(dismiss).toHaveBeenCalledOnce();
  expect(library).not.toHaveBeenCalled();
  await act(async () => buttons.find(button => button.textContent === "Library")!.click());
  expect(library).toHaveBeenCalledOnce();
  await render(false, false, false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector(".reading-welcome-art")).toBeNull();
});
