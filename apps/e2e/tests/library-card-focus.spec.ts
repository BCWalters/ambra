import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = path.resolve(here, "../fixtures/reading-entry.epub");
const secondBook = path.resolve(here, "../fixtures/long-content.epub");

test.describe("Library book focus and safe removal", () => {
  test.skip(process.env.AMBRA_E2E_HEADLESS !== "1", "Requires isolated headless Chromium");

  test("direct details remain keyboard reachable after reader-tab return and removal restores displayed order", async () => {
    const { context, libraryPage: page, readerPage } = await launchReader(book);
    try {
      await page.locator('input[type="file"]').setInputFiles(secondBook);
      await readerPage.close();
      const first = page.getByRole("button", { name: /^Open Reading Entry/ });
      const second = page.getByRole("button", { name: /^Open Ambra Long Content Test Fixture/ });
      await expect(second).toBeVisible();
      const opened = context.waitForEvent("page");
      await first.click();
      const reader = await opened;
      await reader.waitForLoadState("domcontentloaded");
      await page.bringToFront();
      await first.focus();
      await page.keyboard.press("Tab");
      const details = page.getByRole("button", { name: "Reading Entry details", exact: true });
      await expect(details).toBeFocused();
      await expect(details).toHaveCSS("outline-style", "solid");
      await details.press("Enter");
      const metadata = page.getByRole("dialog", { name: "Book details", exact: true });
      await expect(metadata).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(details).toBeFocused();
      await page.getByRole("button", { name: "Sort library", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Title (A–Z)", exact: true }).click();
      await second.press("Delete");
      const confirm = page.getByRole("alertdialog", { name: "Remove from library?", exact: true });
      await expect(confirm).toContainText("Ambra Long Content Test Fixture");
      await expect(confirm).toContainText("original EPUB");
      await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(confirm).toBeHidden();
      await expect(second).toBeFocused();
      await second.press("Backspace");
      await confirm.getByRole("button", { name: "Remove from library", exact: true }).click();
      await expect(second).toHaveCount(0);
      await expect(first).toBeFocused();
      const search = page.getByRole("searchbox", { name: "Search library", exact: true });
      await search.fill("Reading");
      await search.press("Backspace");
      await expect(confirm).toHaveCount(0);
      await first.press("Control+Delete");
      await expect(confirm).toHaveCount(0);
    } finally { await context.close(); }
  });

  test("long generated titles reserve aligned rows, preserve accessible names and keep useful details", async () => {
    const { context, libraryPage: page, readerPage } = await launchReader(book, { viewport: { width: 360, height: 480 } });
    const title = "UnbrokenBookTitle".repeat(100);
    const creator = "長い著者".repeat(100);
    try {
      await exposeReaderController(readerPage);
      await readerPage.evaluate(async ({ title, creator }) => {
        const controller = Reflect.get(window, "__readerController");
        const library = controller.library;
        const stored = await library.getBookMetadata(controller.bookId);
        if (!stored) throw new Error("Fixture book metadata not found");
        await new Promise<void>((resolve, reject) => {
          const transaction = library.db.transaction(["books", "bookCovers"], "readwrite");
          transaction.objectStore("books").put({ ...stored, title, creator });
          transaction.objectStore("bookCovers").delete(controller.bookId);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      }, { title, creator });
      await page.reload();
      const cover = page.getByRole("button", { name: new RegExp(`^Open ${title}`) });
      const card = cover.locator("..");
      const coverTitle = cover.locator("span span");
      await expect(coverTitle).toHaveText(title);
      await expect(coverTitle).toHaveCSS("-webkit-line-clamp", "4");
      await expect(card.locator("p").first()).toHaveCSS("height", "40px");
      const author = card.locator("p").nth(1);
      await expect(author).toHaveText(creator);
      await expect(author).toHaveCSS("height", "18px");
      await expect(author).toHaveCSS("white-space", "nowrap");
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await cover.focus();
      await page.keyboard.press("Tab");
      const details = page.getByRole("button", { name: `${title} details`, exact: true });
      await expect(details).toBeFocused();
      await expect(details).toHaveCSS("outline-style", "solid");
      await details.press("Enter");
      const metadata = page.getByRole("dialog", { name: "Book details", exact: true });
      await expect(metadata.getByText(title, { exact: true })).toHaveText(title);
      const more = metadata.getByRole("button", { name: "Show more: Creator", exact: true });
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await more.click();
      await expect(metadata.getByRole("button", { name: "Show less: Creator", exact: true }))
        .toHaveAttribute("aria-expanded", "true");
      await expect(metadata.getByText(creator, { exact: true })).toHaveText(creator);
    } finally { await context.close(); }
  });
});
