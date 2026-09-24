// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityController } from "./AccessibilityController.js";

beforeEach(() => {
  document.body.innerHTML = "";
  document.getSelection()?.removeAllRanges();
  vi.spyOn(document, "addEventListener");
});

afterEach(() => {
  for (const [type, listener, options] of vi.mocked(document.addEventListener).mock.calls) {
    document.removeEventListener(type, listener, options);
  }
  vi.restoreAllMocks();
});

describe("AccessibilityController", () => {
  it("lets an app handler replace legacy navigation and cleans up reattachments for every document", () => {
    const controller = new AccessibilityController();
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const keyboardHandler = vi.fn();
    const second = document.implementation.createHTMLDocument();
    for (const doc of [document, second]) {
      controller.attach(doc, { onNext, onPrevious }, { keyboardHandler });
      controller.attach(doc, { onNext, onPrevious }, { keyboardHandler });
      doc.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    }
    expect(keyboardHandler).toHaveBeenCalledTimes(2);
    expect(onNext).not.toHaveBeenCalled();
    controller.detach(second);
    second.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(keyboardHandler).toHaveBeenCalledTimes(2);
    controller.detach();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(keyboardHandler).toHaveBeenCalledTimes(2);
  });
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
      expect(heading.hasAttribute("data-ambra-reading-focus")).toBe(true);
      expect(document.activeElement).toBe(heading);
    });

    it("cleans up reader-owned focus after an explicit chapter target loses focus", () => {
      document.body.innerHTML = '<div id="chapter"><h2>Chapter 2</h2></div><button>Continue</button>';
      const target = document.getElementById("chapter")!;
      new AccessibilityController().focusContent(document, target);
      expect(target.hasAttribute("data-ambra-reading-focus")).toBe(true);
      document.querySelector("button")!.focus();
      expect(target.hasAttribute("data-ambra-reading-focus")).toBe(false);
      expect(target.hasAttribute("tabindex")).toBe(false);
    });

    it("makes an href-less chapter anchor focusable without suppressing linked anchors", () => {
      document.body.innerHTML = '<h2><a id="chapter"></a>Chapter</h2><a href="#chapter">Reference</a>';
      const chapter = document.getElementById("chapter")!;
      const link = document.querySelector("a[href]")!;
      const controller = new AccessibilityController();
      controller.focusContent(document, chapter);
      expect(document.activeElement).toBe(chapter);
      expect(chapter.hasAttribute("data-ambra-reading-focus")).toBe(true);
      controller.focusContent(document, link);
      expect(document.activeElement).toBe(link);
      expect(link.hasAttribute("tabindex")).toBe(false);
      expect(link.hasAttribute("data-ambra-reading-focus")).toBe(false);
    });

    it("doesn't overwrite an existing tabindex", () => {
      document.body.innerHTML = '<button tabindex="0">go</button>';
      const button = document.body.firstElementChild as HTMLElement;
      const controller = new AccessibilityController();

      controller.focusContent(document, button);

      expect(button.getAttribute("tabindex")).toBe("0");
    });

    describe("focusReadingPosition", () => {
      it("focuses the visible text's element and sets an exact native caret without changing text", () => {
        document.body.innerHTML = "<p>Earlier page.</p><p id='visible'>Earlier line. The visible line starts here.</p>";
        const paragraph = document.getElementById("visible")!;
        const text = paragraph.firstChild!;
        const content = document.body.textContent;
        const focus = vi.spyOn(paragraph as HTMLElement, "focus");
        new AccessibilityController().focusReadingPosition(document, { node: text, offset: 14 });
        expect(document.activeElement).toBe(paragraph);
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        expect(document.getSelection()?.anchorNode).toBe(text);
        expect(document.getSelection()?.anchorOffset).toBe(14);
        expect(document.getSelection()?.isCollapsed).toBe(true);
        expect(document.body.textContent).toBe(content);
        expect(paragraph.firstChild).toBe(text);
        expect(paragraph.childNodes).toHaveLength(1);
      });

      it("marks only temporary reading focus and cleans it up on blur, including after repeated entry", () => {
        document.body.innerHTML = "<p>Reading text.</p><button>Continue</button>";
        const paragraph = document.querySelector("p")!;
        const controller = new AccessibilityController();
        const position = { node: paragraph.firstChild!, offset: 3 };
        controller.focusReadingPosition(document, position);
        controller.focusReadingPosition(document, position);
        expect(paragraph.hasAttribute("data-ambra-reading-focus")).toBe(true);
        expect(paragraph.getAttribute("tabindex")).toBe("-1");
        document.querySelector("button")!.focus();
        expect(paragraph.hasAttribute("data-ambra-reading-focus")).toBe(false);
        expect(paragraph.hasAttribute("tabindex")).toBe(false);
        controller.focusReadingPosition(document, position);
        expect(paragraph.hasAttribute("data-ambra-reading-focus")).toBe(true);
        expect(document.activeElement).toBe(paragraph);
      });

      it.each([
        '<a href="#reference">Reference</a>',
        "<button>Continue</button>",
        '<p tabindex="0">Scrollable text</p>',
        '<p tabindex="-1">Authored focus target</p>',
        '<p role="button">Custom control</p>',
        '<p contenteditable="true">Editable text</p>',
      ])("preserves authored focus indicators for %s", markup => {
        document.body.innerHTML = markup;
        const target = document.body.firstElementChild!;
        const tabindex = target.getAttribute("tabindex");
        new AccessibilityController().focusReadingPosition(document, { node: target.firstChild!, offset: 0 });
        expect(target.hasAttribute("data-ambra-reading-focus")).toBe(false);
        if (tabindex !== null || target.matches("a, button")) {
          expect(target.getAttribute("tabindex")).toBe(tabindex);
        }
      });

      it("preserves an existing backward text selection instead of moving to the page boundary", () => {
        document.body.innerHTML = "<p>Page beginning.</p><p id='selection'>Keep this selected text.</p>";
        const paragraph = document.getElementById("selection")!;
        const text = paragraph.firstChild!;
        const selection = document.getSelection()!;
        selection.setBaseAndExtent(text, 18, text, 5);
        const selectedText = selection.toString();
        new AccessibilityController().focusReadingPosition(document, { node: document.body.firstChild!, offset: 0 });
        expect(document.activeElement).toBe(paragraph);
        expect(selection.toString()).toBe(selectedText);
        expect(selection.anchorNode).toBe(text);
        expect(selection.anchorOffset).toBe(18);
        expect(selection.focusNode).toBe(text);
        expect(selection.focusOffset).toBe(5);
      });

      it("resolves an element child boundary without jumping to earlier siblings", () => {
        document.body.innerHTML = "<p id='visible'><em>Earlier text.</em>Visible text.</p>";
        const paragraph = document.getElementById("visible")!;
        document.getSelection()?.removeAllRanges();
        new AccessibilityController().focusReadingPosition(document, { node: paragraph, offset: 1 });
        expect(document.getSelection()?.anchorNode).toBe(paragraph.childNodes[1]);
        expect(document.getSelection()?.anchorOffset).toBe(0);
      });

      it("rejects detached or foreign-document positions", () => {
        const controller = new AccessibilityController();
        expect(() => controller.focusReadingPosition(document, { node: document.createTextNode("detached") }))
          .toThrow("current content document");
        const other = document.implementation.createHTMLDocument();
        expect(() => controller.focusReadingPosition(document, { node: other.body }))
          .toThrow("current content document");
      });
    });
  });
});
