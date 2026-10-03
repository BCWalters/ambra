import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/long-content.epub");

for (const width of [760, 1400]) {
  test(`${width}px scrubber navigation persists measured Library progress (#319)`, async () => {
    const { context, readerPage: page, libraryPage } = await launchReader(fixture, {
      viewport: { width, height: 900 },
    });
    try {
      const libraryUrl = new URL(libraryPage.url());
      libraryUrl.searchParams.set("view", "tab");
      await libraryPage.goto(libraryUrl.href);
      await exposeReaderController(page);
      await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 1);
      const initialFraction = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.turnPage(1);
        await controller.flushProgress(true);
        return (await controller.library.getProgress(controller.bookId)).fractionComplete;
      });
      expect(initialFraction).toEqual(expect.any(Number));
      const slider = page.getByRole("slider", { name: "Position in book" });
      for (const { fraction, outside } of [
        { fraction: 0.7, outside: false },
        { fraction: 0.85, outside: false },
        { fraction: 0.35, outside: true },
      ]) {
        await page.mouse.move(width / 2, 895);
        const bounds = (await slider.boundingBox())!;
        const y = bounds.y + bounds.height / 2;
        await page.mouse.move(bounds.x + bounds.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * fraction, outside ? y - 120 : y);
        await page.mouse.up();
        await expect.poll(() => page.evaluate(fraction => {
          const controller = Reflect.get(window, "__readerController");
          const snapshot = controller.snapshot();
          const wanted = Math.max(1, Math.round(fraction * snapshot.bookPageCount));
          return !controller.isLoadInFlight &&
            (snapshot.bookPageIndex === wanted || snapshot.spreadPageNumbers?.includes(wanted));
        }, fraction)).toBe(true);
        const saved = await page.evaluate(async () => {
          const controller = Reflect.get(window, "__readerController");
          const beforeFlush = await controller.library.getProgress(controller.bookId);
          await controller.flushProgress(true);
          const progress = await controller.library.getProgress(controller.bookId);
          return {
            fraction: progress.fractionComplete,
            cfi: progress.cfi,
            total: controller.snapshot().bookPageCount,
            beforeFlushFraction: beforeFlush.fractionComplete,
            beforeFlushCfi: beforeFlush.cfi,
          };
        });
        const expectedFraction = Math.max(1, Math.round(fraction * saved.total)) / saved.total;
        expect(saved.beforeFlushFraction).toBeCloseTo(expectedFraction, 6);
        expect(saved.fraction).toBeCloseTo(expectedFraction, 6);
        expect(saved.cfi).toBe(saved.beforeFlushCfi);
        await libraryPage.reload();
        const percent = `${Math.round(expectedFraction * 100)}%`;
        await expect(libraryPage.locator("[data-library-book]:not([data-library-continue])")
          .locator("[data-library-progress-status]")).toContainText(percent);
        await expect(libraryPage.getByRole("region", { name: "Continue reading", exact: true })
          .locator("[data-library-progress-status]")).toContainText(`${percent} read`);
      }
    } finally {
      await context.close();
    }
  });
}
