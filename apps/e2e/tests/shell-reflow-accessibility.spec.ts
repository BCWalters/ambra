import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const narratedBook = fileURLToPath(new URL("../fixtures/media-overlay/narrated.epub", import.meta.url));

for (const { width, zoom } of [{ width: 320, zoom: 1 }, { width: 1400, zoom: 1 }, { width: 1280, zoom: 4 }]) {
  test(`${width}px at ${zoom * 100}% zoom: all reader controls remain visible and keyboard reachable`, async () => {
    const { context, readerPage: page } = await launchReader(narratedBook, {
      viewport: { width, height: zoom === 4 ? 1024 : width === 320 ? 256 : 900 },
    });
    try {
      if (zoom !== 1) {
        await page.evaluate(async factor => {
          const tab = await chrome.tabs.getCurrent();
          if (tab?.id === undefined) throw new Error("Reader tab unavailable for browser zoom");
          await chrome.tabs.setZoom(tab.id, factor);
        }, zoom);
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width / zoom);
      }
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
        if (name === "Settings") {
          const theme = menu.getByRole("combobox", { name: "Page theme", exact: true });
          await theme.focus();
          await expect(theme).toBeInViewport({ ratio: 1 });
          await page.keyboard.press("s");
          await expect(theme).toHaveValue("sepia");
          await expect(theme).toBeFocused();
          await expect(menu.locator("..")).toBeInViewport({ ratio: 1 });
        } else {
          await menu.getByRole("menuitem", { name: "Page", exact: true }).press("ArrowRight");
          const onePage = page.getByRole("menuitemcheckbox", { name: "Always show one page", exact: true });
          await onePage.focus();
          await expect(onePage).toBeInViewport({ ratio: 1 });
          await onePage.press("Space");
          await expect(onePage).toHaveAttribute("aria-checked", "true");
          await expect(onePage).toBeFocused();
          await page.keyboard.press("Escape");
        }
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
    } finally {
      await context.close();
    }
  });
}

test("forced colors and reduced motion preserve keyboard focus and dialog controls", async () => {
  const { context, readerPage: page } = await launchReader(narratedBook);
  try {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Not now", exact: true }).click();
    const settings = page.getByRole("button", { name: "Settings", exact: true });
    await settings.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(settings).toBeFocused();
    await expect(settings).toHaveCSS("outline-style", "solid");
    await expect(settings).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
    await expect(settings).toBeInViewport({ ratio: 1 });
    await settings.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();

    await page.keyboard.press(process.platform === "darwin" ? "Meta+g" : "Control+g");
    const dialog = page.getByRole("dialog", { name: "Go to Page", exact: true });
    const input = dialog.getByRole("spinbutton");
    await expect(input).toBeFocused();
    await input.fill("0");
    await input.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } finally {
    await context.close();
  }
});
