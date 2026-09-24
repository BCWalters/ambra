import { chromium, expect, test } from "@playwright/test";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.resolve(here, "../fixtures/long-content.epub");
const SECOND_BOOK = path.resolve(here, "../fixtures/two-chapter.epub");

async function withLibrary(
  testInfo: TestInfo,
  viewport: { width: number; height: number },
  run: (page: Page, context: BrowserContext) => Promise<void>,
) {
  const profile = testInfo.outputPath("profile");
  const context = await chromium.launchPersistentContext(profile, {
    headless: process.env.AMBRA_E2E_HEADLESS === "1",
    ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
    viewport,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  try {
    const externalRequests: string[] = [];
    await context.route(/^https?:\/\//, async (route) => {
      externalRequests.push(route.request().url());
      await route.abort();
    });
    await context.setOffline(true);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const page = await context.newPage();
    await page.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html${viewport.width >= 600 ? "?view=tab" : ""}`);
    await expect(page.getByRole("heading", { name: "What will you read first?" })).toBeVisible();
    await run(page, context);
    expect(
      externalRequests,
      "Discovery must not fetch, scrape, or prefetch remote book sites",
    ).toEqual([]);
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}

async function expectDiscovery(page: Page, importLabel = "Import EPUB") {
  const discovery = page.getByRole("region", { name: "Find your next read" });
  await expect(discovery).toBeVisible();
  for (const [name, href] of [
    ["Project Gutenberg", "https://www.gutenberg.org/ebooks/"],
    ["Standard Ebooks", "https://standardebooks.org/ebooks"],
    ["ReadBeyond", "https://www.readbeyond.it/ebooks.html"],
  ]) {
    const link = discovery.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(discovery).toContainText("Links open in a new tab");
  await expect(discovery).toContainText("recorded narration and synchronized text");
  await expect(discovery).toContainText("Check each book's license");
  await expect(discovery.getByRole("listitem").first()).toContainText(
    "EPUB download (not Kindle or PDF)",
  );
  await expect(discovery.getByRole("listitem").nth(1)).toContainText("If it downloads instead");
  await expect(discovery.getByRole("listitem").nth(1)).toContainText(importLabel);
  await expect(discovery.getByRole("listitem").nth(1)).toContainText(".epub");
  await expect(discovery).toContainText("Advanced epub");
  await expect(discovery).toContainText("EPUB or EPUB3");
  await expect(discovery).toContainText("not “Read+Listen”");
}

test("a failed first import retains both choices and the import card retries with a local EPUB", async ({
  browserName: _browserName,
}, testInfo) => {
  await withLibrary(testInfo, { width: 1000, height: 1050 }, async (page) => {
    await page.getByRole("button", { name: "Find your next book Explore free books" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "invalid.epub",
      mimeType: "application/epub+zip",
      buffer: Buffer.from("not an EPUB"),
    });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Oh snickerdoodles, something went wrong.");
    await expectDiscovery(page, "Choose EPUB files...");
    await page.screenshot({
      path: testInfo.outputPath("invalid-first-import.png"),
      fullPage: true,
    });
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await expect(alert).toBeHidden();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Bring a book Choose EPUB files..." }).press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles(BOOK);
    await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Find books", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(alert).toBeHidden();
  });
});

test("empty library offers equal cards, on-demand discovery and keyboard import without network", async ({
  browserName: _browserName,
}, testInfo) => {
  await withLibrary(testInfo, { width: 1000, height: 900 }, async (page) => {
    const discovery = page.getByRole("region", { name: "Find your next read" });
    await expect(discovery).toBeHidden();
    await expect(page.getByRole("toolbar").getByRole("button", { name: "Import EPUB", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sort library" })).toHaveCount(0);
    await expect(page.getByRole("toolbar").getByRole("button")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Find books", exact: true })).toHaveCount(0);
    const importFirst = page.getByRole("button", { name: "Bring a book Choose EPUB files..." });
    const explore = page.getByRole("button", { name: "Find your next book Explore free books" });
    const left = (await importFirst.boundingBox())!;
    const right = (await explore.boundingBox())!;
    expect(right.x).toBeGreaterThan(left.x);
    expect(right.y).toBe(left.y);
    expect(right.width).toBe(left.width);
    expect(right.height).toBe(left.height);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath("empty-library-desktop.png"), fullPage: true });
    await importFirst.focus();
    expect(await importFirst.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
    await page.keyboard.press("Tab");
    await expect(explore).toBeFocused();
    await explore.press("Enter");
    await expect(explore).toHaveAttribute("aria-expanded", "true");
    await expect(explore).toBeFocused();
    await expectDiscovery(page, "Choose EPUB files...");
    await expect(importFirst).toBeVisible();
    expect((await discovery.boundingBox())!.y).toBeGreaterThan(right.y + right.height);
    await expect(discovery).toHaveAttribute("id", (await explore.getAttribute("aria-controls"))!);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Standard Ebooks", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Project Gutenberg", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "ReadBeyond", exact: true })).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath("empty-library-desktop-expanded.png"),
      fullPage: true,
    });
    await explore.focus();
    await explore.press("Space");
    await expect(discovery).toBeHidden();
    await expect(explore).toBeFocused();

    await importFirst.focus();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles(BOOK);
    await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Import EPUB", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "Sort library" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Read now:/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Find your next read" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Find books", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

test("Find books stays available after imports and expands only on request with Enter and Space", async ({
  browserName: _browserName,
}, testInfo) => {
  await withLibrary(testInfo, { width: 1000, height: 800 }, async (page) => {
    await page.locator('input[type="file"]').setInputFiles(BOOK);
    const findBooks = page.getByRole("button", { name: "Find books", exact: true });
    await expect(findBooks).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: "Project Gutenberg", exact: true })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("one-book-collapsed.png"), fullPage: true });
    await findBooks.focus();
    await page.keyboard.press("Enter");
    await expect(findBooks).toHaveAttribute("aria-expanded", "true");
    await expectDiscovery(page);
    const panelId = await findBooks.getAttribute("aria-controls");
    await expect(page.getByRole("region", { name: "Find your next read" })).toHaveAttribute(
      "id",
      panelId!,
    );
    await expect(findBooks).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Standard Ebooks", exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("one-book-expanded.png"), fullPage: true });
    await findBooks.focus();
    await page.keyboard.press("Space");
    await expect(findBooks).toHaveAttribute("aria-expanded", "false");
    await expect(findBooks).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /^Open / }).first()).toBeFocused();

    await page.locator('input[type="file"]').setInputFiles(SECOND_BOOK);
    await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(2);
    await expect(findBooks).toHaveAttribute("aria-expanded", "false");
    await findBooks.click();
    await expectDiscovery(page);
    await page.reload();
    await expect(findBooks).toHaveAttribute("aria-expanded", "false");

    for (let remaining = 2; remaining > 0; remaining--) {
      const remove = page.getByRole("button", { name: /^Remove .* from library$/ }).first();
      await remove.focus();
      await remove.press("Enter");
      await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(remaining - 1);
    }
    await expect(page.getByRole("region", { name: "Find your next read" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "What will you read first?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import EPUB", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Find your next book Explore free books" }).click();
    await expectDiscovery(page, "Choose EPUB files...");
  });
});

test("discovery fits a narrow library popup without horizontal scrolling", async ({
  browserName: _browserName,
}, testInfo) => {
  await withLibrary(testInfo, { width: 360, height: 600 }, async (page) => {
    const bring = page.getByRole("button", { name: "Bring a book Choose EPUB files..." });
    const explore = page.getByRole("button", { name: "Find your next book Explore free books" });
    const firstCard = (await bring.boundingBox())!;
    const secondCard = (await explore.boundingBox())!;
    expect(secondCard.y).toBeGreaterThan(firstCard.y + firstCard.height);
    expect(secondCard.x).toBe(firstCard.x);
    await expect(page.getByRole("toolbar").getByRole("button")).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("empty-library-narrow.png"), fullPage: true });
    await explore.click();
    await expectDiscovery(page, "Choose EPUB files...");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    const first = await page
      .getByRole("link", { name: "Standard Ebooks", exact: true })
      .boundingBox();
    const second = await page
      .getByRole("link", { name: "Project Gutenberg", exact: true })
      .boundingBox();
    expect(second!.y).toBeGreaterThan(first!.y);
    await page.screenshot({
      path: testInfo.outputPath("empty-library-narrow-expanded.png"),
      fullPage: true,
    });
    await page.locator('input[type="file"]').setInputFiles(BOOK);
    await page.getByRole("button", { name: "Find books", exact: true }).click();
    await expectDiscovery(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({
      path: testInfo.outputPath("one-book-narrow-expanded.png"),
      fullPage: true,
    });
  });
});
