import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

test("embedded annotation classification treats escaped commas as assertion data", async () => {
  const { context, readerPage: page } = await launchReader(book);
  try {
    await exposeReaderController(page);
    const annotations = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.embeddedAnnotations = [{
        id: "escaped-id",
        target: {
          source: controller.pkg.spine[0].manifestItem.path,
          selector: [{ type: "FragmentSelector", value: "epubcfi(/6/4!/4/2[id^,comma]/1:0)" }],
        },
      }];
      return controller.listEmbeddedAnnotations();
    });
    expect(annotations).toMatchObject([{ id: "escaped-id", kind: "bookmark", cfi: "epubcfi(/6/4!/4/2[id^,comma]/1:0)" }]);
  } finally {
    await context.close();
  }
});

test("failed bookmark deletion preserves the panel, page marker, and stored record", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 900, height: 900 } });
  try {
    await exposeReaderController(page);
    await page.getByRole("button", { name: "Bookmark this page" }).click();
    await page.getByRole("button", { name: "Bookmarks and highlights" }).click();
    const remove = page.getByRole("button", { name: /^Remove bookmark:/ });
    await expect(remove).toHaveCount(1);
    await page.evaluate(() => {
      const library = Reflect.get(window, "__readerController").library;
      const original = library.removeBookmarks.bind(library);
      Reflect.set(window, "__restoreBookmarkWrites", () => { library.removeBookmarks = original; });
      library.removeBookmarks = async () => { throw new DOMException("Simulated rollback", "AbortError"); };
    });
    await remove.click();
    await expect(page.getByText(/Simulated rollback/)).toBeVisible();
    await expect(remove).toHaveCount(1);
    expect(await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      return {
        cached: controller.snapshot().bookmarks.length,
        marked: controller.snapshot().isBookmarked,
        stored: (await controller.library.listBookmarksForBook(controller.bookId)).length,
      };
    })).toEqual({ cached: 1, marked: true, stored: 1 });

    await page.evaluate(() => Reflect.get(window, "__restoreBookmarkWrites")());
    await remove.click();
    await expect(remove).toHaveCount(0);
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().isBookmarked)).toBe(false);
  } finally {
    await context.close();
  }
});

test("concurrent highlight edits publish the same committed fields as IndexedDB", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 900, height: 900 } });
  try {
    await exposeReaderController(page);
    const result = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const doc = document.querySelector("iframe")!.contentDocument!;
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector("p")!);
      controller.pendingSelectionRange = range;
      await controller.addHighlight("yellow");
      const id = controller.snapshot().highlights[0].id;
      await Promise.all([
        controller.setHighlightNote(id, "Keep both edits"),
        controller.setHighlightStyle(id, "green"),
      ]);
      const cached = controller.snapshot().highlights[0];
      const stored = (await controller.library.listHighlightsForBook(controller.bookId))[0];
      return { cached: { note: cached.note, style: cached.style }, stored: { note: stored.note, style: stored.style } };
    });
    expect(result).toEqual({
      cached: { note: "Keep both edits", style: "green" },
      stored: { note: "Keep both edits", style: "green" },
    });
  } finally {
    await context.close();
  }
});
