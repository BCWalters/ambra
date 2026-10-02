import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const book = fileURLToPath(new URL("../fixtures/reading-entry.epub", import.meta.url));

test("Library keyboard help waits until the review dialog closes", async () => {
  test.skip(process.env.VITE_AMBRA_LOCAL_FEATURES !== "1", "Requires a local-feature extension build.");
  const { context, libraryPage: page, readerPage } = await launchReader(book);
  try {
    await readerPage.close();
    await page.goto(`${page.url()}?view=tab`);
    await page.locator("[data-prototype-controls] summary").click();
    await page.getByRole("button", { name: "Simulate eligible reader", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Are you loving Ambra?", exact: true });
    const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
    await expect(review).toBeVisible();
    await page.keyboard.press("ControlOrMeta+/");
    await expect(review).toBeVisible();
    await expect(shortcuts).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(review).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+/");
    await expect(shortcuts).toBeVisible();
  } finally { await context.close(); }
});
