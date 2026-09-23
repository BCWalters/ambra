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
      // The "details" (i) button only becomes interactive on hover/focus
      // of its card (see `BookCard`'s `isActive`) — hover the title first,
      // matching how `library-ux.spec.ts`'s remove-button test does this.
      await libraryPage.getByText("Alice's Adventures", { exact: false }).hover();
      await libraryPage.getByRole("button", { name: "Alice's Adventures in Wonderland details" }).click();
      await expect(libraryPage.getByText("Book details", { exact: true })).toBeVisible();
      await expect(libraryPage.getByRole("button", { name: /inspector/i })).toHaveCount(0);
      await libraryPage.getByRole("button", { name: "Close" }).click();

      const expandButton = libraryPage.getByRole("button", { name: "Expand library into a full browser tab" });
      const [fullTabPage] = await Promise.all([context.waitForEvent("page"), expandButton.click()]);
      await fullTabPage.waitForLoadState("domcontentloaded");
      await expect(fullTabPage.getByText("Alice's Adventures", { exact: false })).toBeVisible();

      await fullTabPage.getByText("Alice's Adventures", { exact: false }).hover();
      await fullTabPage.getByRole("button", { name: "Alice's Adventures in Wonderland details" }).click();
      const inspectorButton = fullTabPage.getByRole("button", { name: /inspector/i });
      await expect(inspectorButton).toBeVisible();
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
