import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { SUPPORTED_LOCALES, type Locale } from "../../extension/src/i18n/Locale.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";
import { REVIEW_REMINDER_DELAY } from "../../extension/src/library/ReviewInvitation.js";
import type { LibraryDatabase } from "../../extension/src/library/LibraryDatabase.js";

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

test("review modal simulation covers every response, cooldown, focus and release gating without touching storage", async () => {
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
    const invitation = page.getByRole("dialog", { name: "Are you loving Ambra?", exact: true });
    await expect(invitation).toBeVisible();
    await expect(invitation).toHaveAttribute("aria-modal", "true");
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(invitation).toBeVisible();
    for (const width of [1200, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await invitation.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`review-${width}.png`) });
    }
    await invitation.getByRole("button", { name: "Not sure yet", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Simulate 3 days later", exact: true }).click();
    await expect(invitation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(invitation).toHaveCount(0);
    await page.getByRole("button", { name: "Simulate 3 days later", exact: true }).click();
    await invitation.getByRole("button", { name: "Yes, I love it!", exact: true }).click();
    const positive = page.getByRole("dialog", { name: "That's great!", exact: true });
    await expect(positive.getByRole("link", { name: "Write a review", exact: true })).toBeFocused();
    await expect(positive.getByRole("link", { name: "Write a review", exact: true }))
      .toHaveAttribute("href", /chromewebstore\.google\.com\/.*\/reviews$/);
    await expect(positive.getByRole("link", { name: "Write a review", exact: true })).toHaveClass(/fui-Button/);
    await expect(positive.locator("p").filter({ hasText: /^Thank you for reading with Ambra\.$/ })).toBeVisible();
    await expect(positive.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
    for (const width of [320, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: test.info().outputPath(`review-thanks-${width}.png`) });
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Simulate 3 days later", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    await page.getByRole("button", { name: "Reset simulated invitation", exact: true }).click();
    await invitation.getByRole("button", { name: "Not really", exact: true }).click();
    const negative = page.getByRole("dialog", { name: "Help us improve Ambra", exact: true });
    await expect(negative).toContainText("Sorry to hear that! Click below to send us an email if you have any suggestions to improve Ambra.");
    const feedback = negative.getByRole("link", { name: "Share feedback by email", exact: true });
    await expect(feedback).toHaveAttribute("href", "mailto:AmbraEPUB@outlook.com");
    await expect(feedback).toHaveClass(/fui-Button/);
    await expect(feedback).toBeFocused();
    expect(await feedback.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await expect(negative.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
    for (const width of [320, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: test.info().outputPath(`feedback-${width}.png`) });
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Simulate 3 days later", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    await page.getByRole("button", { name: "Use real eligibility", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before);
  } finally { await context.close(); }
});

test("review modal and both follow-ups fit all nine locales at narrow widths", async () => {
  test.skip(!enabled, "Local feature prototype build required");
  const { context, libraryPage: page, readerPage } = await launchReader(book);
  try {
    await readerPage.close();
    await page.goto(`${page.url()}?view=tab`);
    await page.bringToFront();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByText("Local prototype controls", { exact: true }).click();
    let locale: Locale = "en";
    for (const next of SUPPORTED_LOCALES) {
      const t = getTranslate(locale);
      await page.getByRole("button", { name: t("settings.ambraTitle"), exact: true }).click();
      await page.getByRole("combobox", { name: t("settings.language"), exact: true }).selectOption(next);
      await page.keyboard.press("Escape");
      locale = next;
      const translated = getTranslate(locale);
      for (const response of ["yes", "no"] as const) {
        await page.getByRole("button", { name: "Simulate eligible reader", exact: true }).click();
        const localized = page.getByRole("dialog", { name: translated("review.title"), exact: true });
        await expect(localized.getByRole("button", { name: translated("review.later"), exact: true })).toBeVisible();
        await localized.getByRole("button", { name: translated(response === "yes" ? "review.yes" : "review.no"), exact: true }).click();
        const followup = page.getByRole("dialog");
        await expect(followup.getByRole("link", {
          name: translated(response === "yes" ? "review.write" : "review.feedback"), exact: true,
        })).toHaveClass(/fui-Button/);
        if (response === "yes") {
          await expect(followup.locator("p").filter({ hasText: translated("review.thanks") })).toHaveText(translated("review.thanks"));
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const bounds = await followup.boundingBox();
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
        await page.keyboard.press("Escape");
        await expect(followup).toHaveCount(0);
      }
    }
  } finally { await context.close(); }
});

async function qualify(readerPage: Page) {
  await exposeReaderController(readerPage);
  return readerPage.evaluate(async () => {
    const db: LibraryDatabase = Reflect.get(window, "__readerController").library;
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
}

for (const response of ["yes", "no"] as const) {
  test(`real eligibility counts changed positions; ${response} stops prompts permanently across reloads and tabs`, async () => {
    test.skip(!enabled, "Local feature prototype build required");
    const { context, libraryPage: page, readerPage } = await launchReader(book);
    try {
      const state = await qualify(readerPage);
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
      if (response === "yes") {
        await page.evaluate(() => {
          const original = IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
            if (args[0] === "preferences" && args[1] === "readwrite") {
              IDBDatabase.prototype.transaction = original;
              throw new Error("Simulated invitation save failure");
            }
            return original.apply(this, args);
          };
        });
        await invitation.getByRole("button", { name: "Yes, I love it!", exact: true }).click();
        await expect(invitation.getByRole("alert")).toContainText("Simulated invitation save failure");
        await expect(page.getByRole("dialog", { name: "Are you loving Ambra?", exact: true })).toBeVisible();
      }
      await invitation.getByRole("button", { name: response === "yes" ? "Yes, I love it!" : "Not really", exact: true }).click();
      await expect(invitation.getByRole("link")).toBeVisible();
      expect((await snapshot(page))[2]).toContainEqual({
        key: "localPrototypeReviewInvitation", value: expect.objectContaining({ presented: true }),
      });
      await page.keyboard.press("Escape");
      await page.clock.setFixedTime(Date.now() + 365 * 24 * 60 * 60 * 1000);
      await page.reload();
      await expect(page.locator("[data-prototype-controls]")).toBeVisible();
      await expect(invitation).toHaveCount(0);
      const other = await context.newPage();
      await other.goto(page.url());
      await expect(other.locator("[data-prototype-controls]")).toBeVisible();
      await expect(other.locator("[data-review-invitation]")).toHaveCount(0);
    } finally { await context.close(); }
  });

}

test("atomic reservations and terminal responses survive concurrent database connections", async () => {
    test.skip(!enabled, "Local feature prototype build required");
    const { context, readerPage } = await launchReader(book);
    try {
      await qualify(readerPage);
      const result = await readerPage.evaluate(async () => {
        const db: LibraryDatabase = Reflect.get(window, "__readerController").library;
        const other: LibraryDatabase = await Reflect.get(db.constructor, "open")();
        try {
          const claims = await Promise.all([db.claimReviewInvitation(), other.claimReviewInvitation(), db.claimReviewInvitation()]);
          await Promise.all([other.respondToReviewInvitation("yes"), db.respondToReviewInvitation("later")]);
          const stopped = await db.getReviewInvitation();
          await other.respondToReviewInvitation("later");
          return { claims, stopped, afterStaleResponse: await db.getReviewInvitation(), claimedAgain: await other.claimReviewInvitation() };
        } finally { other.close(); }
      });
      expect(result.claims.filter(Boolean)).toHaveLength(1);
      expect(result.stopped.presented).toBe(true);
      expect(result.afterStaleResponse).toEqual(result.stopped);
      expect(result.claimedAgain).toBe(false);
    } finally { await context.close(); }
  });

  test("new eligibility waits for another Library dialog to close", async () => {
    test.skip(!enabled, "Local feature prototype build required");
    const { context, libraryPage: page, readerPage } = await launchReader(book);
    try {
      await page.goto(`${page.url()}?view=tab`);
      await page.bringToFront();
      await page.getByRole("button", { name: "Ambra settings", exact: true }).click();
      await qualify(readerPage);
      await expect(page.getByRole("dialog", { name: "Ambra settings", exact: true })).toBeVisible();
      await expect(page.locator("[data-review-invitation]")).toHaveCount(0);
      expect((await snapshot(page))[2]).toContainEqual({
        key: "localPrototypeReviewInvitation", value: expect.not.objectContaining({ nextPromptAt: expect.any(Number) }),
      });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Are you loving Ambra?", exact: true })).toBeVisible();
    } finally { await context.close(); }
  });

  test("explicit popup import handoff defers the review without consuming eligibility", async () => {
    test.skip(!enabled, "Local feature prototype build required");
    const { context, libraryPage: page, readerPage } = await launchReader(book);
    try {
      await qualify(readerPage);
      await readerPage.close();
      const libraryUrl = page.url().split("?")[0];
      await page.goto(`${libraryUrl}?view=tab&import=1`);
      await page.bringToFront();
      await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeFocused();
      await expect(page.locator("[data-prototype-controls]")).toBeVisible();
      await expect(page.locator("[data-review-invitation]")).toHaveCount(0);
      expect((await snapshot(page))[2]).toContainEqual({
        key: "localPrototypeReviewInvitation", value: expect.not.objectContaining({ nextPromptAt: expect.any(Number) }),
      });
      await page.goto(`${libraryUrl}?view=tab`);
      await expect(page.getByRole("dialog", { name: "Are you loving Ambra?", exact: true })).toBeVisible();
    } finally { await context.close(); }
  });
test("real not-sure cooldown is durable, repeatable, and claimed only once across concurrent tabs", async () => {
  test.skip(!enabled, "Local feature prototype build required");
  const { context, libraryPage: page, readerPage } = await launchReader(book);
  try {
    await qualify(readerPage);
    await readerPage.close();
    const now = Date.now();
    await page.clock.setFixedTime(now);
    await page.goto(`${page.url()}?view=tab`);
    await page.bringToFront();
    const invitation = page.getByRole("dialog", { name: "Are you loving Ambra?", exact: true });
    await expect(invitation).toBeVisible();
    const other = await context.newPage();
    await other.clock.setFixedTime(now);
    await other.goto(page.url());
    await other.bringToFront();
    await expect(other.locator("[data-prototype-controls]")).toBeVisible();
    await expect(other.locator("[data-review-invitation]")).toHaveCount(0);
    await other.close();
    await page.bringToFront();
    await invitation.getByRole("button", { name: "Not sure yet", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    expect((await snapshot(page))[2]).toContainEqual({
      key: "localPrototypeReviewInvitation",
      value: expect.objectContaining({ presented: false, nextPromptAt: now + REVIEW_REMINDER_DELAY }),
    });
    await page.clock.setFixedTime(now + REVIEW_REMINDER_DELAY - 1);
    await page.reload();
    await expect(page.locator("[data-prototype-controls]")).toBeVisible();
    await expect(invitation).toHaveCount(0);
    await page.clock.setFixedTime(now + REVIEW_REMINDER_DELAY);
    await page.reload();
    await expect(invitation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(invitation).toHaveCount(0);
    expect((await snapshot(page))[2]).toContainEqual({
      key: "localPrototypeReviewInvitation",
      value: expect.objectContaining({ presented: false, nextPromptAt: now + 2 * REVIEW_REMINDER_DELAY }),
    });
    await page.reload();
    await expect(page.locator("[data-prototype-controls]")).toBeVisible();
    await expect(invitation).toHaveCount(0);
  } finally { await context.close(); }
});
