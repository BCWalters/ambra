import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return !c.isLoadInFlight && !c.isTurningPage && !c.isApplyingLayout && !c.pendingLayout;
  });
}

for (const direction of ["ltr", "rtl"] as const) {
  for (const width of [760, 1400]) {
    test(`${direction} ${width}px: FXL scrubber seeks every page, retains companion destinations and resumes (#200)`, async () => {
      const book = fileURLToPath(new URL(`../fixtures/fxl-spread-${direction}.epub`, import.meta.url));
      const { context, readerPage: page } = await launchReader(book, { viewport: { width, height: 900 } });
      try {
        await exposeReaderController(page);
        const slider = page.getByRole("slider", { name: "Position in book" });
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 1 of 5 · 20%");
        await expect(page.getByText("Mapping your book…", { exact: true })).toHaveCount(0);
        for (let target = 2; target <= 5; target++) {
          await slider.focus();
          await slider.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight");
          await settled(page);
          await expect(slider).toHaveAttribute("aria-valuetext", `Page ${target} of 5 · ${target * 20}%`);
          expect(await page.evaluate(() => {
            const c = Reflect.get(window, "__readerController");
            return c.contentDocumentViews().find((view: { document: Document }) =>
              view.document.defaultView?.frameElement === document.activeElement)?.spineIndex;
          })).toBe(target - 1);
        }
        await page.evaluate(async () => {
          const c = Reflect.get(window, "__readerController");
          await c.seekToFraction(0.4);
          await c.goToChapter(1);
        });
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 3 of 5 · 60%");
        await slider.focus();
        await slider.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight");
        await settled(page);
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 4 of 5 · 80%");
        if (width === 1400) {
          await page.evaluate(async () => {
            const c = Reflect.get(window, "__readerController");
            await c.seekToFraction(0.4);
            const doc = c.contentDocumentViews().find((view: { spineIndex: number }) => view.spineIndex === 2).document;
            doc.defaultView.frameElement.focus();
            doc.getSelection().collapse(doc.body, 0);
          });
          await expect(slider).toHaveAttribute("aria-valuetext", "Page 3 of 5 · 60%");
        }
        await slider.focus();
        await slider.press("Home");
        await settled(page);
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 1 of 5 · 20%");

        // An exact second-column destination must not snap back to its spread's first page.
        await slider.focus();
        const box = (await slider.boundingBox())!;
        await page.mouse.click(box.x + box.width * (direction === "rtl" ? 0.4 : 0.6), box.y + box.height / 2);
        await settled(page);
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 3 of 5 · 60%");
        await page.evaluate(async () => {
          const c = Reflect.get(window, "__readerController");
          await c.toggleBookmark();
          await c.flushProgress();
        });
        await expect(page.locator("[data-bookmark-marker]")).toHaveCount(1);
        expect(await page.evaluate(() => {
          const snapshot = Reflect.get(window, "__readerController").snapshot();
          return snapshot.bookmarkLocations[snapshot.bookmarks[0].id].page;
        })).toEqual({ status: "known", number: 3 });
        await expect(slider).toHaveAccessibleDescription("Bookmarks: 1 Chapters");
        await page.reload();
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 3 of 5 · 60% - Bookmarked");
        await exposeReaderController(page);
        await page.evaluate(async () => Reflect.get(window, "__readerController")
          .library.patchGlobalReadingSettings({ viewMode: "scroll" }));
        await page.reload();
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 3 of 5 · 60% - Bookmarked");
        await exposeReaderController(page);
        await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().viewMode === "scroll");
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 3 of 5 · 60% - Bookmarked");
        await page.setViewportSize({ width: width === 760 ? 1400 : 760, height: 900 });
        await settled(page);
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 3 of 5 · 60% - Bookmarked");
        await expect(page.locator("[data-bookmark-marker]")).toHaveCount(1);
        await slider.focus();
        await slider.press("End");
        await settled(page);
        await expect(slider).toHaveAttribute("aria-valuetext", "Page 5 of 5 · 100%");
      } finally {
        await context.close();
      }
    });
  }
}
