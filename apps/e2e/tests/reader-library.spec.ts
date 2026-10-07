import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const otherBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const currentTitle = "Ambra Two-Chapter Spread Test Fixture";
const otherTitle = "Ambra Long Content Test Fixture";

for (const width of [360, 1000]) {
  test(`${width}px: Library is a left overlay, retains its state, and shares reference-panel ownership`, async () => {
    const { context, readerPage: page } = await launchReader(book, { viewport: { width, height: 800 } });
    try {
      const originalUrl = page.url();
      const panel = page.locator("[data-ambra-library-panel]");
      await expect(panel).toHaveCount(0);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(panel.locator("[data-library-continue]")).toHaveCount(0);
      await expect(panel.getByRole("button", { name: "Find & sort", exact: true })).toHaveAttribute("aria-expanded", "false");
      await expect(panel.getByRole("searchbox")).toBeHidden();
      await expect(panel.locator("header").getByRole("button", { name: "Open library in new tab", exact: true })).toBeVisible();
      await expect(panel.locator("footer").getByRole("button", { name: "Find books", exact: true })).toBeVisible();
      await expect(panel.locator("footer").getByRole("button", { name: "Import book", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Hide library", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Hide library", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page.getByRole("button", { name: "Library", exact: true })).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(panel.getByRole("button", { name: `Open ${currentTitle}`, exact: true })).toBeVisible();
      const bounds = (await panel.boundingBox())!;
      expect(bounds.x).toBe(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const toggle = panel.getByRole("button", { name: "Find & sort", exact: true });
      await toggle.click();
      const search = panel.getByRole("searchbox", { name: "Search library", exact: true });
      await expect(search).toBeFocused();
      await search.fill("Two-Chapter");
      await search.press("Escape");
      await expect(search).toHaveValue("");
      await expect(panel).toBeVisible();
      await search.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(panel).toBeVisible();
      await toggle.press("Escape");
      await expect(panel).toBeHidden();
      await page.mouse.move(10, 2);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await panel.getByRole("button", { name: `Open ${currentTitle}`, exact: true }).click();
      await expect(panel).toBeHidden();
      expect(page.url()).toBe(originalUrl);
      await expect(panel).toHaveCount(1);
      await page.mouse.move(10, 2);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page.getByRole("button", { name: "Contents", exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page.getByRole("navigation", { name: "Table of contents", exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("another book replaces this reader tab only after a successful position checkpoint", async () => {
  const { context, readerPage: page, libraryPage } = await launchReader(book);
  try {
    await libraryPage.locator('input[type="file"]').setInputFiles(otherBook);
    await expect(libraryPage.getByRole("button", { name: `Open ${otherTitle}`, exact: true })).toBeVisible();
    await page.bringToFront();
    await exposeReaderController(page);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const flush = controller.flushProgress.bind(controller);
      let failNextExplicitCheckpoint = true;
      controller.flushProgress = async (strict = false) => {
        if (strict && failNextExplicitCheckpoint) {
          failNextExplicitCheckpoint = false;
          throw new Error("Reading position checkpoint failed");
        }
        return flush(strict);
      };
    });
    const originalUrl = page.url();
    const pageCount = context.pages().length;
    await page.getByRole("button", { name: "Library", exact: true }).click();
    const panel = page.locator("[data-ambra-library-panel]");
    const target = panel.getByRole("button", { name: `Open ${otherTitle}`, exact: true });
    await target.click();
    await expect(page.getByRole("status").filter({ hasText: "Reading position checkpoint failed" })).toBeVisible();
    expect(page.url()).toBe(originalUrl);
    await expect(panel).toBeVisible();
    await target.click();
    await page.waitForURL(url => url.href !== originalUrl && url.searchParams.has("bookId"));
    await expect(page.locator("iframe").first()).toBeVisible();
    await expect(page).toHaveTitle(otherTitle);
    expect(context.pages()).toHaveLength(pageCount);
    await page.goBack();
    await expect(page.locator("iframe").first()).toBeVisible();
    expect(new URL(page.url()).searchParams.get("bookId")).toBe(new URL(originalUrl).searchParams.get("bookId"));
  } finally {
    await context.close();
  }
});
