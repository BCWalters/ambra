import { test, expect, type JSHandle, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";

const twoChapter = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const longContent = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const notAnEpub = fileURLToPath(new URL("../../../README.md", import.meta.url));
const twoChapterTitle = "Ambra Two-Chapter Spread Test Fixture";
const longContentTitle = "Ambra Long Content Test Fixture";

async function fileTransfer(page: Page, paths: string[], invalid = false): Promise<JSHandle<DataTransfer>> {
  const files = await Promise.all(paths.map(async (file) => ({
    name: file.split("/").at(-1)!,
    bytes: [...await fs.readFile(file)],
  })));
  return page.evaluateHandle(({ files, invalid }) => {
    const data = new DataTransfer();
    if (invalid) data.items.add(new File(["Not a book"], "notes.txt", { type: "text/plain" }));
    for (const file of files) data.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: "application/epub+zip" }));
    return data;
  }, { files, invalid });
}

async function dispatch(page: Page, selector: string, type: string, dataTransfer: JSHandle<DataTransfer>,
  position = { clientX: 100, clientY: 100 }): Promise<boolean> {
  return page.locator(selector).first().evaluate((element, { type, dataTransfer, position }) => {
    const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, ...position });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, { type, dataTransfer, position });
}

async function nativeFileDrop(page: Page, files: string[]): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const box = (await page.locator("main").boundingBox())!;
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ["dragEnter", "dragOver", "drop"] as const) {
      await session.send("Input.dispatchDragEvent", { type, x: box.x + 20, y: box.y + 20, data });
    }
  } finally {
    await session.detach();
  }
}

test.describe("Library file drop", () => {

  test("imports an ordered multi-file drop through the standard pipeline, including invalid-file feedback", async () => {
    const { context, libraryPage: page, readerPage } = await launchReader(twoChapter);
    try {
      await readerPage.close();
      await page.goto(`${page.url()}?view=tab`);
      await page.bringToFront();
      await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeEnabled();
      const originalUrl = page.url();
      const batch = await fileTransfer(page, [longContent, twoChapter], true);
      const overlay = page.locator("[data-library-file-drop]");
      const cover = "[data-book-open]";
      try {
        expect(await dispatch(page, "main", "dragenter", batch)).toBe(true);
        await expect(overlay).toContainText("Drop EPUB files to import");
        expect(await dispatch(page, cover, "dragenter", batch)).toBe(true);
        await dispatch(page, "main", "dragleave", batch);
        await expect(overlay).toBeVisible();
        expect(await dispatch(page, cover, "dragover", batch)).toBe(true);
        await expect(overlay).toHaveCSS("pointer-events", "none");
        await nativeFileDrop(page, [notAnEpub, longContent, twoChapter]);
        await expect(overlay).toHaveCount(0);
        const error = page.getByRole("alert");
        await expect(error).toContainText(getTranslate("en")("error.invalidEpubHeadline"));
        const collection = page.locator("[data-library-collection]");
        await expect(collection.locator("[data-library-book]")).toHaveCount(2);
        await expect(page.getByRole("button", { name: `Open ${longContentTitle}`, exact: true })).toBeVisible();
        await expect(collection.getByRole("button", { name: `Open ${twoChapterTitle}`, exact: true })).toBeVisible();
        await expect(page.getByTestId("library-import-status").getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
        await expect(page.getByTestId("library-import-status")).toContainText(
          getTranslate("en")("library.importAlreadyPresent", { fileName: twoChapterTitle }),
        );
        expect(page.url()).toBe(originalUrl);
        await page.reload();
        await expect(collection.locator("[data-library-book]")).toHaveCount(2);

        const picker = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Import book", exact: true }).focus();
        await page.keyboard.press("Enter");
        await (await picker).setFiles(longContent);
        await expect(page.getByTestId("library-import-status").getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
        await expect(collection.locator("[data-library-book]")).toHaveCount(2);
      } finally {
        await batch.dispose();
      }
    } finally {
      await context.close();
    }
  });

  test("native Chromium file drops cannot navigate or start another import while busy", async () => {
    const { context, libraryPage: page, readerPage } = await launchReader(twoChapter);
    try {
      await readerPage.close();
      await page.goto(`${page.url()}?view=tab`);
      await page.bringToFront();
      await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeEnabled();
      await page.evaluate(() => {
        const arrayBuffer = File.prototype.arrayBuffer;
        const hold = new Promise<void>((resolve) => { Reflect.set(window, "__releaseDropImport", resolve); });
        File.prototype.arrayBuffer = async function () {
          File.prototype.arrayBuffer = arrayBuffer;
          await hold;
          return arrayBuffer.call(this);
        };
        document.addEventListener("dragover", (event) => {
          Reflect.set(window, "__nativeDragPrevented", event.isTrusted && event.defaultPrevented);
        });
      });
      await page.locator('input[type="file"]').setInputFiles(longContent);
      await expect(page.getByTestId("library-import-status")).toContainText("long-content.epub");
      const url = page.url();
      await nativeFileDrop(page, [twoChapter]);
      expect(await page.evaluate(() => Reflect.get(window, "__nativeDragPrevented"))).toBe(true);
      expect(page.url()).toBe(url);
      await expect(page.locator("[data-library-file-drop]")).toHaveCount(0);
      await expect(page.getByTestId("library-import-status")).not.toContainText(twoChapterTitle);
      await page.evaluate(() => Reflect.get(window, "__releaseDropImport")());
      await expect(page.locator("[data-library-collection] [data-library-book]")).toHaveCount(2);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(page.url()).toBe(url);
    } finally {
      await context.close();
    }
  });

  test("supports compact drops, ignores plain links, clears cancelled drags, and fits narrow/dark/forced-colors Library", async () => {
    const { context, libraryPage: page, readerPage } = await launchReader(twoChapter);
    try {
      await readerPage.close();
      await page.bringToFront();
      const overlay = page.locator("[data-library-file-drop]");
      const popupFiles = await fileTransfer(page, [longContent]);
      try {
        expect(await dispatch(page, "main", "dragenter", popupFiles)).toBe(true);
        expect(await dispatch(page, "main", "dragover", popupFiles)).toBe(true);
        await expect(overlay).toBeVisible();
        await nativeFileDrop(page, [longContent]);
        await expect(page.getByRole("button", { name: `Open ${longContentTitle}`, exact: true })).toBeVisible();
        await expect(overlay).toHaveCount(0);
      } finally {
        await popupFiles.dispose();
      }
      await page.goto(`${page.url()}?view=tab`);
      await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeEnabled();
      const files = await fileTransfer(page, [longContent]);
      const text = await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.setData("text/uri-list", "https://example.org/book.epub");
        data.setData("text/plain", "A book link");
        return data;
      });
      try {
        for (const type of ["dragenter", "dragover", "drop"]) {
          expect(await dispatch(page, "main", type, text)).toBe(false);
          await expect(overlay).toHaveCount(0);
        }
        for (const end of ["dragleave", "dragend"]) {
          await dispatch(page, "main", "dragenter", files);
          await expect(overlay).toBeVisible();
          await dispatch(page, "html", end, files, { clientX: 0, clientY: 0 });
          await expect(overlay).toHaveCount(0);
        }
        await page.setViewportSize({ width: 320, height: 640 });
        await page.emulateMedia({ colorScheme: "dark" });
        await dispatch(page, "main", "dragenter", files);
        await expect(overlay).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath("library-drop-dark-narrow.png") });
        await page.emulateMedia({ forcedColors: "active" });
        await expect(overlay).toHaveCSS("border-top-style", "dashed");
        await page.screenshot({ path: test.info().outputPath("library-drop-forced-colors.png") });
        await page.keyboard.press("Escape");
        await expect(overlay).toHaveCount(0);
      } finally {
        await files.dispose();
        await text.dispose();
      }
    } finally {
      await context.close();
    }
  });

  test("in-reader compact Library imports drops without covering or navigating the book", async () => {
    const { context, readerPage: page } = await launchReader(twoChapter, { viewport: { width: 1000, height: 800 } });
    try {
      await page.bringToFront();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      const panel = page.locator("[data-ambra-library-panel]");
      const collection = panel.locator("[data-library-collection]");
      await expect(collection.locator("[data-book-open]")).toHaveCount(1);
      const files = await fileTransfer(page, [longContent]);
      try {
        const selector = "[data-ambra-library-panel] [data-library-collection]";
        await dispatch(page, selector, "dragenter", files);
        const overlay = panel.locator("[data-library-file-drop]");
        await expect(overlay).toBeVisible();
        const bounds = (await panel.boundingBox())!;
        const overlayBounds = (await overlay.boundingBox())!;
        expect(overlayBounds.x).toBeGreaterThanOrEqual(bounds.x);
        expect(overlayBounds.x + overlayBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(overlayBounds.y).toBeGreaterThanOrEqual(bounds.y);
        expect(overlayBounds.y + overlayBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
        const url = page.url();
        await dispatch(page, selector, "drop", files);
        await expect(collection.getByRole("button", { name: `Open ${longContentTitle}`, exact: true })).toBeVisible();
        await expect(overlay).toHaveCount(0);
        expect(page.url()).toBe(url);
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
        expect(await dispatch(page, "body", "dragover", files)).toBe(false);
        await expect(page.locator("[data-library-file-drop]")).toHaveCount(0);
      } finally { await files.dispose(); }
    } finally { await context.close(); }
  });
});
