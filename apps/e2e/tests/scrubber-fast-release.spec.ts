import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/long-content.epub");

for (const width of [760, 1400]) {
  test(`${width}px quick scrubber releases commit once, including releases over the book (#146)`, async () => {
    const { context, readerPage: page } = await launchReader(fixture, { viewport: { width, height: 900 } });
    try {
      await exposeReaderController(page);
      await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 0);
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const state = { calls: [] as number[], settled: 0 };
        Reflect.set(window, "__fastSeeks", state);
        const seek = controller.seekToFraction.bind(controller);
        controller.seekToFraction = async (fraction: number) => {
          state.calls.push(fraction);
          await seek(fraction);
          state.settled++;
        };
      });
      const slider = page.getByRole("slider", { name: "Position in book" });
      for (let index = 0; index < 24; index++) {
        await page.mouse.move(width / 2, 895);
        const bounds = (await slider.boundingBox())!;
        const fraction = index % 2 ? 0.12 : 0.85;
        const y = bounds.y + bounds.height / 2;
        await page.mouse.move(bounds.x + bounds.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * fraction, index % 3 ? y : y - 120);
        await page.mouse.up();
        await expect.poll(() => page.evaluate(() => Reflect.get(window, "__fastSeeks").calls.length)).toBe(index + 1);
        await expect.poll(() => page.evaluate(() => Reflect.get(window, "__fastSeeks").settled)).toBe(index + 1);
        await expect.poll(() => page.evaluate(fraction => {
          const snapshot = Reflect.get(window, "__readerController").snapshot();
          const wanted = Math.max(1, Math.round(fraction * snapshot.bookPageCount));
          return snapshot.bookPageIndex === wanted || snapshot.spreadPageNumbers?.includes(wanted);
        }, fraction)).toBe(true);
      }
    } finally {
      await context.close();
    }
  });
}
