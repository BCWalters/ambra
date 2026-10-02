import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALICE = path.resolve(here, "..", "real-books", "alice-in-wonderland.epub");

/** Covers issue #111: an EPUB Inspector button reachable from the
 * Library's own Book Details flyout — a standalone `EpubInspectionSession`
 * opened directly from a book's stored bytes, with no live reading
 * session required — offered only when the Library is open in its own
 * full browser tab (not the small toolbar popup, where the button
 * would have nowhere useful to lead). */
test.describe("Library EPUB Inspector (issue #111)", () => {
  test("the Inspector button is hidden in the popup, but shown and functional in the full-tab library", async () => {
    const { context, libraryPage } = await launchReader(ALICE, { viewport: { width: 1000, height: 700 } });
    try {
      const popupDetails = libraryPage.locator("[data-library-collection]")
        .getByRole("button", { name: "Alice's Adventures in Wonderland details", exact: true });
      await expect(popupDetails).toBeVisible();
      await popupDetails.click();
      await expect(libraryPage.getByText("Book details", { exact: true })).toBeVisible();
      await expect(libraryPage.getByRole("button", { name: /inspector/i })).toHaveCount(0);
      await libraryPage.getByRole("button", { name: "Close" }).click();

      const expandButton = libraryPage.getByRole("button", { name: "Open library in new tab", exact: true });
      const [fullTabPage] = await Promise.all([context.waitForEvent("page"), expandButton.click()]);
      await fullTabPage.waitForLoadState("domcontentloaded");
      const fullDetails = fullTabPage.locator("[data-library-collection]")
        .getByRole("button", { name: "Alice's Adventures in Wonderland details", exact: true });
      await expect(fullDetails).toBeVisible();
      await fullDetails.click();
      const inspectorButton = fullTabPage.getByRole("button", { name: /inspector/i });
      await expect(inspectorButton).toBeVisible();
      await expect(inspectorButton).toHaveCSS("background-image", "none");
      const primaryColors = await inspectorButton.evaluate(element => {
        const style = getComputedStyle(element);
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--colorBrandBackground)";
        probe.style.color = "var(--colorNeutralForegroundOnBrand)";
        element.append(probe);
        const expected = getComputedStyle(probe);
        const result = { background: style.backgroundColor, foreground: style.color,
          expectedBackground: expected.backgroundColor, expectedForeground: expected.color };
        probe.remove();
        return result;
      });
      expect(primaryColors.background).toBe(primaryColors.expectedBackground);
      expect(primaryColors.foreground).toBe(primaryColors.expectedForeground);
      const remove = fullTabPage.getByRole("button", { name: "Remove from library", exact: true });
      await expect.poll(async () => {
        const inspectorBox = (await inspectorButton.boundingBox())!;
        const removeBox = (await remove.boundingBox())!;
        return { aligned: Math.abs(removeBox.x - inspectorBox.x) < 1,
          separated: removeBox.y - inspectorBox.y - inspectorBox.height >= 40 };
      }).toEqual({ aligned: true, separated: true });
      await expect(remove.locator("..")).toHaveCSS("border-top-style", "solid");
      await fullTabPage.getByRole("dialog", { name: "Book details", exact: true }).screenshot({
        path: test.info().outputPath("details-utility-and-removal.png"),
      });
      await inspectorButton.click();

      await fullTabPage.getByRole("tab", { name: /Files/ }).waitFor();
      await expect(fullTabPage.getByRole("button", { name: "Locate current passage", exact: true })).toHaveCount(0);
      await expect(fullTabPage.getByRole("button", { name: "Show in book", exact: true })).toHaveCount(0);
      await fullTabPage.getByRole("tab", { name: /Spine/ }).click();
      await expect(fullTabPage.getByRole("button", { name: "OEBPS/content.opf" }).first()).toBeVisible();
      await fullTabPage.keyboard.press("Escape");
      await expect(fullTabPage.getByRole("dialog", { name: "EPUB Inspector", exact: true })).toBeHidden();
      await expect(fullTabPage.getByRole("dialog", { name: "Book details", exact: true })).toBeVisible();
      await expect(inspectorButton).toBeFocused();
    } finally {
      await context.close();
    }
  });
});
