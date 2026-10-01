import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from "../../extension/src/i18n/Locale.js";
import { getChromeTheme } from "../../extension/src/reader/chromeTheme.js";

const narratedBook = fileURLToPath(new URL("../fixtures/media-overlay/narrated.epub", import.meta.url));

for (const surface of ["reader", "library"] as const) {
  test(`${surface}: shared settings Brightness stays usable at 320px in all nine locales`, async () => {
    const testInfo = test.info();
    const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
    const { context, readerPage, libraryPage } = await launchReader(book, { viewport: { width: 320, height: 600 } });
    const page = surface === "reader" ? readerPage : libraryPage;
    try {
      await page.bringToFront();
      let t = getTranslate("en");
      for (const locale of SUPPORTED_LOCALES) {
        await test.step(locale, async () => {
          await page.getByRole("button", { name: t("settings.ambraTitle"), exact: true }).click();
          const language = page.getByRole("dialog", { name: t("settings.ambraTitle"), exact: true })
            .getByRole("combobox", { name: t("settings.language"), exact: true });
          await expect(language.locator(`option[value="${locale}"]`)).toHaveText(LOCALE_NATIVE_NAMES[locale]);
          await language.selectOption(locale);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          t = getTranslate(locale);
          await page.mouse.move(0, 0);
          const settings = page.getByRole("button", { name: t("settings.ambraTitle"), exact: true });
          await page.keyboard.press("Escape");
          await expect(settings).toBeFocused();
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await settings.press("Enter");
          const menu = page.getByRole("dialog", { name: t("settings.ambraTitle"), exact: true });
          await expect(menu).toBeVisible();
          const reading = menu.locator("details");
          if (!await reading.evaluate(element => (element as HTMLDetailsElement).open)) {
            await reading.locator("summary").click();
          }
          const label = menu.getByText(t("settings.brightness"), { exact: true });
          const slider = menu.getByRole("slider", { name: t("settings.brightness"), exact: true });
          const row = label.locator("..");
          await row.scrollIntoViewIfNeeded();
          await expect(menu).toBeInViewport({ ratio: 1 });
          await expect(row).toBeInViewport({ ratio: 1 });
          const labelBox = (await label.boundingBox())!;
          const sliderBox = (await slider.boundingBox())!;
          expect(sliderBox.y).toBeGreaterThanOrEqual(labelBox.y + labelBox.height);
          expect(sliderBox.width).toBeGreaterThan(40);
          expect(sliderBox.x).toBeGreaterThanOrEqual(labelBox.x);
          expect(await row.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
          expect(await menu.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
          const original = await slider.inputValue();
          await slider.focus();
          await slider.press("ArrowLeft");
          await expect(slider).not.toHaveValue(original);
          const reset = menu.getByRole("button");
          await expect(reset).toHaveCount(1);
          await expect(reset).toBeInViewport({ ratio: 1 });
          await reset.click();
          await expect(slider).toHaveValue(original);
          expect(await menu.evaluate(element => element.contains(document.activeElement)),
            "Reset must keep keyboard focus inside Ambra settings").toBe(true);
          const screenshot = testInfo.outputPath(`${surface}-${locale}-settings-320px.png`);
          await menu.screenshot({ path: screenshot });
          await testInfo.attach(`${surface}-${locale}-320px`, { path: screenshot, contentType: "image/png" });
          await page.keyboard.press("Escape");
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
      await expect(page.getByRole("region", { name: "Narration controls", exact: true })
        .getByRole("button", { name: "Play narration", exact: true })).toBeVisible();
      const library = page.getByRole("button", { name: "Library", exact: true, includeHidden: true });
      const toolbar = library.locator("..");
      for (const name of [
        "Show contents", "Library", "Annotations", "Search",
        "Text and page options", "Ambra settings", "Book details", "Help & About", "Bookmark this page",
      ]) {
        await expect(toolbar.getByRole("button", { name, exact: true })).toHaveCount(1);
      }
      const buttons = toolbar.getByRole("button");
      await expect(buttons.first()).toHaveAccessibleName("Show contents");
      await buttons.first().focus();
      const count = await buttons.count();
      for (let index = 0; index < count; index++) {
        const button = buttons.nth(index);
        await expect(button).toBeFocused();
        await expect(button, `Control ${index + 1} must not be clipped at ${width}px`).toBeInViewport({ ratio: 1 });
        if (await button.evaluate(element => element.closest("[data-ambra-toolbar-title]") !== null)) {
          await expect(button).toHaveCSS("outline-style", "solid");
          await expect(button).toHaveCSS("outline-width", "2px");
          await expect(button).toHaveCSS("outline-offset", "-2px");
        }
        expect(await page.evaluate(() => window.scrollX), "Tab must not pan the reader horizontally").toBe(0);
        if (index + 1 < count) await page.keyboard.press("Tab");
      }
      for (const name of ["Ambra settings", "Text and page options"]) {
        const trigger = toolbar.getByRole("button", { name, exact: true, includeHidden: true });
        await trigger.focus();
        await trigger.press("Enter");
        const isSettings = name === "Ambra settings";
        const menu = page.getByRole(isSettings ? "dialog" : "menu", { name, exact: true });
        const popup = isSettings ? menu : menu.locator("..");
        await expect(popup).toBeInViewport({ ratio: 1 });
        const title = menu.getByText(isSettings ? "Ambra settings" : "Book options", { exact: true });
        const appearance = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        const foreground = getChromeTheme("ambra", appearance).text;
        expect(await title.evaluate(element => {
          const style = getComputedStyle(element);
          return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color };
        }), `${name} must use its task heading and semantic foreground`).toEqual({
          fontSize: isSettings ? "16px" : "14px", fontWeight: isSettings ? "700" : "600", lineHeight: "20px",
          color: `rgb(${foreground.slice(1).match(/../g)!.map(part => Number.parseInt(part, 16)).join(", ")})`,
        });
        if (width === 1400 && zoom === 1) {
          await expect.poll(async () => {
            const triggerBox = (await trigger.boundingBox())!;
            const menuBox = (await popup.boundingBox())!;
            return Math.abs(menuBox.x + menuBox.width - triggerBox.x - triggerBox.width);
          }, `${name} must align its top-right corner with its trigger`).toBeLessThanOrEqual(2);
          await expect.poll(async () => {
            const triggerBox = (await trigger.boundingBox())!;
            const menuBox = (await popup.boundingBox())!;
            return menuBox.y - triggerBox.y - triggerBox.height;
          }, `${name} must settle below its trigger`).toBeGreaterThanOrEqual(0);
        }
        const anchorScreenshot = test.info().outputPath(`${isSettings ? "settings" : "book-options"}-anchor-${width}px-${zoom * 100}pct.png`);
        await page.screenshot({ path: anchorScreenshot, animations: "disabled" });
        await test.info().attach(`${name} popup anchor at ${width}px / ${zoom * 100}%`, {
          path: anchorScreenshot, contentType: "image/png",
        });
        if (isSettings) {
          const theme = menu.getByRole("combobox", { name: "Page theme", exact: true });
          await expect(theme).toBeFocused();
          await expect(theme).toBeInViewport({ ratio: 1 });
          await theme.press("s");
          await expect(theme).toHaveValue("sepia");
          await expect(theme).toBeFocused();
          await expect(menu).toBeVisible();
          for (const label of ["Page turn", "Interface theme", "Reading mode", "Language"]) {
            const control = menu.getByRole("combobox", { name: label, exact: true });
            await control.focus();
            await expect(control).toBeFocused();
            await expect(control).toBeInViewport({ ratio: 1 });
            expect(await control.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
          }
          await expect(menu).toBeInViewport({ ratio: 1 });
          expect(await menu.evaluate(element => element.scrollWidth - element.clientWidth))
            .toBeLessThanOrEqual(1);
          await page.screenshot({ path: test.info().outputPath(`settings-${width}px-${zoom * 100}pct.png`) });
        } else {
          const cascade = menu.getByRole("menuitem", { name: "Text", exact: true });
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
    await expect(page.getByRole("region", { name: "Narration controls", exact: true })
      .getByRole("button", { name: "Play narration", exact: true })).toBeVisible();
    const settings = page.getByRole("button", { name: "Ambra settings", exact: true });
    await settings.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(settings).toBeFocused();
    await expect(settings).toHaveCSS("outline-style", "solid");
    await expect(settings).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
    await expect(settings).toBeInViewport({ ratio: 1 });
    await settings.press("Enter");
    await expect(page.getByRole("dialog", { name: "Ambra settings", exact: true })).toBeVisible();
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
