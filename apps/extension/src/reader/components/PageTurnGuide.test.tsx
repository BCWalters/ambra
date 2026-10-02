import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageTurnGuide } from "./PageTurnGuide.js";
import type { ReaderController } from "../ReaderController.js";

vi.mock("../../i18n/LocaleContext.js", () => ({ useTranslation: () => (key: string) => key }));
vi.mock("../ChromeThemeContext.js", () => ({
  useChromeTheme: () => ({ accentForeground: "#345", backgroundSolid: "#fff" }),
}));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../usePrefersReducedMotion.js", () => ({ usePrefersReducedMotion: () => motion.reduced }));
let root: Root;
let element: HTMLDivElement;
let navigate: () => void;
let measure: () => void;
let rtl = false;
const geometry = { left: 0, right: 1000, top: 80, height: 700, leftWidth: 140, rightWidth: 140 };
const controller = {
  subscribeNavigation: vi.fn((listener: () => void) => { navigate = listener; return vi.fn(); }),
  subscribe: vi.fn((listener: () => void) => { measure = listener; return vi.fn(); }),
  pageTurnGuideGeometry: vi.fn(() => ({ ...geometry })),
  snapshot: () => ({ pageProgressionDirection: rtl ? "rtl" : "ltr" }),
} as unknown as ReaderController;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  motion.reduced = false;
  rtl = false;
  geometry.leftWidth = 140;
  geometry.rightWidth = 140;
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("settles once, survives resize, disappears on navigation and only replays on a new welcome run", () => {
  act(() => root.render(<PageTurnGuide controller={controller} hidden={false} />));
  expect(element.querySelector("[data-phase]")?.getAttribute("data-phase")).toBe("highlight");
  act(() => vi.advanceTimersByTime(2999));
  expect(element.querySelector("[data-phase]")?.getAttribute("data-phase")).toBe("highlight");
  act(() => vi.advanceTimersByTime(1));
  expect(element.querySelector("[data-phase]")?.getAttribute("data-phase")).toBe("indicators");
  geometry.leftWidth = 30;
  act(() => measure());
  expect(element.querySelector('[data-side="left"]')?.textContent).toBe("");
  expect(element.querySelector('[data-side="left"]')?.getAttribute("style")).toContain("width: 30px");
  geometry.leftWidth = 8;
  act(() => measure());
  expect(element.querySelector('[data-side="left"] .page-turn-guide-wash')).not.toBeNull();
  expect(element.querySelector('[data-side="left"] .page-turn-guide-indicator')).toBeNull();
  act(() => navigate());
  expect(element.childElementCount).toBe(0);
  act(() => root.render(<PageTurnGuide controller={controller} hidden={false} />));
  expect(element.childElementCount).toBe(0);
  act(() => root.render(<PageTurnGuide key="reopened-welcome" controller={controller} hidden={false} />));
  expect(element.querySelector("[data-phase]")).not.toBeNull();
});
it("respects reduced motion and reading direction; hidden overlays still observe navigation", () => {
  motion.reduced = true;
  rtl = true;
  act(() => root.render(<PageTurnGuide controller={controller} hidden={false} />));
  expect(element.querySelector("[data-phase]")?.getAttribute("data-phase")).toBe("indicators");
  expect(element.querySelector('[data-side="left"]')?.getAttribute("data-direction")).toBe("next");
  act(() => root.render(<PageTurnGuide controller={controller} hidden />));
  expect(element.childElementCount).toBe(0);
  act(() => navigate());
  act(() => root.render(<PageTurnGuide controller={controller} hidden={false} />));
  expect(element.childElementCount).toBe(0);
});
