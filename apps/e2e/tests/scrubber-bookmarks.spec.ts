import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { getInterfaceTheme } from "../../../packages/shell/src/theme.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const longBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const t = getTranslate("en");
const theme = getInterfaceTheme("ambra", "light");

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
    const lane = document.querySelector("[data-bookmark-lane]")!;
    const track = slider.getBoundingClientRect();
    const thumb = slider.querySelector("[data-scrubber-thumb]")!.getBoundingClientRect();
    const snapshot = Reflect.get(window, "__readerController").snapshot();
    const ordered = snapshot.bookmarks.map((bookmark: { id: string }) =>
      snapshot.bookmarkProgress.find((marker: { id: string }) => marker.id === bookmark.id),
    ).filter(Boolean).sort((a: { fraction: number }, b: { fraction: number }) => a.fraction - b.fraction);
    return [...lane.querySelectorAll<HTMLElement>("[data-bookmark-marker]")].map(marker => {
      const rect = marker.getBoundingClientRect();
      const count = Number(marker.dataset.bookmarkCount);
      const first = ordered.findIndex((item: { id: string }) => item.id === marker.dataset.groupId);
      const fraction = (ordered[first].fraction + ordered[first + count - 1].fraction) / 2;
      return {
        width: rect.width, height: rect.height,
        expectedWidth: count > 1 ? 40 : 24,
        laneHeight: lane.getBoundingClientRect().height,
        footerHeight: slider.parentElement!.getBoundingClientRect().height,
        insideSlider: slider.contains(marker),
        gap: rect.top - thumb.bottom,
        left: rect.left, right: rect.right, viewport: innerWidth,
        error: Math.abs(rect.left + rect.width / 2 - track.left - track.width *
          (snapshot.pageProgressionDirection === "rtl" ? 1 - fraction : fraction)),
        pointerEvents: getComputedStyle(marker).pointerEvents,
      };
    });
  });
  expect(geometry.length).toBeGreaterThan(0);
  for (const mark of geometry) {
    expect(mark.width).toBe(mark.expectedWidth);
    expect(mark.height).toBe(24);
    expect(mark.laneHeight).toBe(24);
    expect(mark.footerHeight).toBeLessThanOrEqual(76);
    expect(mark.insideSlider).toBe(false);
    expect(mark.gap).toBeGreaterThanOrEqual(2);
    expect(mark.error).toBeLessThan(1);
    expect(mark.left).toBeGreaterThanOrEqual(0);
    expect(mark.right).toBeLessThanOrEqual(mark.viewport);
    expect(mark.pointerEvents).toBe("auto");
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
      await expect(slider).toHaveAccessibleDescription(/Bookmarks: 2(?:\s|$)/);
      await expect(slider).toHaveAttribute("aria-valuetext", /Bookmarked$/);
      await expectFlagGeometry(page);
      await page.screenshot({ path: info.outputPath(`overlap-${width}-${browserName}.png`) });
      await page.getByRole("button", { name: "Annotations", exact: true }).click();
      const panel = page.getByRole("navigation", { name: "Annotations", exact: true });
      await expect(panel).toBeVisible();
      await expect.poll(async () => {
        const panelBox = (await panel.boundingBox())!;
        const barBox = (await slider.locator("..").boundingBox())!;
        return panelBox.y + panelBox.height - barBox.y;
      }).toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "Close annotations panel", exact: true }).click();
      await slider.focus();
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
      await expect(slider).toHaveAccessibleDescription(/Bookmarks: 3(?:\s|$)/);
      const groupCount = width === 320 ? 3 : 2;
      await expect(page.locator("[data-bookmark-marker]")).toHaveCount(width === 320 ? 1 : 2);
      const groupedFlag = page.locator(`[data-bookmark-marker][data-bookmark-count="${groupCount}"]`);
      await expect(groupedFlag).toBeVisible();
      await expectFlagGeometry(page);
      await groupedFlag.click();
      const chooser = page.getByRole("dialog", { name: t("scrubber.chooseBookmark", { count: groupCount }), exact: true });
      await expect(chooser).toBeVisible();
      await expect(chooser.getByRole("button")).toHaveCount(groupCount);
      await page.keyboard.press("Escape");
      await expect(chooser).toBeHidden();
      await expect(groupedFlag).toBeFocused();
      await page.screenshot({ path: info.outputPath(`cluster-${width}.png`) });
      await page.evaluate(async () => {
        Reflect.get(window, "__restoreBookmarkSnapshot")();
        const controller = Reflect.get(window, "__readerController");
        // Font metrics can put the final page beside an already-bookmarked
        // companion. Isolate the exact last page before toggling its bookmark.
        await controller.setAlwaysShowOnePage(true);
      });
      await measured(page);
      await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.seekToFraction(1);
        if (!controller.snapshot().isBookmarked) await controller.toggleBookmark();
      });
      await measured(page);
      await slider.focus();
      await expectFlagGeometry(page);
      await expect(slider).toHaveAttribute("aria-valuetext", /Bookmarked$/);
      const track = (await slider.boundingBox())!;
      await page.mouse.move(track.x + track.width - 0.1, track.y + track.height - 10);
      await page.mouse.down();
      await expect(page.locator("[data-bookmark-status]")).toHaveText("Bookmarked");
      const foregroundRgb = theme.text.match(/\w\w/g)!.map(hex => parseInt(hex, 16)).join(", ");
      await expect(page.locator("[data-bookmark-status]")).toHaveCSS("color", `rgb(${foregroundRgb})`);
      const bookmarkRgb = theme.bookmark.match(/\w\w/g)!.map(hex => parseInt(hex, 16)).join(", ");
      await expect(page.locator("[data-bookmark-status] svg")).toHaveCSS("color", `rgb(${bookmarkRgb})`);
      await expect(page.locator("[data-bookmark-status] svg")).toHaveCSS("width", "18px");
      await expect(page.locator("[data-bookmark-status] svg")).toHaveCSS("height", "18px");
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
          bookmarks: [19_995, 19_996, 19_997, 19_998, 19_999, 20_000].map(current => ({
            ...state.bookmarks[0], id: String(current), label: `Saved position ${current}`,
          })),
          bookmarkProgress: [19_995, 19_996, 19_997, 19_998, 19_999, 20_000].map(current => ({
            id: String(current), fraction: current / 20_000,
          })),
        };
        controller.snapshot = () => endOfLongBook;
        controller.notify();
      });
      await expect(slider).toHaveAttribute("aria-valuetext", /Page 20000 of 20000.*Bookmarked$/);
      await expect(page.locator("[data-bookmark-marker]")).toHaveCount(1);
      await expect(page.locator("[data-bookmark-marker]")).toHaveAttribute("data-bookmark-count", "6");
      await expectFlagGeometry(page);
      await page.locator("[data-bookmark-marker]").click();
      const denseChooser = page.getByRole("dialog", { name: t("scrubber.chooseBookmark", { count: 6 }), exact: true });
      await expect(denseChooser.getByRole("button")).toHaveCount(6);
      await denseChooser.getByRole("button", { name: "Show all bookmarks", exact: true }).click();
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("combobox", { name: "Show", exact: true })).toHaveValue("bookmarks");
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

test("same-page saved text positions remain distinct, bounded, and directly navigable", async () => {
  const { context, readerPage: page } = await launchReader(book);
  try {
    await exposeReaderController(page);
    await measured(page);
    const cfis = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const view = controller.contentDocumentViews()[0];
      const text = view.document.querySelector("p")?.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE || text.textContent.length < 8) {
        throw new Error("The fixture needs a paragraph with distinct text offsets");
      }
      const targets: string[] = [];
      for (let offset = 1; offset <= 6; offset++) {
        const cfi = controller.locatorResolver.generate(view.spineIndex, text, offset).cfi;
        targets.push(cfi);
        await controller.library.addBookmark(controller.bookId, cfi, `Saved text position ${offset}`);
      }
      await controller.refreshBookmarks();
      const navigate = controller.goToBookmark.bind(controller);
      controller.goToBookmark = async (cfi: string) => {
        Reflect.set(window, "__clickedGroupBookmarkCfi", cfi);
        return navigate(cfi);
      };
      return targets;
    });
    await page.mouse.move(10, 2);
    const flag = page.locator('[data-bookmark-marker][data-bookmark-count="6"]');
    await expect(flag).toHaveCount(1);
    await flag.click();
    const chooser = page.getByRole("dialog", { name: t("scrubber.chooseBookmark", { count: 6 }), exact: true });
    await expect(chooser.getByRole("button")).toHaveCount(6);
    await expect(chooser.getByText(t("scrubber.bookmarkPosition", { index: 2 }), { exact: true })).toBeVisible();
    await chooser.getByRole("button").nth(1).click();
    await expect(chooser).toBeHidden();
    await measured(page);
    expect(await page.evaluate(() => Reflect.get(window, "__clickedGroupBookmarkCfi"))).toBe(cfis[1]);

    await flag.click();
    const beforeDismiss = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageIndex);
    await page.locator("iframe").first().click({ position: { x: 100, y: 100 } });
    await expect(chooser).toBeHidden();
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageIndex)).toBe(beforeDismiss);
    await page.mouse.move(10, 2);
    await flag.click();
    await chooser.getByRole("button", { name: "Show all bookmarks", exact: true }).click();
    const panel = page.getByRole("navigation", { name: "Annotations", exact: true });
    await expect(panel.getByRole("combobox", { name: "Show", exact: true })).toHaveValue("bookmarks");
    await expect(panel.getByRole("combobox", { name: "Show", exact: true })).toBeFocused();
    await expect(panel.locator("[data-bookmark-link]")).toHaveCount(6);
  } finally {
    await context.close();
  }
});

test("short viewports keep persistent read-along below the fixed bookmark lane (#214)", async () => {
  const narratedBook = fileURLToPath(new URL("../fixtures/media-overlay/narrated.epub", import.meta.url));
  const { context, readerPage: page } = await launchReader(narratedBook, {
    viewport: { width: 320, height: 256 },
  });
  try {
    await exposeReaderController(page);
    await measured(page);
    const currentPage = await page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().bookPageIndex);
    const audioPanel = page.locator("[data-narration-controls]");
    const lane = (await page.locator("[data-bookmark-lane]").boundingBox())!;
    const controls = (await audioPanel.boundingBox())!;
    expect(lane.y + lane.height).toBeLessThanOrEqual(controls.y);
    expect(controls.y + controls.height).toBeLessThanOrEqual(256);
    await audioPanel.getByRole("button", { name: "Collapse read-along controls", exact: true }).click();
    await expect(audioPanel.getByRole("button", { name: "Play narration", exact: true })).toBeVisible();
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
      await expect(slider).toHaveAccessibleDescription(/Bookmarks: 2(?:\s|$)/);

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
        await expect(marks.nth(index)).toHaveCSS("pointer-events", "auto");
      }
      await page.screenshot({ path: info.outputPath(`bookmark-progress-${browserName}.png`) });

      // Flag activation goes to the exact saved target, not its rounded fraction.
      const firstSavedCfi = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const navigate = controller.goToBookmark.bind(controller);
        controller.goToBookmark = async (cfi: string) => {
          Reflect.set(window, "__clickedBookmarkCfi", cfi);
          return navigate(cfi);
        };
        return controller.snapshot().bookmarks[0].cfi as string;
      });
      await page.mouse.move(10, 2);
      await expect(slider).toHaveCSS("pointer-events", "auto");
      const first = await marks.first().boundingBox();
      await page.mouse.click(first!.x + first!.width / 2, first!.y + first!.height / 2);
      await measured(page);
      await expect.poll(() => page.evaluate(() =>
        Reflect.get(window, "__readerController").snapshot().isBookmarked)).toBe(true);
      expect(await page.evaluate(() => Reflect.get(window, "__clickedBookmarkCfi"))).toBe(firstSavedCfi);

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
      await expect(slider).toHaveAccessibleDescription(/Bookmarks: 1(?:\s|$)/);

      await page.reload();
      await page.waitForFunction(() => [...document.querySelectorAll("iframe")]
        .some(frame => frame.contentDocument?.body?.querySelector("p")));
      await exposeReaderController(page);
      await measured(page);
      await expect(marks).toHaveCount(1);
      await expect(slider).toHaveAccessibleDescription(/Bookmarks: 1(?:\s|$)/);
    } finally {
      await context.close();
    }
  });
}
