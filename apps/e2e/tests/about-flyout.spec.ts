import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");

/**
 * The About Ambra flyout (issue #123) — a static panel packaged with
 * the extension itself, not a separate page/tab, so it opens and closes
 * in place over the Library exactly like `BookDetailsFlyout` does.
 */
test.describe("About Ambra flyout", () => {
  test("opens from the toolbar button, shows credits/links, and closes via Escape", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 700 } });
    try {
      const aboutButton = libraryPage.getByRole("button", { name: "About Ambra" });
      await expect(aboutButton).toBeVisible();
      await aboutButton.click();

      const aside = libraryPage.getByRole("complementary", { name: "About Ambra" });
      await expect(aside).toBeVisible();
      await expect(aside.getByText("Ben Walters")).toBeVisible();
      await expect(aside.getByRole("link", { name: "Source code on GitHub" })).toHaveAttribute(
        "href",
        "https://github.com/BCWalters/ambra",
      );
      await expect(aside.getByRole("link", { name: "Report an issue or request a feature" })).toHaveAttribute(
        "href",
        "mailto:AmbraEPUB@outlook.com",
      );

      await libraryPage.keyboard.press("Escape");
      await expect(aside).not.toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("the copy diagnostics button copies environment info to the clipboard", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 700 } });
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await libraryPage.getByRole("button", { name: "About Ambra" }).click();
      await libraryPage.getByRole("button", { name: "Copy diagnostics" }).click();
      await expect(libraryPage.getByRole("button", { name: "Copied!" })).toBeVisible();

      const clipboardText = await libraryPage.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toContain("Ambra environment info");
      expect(clipboardText).toContain("Extension version:");
    } finally {
      await context.close();
    }
  });
});
