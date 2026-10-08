import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const narrated = path.join(fixtures, "media-overlay/narrated.epub");
const notice = (page: Page) => page.getByRole("region", { name: "This book has narration" });
const controls = (page: Page) => page.getByRole("region", { name: "Narration controls" });
const audio = (page: Page) => page.locator("audio[data-ambra-narration-audio]");

test("read-along appears paused without stealing focus; reopening resets collapse without autoplay", async () => {
  const { context, readerPage: page, libraryPage } = await launchReader(narrated);
  try {
    await expect(controls(page)).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Listen", exact: true })).toHaveCount(0);
    expect(await controls(page).evaluate(element => element.contains(document.activeElement))).toBe(false);
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await controls(page).getByRole("button", { name: "Collapse read-along controls", exact: true }).click();
    await expect(controls(page).getByRole("button", { name: "Expand read-along controls", exact: true })).toBeVisible();
    await expect(controls(page).getByRole("button", { name: "Play narration", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator("iframe").first()).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await expect(controls(page).getByRole("button", { name: "Collapse read-along controls", exact: true })).toBeVisible();
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);

    await libraryPage.locator('input[type="file"]').setInputFiles(path.join(fixtures, "media-overlay/fixed-layout.epub"));
    await expect(libraryPage.locator("[data-library-collection]").getByRole("button", { name: /^Open / })).toHaveCount(2);
    const secondTab = context.waitForEvent("page");
    await libraryPage.getByRole("button", { name: "Open Synthetic narration fixed-layout", exact: true }).click();
    const secondReader = await secondTab;
    await expect(controls(secondReader)).toBeVisible();
    await expect(notice(secondReader)).toHaveCount(0);
    expect(await audio(secondReader).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
  } finally {
    await context.close();
  }
});

test("collapse keeps playback running and the compact strip can pause and resume", async () => {
  const { context, readerPage: page } = await launchReader(narrated);
  try {
    await controls(page).getByRole("button", { name: "Play narration", exact: true }).click();
    await expect(controls(page)).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await expect.poll(() => audio(page).evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
    await expect(controls(page).getByRole("button", { name: "Pause narration", exact: true })).toBeFocused();
    await controls(page).getByRole("button", { name: "Collapse read-along controls", exact: true }).click();
    await expect(controls(page).getByRole("button", { name: "Expand read-along controls", exact: true })).toBeFocused();
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    await controls(page).getByRole("button", { name: "Pause narration", exact: true }).click();
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await controls(page).getByRole("button", { name: "Play narration", exact: true }).click();
    await expect.poll(() => audio(page).evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
  } finally {
    await context.close();
  }
});

test("plain books have no read-along controls or retired discovery notice", async () => {
  const { context, libraryPage } = await launchReader(narrated);
  try {
    await libraryPage.locator('input[type="file"]').setInputFiles(path.join(fixtures, "long-content.epub"));
    await expect(libraryPage.locator("[data-library-collection]").getByRole("button", { name: /^Open / })).toHaveCount(2);
    const nextTab = context.waitForEvent("page");
    await libraryPage.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true }).click();
    const plain = await nextTab;
    await expect(plain.locator("iframe").first()).toBeVisible();
    await expect(notice(plain)).toHaveCount(0);
    await expect(controls(plain)).toHaveCount(0);
    await expect(plain.getByRole("button", { name: "Listen", exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("ephemeral collapse never writes the retired discovery preference", async () => {
  const { context, readerPage: page } = await launchReader(narrated);
  try {
    await expect(controls(page)).toBeVisible();
    await exposeReaderController(page);
    await page.evaluate(() => {
      let writes = 0;
      Reflect.set(window, "__narrationPreferenceWrites", () => writes);
      Reflect.get(window, "__readerController").library.dismissNarrationNotice = async () => {
        writes++;
        throw new DOMException("Could not save the narration preference", "QuotaExceededError");
      };
    });
    await controls(page).getByRole("button", { name: "Collapse read-along controls", exact: true }).click();
    await controls(page).getByRole("button", { name: "Expand read-along controls", exact: true }).click();
    expect(await page.evaluate(() => Reflect.get(window, "__narrationPreferenceWrites")())).toBe(0);
    await expect(page.getByRole("status").filter({ hasText: "out of storage space" })).toHaveCount(0);
    expect(await audio(page).evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await page.reload();
    await expect(controls(page).getByRole("button", { name: "Collapse read-along controls", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("listening action tracks reading selections and starts the selected authored passage", async () => {
  const { context, readerPage: page } = await launchReader(narrated);
  try {
    await controls(page).getByRole("button", { name: "Play narration", exact: true }).click();
    await expect.poll(() => audio(page).evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
    await controls(page).getByRole("button", { name: "Pause narration", exact: true }).click();
    await expect(controls(page).getByRole("button", { name: "Restart page audio", exact: true })).toBeVisible();
    const bounds = await controls(page).boundingBox();
    const selectPassage = () => page.evaluate(() => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const range = doc.createRange();
      range.selectNodeContents(doc.getElementById("c1-p2")!);
      doc.getSelection()!.removeAllRanges();
      doc.getSelection()!.addRange(range);
    });
    await selectPassage();
    await expect(controls(page).getByRole("button", { name: "Jump to selection", exact: true })).toBeVisible();
    expect(await controls(page).boundingBox()).toEqual(bounds);
    await page.evaluate(() => document.querySelector("iframe")!.contentDocument!.getSelection()!.removeAllRanges());
    await expect(controls(page).getByRole("button", { name: "Restart page audio", exact: true })).toBeVisible();
    await selectPassage();
    await controls(page).getByRole("button", { name: "Jump to selection", exact: true }).click();
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
  ...(["en", "de", "es", "fr", "it", "ja", "ko", "ru", "zh"] as const).map(locale => ({ width: 320, locale })),
] as const) {
  test(`${width}px ${locale}: expanded transport has a separate row, collapse is compact, and speed supports keyboard`, async () => {
    const { context, readerPage: page } = await launchReader(narrated, { viewport: { width, height: 900 } });
    try {
      await exposeReaderController(page);
      if (locale !== "en") {
        await page.evaluate(locale => Reflect.get(window, "__readerController").library.setLocalePreference(locale), locale);
        await page.reload();
      }
      await expect(page.locator("iframe").first()).toBeVisible();
      await exposeReaderController(page);
      await page.waitForFunction(() => {
        const c = Reflect.get(window, "__readerController");
        return c?.host && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout && !c.isTurningPage;
      });
      const t = getTranslate(locale);
      const strip = page.locator("[data-narration-controls]");
      await strip.getByRole("button", { name: t("narration.play"), exact: true }).click();
      await expect.poll(() => audio(page).evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
      await exposeReaderController(page);
      await page.evaluate(() => Reflect.get(window, "__readerController").performNarrationAction("toggle"));
      const before = (await strip.boundingBox())!;
      expect(before.height).toBeLessThanOrEqual(224);
      await expect(strip.getByRole("button", { name: t("narration.previous"), exact: true }))
        .toHaveText(t("narration.previousLabel"));
      await expect(strip.getByRole("button", { name: t("narration.next"), exact: true }))
        .toHaveText(t("narration.nextLabel"));
      await expect(strip.getByRole("button", { name: t("narration.play"), exact: true }).locator('[aria-hidden="false"]'))
        .toHaveText(t("narration.playLabel"));
      await expect(strip.getByText(t("narration.speedLabel"), { exact: true })).toBeVisible();
      await expect(strip.getByRole("button", { name: t("narration.listenFromPage"), exact: true })
        .getByText(t("narration.listenFromPage"), { exact: true })).toBeVisible();
      const header = (await strip.locator("[data-narration-commands]").boundingBox())!;
      const transport = (await strip.locator("[data-narration-primary-commands]").boundingBox())!;
      expect(transport.y).toBeGreaterThanOrEqual(header.y + header.height);
      const play = strip.getByRole("button", { name: t("narration.play"), exact: true });
      const playBox = (await play.boundingBox())!;
      expect(Math.abs(playBox.x + playBox.width / 2 - (before.x + before.width / 2))).toBeLessThanOrEqual(1);
      const frameBefore = await page.locator("iframe").first().boundingBox();
      await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
      await expect.poll(() => page.evaluate(() =>
        Reflect.get(window, "__readerController").snapshot().narration.following,
      )).toBe(false);
      expect(await strip.boundingBox()).toEqual(before);
      await expect(strip.getByRole("button", { name: t("narration.return"), exact: true })
        .getByText(t("narration.return"), { exact: true })).toBeVisible();
      expect(await page.locator("iframe").first().boundingBox()).toEqual(frameBefore);
      expect(await strip.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const closeBounds = (await strip.getByRole("button", { name: t("narration.collapse"), exact: true }).boundingBox())!;
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
      await strip.getByRole("button", { name: t("narration.collapse"), exact: true }).click();
      expect((await strip.boundingBox())!.height).toBeLessThan(before.height);
      await expect(strip.locator("[data-narration-primary-commands]")).toHaveCount(0);
      await expect(strip.getByRole("button", { name: t("narration.play"), exact: true })).toBeVisible();
      const collapsedBox = (await strip.boundingBox())!;
      const collapsedPlay = (await strip.getByRole("button", { name: t("narration.play"), exact: true }).boundingBox())!;
      expect(Math.abs(collapsedPlay.x + collapsedPlay.width / 2 - (collapsedBox.x + collapsedBox.width / 2))).toBeLessThanOrEqual(1);
      await expect(strip.getByRole("button", { name: t("narration.expand"), exact: true }))
        .toHaveText(t("narration.expandLabel"));
      expect(await strip.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`narration-controls-${width}-${locale}.png`) });
    } finally {
      await context.close();
    }
  });
}
