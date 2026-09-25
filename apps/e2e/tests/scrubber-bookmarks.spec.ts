import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const longBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));

async function measured(page: Page) {
  await page.waitForFunction(() => {
    const controller = Reflect.get(window, "__readerController");
    const snapshot = controller?.snapshot();
    return snapshot?.bookPageCount > 0 && !controller.isLoadInFlight &&
      !controller.isTurningPage && !controller.isApplyingLayout && !controller.pendingLayout;
  });
}

async function expectFlagGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const slider = document.querySelector('[role="slider"][aria-label="Position in book"]')!;
    const track = slider.getBoundingClientRect();
    const thumb = slider.querySelector("[data-scrubber-thumb]")!.getBoundingClientRect();
    const snapshot = Reflect.get(window, "__readerController").snapshot();
    const fractions = [...new Set<number>(snapshot.bookmarkProgress.map(
      (marker: { fraction: number }) => marker.fraction,
    ))];
    return [...slider.querySelectorAll("[data-bookmark-marker]")].map((marker, index) => {
      const rect = marker.getBoundingClientRect();
      const fraction = fractions[index]!;
      return {
        width: rect.width, height: rect.height,
        gap: thumb.top - rect.bottom,
        left: rect.left, right: rect.right, viewport: innerWidth,
        error: Math.abs(rect.left + rect.width / 2 - track.left - track.width *
          (snapshot.pageProgressionDirection === "rtl" ? 1 - fraction : fraction)),
        pointerEvents: getComputedStyle(marker).pointerEvents,
      };
    });
  });
  expect(geometry.length).toBeGreaterThan(0);
  for (const mark of geometry) {
    expect(mark.width).toBe(18);
    expect(mark.height).toBe(18);
    expect(mark.gap).toBeGreaterThanOrEqual(2);
    expect(mark.error).toBeLessThan(1);
    expect(mark.left).toBeGreaterThanOrEqual(0);
    expect(mark.right).toBeLessThanOrEqual(mark.viewport);
    expect(mark.pointerEvents).toBe("none");
  }
}

for (const width of [320, 1400]) {
  test(`${width}px: current and nearby bookmark flags stay distinct from the thumb (#214)`, async ({ browserName }, info) => {
    test.setTimeout(180_000);
    const { context, readerPage: page } = await launchReader(longBook, {
      viewport: { width, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await measured(page);
      await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.seekToFraction(0.5);
        await controller.toggleBookmark();
        await controller.turnPage(1);
        await controller.toggleBookmark();
      });
      await measured(page);
      await page.mouse.move(10, 2);
      const slider = page.getByRole("slider", { name: "Position in book" });
      await slider.focus();
      await expect(page.locator("[data-bookmark-marker]")).toHaveCount(2);
      await expect(slider).toHaveAccessibleDescription("Bookmarks: 2");
      await expect(slider).toHaveAttribute("aria-valuetext", /Bookmarked$/);
      await expectFlagGeometry(page);
      await page.screenshot({ path: info.outputPath(`overlap-${width}-${browserName}.png`) });
      // A dense cluster still represents every saved bookmark, not just one flag.
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const snapshot = controller.snapshot.bind(controller);
        const state = snapshot();
        const clustered = {
          ...state,
          bookmarks: [...state.bookmarks, { ...state.bookmarks[0], id: "cluster-copy" }],
          bookmarkProgress: [
            ...state.bookmarkProgress,
            { ...state.bookmarkProgress[0], id: "cluster-copy" },
          ],
        };
        controller.snapshot = () => clustered;
        Reflect.set(window, "__restoreBookmarkSnapshot", () => { controller.snapshot = snapshot; });
        controller.notify();
      });
      await expect(slider).toHaveAccessibleDescription("Bookmarks: 3");
      await expect(page.locator("[data-bookmark-marker]")).toHaveCount(2);
      await expectFlagGeometry(page);
      await page.screenshot({ path: info.outputPath(`cluster-${width}.png`) });
      await page.evaluate(async () => {
        Reflect.get(window, "__restoreBookmarkSnapshot")();
        const controller = Reflect.get(window, "__readerController");
        await controller.seekToFraction(1);
        await controller.toggleBookmark();
      });
      await measured(page);
      await slider.focus();
      await expectFlagGeometry(page);
      await expect(slider).toHaveAttribute("aria-valuetext", /Bookmarked$/);
      const track = (await slider.boundingBox())!;
      await page.mouse.move(track.x + track.width - 0.1, track.y + track.height - 10);
      await page.mouse.down();
      await expect(page.locator("[data-bookmark-status]")).toHaveText("Bookmarked");
      const popup = (await page.locator("[data-scrubber-preview]").boundingBox())!;
      expect(popup.x).toBeGreaterThanOrEqual(7);
      expect(popup.x + popup.width).toBeLessThanOrEqual(width - 7);
      await page.screenshot({ path: info.outputPath(`last-page-${width}.png`) });
      await page.mouse.up();
      await measured(page);
      await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
      await expectFlagGeometry(page);
      await expect(slider.locator("..")).toHaveCSS("transition-duration", "0s");
      const flag = page.locator("[data-bookmark-marker]").last();
      await expect(flag).toHaveCSS("color", "rgb(0, 0, 0)");
      await page.screenshot({ path: info.outputPath(`forced-colors-${width}.png`) });
      // Stress subpixel spacing without generating/paginating a 20,000-page EPUB.
      await page.emulateMedia({ forcedColors: "none" });
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const state = controller.snapshot();
        const endOfLongBook = {
          ...state,
          bookPageIndex: 20_000,
          bookPageCount: 20_000,
          bookmarkProgress: [19_998, 19_999, 20_000].map(current => ({
            id: String(current), fraction: current / 20_000,
          })),
        };
        controller.snapshot = () => endOfLongBook;
        controller.notify();
      });
      await expect(slider).toHaveAttribute("aria-valuetext", /Page 20000 of 20000.*Bookmarked$/);
      await expect(page.locator("[data-bookmark-marker]")).toHaveCount(3);
      await expectFlagGeometry(page);
      await page.screenshot({ path: info.outputPath(`long-book-last-page-${width}.png`) });
    } finally {
      await context.close();
    }
  });
}

test("320px RTL: bookmark flags retain true positions at both edges (#214)", async ({ browserName }, info) => {
  const rtlBook = fileURLToPath(new URL("../fixtures/fxl-spread-rtl.epub", import.meta.url));
  const { context, readerPage: page } = await launchReader(rtlBook, {
    viewport: { width: 320, height: 800 },
  });
  try {
    await exposeReaderController(page);
    await measured(page);
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.seekToFraction(0);
      await controller.toggleBookmark();
      await controller.seekToFraction(1);
      await controller.toggleBookmark();
    });
    await measured(page);
    const slider = page.getByRole("slider", { name: "Position in book" });
    await slider.focus();
    await expect(page.locator("[data-bookmark-marker]")).toHaveCount(2);
    await expect(slider).toHaveAttribute("aria-valuetext", /Bookmarked$/);
    await expectFlagGeometry(page);
    const track = (await slider.boundingBox())!;
    await page.mouse.move(track.x + 0.1, track.y + track.height - 10);
    await page.mouse.down();
    await expect(page.locator("[data-bookmark-status]")).toHaveText("Bookmarked");
    const popup = (await page.locator("[data-scrubber-preview]").boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(7);
    expect(popup.x + popup.width).toBeLessThanOrEqual(313);
    await page.screenshot({ path: info.outputPath(`rtl-left-edge-${browserName}.png`) });
    await page.mouse.up();
    await measured(page);
    await slider.press("Home");
    await measured(page);
    await expectFlagGeometry(page);
    await page.screenshot({ path: info.outputPath("rtl-first-page.png") });
  } finally {
    await context.close();
  }
});

async function toggleBookmark(page: Page, name: string) {
  await page.mouse.move(10, 2);
  await page.getByRole("button", { name, exact: true }).click();
}

test("short viewports keep narration notice controls above the flag lane (#214)", async () => {
  const narratedBook = fileURLToPath(new URL("../fixtures/media-overlay/narrated.epub", import.meta.url));
  const { context, readerPage: page } = await launchReader(narratedBook, {
    viewport: { width: 320, height: 256 },
  });
  try {
    await exposeReaderController(page);
    await measured(page);
    const currentPage = await page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().bookPageIndex);
    await page.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(page.locator("[data-narration-discovery]")).toHaveCount(0);
    expect(await page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().bookPageIndex)).toBe(currentPage);
  } finally {
    await context.close();
  }
});

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
