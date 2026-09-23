import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const narrated = path.join(fixtures, "media-overlay/narrated.epub");
const notice = (page: Page) => page.getByRole("region", { name: "This book has narration" });
const controls = (page: Page) => page.getByRole("region", { name: "Narration controls" });
const audio = (page: Page) => page.locator("audio[data-ambra-narration-audio]");

async function acknowledged(page: Page) {
  await exposeReaderController(page);
  return page.evaluate(async () => {
    const controller = Reflect.get(window, "__readerController");
    const metadata = await controller.library.getBookMetadata(controller.bookId);
    return metadata?.narrationNoticeDismissed === true;
  });
}

test("first-open narration notice neither steals focus nor autoplays; dismissal survives reopening", async () => {
  const { context, readerPage: page, libraryPage } = await launchReader(narrated);
  try {
    await expect(notice(page)).toBeVisible();
    expect(await notice(page).evaluate(element => element.contains(document.activeElement))).toBe(false);
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await expect(controls(page)).toHaveCount(0);
    const frame = page.locator("iframe").first();
    const before = await frame.boundingBox();
    await notice(page).getByRole("button", { name: "Not now", exact: true }).click();
    await expect(notice(page)).toHaveCount(0);
    await expect.poll(() => acknowledged(page)).toBe(true);
    expect(await frame.boundingBox()).toEqual(before);
    await page.reload();
    await expect(page.locator("iframe").first()).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Listen", exact: true })).toBeVisible();

    await libraryPage.locator('input[type="file"]').setInputFiles(path.join(fixtures, "media-overlay/fixed-layout.epub"));
    await expect(libraryPage.getByRole("button", { name: /^Open / })).toHaveCount(2);
    const secondTab = context.waitForEvent("page");
    await libraryPage.getByRole("button", { name: "Open Synthetic narration fixed-layout", exact: true }).click();
    const secondReader = await secondTab;
    await expect(notice(secondReader)).toBeVisible();
    expect(await audio(secondReader).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
  } finally {
    await context.close();
  }
});

test("Listen now opens playback and acknowledges the notice; stopping does not bring it back", async () => {
  const { context, readerPage: page } = await launchReader(narrated);
  try {
    await notice(page).getByRole("button", { name: "Listen now", exact: true }).click();
    await expect(controls(page)).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await expect.poll(() => audio(page).evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
    await expect(controls(page).getByRole("button", { name: "Pause narration", exact: true })).toBeFocused();
    await expect.poll(() => acknowledged(page)).toBe(true);
    await controls(page).getByRole("button", { name: "Close narration", exact: true }).click();
    await expect(controls(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await page.reload();
    await expect(page.locator("iframe").first()).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("unacknowledged notices survive reopening and plain books have none", async () => {
  const { context, readerPage: page, libraryPage } = await launchReader(narrated);
  try {
    await expect(notice(page)).toBeVisible();
    await page.reload();
    await expect(notice(page)).toBeVisible();
    await libraryPage.locator('input[type="file"]').setInputFiles(path.join(fixtures, "long-content.epub"));
    await expect(libraryPage.getByRole("button", { name: /^Open / })).toHaveCount(2);
    const nextTab = context.waitForEvent("page");
    await libraryPage.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true }).click();
    const plain = await nextTab;
    await expect(plain.locator("iframe").first()).toBeVisible();
    await expect(notice(plain)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("failure to remember dismissal is surfaced and does not silently lose the reminder", async () => {
  const { context, readerPage: page } = await launchReader(narrated);
  try {
    await expect(notice(page)).toBeVisible();
    await exposeReaderController(page);
    await page.evaluate(() => {
      Reflect.get(window, "__readerController").library.dismissNarrationNotice = async () => {
        throw new DOMException("Could not save the narration preference", "QuotaExceededError");
      };
    });
    await notice(page).getByRole("button", { name: "Not now", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "out of storage space" })).toBeVisible();
    expect(await acknowledged(page)).toBe(false);
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await page.reload();
    await expect(notice(page)).toBeVisible();
  } finally {
    await context.close();
  }
});

test("listening action tracks reading selections and starts the selected authored passage", async () => {
  const { context, readerPage: page } = await launchReader(narrated);
  try {
    await notice(page).getByRole("button", { name: "Listen now", exact: true }).click();
    await expect.poll(() => audio(page).evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
    await controls(page).getByRole("button", { name: "Pause narration", exact: true }).click();
    await expect(controls(page).getByRole("button", { name: "Listen from this page", exact: true })).toBeVisible();
    const bounds = await controls(page).boundingBox();
    const selectPassage = () => page.evaluate(() => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const range = doc.createRange();
      range.selectNodeContents(doc.getElementById("c1-p2")!);
      doc.getSelection()!.removeAllRanges();
      doc.getSelection()!.addRange(range);
    });
    await selectPassage();
    await expect(controls(page).getByRole("button", { name: "Listen from selection", exact: true })).toBeVisible();
    expect(await controls(page).boundingBox()).toEqual(bounds);
    await page.evaluate(() => document.querySelector("iframe")!.contentDocument!.getSelection()!.removeAllRanges());
    await expect(controls(page).getByRole("button", { name: "Listen from this page", exact: true })).toBeVisible();
    await selectPassage();
    await controls(page).getByRole("button", { name: "Listen from selection", exact: true }).click();
    await expect.poll(() => audio(page).evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThanOrEqual(4);
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).currentTime)).toBeLessThan(8);
    await exposeReaderController(page);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").narration.target.fragment)).toBe("c1-p2");
  } finally {
    await context.close();
  }
});

for (const { width, locale } of [
  { width: 900, locale: "en" },
  { width: 360, locale: "en" },
  { width: 900, locale: "de" },
] as const) {
  test(`${width}px ${locale}: compact controls keep one row and a stable viewport; speed menu supports keyboard`, async () => {
    const { context, readerPage: page } = await launchReader(narrated, { viewport: { width, height: 900 } });
    try {
      await exposeReaderController(page);
      if (locale !== "en") {
        await page.evaluate(locale => Reflect.get(window, "__readerController").library.setLocalePreference(locale), locale);
        await page.reload();
      }
      await page.locator("[data-narration-discovery]").getByRole("button").first().click();
      await expect.poll(() => audio(page).evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
      await exposeReaderController(page);
      await page.evaluate(() => Reflect.get(window, "__readerController").performNarrationAction("toggle"));
      const strip = page.locator("[data-narration-controls]");
      const before = (await strip.boundingBox())!;
      expect(before.height).toBeLessThanOrEqual(48);
      await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
      await expect.poll(() => page.evaluate(() =>
        Reflect.get(window, "__readerController").snapshot().narration.following,
      )).toBe(false);
      expect(await strip.boundingBox()).toEqual(before);
      const buttonRows = await strip.getByRole("button").evaluateAll(elements =>
        elements.map(element => element.getBoundingClientRect().y),
      );
      expect(Math.max(...buttonRows) - Math.min(...buttonRows)).toBeLessThan(2);
      expect(await strip.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const closeBounds = (await strip.getByRole("button").last().boundingBox())!;
      expect(closeBounds.x + closeBounds.width).toBeGreaterThan(width - 20);
      const positionBeforeMenu = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageIndex);
      const speed = strip.getByRole("button").filter({ hasText: /^1×$/ });
      await speed.press("Enter");
      await expect(page.getByRole("menuitemradio", { name: "1×", exact: true })).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect.poll(() => audio(page).evaluate(element => (element as HTMLAudioElement).playbackRate)).toBe(2);
      const updatedSpeed = strip.getByRole("button").filter({ hasText: /^2×$/ });
      await expect(updatedSpeed).toBeFocused();
      await updatedSpeed.press("Enter");
      await page.screenshot({
        path: test.info().outputPath(`narration-speed-${width}-${locale}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(updatedSpeed).toBeFocused();
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageIndex)).toBe(positionBeforeMenu);
      await page.screenshot({ path: test.info().outputPath(`narration-controls-${width}-${locale}.png`) });
    } finally {
      await context.close();
    }
  });
}
