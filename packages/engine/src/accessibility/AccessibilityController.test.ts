// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityController } from "./AccessibilityController.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("AccessibilityController", () => {
  describe("attach", () => {
    it("calls onNext for ArrowRight and onPrevious for ArrowLeft", () => {
      const controller = new AccessibilityController();
      const onNext = vi.fn();
      const onPrevious = vi.fn();
      controller.attach(document, { onNext, onPrevious });

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));

      expect(onNext).toHaveBeenCalledTimes(1);
      expect(onPrevious).toHaveBeenCalledTimes(1);
    });

    it("ignores keys other than ArrowLeft/ArrowRight", () => {
      const controller = new AccessibilityController();
      const onNext = vi.fn();
      const onPrevious = vi.fn();
      controller.attach(document, { onNext, onPrevious });

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));

      expect(onNext).not.toHaveBeenCalled();
      expect(onPrevious).not.toHaveBeenCalled();
    });

    it("replaces a previously attached listener rather than stacking them", () => {
      const controller = new AccessibilityController();
      const firstOnNext = vi.fn();
      const secondOnNext = vi.fn();
      controller.attach(document, { onNext: firstOnNext, onPrevious: vi.fn() });
      controller.attach(document, { onNext: secondOnNext, onPrevious: vi.fn() });

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

      expect(firstOnNext).not.toHaveBeenCalled();
      expect(secondOnNext).toHaveBeenCalledTimes(1);
    });
  });

  describe("detach", () => {
    it("stops calling handlers after detach", () => {
      const controller = new AccessibilityController();
      const onNext = vi.fn();
      controller.attach(document, { onNext, onPrevious: vi.fn() });
      controller.detach();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

      expect(onNext).not.toHaveBeenCalled();
    });

    it("is a no-op when nothing is attached", () => {
      const controller = new AccessibilityController();
      expect(() => controller.detach()).not.toThrow();
    });
  });

  describe("focusContent", () => {
    it("focuses document.body and gives it tabindex=-1 when no target is given", () => {
      document.body.innerHTML = "<p>hello</p>";
      const controller = new AccessibilityController();

      controller.focusContent(document);

      expect(document.body.getAttribute("tabindex")).toBe("-1");
      expect(document.activeElement).toBe(document.body);
    });

    it("focuses the given target element instead of body", () => {
      document.body.innerHTML = "<h1>Chapter 1</h1><p>text</p>";
      const heading = document.body.firstElementChild as HTMLElement;
      const controller = new AccessibilityController();

      controller.focusContent(document, heading);

      expect(heading.getAttribute("tabindex")).toBe("-1");
      expect(document.activeElement).toBe(heading);
    });

    it("doesn't overwrite an existing tabindex", () => {
      document.body.innerHTML = '<button tabindex="0">go</button>';
      const button = document.body.firstElementChild as HTMLElement;
      const controller = new AccessibilityController();

      controller.focusContent(document, button);

      expect(button.getAttribute("tabindex")).toBe("0");
    });
  });
});
