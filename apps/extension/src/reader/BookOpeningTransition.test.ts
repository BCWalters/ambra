import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareBookOpeningTransition } from "./BookOpeningTransition.js";

let container: HTMLDivElement;
let motion: MediaQueryList;
let transition: ReturnType<typeof prepareBookOpeningTransition>;
const animation = Object.assign(new EventTarget(), { cancel: vi.fn() });
const animate = vi.fn(() => animation);
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  vi.spyOn(window, "matchMedia").mockReturnValue(motion);
  vi.spyOn(motion, "matches", "get").mockReturnValue(false);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  animate.mockClear();
  animation.cancel.mockClear();
});

afterEach(() => {
  transition?.cancel();
  container.remove();
  vi.restoreAllMocks();
  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  }
});

it("waits for readiness, fades only the decorative cover, and removes it on completion", () => {
  transition = prepareBookOpeningTransition(container);
  const cover = container.querySelector<HTMLElement>("[data-book-opening]")!;
  expect(cover.getAttribute("aria-hidden")).toBe("true");
  expect(cover.style.pointerEvents).toBe("none");
  expect(cover.style.background).toBe("inherit");
  expect(container.style.opacity).toBe("");
  expect(animate).not.toHaveBeenCalled();
  transition.reveal();
  expect(animate).toHaveBeenCalledExactlyOnceWith(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 180, easing: "ease-out" },
  );
  animation.dispatchEvent(new Event("finish"));
  expect(container.children).toHaveLength(0);
  transition.reveal();
  expect(animate).toHaveBeenCalledTimes(1);
});

it("does not restart an in-flight opening", () => {
  transition = prepareBookOpeningTransition(container);
  transition.reveal();
  transition.reveal();
  expect(animate).toHaveBeenCalledTimes(1);
});

it("keeps content focusable throughout the transition", () => {
  transition = prepareBookOpeningTransition(container);
  const button = document.createElement("button");
  container.append(button);
  button.focus();
  transition.reveal();
  expect(document.activeElement).toBe(button);
  expect(container.hasAttribute("aria-hidden")).toBe(false);
  expect(container.hasAttribute("inert")).toBe(false);
});

it("reveals immediately with reduced motion and cannot replay when the preference changes", () => {
  vi.spyOn(motion, "matches", "get").mockReturnValue(true);
  transition = prepareBookOpeningTransition(container);
  transition.reveal();
  expect(animate).not.toHaveBeenCalled();
  expect(container.children).toHaveLength(0);
  vi.spyOn(motion, "matches", "get").mockReturnValue(false);
  motion.dispatchEvent(new Event("change"));
  transition.reveal();
  expect(animate).not.toHaveBeenCalled();
});

it.each(["motion", "visibility"])("ends the effect immediately on a %s change", (change) => {
  transition = prepareBookOpeningTransition(container);
  transition.reveal();
  if (change === "motion") {
    vi.spyOn(motion, "matches", "get").mockReturnValue(true);
    motion.dispatchEvent(new Event("change"));
  } else {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
  }
  expect(container.children).toHaveLength(0);
  expect(animation.cancel).toHaveBeenCalledOnce();
});

it("skips animation in a background tab", () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  transition = prepareBookOpeningTransition(container);
  transition.reveal();
  expect(animate).not.toHaveBeenCalled();
  expect(container.children).toHaveLength(0);
});

it("cancels an obsolete opening without removing reading content", () => {
  transition = prepareBookOpeningTransition(container);
  const content = document.createElement("iframe");
  container.append(content);
  transition.cancel();
  transition.reveal();
  expect(animate).not.toHaveBeenCalled();
  expect([...container.children]).toEqual([content]);
});
