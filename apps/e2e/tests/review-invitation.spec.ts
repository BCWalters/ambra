import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { SUPPORTED_LOCALES, type Locale } from "../../extension/src/i18n/Locale.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";

const book = fileURLToPath(new URL("../fixtures/reading-entry.epub", import.meta.url));
const enabled = process.env.VITE_AMBRA_LOCAL_FEATURES === "1";

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ambra-library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await Promise.all(["books", "readingProgress", "preferences"].map(name =>
        new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })));
    } finally { db.close(); }
  });
}

test("review simulation is isolated, dismissible, responsive and absent from release builds", async () => {
  const { context, libraryPage: page, readerPage } = await launchReader(book);
  try {
    await readerPage.close();
    await page.goto(`${page.url()}?view=tab`);
    await page.bringToFront();
    if (!enabled) {
      await expect(page.locator("[data-prototype-controls]")).toHaveCount(0);
      await expect(page.locator("[data-review-invitation]")).toHaveCount(0);
      return;
    }
    const before = await snapshot(page);
    await page.getByText("Local prototype controls", { exact: true }).click();
    await page.getByRole("button", { name: "Simulate new reader", exact: true }).click();
    await expect(page.locator("[data-review-invitation]")).toHaveCount(0);
    await page.getByRole("button", { name: "Simulate eligible reader", exact: true }).click();
    const invitation = page.getByRole("region", { name: "Share your experience with Ambra" });
    await expect(invitation).toBeVisible();
    await expect(invitation.getByRole("link", { name: "Write a review", exact: true }))
      .toHaveAttribute("href", /chromewebstore\.google\.com\/.*\/reviews$/);
    await expect(invitation.getByRole("link", { name: "Send feedback", exact: true }))
      .toHaveAttribute("href", "https://github.com/BCWalters/ambra/issues/new/choose");
    await page.getByRole("button", { name: "Reading Entry details", exact: true }).first().click();
    await expect(invitation).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(invitation).toBeVisible();
    for (const width of [1200, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await invitation.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`review-${width}.png`) });
    }
    await invitation.getByRole("button", { name: "No thanks", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Reset simulated invitation", exact: true }).click();
    await expect(invitation).toBeVisible();
    await page.getByRole("button", { name: "Use real eligibility", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before);
    await page.getByRole("button", { name: "Simulate eligible reader", exact: true }).click();
    let locale: Locale = "en";
    for (const next of SUPPORTED_LOCALES) {
      const t = getTranslate(locale);
      await page.getByRole("button", { name: t("settings.ambraTitle"), exact: true }).click();
      await page.getByRole("combobox", { name: t("settings.language"), exact: true }).selectOption(next);
      await page.keyboard.press("Escape");
      locale = next;
      const translated = getTranslate(locale);
      const localized = page.getByRole("region", { name: translated("review.title") });
      await expect(localized.getByRole("link", { name: translated("review.write"), exact: true })).toBeVisible();
      await expect(localized.getByRole("link", { name: translated("review.feedback"), exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await context.close(); }
});

test("real reading eligibility counts changed positions and invites once across Library tabs", async () => {
  test.skip(!enabled, "Local feature prototype build required");
  const { context, libraryPage: page, readerPage } = await launchReader(book);
  try {
    await exposeReaderController(readerPage);
    const state = await readerPage.evaluate(async () => {
      const db = Reflect.get(window, "__readerController").library;
      const now = Date.now;
      try {
        Date.now = () => new Date(2026, 9, 1, 12).getTime();
        await db.saveProgress("review-test", "first", 0);
        await db.saveProgress("review-test", "first", 0.5);
        const unchanged = await db.getReviewInvitation();
        await db.saveProgress("review-test", "second", 0.49);
        await db.saveProgress("review-test", "third", 0.5);
        Date.now = () => new Date(2026, 9, 2, 12).getTime();
        await db.saveProgress("review-test", "fourth", 0.7);
        const twoDays = await db.getReviewInvitation();
        Date.now = () => new Date(2026, 9, 3, 12).getTime();
        await db.saveProgress("review-test", "fifth", 0.8);
        const eligible = await db.getReviewInvitation();
        return { unchanged, twoDays, eligible };
      } finally { Date.now = now; }
    });
    expect(state.unchanged.days).toEqual([]);
    expect(state.twoDays.days).toHaveLength(2);
    expect(state.eligible).toMatchObject({ days: ["2026-10-01", "2026-10-02", "2026-10-03"],
      reachedHalf: true, presented: false });
    await readerPage.close();
    await expect(page.locator("[data-review-invitation]")).toHaveCount(0);
    await page.goto(`${page.url()}?view=tab`);
    await page.bringToFront();
    const invitation = page.locator("[data-review-invitation]");
    await expect(invitation).toBeVisible();
    await invitation.getByRole("button", { name: "No thanks" }).click();
    await page.reload();
    await expect(page.locator("[data-prototype-controls]")).toBeVisible();
    await expect(invitation).toHaveCount(0);
    const other = await context.newPage();
    await other.goto(page.url());
    await expect(other.locator("[data-prototype-controls]")).toBeVisible();
    await expect(other.locator("[data-review-invitation]")).toHaveCount(0);
  } finally { await context.close(); }
});
