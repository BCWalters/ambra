import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALICE = path.resolve(here, "..", "real-books", "alice-in-wonderland.epub");
const CHILDRENS_LIT = path.resolve(here, "..", "real-books", "childrens-literature.epub");

/** Covers the Library redesign (themed action buttons/trash-can remove,
 * a full-browser-tab expand option, and book-grid sorting) added on top
 * of the pre-existing bare-bones grid. */
test.describe("Library UX: sorting, full-tab expand, themed remove", () => {
  test("sorting by title reorders the grid and the choice persists across a reload", async () => {
    const { context, libraryPage } = await launchReader(ALICE, { viewport: { width: 1000, height: 700 } });
    try {
      await libraryPage.locator('input[type="file"]').setInputFiles([CHILDRENS_LIT]);
      await libraryPage.waitForTimeout(1000);

      const titlesInOrder = () =>
        libraryPage
          .locator("p")
          .evaluateAll((nodes) =>
            nodes
              .map((n) => n.textContent?.trim())
              .filter((text): text is string => !!text && (text.startsWith("Alice") || text.startsWith("Children"))),
          );

      // Newest-first (the default) puts the just-imported "Children's
      // Literature" ahead of "Alice's Adventures…", imported first.
      expect(await titlesInOrder()).toEqual(["Children's Literature", "Alice's Adventures in Wonderland"]);

      await libraryPage.getByRole("button", { name: "Sort library" }).click();
      await libraryPage.getByRole("menuitemradio", { name: "Title (A–Z)" }).click();
      await libraryPage.waitForTimeout(300);

      expect(await titlesInOrder()).toEqual(["Alice's Adventures in Wonderland", "Children's Literature"]);

      await libraryPage.reload();
      await libraryPage.waitForTimeout(800);
      expect(await titlesInOrder()).toEqual(["Alice's Adventures in Wonderland", "Children's Literature"]);
    } finally {
      await context.close();
    }
  });

  test("the expand button opens the library as its own full tab, which then hides that same button", async () => {
    const { context, libraryPage } = await launchReader(ALICE, { viewport: { width: 1000, height: 700 } });
    try {
      const expandButton = libraryPage.getByRole("button", { name: "Expand library into a full browser tab" });
      await expect(expandButton).toBeVisible();

      const [fullTabPage] = await Promise.all([context.waitForEvent("page"), expandButton.click()]);
      await fullTabPage.waitForLoadState("domcontentloaded");
      await fullTabPage.waitForTimeout(500);

      expect(fullTabPage.url()).toContain("?view=tab");
      await expect(fullTabPage.getByRole("button", { name: "Expand library into a full browser tab" })).toHaveCount(0);
      // The rest of the page still works normally in the full tab.
      await expect(fullTabPage.getByText("Alice's Adventures", { exact: false })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("the remove (trash) button removes a book from the grid", async () => {
    const { context, libraryPage } = await launchReader(ALICE, { viewport: { width: 1000, height: 700 } });
    try {
      await expect(libraryPage.getByText("Alice's Adventures", { exact: false })).toBeVisible();
      // The trash button is only interactive while its card is
      // hovered/focused (see `BookCard`'s `isActive` — `pointer-events:
      // none` otherwise), matching real usage.
      await libraryPage.getByText("Alice's Adventures", { exact: false }).hover();
      await libraryPage.getByRole("button", { name: /^Remove .* from library$/ }).click();
      await libraryPage.waitForTimeout(500);
      await expect(libraryPage.getByText("Alice's Adventures", { exact: false })).toHaveCount(0);
      await expect(libraryPage.getByText("Your library is empty", { exact: false })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
