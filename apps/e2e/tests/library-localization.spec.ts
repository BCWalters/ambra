import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = path.resolve(here, "../fixtures/long-content.epub");

test("French Library localizes live, preserves toolbar order and persists across empty-state reloads", async () => {
  const { context, libraryPage: page } = await launchReader(book, { viewport: { width: 360, height: 700 } });
  try {
    const detailsLabel = await page.getByRole("button", { name: / details$/ }).getAttribute("aria-label");
    const title = detailsLabel!.slice(0, -" details".length);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Language\b/ }).click();
    await page.getByRole("menuitemradio", { name: "Français", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const t = getTranslate("fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page).toHaveTitle(t("library.pageTitle"));
    const toolbar = page.getByRole("toolbar", { name: t("library.toolbar") });
    const names = [t("library.importEpub"), t("library.sort"), t("toolbar.settings"), t("about.title"), t("library.expand")];
    await expect(toolbar.getByRole("button")).toHaveCount(names.length);
    for (let index = 0; index < names.length; index++) {
      await expect(toolbar.getByRole("button").nth(index)).toHaveAccessibleName(names[index]!);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: t("about.title"), exact: true }).click();
    const about = page.getByRole("dialog", { name: t("about.title") });
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
    await details.getByRole("button", { name: t("highlight.close"), exact: true }).click();
    await page.getByText(title, { exact: true }).last().hover();
    await page.getByRole("button", { name: t("library.removeBook", { title }), exact: true }).click();
    await expect(page.getByRole("heading", { name: t("library.emptyTitle") })).toBeVisible();
    await expect(page.getByRole("region", { name: t("library.discoveryTitle") })).toBeHidden();
    await page.getByRole("button", { name: `${t("library.findNextBook")} ${t("library.exploreFreeBooks")}` }).click();
    await expect(page.getByRole("region", { name: t("library.discoveryTitle") })).toBeVisible();
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
