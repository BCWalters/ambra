import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

test("transient shell overflow does not rebuild a just-navigated spread (#150)", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 1400, height: 900 },
    showScrollbars: true,
  });
  try {
    await exposeReaderController(page);
    // Exercise classic scrollbar geometry even on systems using overlay scrollbars.
    await page.addStyleTag({ content: "html::-webkit-scrollbar { width: 15px; height: 15px; }" });
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 0);
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.seekToFraction(0.5);
      const state = {
        host: controller.host,
        snapshot: controller.snapshot(),
        resizes: [] as number[],
      };
      Reflect.set(window, "__viewportStability", state);
      const resize = controller.resize.bind(controller);
      controller.resize = (width: number, height: number) => {
        state.resizes.push(width);
        resize(width, height);
      };
    });
    await page.mouse.move(600, 2);
    await page.getByRole("button", { name: "Book details", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Book details" })).toBeVisible();
    await page.evaluate(async () => {
      // A briefly unpositioned shell portal must not make the reader document
      // scrollable: the book and panels own their scrolling independently.
      const overflow = document.createElement("div");
      Object.assign(overflow.style, {
        position: "absolute", top: "100vh", width: "1px", height: "1px",
      });
      document.body.appendChild(overflow);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      overflow.remove();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    expect(await page.evaluate(() => Reflect.get(window, "__viewportStability").resizes)).toEqual([]);
    expect(await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const before = Reflect.get(window, "__viewportStability");
      const after = controller.snapshot();
      return {
        sameHost: controller.host === before.host,
        samePage: after.bookPageIndex === before.snapshot.bookPageIndex,
        sameCount: after.bookPageCount === before.snapshot.bookPageCount,
        width: after.paneWidth,
      };
    })).toEqual({ sameHost: true, samePage: true, sameCount: true, width: 1400 });

    await page.setViewportSize({ width: 1300, height: 900 });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().paneWidth)).toBe(1300);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageCount)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
