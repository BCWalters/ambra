import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const narratedBook = fileURLToPath(new URL("../fixtures/media-overlay/narrated.epub", import.meta.url));

for (const width of [320, 1400]) {
  test(`${width}px: all reader controls remain visible and keyboard reachable`, async () => {
    const { context, readerPage: page } = await launchReader(narratedBook, {
      viewport: { width, height: width === 320 ? 256 : 900 },
    });
    try {
      await page.getByRole("button", { name: "Not now", exact: true }).click();
      const library = page.getByRole("button", { name: "Library", exact: true });
      const toolbar = library.locator("..");
      for (const name of [
        "Library", "Show contents", "Bookmarks and highlights", "Search",
        "Text and page options", "Settings", "Book details", "Listen", "Bookmark this page",
      ]) {
        await expect(toolbar.getByRole("button", { name, exact: true })).toHaveCount(1);
      }
      await library.focus();
      const buttons = toolbar.getByRole("button");
      const count = await buttons.count();
      for (let index = 0; index < count; index++) {
        const button = buttons.nth(index);
        await expect(button).toBeFocused();
        await expect(button, `Control ${index + 1} must not be clipped at ${width}px`).toBeInViewport({ ratio: 1 });
        if (index === 3) {
          await expect(button).toHaveCSS("outline-style", "solid");
          await expect(button).toHaveCSS("outline-width", "2px");
          await expect(button).toHaveCSS("outline-offset", "-2px");
        }
        expect(await page.evaluate(() => window.scrollX), "Tab must not pan the reader horizontally").toBe(0);
        if (index + 1 < count) await page.keyboard.press("Tab");
      }
      for (const name of ["Settings", "Text and page options"]) {
        const trigger = toolbar.getByRole("button", { name, exact: true });
        await trigger.focus();
        await trigger.press("Enter");
        const menu = page.getByRole("menu");
        await expect(menu.locator("..")).toBeInViewport({ ratio: 1 });
        await page.keyboard.press("Home");
        await page.keyboard.press("ArrowRight");
        await expect(page.getByRole("menu")).toHaveCount(2);
        const submenu = page.getByRole("menu").last();
        await expect(submenu.locator("..")).toBeInViewport({ ratio: 1 });
        await submenu.getByRole("menuitemradio").first().focus();
        await page.keyboard.press("End");
        await expect(submenu.locator(":focus")).toBeInViewport({ ratio: 1 });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(1);
        await page.keyboard.press("End");
        await expect(menu.locator(":focus")).toBeInViewport({ ratio: 1 });
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
    } finally {
      await context.close();
    }
  });
}
