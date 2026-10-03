import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";
import { SUPPORTED_LOCALES } from "../../extension/src/i18n/Locale.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = path.resolve(here, "../fixtures/long-content.epub");

test("Contents and Library panel tooltips reflect open state in all nine locales", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1000, height: 800 } });
  try {
    let t = getTranslate("en");
    for (const locale of SUPPORTED_LOCALES) {
      await test.step(locale, async () => {
        await page.getByRole("button", { name: t("settings.ambraTitle"), exact: true }).click();
        await page.getByRole("combobox", { name: t("settings.language"), exact: true }).selectOption(locale);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        t = getTranslate(locale);
        await page.keyboard.press("Escape");
        for (const [closedLabel, openLabel] of [
          [t("toolbar.showContents"), t("toolbar.hideContents")],
          [t("toolbar.backToLibrary"), t("toolbar.hideLibrary")],
        ]) {
          const closed = page.getByRole("button", { name: closedLabel, exact: true });
          await closed.focus();
          await expect(closed).toHaveAttribute("aria-pressed", "false");
          await closed.hover();
          await expect(page.getByRole("tooltip", { name: closedLabel, exact: true })).toBeVisible();
          await closed.click();
          const opened = page.getByRole("button", { name: openLabel, exact: true });
          await expect(opened).toHaveAttribute("aria-pressed", "true");
          await page.mouse.move(500, 500);
          await opened.hover();
          await expect(page.getByRole("tooltip", { name: openLabel, exact: true })).toBeVisible();
          await opened.click();
          await expect(closed).toHaveAttribute("aria-pressed", "false");
        }
      });
    }
  } finally {
    await context.close();
  }
});

for (const width of [320, 1200]) {
  test(`Help & About stays expanded and compact at ${width}px in Library and reader`, async () => {
    const { context, libraryPage, readerPage } = await launchReader(book, { viewport: { width, height: 800 } });
    try {
      for (const [surface, page] of [["library", libraryPage], ["reader", readerPage]] as const) {
        const trigger = page.getByRole("button", { name: "Help & About", exact: true });
        await trigger.focus();
        await trigger.press("Enter");
        const help = page.getByRole("dialog", { name: "Help & About", exact: true });
        await expect(help).toHaveCSS("opacity", "1");
        const about = help.getByRole("region", { name: "About Ambra", exact: true });
        const feedback = help.getByRole("region", { name: "Help shape Ambra", exact: true });
        await expect(about.getByRole("heading", { name: "About Ambra", exact: true })).toBeVisible();
        await expect(about.getByRole("button", { name: "About Ambra", exact: true })).toHaveCount(0);
        await expect(about.getByText(/^Version /)).toBeVisible();
        await expect(about.getByRole("link", { name: "Privacy policy", exact: true })).toBeVisible();
        await expect(feedback).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        expect((await feedback.boundingBox())!.height).toBeLessThan(260);
        expect(await help.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await about.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${surface}-help-${width}.png`), fullPage: true });
        const standards = about.getByRole("button", { name: "Standards and open source", exact: true });
        await expect(standards).toHaveAttribute("aria-expanded", "false");
        await standards.click();
        await expect(about.getByRole("link", { name: "EPUB 3.4 specification", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
    } finally { await context.close(); }
  });
}

test("French Library localizes live, preserves toolbar order and persists across empty-state reloads", async () => {
  const { context, libraryPage: page } = await launchReader(book, { viewport: { width: 360, height: 700 } });
  try {
    const detailsLabel = await page.getByRole("button", { name: / details$/ }).getAttribute("aria-label");
    const title = detailsLabel!.slice(0, -" details".length);
    await page.getByRole("button", { name: "Ambra settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("fr");
    await page.keyboard.press("Escape");
    const t = getTranslate("fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page).toHaveTitle(t("library.pageTitle"));
    const toolbar = page.getByRole("toolbar", { name: t("library.toolbar") });
    const names = [t("settings.ambraTitle"), t("about.title")];
    await expect(toolbar.getByRole("button")).toHaveCount(names.length);
    for (let index = 0; index < names.length; index++) {
      await expect(toolbar.getByRole("button").nth(index)).toHaveAccessibleName(names[index]!);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: t("about.title"), exact: true }).click();
    const about = page.getByRole("dialog", { name: t("about.title") });
    await expect(about.getByRole("heading", { name: t("about.aboutAmbra"), exact: true })).toBeVisible();
    await expect(about.getByRole("button", { name: t("about.aboutAmbra"), exact: true })).toHaveCount(0);
    await expect(about.getByText(t("about.description"))).toBeVisible();
    await expect(about.getByRole("link", { name: t("about.feedback") })).toHaveAttribute("href", "mailto:AmbraEPUB@outlook.com");
    await expect(about.getByRole("button", { name: t("about.copyDiagnostics") })).toBeVisible();
    await about.getByRole("button", { name: t("highlight.close"), exact: true }).click();
    const detailsButton = page.getByRole("button", { name: t("library.bookDetails", { title }), exact: true });
    await detailsButton.focus();
    await detailsButton.press("Enter");
    const details = page.getByRole("dialog", { name: t("toolbar.bookDetails") });
    await expect(details.getByText(title, { exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: t("bookDetails.publicationDetails") })).toBeVisible();
    await details.getByRole("button", { name: t("library.removeAction"), exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: t("library.removeTitle") });
    await expect(confirm.getByRole("button", { name: t("annotations.cancelNote"), exact: true })).toBeFocused();
    await confirm.getByRole("button", { name: t("library.removeAction"), exact: true }).click();
    await expect(page.getByRole("heading", { name: t("library.emptyTitle") })).toBeVisible();
    await expect(page.getByRole("region", { name: t("library.discoveryTitle") })).toBeHidden();
    const opened = context.waitForEvent("page");
    await page.getByRole("button", { name: t("library.findBooks"), exact: true }).click();
    const full = await opened;
    await expect(full.getByRole("dialog", { name: t("library.findBooks"), exact: true })).toBeVisible();
    await full.close();
    await page.reload();
    await expect(page.getByRole("heading", { name: t("library.emptyTitle") })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "invalid.epub", mimeType: "application/epub+zip", buffer: Buffer.from("not an EPUB"),
    });
    await expect(page.getByRole("alert")).toContainText(t("error.invalidEpubHeadline"));
    await page.getByRole("alert").getByRole("button", { name: t("library.dismiss"), exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
