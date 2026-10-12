import { expect, test } from "@playwright/test";
import path from "node:path";
import { launchReader, READER_FRAME_SELECTOR } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

for (const single of [false, true]) {
  for (const style of ["slide", "scroll"] as const) {
    test(`${single ? "single" : "spread"} ${style}: a controlled warm turn refills both idle candidates`, async () => {
      const { context, readerPage: page } = await launchReader(
        navigationFixture(test.info(), [12]),
        { viewport: { width: 1547, height: 878 } },
      );
      try {
        await exposeReaderController(page);
        await page.evaluate(async ({ single, style }) => {
          const c = Reflect.get(window, "__readerController");
          await c.setPageTurnAnimationStyle("none");
          await c.setAlwaysShowOnePage(single);
          await c.turnPage(1);
          await c.setPageTurnAnimationStyle(style);
        }, { single, style });
        await page.waitForFunction(() => {
          const cache = Reflect.get(window, "__readerController").pageTurnPrefetch;
          return cache.entries.get(1)?.value && cache.entries.get(-1)?.value;
        });
        const before = await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          Reflect.set(window, "__dragCandidate", c.pageTurnPrefetch.entries.get(1).value.host);
          const edge = [...c.pageMargins().edges].sort((a, b) => a.left - b.left).at(-1);
          return { x: edge.right - 3, y: edge.top + edge.height / 2, width: c.width, cfi: c.currentReadingCfi() };
        });
        await page.mouse.move(before.x, before.y);
        await page.mouse.down();
        await page.mouse.move(before.x - before.width * 0.48, before.y, { steps: 12 });
        await page.waitForTimeout(150);
        await page.mouse.up();
        await page.waitForFunction(() => {
          const c = Reflect.get(window, "__readerController");
          return !c.isTurningPage && !c.controlledTurn && !c.gestureCleanup;
        });
        expect(await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          return c.host === Reflect.get(window, "__dragCandidate");
        })).toBe(true);
        const after = await page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi());
        expect(after).not.toBe(before.cfi);
        await page.waitForFunction(() => {
          const c = Reflect.get(window, "__readerController");
          const cache = c.pageTurnPrefetch;
          return cache.source === c.host && cache.entries.get(1)?.value && cache.entries.get(-1)?.value;
        });
        expect(await page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi())).toBe(after);
        await page.evaluate(() => Reflect.get(window, "__readerController").dispose());
        await expect(page.locator("iframe")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
}

for (const rtl of [false, true]) {
  for (const style of ["slide", "scroll"] as const) {
    test(`single ${rtl ? "RTL" : "LTR"} ${style}: idle preparation includes the next chapter`, async () => {
      const { context, readerPage: page } = await launchReader(
        navigationFixture(test.info(), [2, 2], undefined, rtl ? "rtl" : "ltr"),
        { viewport: { width: 1547, height: 878 } },
      );
      try {
        await exposeReaderController(page);
        await page.evaluate(async (style) => {
          const c = Reflect.get(window, "__readerController");
          await c.setPageTurnAnimationStyle("none");
          await c.setAlwaysShowOnePage(true);
          await c.openSpineItem(0, { landOnLastPage: true });
          await c.setPageTurnAnimationStyle(style);
        }, style);
        for (const direction of [1, -1] as const) {
          await page.waitForFunction((direction) => {
            const c = Reflect.get(window, "__readerController");
            return (
              c.pageTurnPrefetch.entries.get(direction)?.value?.spineIndex ===
              (direction === 1 ? 1 : 0)
            );
          }, direction);
          await page.evaluate(async (direction) => {
            const c = Reflect.get(window, "__readerController");
            Reflect.set(
              window,
              "__chapterCandidate",
              c.pageTurnPrefetch.entries.get(direction).value.host,
            );
            await c.turnPage(direction);
          }, direction);
          expect(
            await page.evaluate(() => {
              const c = Reflect.get(window, "__readerController");
              return c.host === Reflect.get(window, "__chapterCandidate");
            }),
          ).toBe(true);
          expect(
            await page.evaluate(() => Reflect.get(window, "__readerController").spineIndex),
          ).toBe(direction === 1 ? 1 : 0);
          const persisted = await page.evaluate(async () => {
            const c = Reflect.get(window, "__readerController");
            return { saved: (await c.library.getProgress(c.bookId))?.cfi, current: c.currentReadingCfi() };
          });
          expect(persisted.saved).toBe(persisted.current);
          await expect(page.locator(READER_FRAME_SELECTOR)).toHaveCount(1);
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

for (const fixed of [false, true]) {
  for (const single of [false, true]) {
    for (const rtl of [false, true]) {
      for (const style of ["slide", "scroll"] as const) {
        test(`${fixed ? "fixed" : "reflowable"} ${single ? "single" : "spread"} ${rtl ? "RTL" : "LTR"} ${style}: idle candidates are ready before either direction starts`, async () => {
          const book = fixed
            ? path.resolve("fixtures", rtl ? "fxl-spread-rtl.epub" : "fxl-spread-ltr.epub")
            : navigationFixture(test.info(), [12], undefined, rtl ? "rtl" : "ltr");
          const { context, readerPage: page } = await launchReader(book, {
            viewport: fixed && single ? { width: 680, height: 900 } : { width: 1547, height: 878 },
          });
          try {
            await exposeReaderController(page);
            await page.evaluate(
              async ({ single, style }) => {
                const c = Reflect.get(window, "__readerController");
                await c.setPageTurnAnimationStyle("none");
                await c.setAlwaysShowOnePage(single);
                await c.turnPage(1);
                await c.setPageTurnAnimationStyle(style);
              },
              { single, style },
            );
            for (const direction of [1, -1] as const) {
              await page.waitForFunction((direction) => {
                const cache = Reflect.get(window, "__readerController").pageTurnPrefetch;
                return (
                  cache.entries.get(direction)?.value &&
                  (direction === -1 || cache.entries.get(-1)?.value)
                );
              }, direction);
              const before = await page.evaluate(() =>
                Reflect.get(window, "__readerController").currentReadingCfi(),
              );
              const ready = await page.evaluate((direction) => {
                const c = Reflect.get(window, "__readerController");
                const candidate = c.pageTurnPrefetch.entries.get(direction).value;
                Reflect.set(window, "__expectedPrefetchedHost", candidate.host);
                Reflect.set(window, "__preloadCfi", c.currentReadingCfi());
                return {
                  count: c.pageTurnPrefetch.entries.size,
                  inert: candidate.host.element.inert,
                  opacity: getComputedStyle(candidate.wrapper ?? candidate.host.element).opacity,
                  documents: c
                    .contentDocumentViews(candidate.host)
                    .map(({ document: doc }: { document: Document }) => ({
                      text: doc.body.textContent,
                      ready: doc.readyState,
                    })),
                };
              }, direction);
              expect(ready.count).toBe(2);
              expect(ready.inert).toBe(true);
              expect(ready.opacity).toBe("0");
              expect(
                ready.documents.every(
                  (doc: { text: string; ready: string }) => !!doc.text && doc.ready === "complete",
                ),
              ).toBe(true);
              await page.evaluate(async (direction) => {
                const c = Reflect.get(window, "__readerController");
                const prototype = HTMLIFrameElement.prototype;
                const descriptor = Object.getOwnPropertyDescriptor(prototype, "src")!;
                let loads = 0;
                Object.defineProperty(prototype, "src", {
                  ...descriptor,
                  set(this: HTMLIFrameElement, value: string) {
                    loads++;
                    descriptor.set!.call(this, value);
                  },
                });
                try {
                  await c.turnPage(direction);
                  Reflect.set(window, "__foregroundLoads", loads);
                } finally {
                  Object.defineProperty(prototype, "src", descriptor);
                }
              }, direction);
              expect(await page.evaluate(() => Reflect.get(window, "__foregroundLoads"))).toBe(0);
              expect(
                await page.evaluate(() => {
                  const c = Reflect.get(window, "__readerController");
                  return (
                    c.host === Reflect.get(window, "__expectedPrefetchedHost") &&
                    !c.host.element.inert
                  );
                }),
              ).toBe(true);
              expect(
                await page.evaluate(() =>
                  Reflect.get(window, "__readerController").currentReadingCfi(),
                ),
              ).not.toBe(before);
              await expect(page.locator(READER_FRAME_SELECTOR)).toHaveCount(ready.documents.length);
              expect(
                await page.evaluate(
                  () => Reflect.get(window, "__readerController").snapshot().error,
                ),
              ).toBeUndefined();
            }
            await page.waitForFunction(
              () =>
                Reflect.get(window, "__readerController").pageTurnPrefetch.entries.get(1)?.value,
            );
            const resizedWidth = await page.evaluate(() => {
              const c = Reflect.get(window, "__readerController");
              const cached = [...c.pageTurnPrefetch.entries.values()].map(
                (entry) =>
                  (entry as { value?: { host: { element: HTMLElement } } }).value?.host.element,
              );
              Reflect.set(window, "__oldPrefetchedElements", cached);
              return c.width - 20;
            });
            await page.setViewportSize({
              width: resizedWidth,
              height: fixed && single ? 900 : 878,
            });
            await page.waitForFunction((width) => {
              const c = Reflect.get(window, "__readerController");
              return (
                c.width === width && !c.isApplyingLayout && !c.isLoadInFlight && !c.pendingLayout
              );
            }, resizedWidth);
            expect(
              await page.evaluate(() =>
                Reflect.get(window, "__oldPrefetchedElements").every(
                  (element: HTMLElement | undefined) => !element?.isConnected,
                ),
              ),
            ).toBe(true);
            await page.evaluate(() => Reflect.get(window, "__readerController").dispose());
            await expect(page.locator("iframe")).toHaveCount(0);
          } finally {
            await context.close();
          }
        });
      }
    }
  }
}
