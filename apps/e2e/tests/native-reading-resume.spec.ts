import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clickReadingPage, launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

// These tests exercise real DOM Selection/focus; they do not emulate VoiceOver's spoken cursor.
for (const width of [900, 1400]) {
  test(`${width}px persists a native off-page caret through flush, reflow, reload and subsequent page navigation`, async () => {
    const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"),
      { viewport: { width, height: 900 } });
    try {
      await exposeReaderController(page);
      const expected = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const view = controller.contentDocumentViews()[0];
        const paragraphs = view.document.querySelectorAll("p");
        const node = paragraphs[Math.floor(paragraphs.length * 0.6)].firstChild;
        view.document.defaultView.frameElement.focus();
        view.document.getSelection().collapse(node, 7);
        const expected = controller.locatorResolver.generate(view.spineIndex, node, 7).cfi;
        await controller.flushProgress();
        return { expected, actual: (await controller.library.getProgress(controller.bookId)).cfi };
      });
      expect(expected.actual).toBe(expected.expected);
      await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const button = document.querySelector("button")!;
        button.focus();
        await controller.flushProgress();
        await controller.setFontScale(1.1);
        await controller.flushProgress();
      });
      expect(await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        return (await controller.library.getProgress(controller.bookId)).cfi;
      })).toBe(expected.expected);
      await page.reload();
      await page.waitForFunction(() => [...document.querySelectorAll("iframe")]
        .some(frame => frame.contentDocument?.body?.querySelector("p")));
      await exposeReaderController(page);
      await expect.poll(() => page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        if (!controller?.host || controller.isLoadInFlight) return "";
        await controller.flushProgress();
        return (await controller.library.getProgress(controller.bookId)).cfi;
      })).toBe(expected.expected);
      expect(await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const view = controller.contentDocumentViews().find((view: { document: Document }) =>
          view.document.defaultView?.frameElement === document.activeElement);
        const selection = view.document.getSelection();
        return controller.locatorResolver.generate(view.spineIndex, selection.anchorNode, selection.anchorOffset).cfi;
      })).toBe(expected.expected);
      await clickReadingPage(page, "right");
      await expect.poll(() => page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        return (await controller.library.getProgress(controller.bookId)).cfi;
      })).not.toBe(expected.expected);
      const navigated = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const position = controller.host.currentPosition();
        const visual = controller.locatorResolver.generate(controller.spineIndex, position.node, position.offset).cfi;
        return { actual: (await controller.library.getProgress(controller.bookId)).cfi, visual };
      });
      expect(navigated.actual).toBe(navigated.visual);
      expect(await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        return (await controller.library.getProgress(controller.bookId)).cfi;
      })).not.toBe(expected.expected);
    } finally {
      await context.close();
    }
  });
}

test("ordinary scrolling replaces an old native caret with the visual resume position", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    await exposeReaderController(page);
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.setViewMode("scroll");
      const view = controller.contentDocumentViews()[0];
      const node = view.document.querySelectorAll("p")[2].firstChild;
      view.document.defaultView.frameElement.focus();
      view.document.getSelection().collapse(node, 7);
      await controller.flushProgress();
      Reflect.set(window, "__oldNativeCfi", (await controller.library.getProgress(controller.bookId)).cfi);
    });
    await page.mouse.move(450, 450);
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.flushProgress();
      return (await controller.library.getProgress(controller.bookId)).cfi;
    })).not.toBe(await page.evaluate(() => Reflect.get(window, "__oldNativeCfi")));
    expect(await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const position = controller.host.currentPosition();
      const visual = controller.locatorResolver.generate(controller.spineIndex, position.node, position.offset).cfi;
      return (await controller.library.getProgress(controller.bookId)).cfi === visual;
    })).toBe(true);
  } finally {
    await context.close();
  }
});

test("scrolling away and back without flushing does not revive an old native caret", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    await exposeReaderController(page);
    const initial = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.setViewMode("scroll");
      const position = controller.host.currentPosition();
      const visual = controller.locatorResolver.generate(controller.spineIndex, position.node, position.offset).cfi;
      const doc = controller.contentDocumentViews()[0].document;
      const node = doc.querySelectorAll("p")[2].firstChild;
      doc.defaultView.frameElement.focus();
      doc.getSelection().collapse(node, 7);
      await controller.flushProgress();
      return {
        visual, native: (await controller.library.getProgress(controller.bookId)).cfi,
        scrollTop: doc.scrollingElement.scrollTop,
      };
    });
    expect(initial.native).not.toBe(initial.visual);
    await page.mouse.move(450, 450);
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      return controller.contentDocumentViews()[0].document.scrollingElement.scrollTop;
    })).toBeGreaterThan(initial.scrollTop + 100);
    await page.mouse.wheel(0, -1000);
    await expect.poll(() => page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      return controller.contentDocumentViews()[0].document.scrollingElement.scrollTop;
    })).toBe(initial.scrollTop);
    expect(await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.flushProgress();
      return (await controller.library.getProgress(controller.bookId)).cfi;
    })).toBe(initial.visual);
  } finally {
    await context.close();
  }
});

test("an already-visible companion chapter's native focus is persisted and restored", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "chained-single-page-chapters.epub"),
    { viewport: { width: 1400, height: 900 } });
  try {
    await exposeReaderController(page);
    const result = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const views = controller.contentDocumentViews();
      const companion = views.find((view: { spineIndex: number }) => view.spineIndex !== controller.spineIndex);
      if (!companion) throw new Error("Fixture must expose a cross-chapter spread.");
      controller.focusReadingContent(companion.document);
      const selection = companion.document.getSelection();
      const expected = controller.locatorResolver.generate(
        companion.spineIndex, selection.anchorNode, selection.anchorOffset,
      ).cfi;
      await controller.flushProgress();
      return { expected, actual: (await controller.library.getProgress(controller.bookId)).cfi };
    });
    expect(result.actual).toBe(result.expected);
    await page.reload();
    await page.waitForFunction(() => [...document.querySelectorAll("iframe")]
      .some(frame => frame.contentDocument?.body?.querySelector("p")));
    await exposeReaderController(page);
    await expect.poll(() => page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      if (!controller?.host || controller.isLoadInFlight) return "";
      await controller.flushProgress();
      return (await controller.library.getProgress(controller.bookId)).cfi;
    })).toBe(result.expected);
  } finally {
    await context.close();
  }
});
