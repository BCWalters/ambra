import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/long-content.epub");

for (const width of [1000, 360]) {
  test(`Library flyout close buttons stay at the right edge at ${width}px`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { context, libraryPage } = await launchReader(book, { viewport: { width, height: 800 } });
    try {
      for (const title of ["Book details", "About Ambra"]) {
        const trigger = title === "Book details"
          ? libraryPage.getByRole("button", { name: /details$/ })
          : libraryPage.getByRole("button", { name: title, exact: true });
        await trigger.focus();
        await trigger.press("Enter");
        const dialog = libraryPage.getByRole("dialog", { name: title });
        const close = dialog.getByRole("button", { name: "Close", exact: true });
        await expect(close).toBeFocused();
        await expect.poll(async () => {
          const panel = await dialog.boundingBox();
          return panel ? Math.abs(panel.x + panel.width - width) : Infinity;
        }).toBeLessThan(1);
        await expect.poll(async () => {
          const panel = await dialog.boundingBox();
          const button = await close.boundingBox();
          if (!panel || !button) return Infinity;
          return Math.abs(panel.x + panel.width - button.x - button.width);
        }).toBeLessThanOrEqual(16);
        await libraryPage.screenshot({ path: testInfo.outputPath(`${title}.png`) });
        await close.click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    } finally {
      await context.close();
    }
  });
}
