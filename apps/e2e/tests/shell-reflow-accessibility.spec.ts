import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from "../../extension/src/i18n/Locale.js";

const narratedBook = fileURLToPath(new URL("../fixtures/media-overlay/narrated.epub", import.meta.url));

for (const surface of ["reader", "library"] as const) {
  test(`${surface}: inline Brightness stays usable at 320px in all nine locales`, async () => {
    const testInfo = test.info();
    const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
    const { context, readerPage, libraryPage } = await launchReader(book, { viewport: { width: 320, height: 600 } });
    const page = surface === "reader" ? readerPage : libraryPage;
    try {
      await page.bringToFront();
      let t = getTranslate("en");
      for (const locale of SUPPORTED_LOCALES) {
        await test.step(locale, async () => {
          await page.getByRole("button", { name: t("toolbar.settings"), exact: true }).click();
          await page.getByRole("menuitem", { name: new RegExp(`^${t("settings.language")}`) }).press("ArrowRight");
          const languageChoice = page.getByRole("menuitemradio", { name: LOCALE_NATIVE_NAMES[locale], exact: true });
          await languageChoice.click();
          await expect(languageChoice).toHaveAttribute("aria-checked", "true");
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          t = getTranslate(locale);
          await page.mouse.move(0, 0);
          const settings = page.getByRole("button", { name: t("toolbar.settings"), exact: true });
          await settings.press("Enter");
          await expect(page.getByRole("menu")).toHaveCount(0);
          await settings.press("Enter");
          await expect(page.getByRole("menu")).toHaveCount(1);
          const menu = page.getByRole("menu", { name: t("toolbar.settings"), exact: true });
          const label = menu.getByText(t("settings.brightness"), { exact: true });
          const slider = menu.getByRole("slider", { name: t("settings.brightness"), exact: true });
          const row = label.locator("..");
          await expect(menu.locator("..")).toBeInViewport({ ratio: 1 });
          await expect(row).toBeInViewport({ ratio: 1 });
          const labelBox = (await label.boundingBox())!;
          const sliderBox = (await slider.boundingBox())!;
          expect(sliderBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
          expect(sliderBox.width).toBeGreaterThan(40);
          expect(Math.abs(labelBox.y + labelBox.height / 2 - sliderBox.y - sliderBox.height / 2)).toBeLessThanOrEqual(8);
          expect(await row.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
          expect(await menu.locator("..").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
          const original = await slider.inputValue();
          await slider.focus();
          await slider.press("ArrowLeft");
          await expect(slider).not.toHaveValue(original);
          const reset = menu.getByRole("button");
          await expect(reset).toHaveCount(1);
          await expect(reset).toBeInViewport({ ratio: 1 });
          await reset.click();
          await expect(slider).toHaveValue(original);
          const screenshot = testInfo.outputPath(`${surface}-${locale}-settings-320px.png`);
          await menu.locator("..").screenshot({ path: screenshot });
          await testInfo.attach(`${surface}-${locale}-320px`, { path: screenshot, contentType: "image/png" });
          await page.getByRole("button", { name: t("toolbar.settings"), exact: true }).click();
          await expect(menu).toBeHidden();
        });
      }
    } finally {
      await context.close();
    }
  });
}

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
        const menu = page.getByRole("menu", { name, exact: true });
        await expect(menu.locator("..")).toBeInViewport({ ratio: 1 });
        const title = menu.getByText(name === "Settings" ? "Ambra settings" : "Book options", { exact: true });
        expect(await title.evaluate(element => {
          const style = getComputedStyle(element);
          return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color };
        }), `${name} must use the shared top-level menu title styling`).toEqual({
          fontSize: "14px", fontWeight: "600", lineHeight: "20px", color: "rgb(36, 36, 36)",
        });
        if (width === 1400 && zoom === 1) {
          await expect.poll(async () => {
            const triggerBox = (await trigger.boundingBox())!;
            const menuBox = (await menu.locator("..").boundingBox())!;
            return Math.abs(menuBox.x + menuBox.width - triggerBox.x - triggerBox.width);
          }, `${name} must align its top-right corner with its trigger`).toBeLessThanOrEqual(2);
          await expect.poll(async () => {
            const triggerBox = (await trigger.boundingBox())!;
            const menuBox = (await menu.locator("..").boundingBox())!;
            return menuBox.y - triggerBox.y - triggerBox.height;
          }, `${name} must settle below its trigger`).toBeGreaterThanOrEqual(0);
        }
        const anchorScreenshot = test.info().outputPath(`${name === "Settings" ? "settings" : "book-options"}-anchor-${width}px-${zoom * 100}pct.png`);
        await page.screenshot({ path: anchorScreenshot, animations: "disabled" });
        await test.info().attach(`${name} popup anchor at ${width}px / ${zoom * 100}%`, {
          path: anchorScreenshot, contentType: "image/png",
        });
        const cascade = menu.getByRole("menuitem", {
          name: name === "Settings" ? /^Page turn/ : /^Text$/,
        });
        await cascade.press("ArrowRight");
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
          const themeParent = menu.getByRole("menuitem", { name: /^Page theme/ });
          await themeParent.press("ArrowRight");
          const theme = page.getByRole("menu", { name: /^Page theme/ });
          const white = theme.getByRole("menuitemradio", { name: "White", exact: true });
          await white.focus();
          await expect(white).toBeInViewport({ ratio: 1 });
          await white.press("ArrowDown");
          const sepia = theme.getByRole("menuitemradio", { name: "Sepia", exact: true });
          await expect(sepia).toBeFocused();
          await sepia.press("Enter");
          await expect(sepia).toHaveAttribute("aria-checked", "true");
          await expect(page.getByRole("menu")).toHaveCount(2);
          for (const radio of await theme.getByRole("menuitemradio").all()) {
            await radio.focus();
            await expect(radio).toBeInViewport({ ratio: 1 });
          }
          await expect(theme.locator("..")).toBeInViewport({ ratio: 1 });
          await page.keyboard.press("Escape");
          await expect(themeParent).toBeFocused();
          await expect(menu.locator("..")).toBeInViewport({ ratio: 1 });
          expect(await menu.locator("..").evaluate(element => element.scrollWidth - element.clientWidth))
            .toBeLessThanOrEqual(1);
          await page.screenshot({ path: test.info().outputPath(`settings-${width}px-${zoom * 100}pct.png`) });
          for (const label of ["Reader theme", "Reading mode", "Language"]) {
            const parent = menu.getByRole("menuitem", { name: new RegExp(`^${label}`) });
            await parent.press("ArrowRight");
            const choices = page.getByRole("menu").last();
            await expect(choices.locator("..")).toBeInViewport({ ratio: 1 });
            await choices.getByRole("menuitemradio").first().focus();
            await page.keyboard.press("End");
            await expect(choices.locator(":focus")).toBeInViewport({ ratio: 1 });
            await page.keyboard.press("Escape");
            await expect(parent).toBeFocused();
          }
        } else {
          await menu.getByRole("menuitem", { name: "Page", exact: true }).press("ArrowRight");
          const onePage = page.getByRole("switch", { name: "Always show one page", exact: true });
          await onePage.focus();
          await expect(onePage).toBeInViewport({ ratio: 1 });
          await onePage.press("Space");
          await expect(onePage).toBeChecked();
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
