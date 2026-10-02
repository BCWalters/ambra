import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader, clickReadingPage } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import type { ReaderSnapshot } from "../../extension/src/reader/ReaderTypes.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const rtlBook = fileURLToPath(new URL("../fixtures/fxl-spread-rtl.epub", import.meta.url));
const welcome = (page: Page) => page.getByRole("dialog", { name: "Make yourself at home", exact: true });
const guide = (page: Page) => page.getByTestId("page-turn-guide");
async function pagePosition(page: Page) {
  return page.evaluate(() => {
    const snapshot: ReaderSnapshot = Reflect.get(window, "__readerController").snapshot();
    const { spineIndex, pageIndex } = snapshot;
    return { spineIndex, pageIndex };
  });
}
async function reopen(page: Page) {
  const help = page.getByRole("button", { name: "Help & About", exact: true });
  await help.focus();
  await help.click();
  await page.getByRole("button", { name: "Reading tips", exact: true }).click();
  await expect(welcome(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(welcome(page)).toHaveCount(0);
  await expect(guide(page)).toBeVisible();
}

// eslint-disable-next-line no-empty-pattern
test("first welcome guides real margins; resize/no-op preserve it, successful margin turn dismisses it, explicit tips replay", async ({}, info) => {
  const app = await launchReader(book, { firstReadingWelcome: true, viewport: { width: 1100, height: 850 } });
  try {
    const page = app.readerPage;
    await exposeReaderController(page);
    await expect(welcome(page)).toBeVisible();
    await expect(guide(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(guide(page)).toBeVisible();
    await expect(guide(page).getByRole("status")).toHaveText("Click or tap in the margins to change pages.");
    await expect(guide(page).getByRole("button", { name: "Dismiss page-turn tip", exact: true })).not.toBeFocused();
    await expect(guide(page)).toHaveCSS("transition-property", "opacity");
    await expect(guide(page)).toHaveCSS("transition-duration", "0.24s");
    const arrow = page.locator(".page-turn-guide-indicator svg").first();
    await expect(arrow).toHaveCSS("animation-name", "page-turn-guide-pulse");
    await expect(arrow).toHaveCSS("animation-duration", "1.5s");
    await expect(arrow).toHaveCSS("animation-iteration-count", "2");
    await expect(guide(page)).toHaveAttribute("data-phase", "indicators");
    await expect(arrow).toHaveCSS("animation-name", "none");
    await expect(page.locator(".page-turn-guide-wash").first()).toHaveCSS("opacity", "0.08");
    expect(await guide(page).evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(-1));
    await expect(guide(page)).toBeVisible();
    await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("scroll"));
    await expect(guide(page)).toHaveCount(0);
    await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("paginated"));
    await expect(guide(page)).toBeVisible();
    await page.setViewportSize({ width: 320, height: 750 });
    await expect(guide(page)).toBeVisible();
    await expect(page.locator(".page-turn-guide-indicator span")).toHaveCount(0);
    const tipBounds = await page.locator(".page-turn-guide-tip").boundingBox();
    expect(tipBounds?.x).toBeGreaterThanOrEqual(0);
    expect((tipBounds?.x ?? 0) + (tipBounds?.width ?? 0)).toBeLessThanOrEqual(320);
    await page.setViewportSize({ width: 780, height: 750 });
    await expect(guide(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const expected = Reflect.get(window, "__readerController").pageTurnGuideGeometry();
      const actual = document.querySelector('[data-side="right"]')?.getBoundingClientRect();
      return !!expected && !!actual && Math.abs(actual.right - expected.right) < 1 &&
        Math.abs(actual.width - expected.rightWidth) < 1 && Math.abs(actual.top - expected.top) < 1 &&
        Math.abs(actual.height - expected.height) < 1 &&
        Math.abs(expected.top - document.querySelector('[role="main"]')!.getBoundingClientRect().top) < 1 &&
        Math.abs(expected.height - document.querySelector('[role="main"]')!.getBoundingClientRect().height) < 1;
    })).toBe(true);
    await page.screenshot({ path: info.outputPath("first-turn-guide.png") });
    await clickReadingPage(page, "right");
    await expect(guide(page)).toHaveCount(0);
    await reopen(page);
    await page.evaluate(() => Reflect.get(window, "__readerController").goToChapter(1));
    await expect(guide(page)).toHaveCount(0);
    await reopen(page);
    const beforeDismiss = await pagePosition(page);
    await guide(page).evaluate(element => {
      const result = { exiting: false, duration: "" };
      Reflect.set(window, "__guideExit", result);
      const observer = new MutationObserver(() => {
        if (element.getAttribute("data-phase") !== "exiting") return;
        result.exiting = true;
        result.duration = getComputedStyle(element).transitionDuration;
        observer.disconnect();
      });
      observer.observe(element, { attributes: true, attributeFilter: ["data-phase"] });
    });
    await guide(page).getByRole("button", { name: "Dismiss page-turn tip", exact: true }).click();
    await expect(guide(page)).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, "__guideExit"))).toEqual({ exiting: true, duration: "0.24s" });
    expect(await pagePosition(page)).toEqual(beforeDismiss);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
    await page.reload();
    await expect(welcome(page)).toHaveCount(0);
    await expect(guide(page)).toHaveCount(0);
  } finally { await app.context.close(); }
});

// eslint-disable-next-line no-empty-pattern
test("reduced motion and RTL preserve physical arrows and invert next/previous", async ({}) => {
  const app = await launchReader(rtlBook, { viewport: { width: 1200, height: 850 } });
  try {
    const page = app.readerPage;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await reopen(page);
    await expect(guide(page)).toHaveAttribute("data-phase", "indicators");
    await expect(page.locator('.page-turn-guide-margin[data-side="left"]')).toHaveAttribute("data-direction", "next");
    await expect(page.locator(".page-turn-guide-tip")).toHaveAttribute("data-tip-side", "left");
    await expect(guide(page)).toHaveCSS("transition-duration", "0s");
    expect(await guide(page).evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
    await page.keyboard.press("ArrowLeft");
    await expect(guide(page)).toHaveCount(0);
  } finally { await app.context.close(); }
});
