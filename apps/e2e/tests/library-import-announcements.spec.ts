import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";

const seedBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const smallBook = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const title = "Ambra Two-Chapter Spread Test Fixture";

for (const view of ["tab", "import"] as const) {
  test(`${view}: small local imports announce success and duplicates without moving chooser focus`, async () => {
    const { context, libraryPage: page } = await launchReader(seedBook);
    try {
      const url = new URL(page.url());
      url.search = `?view=${view}`;
      await page.goto(url.href);
      const status = page.getByTestId("library-import-status").getByRole("status");
      await expect(status).toHaveCount(1);
      await expect(status).toBeEmpty();
      await expect(status).toHaveAttribute("aria-live", "polite");
      await expect(status).toHaveAttribute("aria-atomic", "true");
      await expect(status.locator("button, [role=progressbar]")).toHaveCount(0);
      const choose = page.getByRole("button", {
        name: view === "import" ? "Choose EPUB files..." : "Import book", exact: true,
      });
      for (const message of [
        `Added ${title} to your library.`,
        `${title} is already in your library.`,
      ]) {
        await choose.focus();
        const chooserOpened = page.waitForEvent("filechooser");
        await choose.click();
        const chooser = await chooserOpened;
        await chooser.setFiles(smallBook);
        await expect(status).toHaveText(message);
        await expect(choose).toBeFocused();
        await expect(page.getByRole("button", { name: `Read now: ${title}`, exact: true })).toBeEnabled();
        await expect(status).not.toContainText("Cancel");
      }
    } finally {
      await context.close();
    }
  });
}

test("French local-import completion remains localized and compact Library keyboard navigation leaves the toolbar", async () => {
  const { context, libraryPage: page } = await launchReader(seedBook, { viewport: { width: 360, height: 700 } });
  try {
    const help = page.getByRole("button", { name: "Help & About", exact: true });
    await help.focus();
    await help.press("Tab");
    await expect(page.getByRole("button", { name: "Find books", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeFocused();
    expect(await help.evaluate(element => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowRight", ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
      });
      return element.dispatchEvent(event);
    })).toBe(true);
    await page.getByRole("button", { name: "Ambra settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("fr");
    await page.keyboard.press("Escape");
    const url = new URL(page.url());
    url.search = "?view=tab";
    await page.goto(url.href);
    const t = getTranslate("fr");
    const choose = page.getByRole("button", { name: t("library.importEpub"), exact: true });
    await choose.focus();
    const chooserOpened = page.waitForEvent("filechooser");
    await choose.click();
    await (await chooserOpened).setFiles(smallBook);
    await expect(page.getByTestId("library-import-status").getByRole("status"))
      .toHaveText(t("library.importComplete", { fileName: title }));
    await expect(choose).toBeFocused();
  } finally {
    await context.close();
  }
});
