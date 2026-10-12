import { expect, test } from "@playwright/test";
import { clickReadingPage, launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

for (const rtl of [false, true]) {
  test(`single ${rtl ? "RTL" : "LTR"}: clicked leaf retains outgoing ink on both faces and reuses its chapter`, async () => {
    const { context, readerPage: page } = await launchReader(
      navigationFixture(
        test.info(),
        [60],
        (_chapter, index) =>
          `<p id="p${index}">${index}. ${"A quiet path through the hills leads home. ".repeat(30)}</p>`,
        rtl ? "rtl" : "ltr",
      ),
      { viewport: { width: 1547, height: 878 } },
    );
    try {
      await exposeReaderController(page);
      await page.evaluate(async () => {
        const c = Reflect.get(window, "__readerController");
        await c.setAlwaysShowOnePage(true);
        await c.openSpineItem(0, { fragment: "p17" });
        await c.setPageTurnAnimationStyle("rotate");
        Reflect.set(window, "__sourceHost", c.host);
        Reflect.set(window, "__sourceDocument", c.host.element.contentDocument);
        const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
        c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
          const leaf = create(...args);
          const settle = leaf.settle.bind(leaf);
          leaf.settle = async (...args: unknown[]) => {
            leaf.paint(0.45);
            await new Promise<void>((resolve) =>
              Reflect.set(window, "__releaseSingleLeaf", resolve),
            );
            Reflect.set(window, "__releaseSingleLeaf", undefined);
            return settle(...args);
          };
          return leaf;
        };
      });
      for (const direction of [1, -1] as const) {
        const before = await page.evaluate(() =>
          Reflect.get(window, "__readerController").currentReadingCfi(),
        );
        const physical = rtl ? -direction : direction;
        await clickReadingPage(page, physical === 1 ? "right" : "left");
        await page.waitForFunction(() => !!Reflect.get(window, "__releaseSingleLeaf"));
        const ink = await page
          .locator("[data-ambra-curled-leaf]")
          .evaluate((frame: HTMLIFrameElement) => {
            const doc = frame.contentDocument!;
            return {
              front: doc.querySelector("[data-flat-leaf-face='front'] [data-page-copy]")!
                .textContent,
              underlay: doc.querySelector("[data-leaf-underlay] [data-page-copy]")!.textContent,
              faces: Array.from(doc.querySelectorAll("[data-face] [data-page-copy]")).map(
                (copy) => copy.textContent,
              ),
            };
          });
        expect(ink.front).not.toBe(ink.underlay);
        expect(ink.faces).toHaveLength(40);
        for (const face of ink.faces) expect(face).toBe(ink.front);
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi()),
        ).toBe(before);
        await page.screenshot({
          path: test.info().outputPath(`single-outgoing-leaf-${direction}.png`),
        });
        await page.evaluate(() => Reflect.get(window, "__releaseSingleLeaf")());
        await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
        expect(
          await page.evaluate(() => {
            const c = Reflect.get(window, "__readerController");
            return (
              c.host === Reflect.get(window, "__sourceHost") &&
              c.host.element.contentDocument === Reflect.get(window, "__sourceDocument")
            );
          }),
        ).toBe(true);
        await expect(page.locator("iframe")).toHaveCount(1);
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().error),
        ).toBeUndefined();
      }
    } finally {
      await context.close();
    }
  });
}
