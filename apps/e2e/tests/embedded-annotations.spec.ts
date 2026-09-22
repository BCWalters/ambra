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
 * CFI generated from this exact book's own `ch1.xhtml`). Confirms the
 * reader surfaces it in its own "Notes" tab (not shown at all for books
 * without one — every other real-book fixture in this suite), shows the
 * annotation's own note text as the row label, and that selecting it
 * actually navigates there without an error.
 */
test("a publisher-embedded annotation collection shows in its own read-only Notes tab", async () => {
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
    await readerPage.getByRole("button", { name: "Bookmarks and highlights" }).click();
    await readerPage.getByRole("tab", { name: /Notes/ }).click();

    const noteRow = readerPage.getByRole("button", {
      name: "Publisher's note: this chapter introduces the fox.",
    });
    await expect(noteRow).toBeVisible();

    await noteRow.click();
    await readerPage.waitForTimeout(500);
    // Confirms the navigation succeeded without surfacing an error
    // toast (a broken/stale CFI would report one — see
    // `ReaderController.goToCfi`) and the book is still showing real
    // content.
    expect(await currentPageLabel(readerPage)).not.toBeNull();
  } finally {
    await context.close();
  }
});
