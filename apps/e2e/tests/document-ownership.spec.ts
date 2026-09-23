import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/chained-single-page-chapters.epub");

test("cross-chapter spread annotations keep their owning document for creation, clicks, and notes", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await exposeReaderController(page);
    const target = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const views = controller.host.documentViews();
      if (views.length !== 2 || views[0].spineIndex === views[1].spineIndex) {
        throw new Error("Fixture must open on a cross-chapter spread");
      }
      const first = views[0];
      const range = first.document.createRange();
      range.selectNodeContents(first.document.querySelector("p")!);
      controller.pendingSelectionRange = range;
      await controller.addHighlight("yellow");
      const highlight = controller.snapshot().highlights[0];
      await controller.setHighlightNote(highlight.id, "Earlier page note");
      const rect = range.getClientRects()[0];
      const frame = first.document.defaultView.frameElement.getBoundingClientRect();
      return {
        id: highlight.id, owner: first.spineIndex, storedOwner: highlight.spineIndex,
        x: frame.left + rect.left + 5, y: frame.top + rect.top + rect.height / 2,
      };
    });
    expect(target.storedOwner).toBe(target.owner);
    await page.mouse.click(target.x, target.y);
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().activeHighlight?.highlight.id)).toBe(target.id);
    expect(await page.evaluate(id => {
      const controller = Reflect.get(window, "__readerController");
      controller.dismissActiveHighlight();
      controller.openHighlightPopup(id);
      return controller.snapshot().activeHighlight?.highlight.id;
    }, target.id)).toBe(target.id);
  } finally {
    await context.close();
  }
});
