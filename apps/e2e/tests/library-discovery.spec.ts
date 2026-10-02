import { chromium, expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const BOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/long-content.epub");

async function withLibrary(testInfo: TestInfo, width: number, run: (page: Page, context: BrowserContext) => Promise<void>) {
  const profile = testInfo.outputPath("profile");
  const context = await chromium.launchPersistentContext(profile, {
    headless: process.env.AMBRA_E2E_HEADLESS === "1",
    ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
    viewport: { width, height: width < 600 ? 480 : 900 },
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  try {
    const requests: string[] = [];
    await context.route(/^https?:\/\//, async (route) => { requests.push(route.request().url()); await route.abort(); });
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html${width >= 600 ? "?view=tab" : ""}`);
    await expect(page.getByRole("heading", { name: "No books yet" })).toBeVisible();
    await run(page, context);
    expect(requests, "Discovery must not fetch or prefetch external sites").toEqual([]);
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}

async function expectDiscovery(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Find books", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  for (const [name, href] of [
    ["Standard Ebooks", "https://standardebooks.org/ebooks"],
    ["Project Gutenberg", "https://www.gutenberg.org/ebooks/"],
    ["ReadBeyond", "https://www.readbeyond.it/ebooks.html"],
    ["eBooks.com", "https://www.ebooks.com/drm-free-epub"],
  ]) {
    const link = dialog.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", href!);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(dialog).toContainText("Links open in a new tab");
  await expect(dialog).toContainText("Check each book's license");
  await expect(dialog).toContainText("recorded narration and synchronized text");
  await expect(dialog).toContainText("DRM-free EPUBs available for purchase.");
  await expect(dialog.getByRole("listitem").nth(1)).toContainText("Import book");
  return dialog;
}

test("empty full library keeps normal actions, opens centered discovery and restores focus on Escape", async ({ browserName: _browserName }, info) => {
  await withLibrary(info, 1000, async (page) => {
    const find = page.getByRole("button", { name: "Find books", exact: true });
    await expect(find).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Import book", exact: true })).toHaveCount(1);
    await expect(page.getByRole("contentinfo")).not.toContainText("0 books");
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    await find.click();
    const dialog = await expectDiscovery(page);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 500)).toBeLessThan(2);
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(find).toBeFocused();
    await find.click();
    await expectDiscovery(page);
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
    await expect(find).toBeFocused();
  });
});

for (const width of [320, 360]) {
  test(`${width}px compact discovery opens the full library with the modal already open`, async ({ browserName: _browserName }, info) => {
    await withLibrary(info, width, async (page, context) => {
      const opened = context.waitForEvent("page");
      await page.getByRole("button", { name: "Find books", exact: true }).click();
      const full = await opened;
      await expect(full).toHaveURL(/\?view=tab&discover=1$/);
      await expectDiscovery(full);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open library in new tab", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && scrollY === 0)).toBe(true);
    });
  });
}

test("failed imports retain the single normal Import action, retry succeeds and discovery remains available", async ({ browserName: _browserName }, info) => {
  await withLibrary(info, 1000, async (page) => {
    await page.locator('input[type="file"]').setInputFiles({ name: "invalid.epub", mimeType: "application/epub+zip", buffer: Buffer.from("not an EPUB") });
    await expect(page.getByRole("alert")).toContainText("doesn't look like a valid EPUB");
    await page.getByRole("button", { name: "Find books", exact: true }).click();
    await expectDiscovery(page);
    await page.keyboard.press("Escape");
    await page.getByRole("alert").getByRole("button", { name: "Dismiss", exact: true }).click();
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import book", exact: true }).press("Enter");
    await (await choosing).setFiles(BOOK);
    await expect(page.locator("[data-library-collection] [data-book-open]")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "No books yet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import book", exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Find books", exact: true }).click();
    await expectDiscovery(page);
  });
});
