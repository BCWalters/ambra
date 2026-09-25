import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return !c.isApplyingLayout && !c.isLoadInFlight && !c.pendingLayout && !c.isTurningPage;
  });
}

async function expectCenteredColumn(page: Page, widthEm: number) {
  const geometry = await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    return c.contentDocumentViews().map(({ document: doc }: { document: Document }) => {
      const body = doc.body.getBoundingClientRect();
      return {
        width: body.width, fontSize: parseFloat(doc.defaultView!.getComputedStyle(doc.body).fontSize),
        center: body.left + body.width / 2, viewport: doc.defaultView!.innerWidth,
      };
    }) as { width: number; fontSize: number; center: number; viewport: number }[];
  });
  expect(geometry).toHaveLength(1);
  expect(Math.abs(geometry[0]!.center - geometry[0]!.viewport / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry[0]!.width - widthEm * geometry[0]!.fontSize)).toBeLessThanOrEqual(1);
}

test("Always show one page retains focus and location, respects width, and survives resizing, navigation and reopen", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1600, height: 900 } });
  try {
    await exposeReaderController(page);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().isSpread)).toBe(true);
    await page.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      await c.setPageTurnAnimationStyle("none");
      await c.seekToFraction(0.3);
      const point = c.nativeReading.current() ?? c.host.currentPosition();
      Reflect.set(window, "__onePageLocation", c.locatorResolver.generate(point.spineIndex ?? c.spineIndex, point.node, point.offset).cfi);
    });
    const trigger = page.getByRole("button", { name: "Text and page options", exact: true });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Page", exact: true }).press("ArrowRight");
    expect(await page.getByRole("combobox", { name: "Page theme", exact: true }).count()).toBe(0);
    const toggle = page.getByRole("menuitemcheckbox", { name: "Always show one page", exact: true });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.press("Space");
    await settled(page);
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const point = c.nativeReading.current();
      return c.locatorResolver.generate(point.spineIndex, point.node, point.offset).cfi;
    })).toBe(await page.evaluate(() => Reflect.get(window, "__onePageLocation")));
    await expectCenteredColumn(page, 34);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    for (const width of [2400, 800, 1800]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").appliedWidth)).toBe(width);
      await settled(page);
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().isSpread)).toBe(false);
      await expectCenteredColumn(page, 34);
    }
    await page.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      await c.setContentWidth(26);
      await c.turnPage(1);
      await c.goToChapter(1);
    });
    await expectCenteredColumn(page, 26);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().isSpread)).toBe(false);
    await page.reload();
    await expect(trigger).toBeVisible();
    await exposeReaderController(page);
    await expectCenteredColumn(page, 26);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().alwaysShowOnePage)).toBe(true);
    await page.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      await c.setViewMode("scroll");
      await c.setAlwaysShowOnePage(false);
    });
    await expectCenteredColumn(page, 26);
    await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("paginated"));
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().isSpread)).toBe(true);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
