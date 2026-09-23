import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

// Native DOM evidence, not a claim about VoiceOver's separate virtual cursor.
async function entryState(page: Page) {
  return page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    const position = controller.host?.currentPosition();
    if (!position) return undefined;
    const doc = position.node.ownerDocument as Document;
    const selection = doc.getSelection();
    const textOffset = (node: Node, offset: number) => {
      const range = doc.createRange();
      range.selectNodeContents(doc.body);
      range.setEnd(node, offset);
      return range.toString().length;
    };
    return {
      focusedAtPage: doc.activeElement !== doc.body && doc.activeElement?.contains(position.node),
      caretAtPage: selection?.anchorNode != null &&
        textOffset(selection.anchorNode, selection.anchorOffset) === textOffset(position.node, position.offset ?? 0),
      exposedFrame: doc.defaultView?.frameElement?.getAttribute("aria-hidden") !== "true",
      bodyScrollTop: doc.scrollingElement?.scrollTop ?? 0,
      focusOutline: doc.activeElement && doc.defaultView?.getComputedStyle(doc.activeElement).outlineStyle,
      offset: position.offset ?? 0,
      textBoundary: position.node.nodeType === Node.TEXT_NODE,
      pageIndex: controller.snapshot().pageIndex,
    };
  });
}

for (const { width, midParagraph } of [
  { width: 900, midParagraph: false },
  { width: 1400, midParagraph: false },
  { width: 900, midParagraph: true },
  { width: 1400, midParagraph: true },
]) {
  test(`${width}px ${midParagraph ? "mid-paragraph" : "paragraph-boundary"} reading entry focuses the displayed page and exact native text offset`, async () => {
    const book = midParagraph ? path.join(path.dirname(fixture), "reading-entry.epub") : fixture;
    const { context, readerPage: page } = await launchReader(book, { viewport: { width, height: 900 } });
    try {
      await exposeReaderController(page);
      await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 0);
      await page.evaluate(() => Reflect.get(window, "__readerController").seekToFraction(0.55));
      await expect.poll(async () => (await entryState(page))?.focusedAtPage).toBe(true);
      await expect.poll(async () => (await entryState(page))?.caretAtPage).toBe(true);
      expect((await entryState(page))?.exposedFrame).toBe(true);
      expect((await entryState(page))?.bodyScrollTop).toBe(0);
      expect((await entryState(page))?.focusOutline).toBe("none");
      const position = (await entryState(page))!;
      expect(position.pageIndex).toBeGreaterThan(0);
      if (midParagraph) {
        expect(position.textBoundary).toBe(true);
        expect(position.offset).toBeGreaterThan(0);
      }

      await page.mouse.move(350, 2);
      await page.getByRole("button", { name: "Book details", exact: true }).click();
      await page.getByRole("button", { name: "Close book details panel", exact: true }).click();
      await expect.poll(async () => (await entryState(page))?.caretAtPage).toBe(true);
      expect((await entryState(page))?.pageIndex).toBe(position.pageIndex);
      expect((await entryState(page))?.focusOutline).toBe("none");

      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc = controller.host.currentPosition().node.ownerDocument;
        const selection = doc.getSelection();
        const node = selection.anchorNode;
        const offset = Math.min(selection.anchorOffset + 2, node.nodeType === 3 ? node.textContent.length : node.childNodes.length);
        selection.collapse(node, offset);
        Reflect.set(window, "__retainedCaret", { node, offset });
        window.dispatchEvent(new Event("focus"));
      });
      expect(await page.evaluate(() => {
        const retained = Reflect.get(window, "__retainedCaret");
        const selection = retained.node.ownerDocument.getSelection();
        return selection.anchorNode === retained.node && selection.anchorOffset === retained.offset;
      })).toBe(true);

      await page.reload();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("iframe")].some(frame => frame.contentDocument?.body?.querySelector("p")),
      );
      await exposeReaderController(page);
      await expect.poll(async () => (await entryState(page))?.focusedAtPage).toBe(true);
      await expect.poll(async () => (await entryState(page))?.caretAtPage).toBe(true);
      expect((await entryState(page))?.pageIndex).toBe(position.pageIndex);
      expect((await entryState(page))?.focusOutline).toBe("none");
    } finally {
      await context.close();
    }
  });
}

test("reading-entry focus leaves a keyboard-reachable link's indicator intact", async () => {
  const { context, readerPage: page } = await launchReader(fixture);
  try {
    await exposeReaderController(page);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.restoreContentFocus();
      const doc: Document = controller.host.currentPosition().node.ownerDocument;
      const paragraph = doc.activeElement!;
      const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "a");
      link.setAttribute("href", "#reference");
      link.setAttribute("id", "keyboard-reference");
      link.setAttribute("style", "outline: 3px solid red");
      link.textContent = "Reference";
      paragraph.appendChild(link);
      Reflect.set(window, "__readingFocusTarget", paragraph);
    });
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => {
      const paragraph: Element = Reflect.get(window, "__readingFocusTarget");
      const doc = paragraph.ownerDocument;
      const link = doc.getElementById("keyboard-reference")!;
      const style = doc.defaultView!.getComputedStyle(link);
      return {
        linkFocused: doc.activeElement === link,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        readingFocusRemoved: !paragraph.hasAttribute("data-ambra-reading-focus") && !paragraph.hasAttribute("tabindex"),
      };
    })).toEqual({
      linkFocused: true,
      outlineStyle: "solid",
      outlineWidth: "3px",
      readingFocusRemoved: true,
    });
  } finally {
    await context.close();
  }
});

test("returning to reading preserves the text selection and canonical location", async () => {
  const { context, readerPage: page } = await launchReader(fixture);
  try {
    await exposeReaderController(page);
    expect(await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const position = controller.host.currentPosition();
      const doc = position.node.ownerDocument;
      const paragraph = doc.querySelector("p");
      const text = paragraph.firstChild;
      const selection = doc.getSelection();
      selection.setBaseAndExtent(text, 20, text, 5);
      const selected = selection.toString();
      const before = controller.locatorResolver.generate(controller.spineIndex, text, 5).cfi;
      controller.restoreContentFocus();
      return selection.toString() === selected && selection.anchorOffset === 20 &&
        selection.focusOffset === 5 &&
        controller.locatorResolver.generate(controller.spineIndex, text, 5).cfi === before;
    })).toBe(true);
  } finally {
    await context.close();
  }
});
