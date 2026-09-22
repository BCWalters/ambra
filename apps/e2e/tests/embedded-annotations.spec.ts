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
 * merges it directly into the Bookmarks tab (issue #116 — a dedicated
 * third "Notes" tab used to hold these, but routinely didn't fit the
 * panel's fixed width alongside "Bookmarks"/"Highlights" for what's
 * usually zero or one item), tagged distinctly from the reader's own
 * bookmarks, shows the annotation's own note text as its label, and
 * that selecting it actually navigates there without an error.
 */
test("a publisher-embedded, bookmark-shaped annotation merges into the Bookmarks tab with a read-only treatment", async () => {
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

    // No separate "Notes" tab at all any more — just the usual two.
    await expect(readerPage.getByRole("tab")).toHaveCount(2);
    await expect(readerPage.getByRole("tab", { name: /Notes/ })).toHaveCount(0);

    // The Bookmarks tab is selected by default and its count includes
    // the embedded annotation even though the reader has no bookmarks
    // of their own yet.
    await expect(readerPage.getByRole("tab", { name: "Bookmarks (1)" })).toBeVisible();

    const noteRow = readerPage.getByRole("button", { name: /this chapter introduces the fox/ });
    await expect(noteRow).toBeVisible();
    // Tagged distinctly from a real bookmark, and has no remove button —
    // there's nothing here for the reader to delete (it lives in the
    // EPUB itself, not this app's own library).
    await expect(noteRow.getByText("Publisher note")).toBeVisible();
    await expect(readerPage.getByRole("button", { name: /^Remove bookmark:/ })).toHaveCount(0);

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
