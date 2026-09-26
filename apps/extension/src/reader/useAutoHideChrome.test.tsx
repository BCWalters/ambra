import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoHideChrome, type AutoHideChrome } from "./useAutoHideChrome.js";

let root: Root;
let element: HTMLDivElement;
let chrome: AutoHideChrome;

function Harness({ held = false, activity }: { held?: boolean; activity?: number }) {
  chrome = useAutoHideChrome(held, activity);
  return <div ref={chrome.handlers.ref} style={{ opacity: chrome.visible ? 1 : 0 }} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  act(() => root.render(<Harness />));
  (element.firstElementChild as HTMLElement).getBoundingClientRect =
    () => new DOMRect(0, 0, 800, 50);
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

it.each(["dialog", "toolbar", "menu", "listbox", "region", "tooltip"])(
  "leaves pointer and keyboard activity in another %s surface to that surface",
  role => {
    const surface = document.createElement("div");
    surface.setAttribute("role", role);
    const child = document.createElement("span");
    surface.append(child);
    document.body.append(surface);
    act(() => chrome.hide());
    for (const y of [12, window.innerHeight - 12]) {
      act(() => child.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientY: y })));
      expect(chrome.visible).toBe(false);
    }
    act(() => child.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" })));
    expect(chrome.visible).toBe(false);
    surface.remove();
    act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: 5 })));
    expect(chrome.visible).toBe(true);
  },
);

it("checks the composed ownership path for shadow descendants and a popup dismissed by Escape", () => {
  const surface = document.createElement("div");
  surface.setAttribute("role", "dialog");
  const child = document.createElement("span");
  surface.attachShadow({ mode: "open" }).append(child);
  document.body.append(surface);
  act(() => chrome.hide());
  act(() => child.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true, clientY: 5 })));
  expect(chrome.visible).toBe(false);
  surface.addEventListener("keydown", () => surface.remove(), { once: true });
  act(() => child.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true, key: "Escape" })));
  expect(surface.isConnected).toBe(false);
  expect(chrome.visible).toBe(false);
});

it("keeps registered chrome controls and their keyboard focus reveal available", () => {
  const surface = element.firstElementChild as HTMLElement;
  surface.setAttribute("role", "toolbar");
  const button = document.createElement("button");
  surface.append(button);
  act(() => chrome.hide());
  act(() => button.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientY: 5 })));
  expect(chrome.visible).toBe(true);
  act(() => chrome.hide());
  act(() => button.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" })));
  expect(chrome.visible).toBe(true);
  act(() => chrome.hide());
  act(() => chrome.handlers.onFocus());
  expect(chrome.visible).toBe(true);
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

it("does not consume a committed reveal whose opacity is still zero", () => {
  act(() => { chrome.hide(); });
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: 5 })));
  expect(chrome.visible).toBe(true);
  (element.firstElementChild as HTMLElement).style.opacity = "0";
  act(() => { expect(chrome.dismissForContent()).toBe(false); });
  expect(chrome.visible).toBe(false);
});

it("does not re-reveal dismissed chrome for repeated edge taps while it fades", () => {
  act(() => { expect(chrome.dismissForContent()).toBe(true); });
  (element.firstElementChild as HTMLElement).style.opacity = "0.8";
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: window.innerHeight - 75 })));
  expect(chrome.visible).toBe(false);
  act(() => { expect(chrome.dismissForContent()).toBe(false); });
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: window.innerHeight / 2 })));
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: 5 })));
  expect(chrome.visible).toBe(true);
});

it("reveals actual controls and keyboard focus immediately after a content dismissal", () => {
  const surface = element.firstElementChild as HTMLElement;
  surface.getBoundingClientRect = () => new DOMRect(0, 0, 800, 50);
  act(() => { chrome.dismissForContent(); });
  act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 20 })));
  expect(chrome.visible).toBe(true);
  act(() => { chrome.dismissForContent(); });
  act(() => { chrome.handlers.onFocus(); });
  expect(chrome.visible).toBe(true);
});

it("consumes even a partially visible reveal, including the other chrome surface", () => {
  (element.firstElementChild as HTMLElement).style.opacity = "0";
  const scrubber = document.createElement("div");
  scrubber.style.opacity = "0.01";
  element.append(scrubber);
  const cleanup = chrome.handlers.ref?.(scrubber);
  act(() => { expect(chrome.dismissForContent()).toBe(true); });
  if (typeof cleanup === "function") cleanup();
  scrubber.remove();
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
