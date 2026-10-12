import { expect, test } from "@playwright/test";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

for (const rtl of [false, true]) {
  for (const style of ["rotate", "slide", "scroll"] as const) {
    test(`single ${rtl ? "RTL" : "LTR"} ${style}: anchored folios agree before, during and after turns`, async () => {
      const epub = navigationFixture(
        test.info(),
        [60],
        (_chapter, index) =>
          `<p id="p${index}">${index}. ${"A quiet path through the hills leads home. ".repeat(30)}</p>`,
        rtl ? "rtl" : "ltr",
      );
      const { context, readerPage: page } = await launchReader(epub, {
        viewport: { width: 1547, height: 878 },
      });
      try {
        await exposeReaderController(page);
        await page.evaluate(async (style) => {
          const c = Reflect.get(window, "__readerController");
          await c.setPageTurnAnimationStyle("none");
          await c.setAlwaysShowOnePage(true);
          await c.openSpineItem(0, { fragment: "p17" });
          await c.setPageTurnAnimationStyle(style);
          const animator = c.pageTurnAnimator;
          const create = c.pageTurnOrchestrator.createCurledLeaf.bind(c.pageTurnOrchestrator);
          c.pageTurnOrchestrator.createCurledLeaf = (...args: unknown[]) => {
            const leaf = create(...args);
            const settle = leaf.settle.bind(leaf);
            leaf.settle = async (...args: unknown[]) => {
              leaf.paint(0.3);
              await new Promise<void>((resolve) => Reflect.set(window, "__releaseFolio", resolve));
              Reflect.set(window, "__releaseFolio", undefined);
              return settle(...args);
            };
            return leaf;
          };
          for (const method of ["playPageTurnAnimation", "playScrollTurn"]) {
            const play = animator[method].bind(animator);
            animator[method] = async (...args: unknown[]) => {
              await new Promise<void>((resolve) => Reflect.set(window, "__releaseFolio", resolve));
              Reflect.set(window, "__releaseFolio", undefined);
              return play(...args);
            };
          }
          for (const method of ["animatePageTurn", "animateReusablePageTurn"]) {
            const animate = c.pageTurnOrchestrator[method].bind(c.pageTurnOrchestrator);
            c.pageTurnOrchestrator[method] = (...args: unknown[]) => {
              Reflect.set(window, "__turnFolios", args[method === "animatePageTurn" ? 3 : 2]);
              return animate(...args);
            };
          }
        }, style);
        await page.waitForFunction(
          () => Reflect.get(window, "__readerController").snapshot().bookPageIndex !== undefined,
        );
        for (const direction of [1, -1] as const) {
          const before = await page.evaluate(
            () => Reflect.get(window, "__readerController").snapshot().bookPageIndex,
          );
          await page.evaluate((direction) => {
            Reflect.set(
              window,
              "__folioTurnDone",
              Reflect.get(window, "__readerController").turnPage(direction),
            );
          }, direction);
          await page.waitForFunction(() => !!Reflect.get(window, "__releaseFolio"));
          const folios = await page.evaluate(() => Reflect.get(window, "__turnFolios"));
          expect(folios.outgoingPage).toBe(before);
          const overlays = page.locator("[data-ambra-turn-furniture]");
          await expect(overlays).toHaveCount(2);
          expect(await overlays.allTextContents()).toEqual(
            expect.arrayContaining([
              expect.stringContaining(`Page ${folios.outgoingPage}`),
              expect.stringContaining(`Page ${folios.incomingPage}`),
            ]),
          );
          if (style === "rotate") {
            await expect(page.locator("[data-ambra-curled-leaf]")).toHaveAttribute(
              "data-progress",
              "0.3",
            );
            await page.screenshot({
              path: test.info().outputPath(`single-curled-${direction}.png`),
            });
          }
          await page.evaluate(() => Reflect.get(window, "__releaseFolio")());
          await page.evaluate(async () => {
            await Reflect.get(window, "__folioTurnDone");
          });
          const after = await page.evaluate(
            () => Reflect.get(window, "__readerController").snapshot().bookPageIndex,
          );
          expect(folios.incomingPage).toBe(after);
          await expect(overlays).toHaveCount(0);
          await expect(page.getByText(`Page ${after}`, { exact: true })).toHaveCount(1);
          expect(
            await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().error),
          ).toBeUndefined();
        }
      } finally {
        await context.close();
      }
    });
  }
}
