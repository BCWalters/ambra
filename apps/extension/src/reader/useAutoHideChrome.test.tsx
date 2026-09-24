import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoHideChrome, type AutoHideChrome } from "./useAutoHideChrome.js";

let root: Root;
let element: HTMLDivElement;
let chrome: AutoHideChrome;

function Harness({ held = false, activity }: { held?: boolean; activity?: number }) {
  chrome = useAutoHideChrome(held, activity);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("consumes only the first dismissal, synchronously before React renders", () => {
  act(() => {
    expect(chrome.dismissForContent()).toBe(true);
    expect(chrome.dismissForContent()).toBe(false);
  });
  expect(chrome.visible).toBe(false);
});

it.each(["keydown", "resize", "pointermove"])("consumes another click after %s reveals chrome", event => {
  act(() => { chrome.dismissForContent(); });
  act(() => window.dispatchEvent(event === "pointermove"
    ? new PointerEvent(event, { clientY: 5 })
    : new Event(event)));
  expect(chrome.visible).toBe(true);
  act(() => { expect(chrome.dismissForContent()).toBe(true); });
});

it("does not reveal chrome for ordinary reading-area movement", () => {
  act(() => { chrome.dismissForContent(); });
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: window.innerHeight / 2 })));
  act(() => { expect(chrome.dismissForContent()).toBe(false); });
});

it("does not charge a click for an edge reveal queued in the same input turn", () => {
  act(() => { chrome.hide(); });
  act(() => {
    window.dispatchEvent(new PointerEvent("pointermove", { clientY: window.innerHeight - 75 }));
    expect(chrome.dismissForContent()).toBe(false);
  });
  expect(chrome.visible).toBe(false);
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: 5 })));
  expect(chrome.visible).toBe(true);
  act(() => { expect(chrome.dismissForContent()).toBe(true); });
});

it("does not consume clicks for held chrome, including after its hold changes", () => {
  act(() => root.render(<Harness held />));
  act(() => { expect(chrome.dismissForContent()).toBe(false); });
  expect(chrome.visible).toBe(true);
  act(() => root.render(<Harness />));
  act(() => { expect(chrome.dismissForContent()).toBe(true); });
});

it("dismisses despite old toolbar hover/focus before native focus moves into the book", () => {
  act(() => {
    chrome.handlers.onPointerEnter();
    chrome.handlers.onFocus();
    expect(chrome.dismissForContent()).toBe(true);
    expect(chrome.dismissForContent()).toBe(false);
  });
  expect(chrome.visible).toBe(false);
});

it("keeps timer and activity hides synchronized with dismissal", () => {
  act(() => root.render(<Harness activity={0} />));
  expect(chrome.visible).toBe(true);
  act(() => vi.advanceTimersByTime(2500));
  expect(chrome.dismissForContent()).toBe(false);
  act(() => chrome.handlers.onFocus());
  act(() => chrome.handlers.onBlur());
  act(() => root.render(<Harness activity={1} />));
  expect(chrome.visible).toBe(false);
  expect(chrome.dismissForContent()).toBe(false);
});

it("hides with a panel backdrop dismissal without requiring another hide-only click", () => {
  act(() => root.render(<Harness held />));
  act(() => {
    chrome.hide();
    root.render(<Harness />);
  });
  expect(chrome.visible).toBe(false);
  expect(chrome.dismissForContent()).toBe(false);
});

it("removes reveal listeners and timers on unmount", () => {
  const show = vi.spyOn(window, "removeEventListener");
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  for (const type of ["pointermove", "keydown", "resize"]) {
    expect(show).toHaveBeenCalledWith(type, expect.any(Function));
  }
  show.mockRestore();
  root = createRoot(element);
});
