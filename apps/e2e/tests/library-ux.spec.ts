import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentPageLabel, launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT = path.resolve(here, "..", "fixtures", "long-content.epub");
const TWO_CHAPTER = path.resolve(here, "..", "fixtures", "two-chapter.epub");
const LONG_CONTENT_TITLE = "Ambra Long Content Test Fixture";
const TWO_CHAPTER_TITLE = "Ambra Two-Chapter Spread Test Fixture";

/** Covers the Library redesign (themed action buttons/trash-can remove,
 * a full-browser-tab expand option, and book-grid sorting) added on top
 * of the pre-existing bare-bones grid. */
test.describe("Library UX: sorting, full-tab expand, themed remove", () => {
  test("sorting by title reorders the grid and the choice persists across a reload", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT, { viewport: { width: 1000, height: 700 } });
    try {
      await libraryPage.locator('input[type="file"]').setInputFiles([TWO_CHAPTER]);

      const titlesInOrder = () =>
        libraryPage
          .locator("p")
          .evaluateAll((nodes, titles) =>
            nodes
              .map((n) => n.textContent?.trim())
              .filter((text): text is string => !!text && titles.includes(text)),
            [LONG_CONTENT_TITLE, TWO_CHAPTER_TITLE],
          );

      // Newest-first and alphabetical order must disagree for these fixtures.
      await expect.poll(titlesInOrder).toEqual([TWO_CHAPTER_TITLE, LONG_CONTENT_TITLE]);

      await libraryPage.getByRole("button", { name: "Sort library" }).click();
      await libraryPage.getByRole("menuitemradio", { name: "Title (A–Z)" }).click();
      await expect.poll(titlesInOrder).toEqual([LONG_CONTENT_TITLE, TWO_CHAPTER_TITLE]);

      await libraryPage.reload();
      await expect.poll(titlesInOrder).toEqual([LONG_CONTENT_TITLE, TWO_CHAPTER_TITLE]);
    } finally {
      await context.close();
    }
  });

  test("the expand button opens the library as its own full tab, which then hides that same button", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT, { viewport: { width: 1000, height: 700 } });
    try {
      const expandButton = libraryPage.getByRole("button", { name: "Expand library into a full browser tab" });
      await expect(expandButton).toBeVisible();

      const [fullTabPage] = await Promise.all([context.waitForEvent("page"), expandButton.click()]);
      await fullTabPage.waitForLoadState("domcontentloaded");
      await fullTabPage.waitForTimeout(500);

      expect(fullTabPage.url()).toContain("?view=tab");
      await expect(fullTabPage.getByRole("button", { name: "Expand library into a full browser tab" })).toHaveCount(0);
      // The rest of the page still works normally in the full tab.
      await expect(fullTabPage.getByText(LONG_CONTENT_TITLE, { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("the remove (trash) button removes a book from the grid", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT, { viewport: { width: 1000, height: 700 } });
    try {
      const cover = libraryPage.getByRole("button", { name: `Open ${LONG_CONTENT_TITLE}`, exact: true });
      await expect(cover).toBeVisible();
      // The trash button is only interactive while its card is
      // hovered/focused (see `BookCard`'s `isActive` — `pointer-events:
      // none` otherwise), matching real usage.
      await cover.hover();
      await libraryPage.getByRole("button", { name: /^Remove .* from library$/ }).click();
      await libraryPage.waitForTimeout(500);
      await expect(cover).toHaveCount(0);
      await expect(libraryPage.getByText("What will you read first?", { exact: false })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

/** Covers issue #105 (a read-only "Book details" flyout sharing the
 * reader's own informational layout, minus its three reader-only action
 * buttons) and issue #104 (a per-book reading-position percentage). */
test.describe("Library UX: book details flyout", () => {
  test("opens from the card's info button, shows metadata, and closes via Escape", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT, { viewport: { width: 1000, height: 700 } });
    try {
      await libraryPage.getByRole("button", { name: `Open ${LONG_CONTENT_TITLE}`, exact: true }).hover();
      const detailsButton = libraryPage.getByRole("button", { name: /details$/ });
      await detailsButton.focus();
      await libraryPage.keyboard.press("Enter");

      const flyout = libraryPage.getByRole("dialog", { name: "Book details" });
      await expect(flyout).toBeVisible();
      await expect(flyout).toHaveAttribute("aria-modal", "true");
      await expect(flyout.getByRole("button", { name: "Close", exact: true })).toBeFocused();
      await expect(flyout.getByText(LONG_CONTENT_TITLE, { exact: true })).toBeVisible();
      await expect(flyout.getByText("Ada Lovelace", { exact: true })).toBeVisible();
      // No reading progress yet for a never-opened book — the flyout
      // should simply omit the "Progress" section rather than show 0%.
      await expect(flyout.getByText("Progress")).toHaveCount(0);

      await libraryPage.keyboard.press("Escape");
      await expect(flyout).toBeHidden();
      await expect(detailsButton).toBeFocused();
    } finally {
      await context.close();
    }
  });

  test("shows a reading-position percentage once a book has been opened and paged through", async () => {
    const { context, libraryPage, readerPage } = await launchReader(LONG_CONTENT, {
      viewport: { width: 1000, height: 700 },
    });
    try {
      await expect.poll(() => currentPageLabel(readerPage)).not.toBeNull();
      for (let turn = 0; turn < 2; turn++) {
        const before = await currentPageLabel(readerPage);
        await readerPage.keyboard.press("ArrowRight");
        await expect.poll(async () => {
          const after = await currentPageLabel(readerPage);
          return after !== null && after !== before;
        }).toBe(true);
      }
      // Flush the reader's progress save (mirrors what a visibility
      // change/tab close does) before returning to the library.
      await readerPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await libraryPage.bringToFront();
      await libraryPage.reload();
      await libraryPage.waitForTimeout(800);

      await libraryPage.getByText(LONG_CONTENT_TITLE, { exact: true }).hover();
      await libraryPage.getByRole("button", { name: /details$/ }).click();

      const flyout = libraryPage.getByRole("dialog", { name: "Book details" });
      await expect(flyout.getByText("Progress")).toBeVisible();
      await expect(flyout.getByText(/% read$/)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

/** Covers issue #106: a themed, "snickerdoodles"-toned error surface for
 * a failed import, replacing a bare red error-message line. */
test.describe("Library UX: friendly import error", () => {
  for (const width of [1000, 360]) {
    test(`import errors separate the headline and explanation at ${width}px and can be dismissed`, async () => {
      const { context, libraryPage } = await launchReader(LONG_CONTENT, { viewport: { width, height: 700 } });
      try {
        await libraryPage.locator('input[type="file"]').setInputFiles({
          name: "bogus.epub",
          mimeType: "application/epub+zip",
          buffer: Buffer.from("not a real epub"),
        });

        await expect(libraryPage.getByText("Oh snickerdoodles, something went wrong.")).toBeVisible();
        const alert = libraryPage.getByRole("alert");
        await expect(alert).toBeVisible();
        const headline = alert.locator("p").nth(0);
        const explanation = alert.locator("p").nth(1);
        await expect(headline).toHaveCSS("display", "block");
        await expect(explanation).toHaveCSS("display", "block");
        const headlineBounds = await headline.boundingBox();
        const explanationBounds = await explanation.boundingBox();
        expect(headlineBounds).not.toBeNull();
        expect(explanationBounds).not.toBeNull();
        expect(explanationBounds!.y).toBeGreaterThan(headlineBounds!.y + headlineBounds!.height);

        await libraryPage.getByRole("button", { name: "Dismiss" }).click();
        await expect(libraryPage.getByText("Oh snickerdoodles, something went wrong.")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
});
