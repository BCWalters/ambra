import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");

/**
 * Issue #112: the reader had no way back to the library short of
 * closing the tab or using the browser's own back button — neither
 * obvious nor discoverable. The toolbar's new leftmost button navigates
 * the reader's own tab to the library's full-tab view (`?view=tab`,
 * the same one `openLibraryTab` opens in a *new* tab elsewhere), rather
 * than leaving the reader tab open behind a second one.
 *
 * Issue #125: the button's icon/label were changed from a left-arrow
 * "Back to Library" (which read as an undo/previous action) to the
 * Ambra mark with a plain "Library" label, since it always navigates
 * to the Library rather than returning to a prior state.
 */
test("the toolbar's Library button navigates the reader's own tab to the full-tab library view", async () => {
  const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 900 } });
  try {
    await readerPage.waitForTimeout(500);
    await readerPage.mouse.move(450, 20);
    await readerPage.waitForTimeout(150);

    const backButton = readerPage.getByRole("button", { name: "Library", exact: true });
    await expect(backButton).toBeVisible();
    await backButton.click();

    await expect(readerPage).toHaveURL(/library\/index\.html\?view=tab/);
    await expect(readerPage.getByText("Ambra Long Conte")).toBeVisible();
  } finally {
    await context.close();
  }
});
