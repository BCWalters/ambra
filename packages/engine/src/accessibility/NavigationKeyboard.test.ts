// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessibilityController } from "./AccessibilityController.js";
import { isInteractiveContentTarget, navigationCommand } from "./NavigationKeyboard.js";

const controller = new AccessibilityController();
afterEach(() => {
  controller.detach();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function press(target: EventTarget, key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

describe("pointer content ownership", () => {
  it("protects SVG links using legacy xlink href attributes", () => {
    document.body.innerHTML = '<svg><a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#target"><rect/></a></svg>';
    expect(isInteractiveContentTarget(document.querySelector("rect")!)).toBe(true);
  });

  it("honors inherited editing and explicit noneditable subtrees", () => {
    document.body.innerHTML = '<div contenteditable="plaintext-only"><p>Editable</p><div contenteditable="false"><img/></div></div>';
    expect(isInteractiveContentTarget(document.querySelector("p")!)).toBe(true);
    expect(isInteractiveContentTarget(document.querySelector("img")!)).toBe(false);
  });
});

describe("navigation keyboard policy", () => {
  it.each([
    '<input />',
    '<textarea></textarea>',
    '<select><option>One</option></select>',
    '<div contenteditable><span tabindex="0">Editable</span></div>',
    '<div contenteditable="plaintext-only"><span tabindex="0">Editable</span></div>',
    '<div contenteditable><span contenteditable="invalid"><b tabindex="0">Editable</b></span></div>',
    '<div role="dialog"><button>Action</button></div>',
    '<div role="radiogroup"><button role="radio">Choice</button></div>',
  ])("leaves native controls and editing alone: %s", markup => {
    document.body.innerHTML = markup;
    const target = Array.from(document.body.querySelectorAll("*")).at(-1)!;
    const next = vi.fn();
    controller.attach(document, { onNext: next, onPrevious: next, onNextChapter: next });
    for (const key of ["ArrowRight", " "]) {
      expect(press(target, key).defaultPrevented).toBe(false);
      expect(press(target, key, { ctrlKey: true }).defaultPrevented).toBe(false);
    }
    expect(next).not.toHaveBeenCalled();
  });

  it.each(["button", "summary", "a", "div"])("preserves Space activation on %s", tag => {
    const element = document.createElement(tag);
    if (tag === "a") element.setAttribute("href", "#target");
    if (tag === "div") element.setAttribute("role", "button");
    document.body.append(element);
    const next = vi.fn();
    controller.attach(document, { onNext: next, onPrevious: next });
    expect(press(element, " ").defaultPrevented).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it("preserves arrows on overflowing pre blocks, even at their scroll boundary", () => {
    const pre = document.createElement("pre");
    pre.style.overflowX = "auto";
    Object.defineProperties(pre, { scrollWidth: { value: 400 }, clientWidth: { value: 100 } });
    document.body.append(pre);
    const next = vi.fn();
    controller.attach(document, { onNext: next, onPrevious: next });
    expect(press(pre, "ArrowRight").defaultPrevented).toBe(false);
    expect(press(pre, "ArrowLeft").defaultPrevented).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it("honors claimed events, composing, browser modifiers, and selection keys", () => {
    const next = vi.fn();
    controller.attach(document, { onNext: next, onPrevious: next });
    const claimed = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    claimed.preventDefault();
    expect(navigationCommand(claimed, document)).toBeUndefined();
    for (const options of [{ altKey: true }, { isComposing: true }, { shiftKey: true }]) {
      expect(press(document, "ArrowRight", options).defaultPrevented).toBe(false);
    }
    expect(press(document, " ", { metaKey: true }).defaultPrevented).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not consume chapter shortcuts when no chapter handler exists", () => {
    controller.attach(document, { onNext: vi.fn(), onPrevious: vi.fn() });
    expect(press(document, "ArrowRight", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("exempts shell panels without disabling navigation inside book asides", () => {
    const aside = document.createElement("aside");
    document.body.append(aside);
    const next = vi.fn();
    controller.attach(document, { onNext: next, onPrevious: next }, { scope: "shell" });
    expect(press(aside, "ArrowRight").defaultPrevented).toBe(false);
    controller.attach(document, { onNext: next, onPrevious: next }, { scope: "content" });
    expect(press(aside, "ArrowRight").defaultPrevented).toBe(true);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows navigation inside an explicitly noneditable subtree", () => {
    document.body.innerHTML = '<div contenteditable><div contenteditable="false"><p>Book text</p></div></div>';
    const next = vi.fn();
    controller.attach(document, { onNext: next, onPrevious: next });
    expect(press(document.querySelector("p")!, "ArrowRight").defaultPrevented).toBe(true);
    expect(next).toHaveBeenCalledOnce();
  });
});
