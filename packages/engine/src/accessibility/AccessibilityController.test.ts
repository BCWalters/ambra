// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityController } from "./AccessibilityController.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("AccessibilityController", () => {
  it("mirrors RTL arrows and chapter arrows, but keeps Space logical", () => {
    const controller = new AccessibilityController();
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onNextChapter = vi.fn();
    const onPreviousChapter = vi.fn();
    controller.attach(document, { onNext, onPrevious, onNextChapter, onPreviousChapter }, { pageProgressionDirection: "rtl" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true }));
    expect(onNextChapter).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", metaKey: true }));
    expect(onPreviousChapter).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", shiftKey: true }));
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledTimes(2);
    controller.detach();
  });
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

    it("ignores keys other than ArrowLeft/ArrowRight/Space", () => {
      const controller = new AccessibilityController();
      const onNext = vi.fn();
      const onPrevious = vi.fn();
      controller.attach(document, { onNext, onPrevious });

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));

      expect(onNext).not.toHaveBeenCalled();
      expect(onPrevious).not.toHaveBeenCalled();
    });

    it("calls onNext for Space and onPrevious for Shift+Space by default", () => {
      const controller = new AccessibilityController();
      const onNext = vi.fn();
      const onPrevious = vi.fn();
      controller.attach(document, { onNext, onPrevious });

      document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", shiftKey: true }));

      expect(onNext).toHaveBeenCalledTimes(1);
      expect(onPrevious).toHaveBeenCalledTimes(1);
    });

    it("does not intercept Space when interceptSpace is false (continuous-scroll content)", () => {
      const controller = new AccessibilityController();
      const onNext = vi.fn();
      const onPrevious = vi.fn();
      controller.attach(document, { onNext, onPrevious }, { interceptSpace: false });

      document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", shiftKey: true }));

      expect(onNext).not.toHaveBeenCalled();
      expect(onPrevious).not.toHaveBeenCalled();
      // Left/Right must still work — only Space is opted out.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      expect(onNext).toHaveBeenCalledTimes(1);
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
