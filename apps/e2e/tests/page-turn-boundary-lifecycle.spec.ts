import { expect, test, type Page } from "@playwright/test";
import { launchReader, READER_FRAME_SELECTOR } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return !c.isTurningPage && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
  });
  await expect(
    page.locator(
      "[data-ambra-curled-leaf], [data-ambra-page-turn-input], [data-ambra-turn-furniture]",
    ),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().error),
  ).toBeUndefined();
}

async function drag(page: Page, direction: 1 | -1, fraction: number): Promise<void> {
  const bounds = await page.evaluate((direction) => {
    const c = Reflect.get(window, "__readerController");
    const edges = [...c.pageMargins().edges].sort((a, b) => a.left - b.left);
    const edge = edges[direction === 1 ? edges.length - 1 : 0];
    return {
      x: direction === 1 ? edge.right - 3 : edge.left + 3,
      y: edge.top + edge.height / 2,
      width: c.width,
    };
  }, direction);
  await page.mouse.move(bounds.x, bounds.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x - direction * Math.ceil(bounds.width * fraction), bounds.y, { steps: 12 });
  await page.waitForTimeout(300);
}

for (const single of [false, true]) {
  for (const rtl of [false, true]) {
    test(`${single ? "single" : "spread"} ${rtl ? "RTL" : "LTR"}: prepared chapter reveals use a curled leaf in both directions`, async () => {
      const { context, readerPage: page } = await launchReader(
        navigationFixture(test.info(), [2, 2], undefined, rtl ? "rtl" : "ltr"),
        { viewport: { width: 1547, height: 878 } },
      );
      try {
        await exposeReaderController(page);
        await page.evaluate(async (single) => {
          const c = Reflect.get(window, "__readerController");
          await c.setAlwaysShowOnePage(single);
          await c.setPageTurnAnimationStyle("rotate");
          const orchestrator = c.pageTurnOrchestrator;
          const create = orchestrator.createCurledLeaf.bind(orchestrator);
          orchestrator.createCurledLeaf = (...args: unknown[]) => {
            const leaf = create(...args);
            const settle = leaf.settle.bind(leaf);
            leaf.settle = async (...args: unknown[]) => {
              leaf.paint(0.3);
              await new Promise<void>((resolve) =>
                Reflect.set(window, "__releaseChapterCurl", resolve),
              );
              Reflect.set(window, "__releaseChapterCurl", undefined);
              await settle(...args);
            };
            return leaf;
          };
        }, single);
        for (const [spineIndex, direction] of [
          [1, 1],
          [0, -1],
        ] as const) {
          await page.evaluate(
            ({ spineIndex, direction }) => {
              Reflect.set(
                window,
                "__chapterCurlDone",
                Reflect.get(window, "__readerController").openSpineItem(spineIndex, {
                  animateDirection: direction,
                  landOnLastPage: direction === -1,
                }),
              );
            },
            { spineIndex, direction },
          );
          await page.waitForFunction(() => !!Reflect.get(window, "__releaseChapterCurl"));
          await page.waitForTimeout(250);
          expect(
            await page.evaluate(
              () => Reflect.get(window, "__readerController").snapshot().isLoading,
            ),
          ).toBe(false);
          await expect(page.locator("[data-ambra-curled-leaf]")).toHaveAttribute(
            "data-progress",
            "0.3",
          );
          const headers = await page.locator("[data-ambra-turn-furniture]").allTextContents();
          expect(headers.join(" ")).toContain("Chapter 1");
          expect(headers.join(" ")).toContain("Chapter 2");
          await page.screenshot({
            path: test.info().outputPath(`chapter-curled-${direction}.png`),
          });
          await page.evaluate(() => Reflect.get(window, "__releaseChapterCurl")());
          await page.evaluate(() => Reflect.get(window, "__chapterCurlDone"));
          await settled(page);
          expect(
            await page.evaluate(() => Reflect.get(window, "__readerController").spineIndex),
          ).toBe(spineIndex);
          await expect(page.locator(READER_FRAME_SELECTOR)).toHaveCount(single ? 1 : 2);
        }
      } finally {
        await context.close();
      }
    });
  }
  for (const style of ["rotate", "slide", "scroll"] as const) {
    test(`${single ? "single" : "spread"} ${style}: chapter drags return and commit without stale input at book ends`, async () => {
      const { context, readerPage: page } = await launchReader(
        navigationFixture(test.info(), [2, 2]),
        {
          viewport: { width: 1547, height: 878 },
        },
      );
      try {
        await exposeReaderController(page);
        await page.evaluate(
          async ({ single, style }) => {
            const c = Reflect.get(window, "__readerController");
            await c.setAlwaysShowOnePage(single);
            await c.setPageTurnAnimationStyle(style);
            await c.openSpineItem(0, { landOnLastPage: true });
          },
          { single, style },
        );
        await settled(page);
        const original = await page.evaluate(() =>
          Reflect.get(window, "__readerController").currentReadingCfi(),
        );
        const threshold = single && style === "rotate" ? 0.25 : 0.4;
        await drag(page, 1, threshold - 0.01);
        await page.mouse.up();
        await settled(page);
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi()),
        ).toBe(original);
        await drag(page, 1, threshold);
        await page.mouse.up();
        await settled(page);
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").spineIndex),
        ).toBe(1);
        await drag(page, -1, threshold);
        await page.mouse.up();
        await settled(page);
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi()),
        ).toBe(original);
        for (const [spine, direction] of [
          [0, -1],
          [1, 1],
        ] as const) {
          await page.evaluate(
            async ({ spine, direction }) => {
              await Reflect.get(window, "__readerController").openSpineItem(spine, {
                landOnLastPage: direction === 1,
              });
            },
            { spine, direction },
          );
          const before = await page.evaluate(() =>
            Reflect.get(window, "__readerController").currentReadingCfi(),
          );
          await drag(page, direction, 0.45);
          await page.mouse.up();
          await settled(page);
          expect(
            await page.evaluate(() =>
              Reflect.get(window, "__readerController").currentReadingCfi(),
            ),
          ).toBe(before);
        }
      } finally {
        await context.close();
      }
    });

    for (const action of ["resize", "settings", "seek"] as const) {
      test(`${single ? "single" : "spread"} ${style}: ${action} during an active drag settles and restores navigation`, async () => {
        const { context, readerPage: page } = await launchReader(
          navigationFixture(test.info(), [12, 12]),
          {
            viewport: { width: 1547, height: 878 },
          },
        );
        try {
          await exposeReaderController(page);
          await page.evaluate(
            async ({ single, style }) => {
              const c = Reflect.get(window, "__readerController");
              await c.setAlwaysShowOnePage(single);
              await c.setPageTurnAnimationStyle(style);
            },
            { single, style },
          );
          await drag(page, 1, 0.45);
          await page.waitForFunction(
            () => Reflect.get(window, "__readerController").isAnimatingPageTurn,
          );
          if (action === "resize") await page.setViewportSize({ width: 1200, height: 850 });
          else
            await page.evaluate((action) => {
              const c = Reflect.get(window, "__readerController");
              Reflect.set(
                window,
                "__dragReplacement",
                action === "settings" ? c.setFontScale(1.25) : c.seekToFraction(0.75),
              );
            }, action);
          await page.mouse.up();
          if (action !== "resize")
            await page.evaluate(() => Reflect.get(window, "__dragReplacement"));
          await settled(page);
          const state = await page.evaluate(() => {
            const c = Reflect.get(window, "__readerController");
            return {
              scale: c.fontScale,
              spine: c.spineIndex,
              width: c.width,
              cfi: c.currentReadingCfi(),
            };
          });
          if (action === "resize") expect(state.width).toBe(1200);
          if (action === "settings") expect(state.scale).toBe(1.25);
          if (action === "seek") expect(state.spine).toBe(1);
          await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
          await settled(page);
          expect(
            await page.evaluate(() =>
              Reflect.get(window, "__readerController").currentReadingCfi(),
            ),
          ).not.toBe(state.cfi);
          await expect(page.locator(READER_FRAME_SELECTOR)).toHaveCount(single ? 1 : 2);
        } finally {
          await context.close();
        }
      });
    }
  }
}
