import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));

async function measured(page: Page) {
  await page.waitForFunction(() => {
    const controller = Reflect.get(window, "__readerController");
    const snapshot = controller?.snapshot();
    return snapshot?.bookPageCount > 0 && !controller.isLoadInFlight &&
      !controller.isTurningPage && !controller.isApplyingLayout && !controller.pendingLayout;
  });
}

async function toggleBookmark(page: Page, name: string) {
  await page.mouse.move(10, 2);
  await page.getByRole("button", { name, exact: true }).click();
}

for (const width of [900, 1400]) {
  test(`${width}px: progress bookmarks survive reflow and reload without intercepting seeking (#186)`, async ({ browserName }, info) => {
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await measured(page);
      for (const fraction of [0.2, 0.7]) {
        await page.evaluate(async target => {
          await Reflect.get(window, "__readerController").seekToFraction(target);
        }, fraction);
        await measured(page);
        await toggleBookmark(page, "Bookmark this page");
      }
      const marks = page.locator("[data-bookmark-marker]");
      await expect(marks).toHaveCount(2);
      const slider = page.getByRole("slider", { name: "Position in book" });
      await expect(slider).toHaveAccessibleDescription("Bookmarks: 2");

      const positions = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        return controller.snapshot().bookmarkProgress as Array<{ id: string; fraction: number }>;
      });
      expect(positions[0]!.fraction).toBeLessThan(positions[1]!.fraction);
      for (const [index, marker] of positions.entries()) {
        const track = (await slider.boundingBox())!;
        const mark = (await marks.nth(index).boundingBox())!;
        expect(Math.abs(mark.x + mark.width / 2 - track.x - track.width * marker.fraction))
          .toBeLessThan(1);
        await expect(marks.nth(index)).toHaveCSS("pointer-events", "none");
      }
      await page.screenshot({ path: info.outputPath(`bookmark-progress-${browserName}.png`) });

      // Clicking the painted marker still belongs to the slider's ordinary seek.
      await page.mouse.move(10, 2);
      await expect(slider).toHaveCSS("pointer-events", "auto");
      const first = await marks.first().boundingBox();
      await page.mouse.click(first!.x + first!.width / 2, first!.y + first!.height / 2);
      await measured(page);
      await expect.poll(() => page.evaluate(() =>
        Reflect.get(window, "__readerController").snapshot().isBookmarked)).toBe(true);

      await page.evaluate(async () => {
        await Reflect.get(window, "__readerController").setFontScale(1.4);
      });
      await page.setViewportSize({ width: width === 900 ? 1400 : 900, height: 780 });
      await measured(page);
      await expect(marks).toHaveCount(2);
      await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.goToBookmark(controller.snapshot().bookmarks[0].cfi);
      });
      await measured(page);
      await toggleBookmark(page, "Remove bookmark");
      await expect(marks).toHaveCount(1);
      await expect(slider).toHaveAccessibleDescription("Bookmarks: 1");

      await page.reload();
      await page.waitForFunction(() => [...document.querySelectorAll("iframe")]
        .some(frame => frame.contentDocument?.body?.querySelector("p")));
      await exposeReaderController(page);
      await measured(page);
      await expect(marks).toHaveCount(1);
      await expect(slider).toHaveAccessibleDescription("Bookmarks: 1");
    } finally {
      await context.close();
    }
  });
}
