import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, currentPageLabel } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EMBEDDED_ANNOTATIONS_EPUB = path.resolve(here, "..", "fixtures", "embedded-annotations.epub");

/**
 * A publisher-embedded, read-only annotation collection (issue #109) —
 * a manifest item marked `properties="annotations"` pointing at a plain
 * EPUB Annotations 1.0 JSON file (see `embedded-annotations.epub`'s own
 * `OEBPS/annotations.json`, built by hand for this fixture using a real
 * CFI generated from this exact book's own `ch1.xhtml`; its one
 * annotation has `motivation: "bookmarking"`). Confirms the reader
 * includes it in both All annotations and the Bookmarks filter,
 * tagged distinctly from the reader's own
 * bookmarks, shows the annotation's own note text as its label, and
 * that selecting it actually navigates there without an error.
 */
test("a publisher-embedded bookmark appears in Annotations and its Bookmarks filter with read-only treatment", async () => {
  const { context, readerPage } = await launchReader(EMBEDDED_ANNOTATIONS_EPUB, {
    viewport: { width: 900, height: 900 },
  });
  try {
    await readerPage.waitForTimeout(500);

    // The toolbar auto-hides after inactivity (`bumpContentActivity`),
    // making its own buttons briefly unclickable — a plain mouse move
    // first "wakes" it, the same way every other test that opens a
    // toolbar panel from a freshly-loaded page does.
    await readerPage.mouse.move(450, 20);
    await readerPage.waitForTimeout(150);
    await readerPage.getByRole("button", { name: "Annotations", exact: true }).click();
    const panel = readerPage.getByRole("navigation", { name: "Annotations", exact: true });
    const show = panel.getByRole("combobox", { name: "Show", exact: true });

    await expect(panel.getByRole("tab")).toHaveCount(0);
    await expect(show).toHaveValue("all");
    await expect(show.locator("option")).toHaveText([
      "All annotations (1)", "Highlights (0)", "Notes (0)", "Bookmarks (1)",
    ]);

    const noteRow = panel.getByRole("button", { name: /this chapter introduces the fox/ });
    await expect(noteRow).toBeVisible();
    await show.selectOption("bookmarks");
    await expect(noteRow).toBeVisible();
    // Tagged distinctly from a real bookmark, and has no remove button —
    // there's nothing here for the reader to delete (it lives in the
    // EPUB itself, not this app's own library).
    await expect(readerPage.locator("[data-bookmark-card]").getByText("Publisher note")).toBeVisible();
    await expect(readerPage.getByRole("button", { name: /^Remove bookmark:/ })).toHaveCount(0);

    await noteRow.click();
    await readerPage.waitForTimeout(500);
    // Confirms the navigation succeeded without surfacing an error
    // toast (a broken/stale CFI would report one — see
    // `ReaderController.goToCfi`) and the book is still showing real
    // content.
    expect(await currentPageLabel(readerPage)).not.toBeNull();
    await expect(panel).toBeHidden();
    await expect(readerPage.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
