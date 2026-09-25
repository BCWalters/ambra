// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessibilityController } from "./AccessibilityController.js";

afterEach(() => vi.restoreAllMocks());

describe("native SVG reading focus", () => {
  function svgDocument() {
    return new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" aria-labelledby="title description"><title id="title">Accessible page</title><desc id="description">Original geometric test.</desc><defs/><text x="10" y="40">Text remains in the native DOM</text></svg>',
      "image/svg+xml",
    );
  }

  it("uses the SVG document root when no HTML body exists", () => {
    const doc = svgDocument();
    const focus = vi.spyOn(doc.querySelector("svg")!, "focus");
    new AccessibilityController().focusContent(doc);
    expect(doc.body).toBeNull();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(doc.documentElement.getAttribute("tabindex")).toBe("-1");
    expect(doc.documentElement.getAttribute("aria-labelledby")).toBe("title description");
    expect(doc.querySelector("title")?.textContent).toBe("Accessible page");
  });

  it("does not move entry focus/caret into non-rendered SVG metadata", () => {
    const doc = svgDocument();
    const controller = new AccessibilityController();
    const focus = vi.spyOn(controller, "focusContent");
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    const collapse = vi.spyOn(selection, "collapse");
    vi.spyOn(doc, "getSelection").mockReturnValue(selection);
    controller.focusReadingPosition(doc, { node: doc.documentElement, offset: 0 });
    expect(focus).toHaveBeenCalledWith(doc, doc.documentElement);
    expect(collapse).toHaveBeenCalledWith(doc.documentElement, 0);
    expect(doc.querySelector("title")?.hasAttribute("tabindex")).toBe(false);
  });
});
