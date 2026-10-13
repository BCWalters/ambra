import { expect, test } from "@playwright/test";
import { clickReadingPage, launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

for (const rtl of [false, true]) {
  test(`${rtl ? "RTL" : "LTR"}: previous margin at a mixed-document book start creates no leaf`, async () => {
    const { context, readerPage: page } = await launchReader(
      navigationFixture(test.info(), [1, 6], undefined, rtl ? "rtl" : "ltr"),
      { viewport: { width: 1547, height: 878 } },
    );
    try {
      await exposeReaderController(page);
      const before = await page.evaluate(async () => {
        const c = Reflect.get(window, "__readerController");
        await c.setPageTurnAnimationStyle("rotate");
        const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
        Reflect.set(window, "__bookStartLeafCount", 0);
        c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
          Reflect.set(
            window,
            "__bookStartLeafCount",
            Reflect.get(window, "__bookStartLeafCount") + 1,
          );
          return create(...args);
        };
        return { positions: c.host.positions, cfi: c.currentReadingCfi() };
      });
      expect(before.positions).toEqual({
        first: { spineIndex: 0, pageIndex: 0 },
        second: { spineIndex: 1, pageIndex: 0 },
      });
      await clickReadingPage(page, rtl ? "right" : "left");
      await page.waitForFunction(() => {
        const c = Reflect.get(window, "__readerController");
        return !c.isTurningPage && !c.isLoadInFlight && !c.controlledTurn && !c.gestureCleanup;
      });
      const after = await page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        return {
          positions: c.host.positions,
          cfi: c.currentReadingCfi(),
          leaves: Reflect.get(window, "__bookStartLeafCount"),
          error: c.snapshot().error,
        };
      });
      expect(after.leaves).toBe(0);
      expect(after.positions).toEqual(before.positions);
      expect(after.cfi).toBe(before.cfi);
      expect(after.error).toBeUndefined();
      await expect(page.locator("[data-ambra-curled-leaf]")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test(`${rtl ? "RTL" : "LTR"}: title spread stays pixel-identical while the boundary curl prepares`, async () => {
    const { context, readerPage: page } = await launchReader(
      navigationFixture(
        test.info(),
        [1, 6],
        (chapter, index) =>
          chapter === 0
            ? "<h1>A quiet journey</h1>"
            : `<p style="height:600px;margin:0">${index}. ${"An original passage for the turning page. ".repeat(8)}</p>`,
        rtl ? "rtl" : "ltr",
      ),
      { viewport: { width: 1547, height: 878 } },
    );
    try {
      await exposeReaderController(page);
      const { clip, stationaryClip, movingClip } = await page.evaluate(async () => {
        const c = Reflect.get(window, "__readerController");
        await c.setPageTurnAnimationStyle("rotate");
        const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
        c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
          const leaf = create(...args);
          const prepare = leaf.prepare.bind(leaf);
          const settle = leaf.settle.bind(leaf);
          leaf.prepare = async (...prepareArgs: unknown[]) => {
            await new Promise<void>((resolve) =>
              Reflect.set(window, "__releaseOnsetPreparation", resolve),
            );
            return prepare(...prepareArgs);
          };
          leaf.settle = async (...settleArgs: unknown[]) => {
            leaf.paint(0.3);
            await new Promise<void>((resolve) =>
              Reflect.set(window, "__releaseOnsetCurl", resolve),
            );
            return settle(...settleArgs);
          };
          return leaf;
        };
        const bounds = c.containerEl.getBoundingClientRect();
        const stationary = c.host
          .columnElement(c.pkg.effectivePageProgressionDirection === "rtl" ? "right" : "left")
          .getBoundingClientRect();
        const moving = c.host
          .columnElement(c.pkg.effectivePageProgressionDirection === "rtl" ? "left" : "right")
          .getBoundingClientRect();
        return {
          // Compare publication pixels, excluding reactive toolbar/scrubber chrome.
          clip: {
            x: bounds.left + 2,
            y: bounds.top + 80,
            width: bounds.width - 4,
            height: bounds.height - 160,
          },
          stationaryClip: {
            x: stationary.left + 2,
            y: bounds.top + 80,
            width: stationary.width - 4,
            height: bounds.height - 160,
          },
          movingClip: {
            x: moving.left + 2,
            y: bounds.top + 80,
            width: moving.width - 4,
            height: bounds.height - 160,
          },
        };
      });
      await page.waitForTimeout(1000);
      // Toolbar/scrubber shadows extend beyond their boxes and react to the moving leaf.
      const publicationScreenshot = {
        style: "[data-ambra-page-band] { visibility: hidden !important; }",
      };
      await page.screenshot({
        ...publicationScreenshot,
        clip,
        path: test.info().outputPath("before.png"),
      });
      const stationaryBefore = await page.screenshot({
        ...publicationScreenshot,
        clip: stationaryClip,
        path: test.info().outputPath("stationary-before.png"),
      });
      const movingBefore = await page.screenshot({ ...publicationScreenshot, clip: movingClip });
      await page.evaluate(() => {
        Reflect.set(window, "__onsetTurn", Reflect.get(window, "__readerController").turnPage(1));
      });
      await page.waitForFunction(() => !!Reflect.get(window, "__releaseOnsetPreparation"));
      await page.screenshot({
        ...publicationScreenshot,
        clip,
        path: test.info().outputPath("preparing.png"),
      });
      const stationaryPreparing = await page.screenshot({ ...publicationScreenshot, clip: stationaryClip });
      const movingPreparing = await page.screenshot({ ...publicationScreenshot, clip: movingClip });
      expect(
        stationaryPreparing.equals(stationaryBefore) && movingPreparing.equals(movingBefore),
        "Canonical publication columns changed before the curl was ready",
      ).toBe(true);
      await page.evaluate(() => Reflect.get(window, "__releaseOnsetPreparation")());
      await page.waitForFunction(() => !!Reflect.get(window, "__releaseOnsetCurl"));
      const stationaryDuring = await page.screenshot({
        ...publicationScreenshot,
        clip: stationaryClip,
        path: test.info().outputPath("stationary-during.png"),
      });
      expect(
        stationaryDuring.equals(stationaryBefore),
        "Incoming text leaked through the short stationary page",
      ).toBe(true);
      await page.evaluate(async () => {
        Reflect.get(window, "__releaseOnsetCurl")();
        await Reflect.get(window, "__onsetTurn");
      });
      const after = await page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        return { positions: c.host.positions, error: c.snapshot().error };
      });
      expect(after.positions.first).toEqual({ spineIndex: 1, pageIndex: 1 });
      expect(after.error).toBeUndefined();
      await expect(page.locator("[data-ambra-curled-leaf]")).toHaveCount(0);
      await expect(page.locator("[data-ambra-turn-stationary-paper]")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
