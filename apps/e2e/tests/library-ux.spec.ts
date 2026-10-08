import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentPageLabel, launchReader } from "../harness.js";
import { expandLibraryTools } from "../library-tools.js";
import { exposeReaderController } from "../reader-controller.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT = path.resolve(here, "..", "fixtures", "long-content.epub");
const TWO_CHAPTER = path.resolve(here, "..", "fixtures", "two-chapter.epub");
const LONG_CONTENT_TITLE = "Ambra Long Content Test Fixture";
const TWO_CHAPTER_TITLE = "Ambra Two-Chapter Spread Test Fixture";

test("Continue reading follows the prototype and resumes the saved book at wide and narrow widths", async () => {
  const { context, libraryPage: page, readerPage } = await launchReader(TWO_CHAPTER, { viewport: { width: 1200, height: 900 } });
  try {
    await exposeReaderController(readerPage);
    await readerPage.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.goToChapter(1);
      await controller.flushProgress();
    });
    await page.goto(`${page.url()}?view=tab`);
    await page.bringToFront();
    const resume = page.getByRole("region", { name: "Continue reading", exact: true });
    await expect(resume.getByRole("heading", { name: TWO_CHAPTER_TITLE, exact: true })).toBeVisible();
    for (const width of [1200, 600, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const card = resume.locator("[data-library-continue]");
      const cover = resume.locator("[data-book-open]");
      await expect(card).toHaveCSS("border-radius", "8px");
      await expect(card).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(cover).toHaveCSS("width", "72px");
      await expect(cover).toHaveCSS("height", "108px");
      await expect(resume.getByRole("heading")).toHaveCSS("font-size", width > 600 ? "21px" : "18px");
      const progress = resume.locator("[data-library-progress-track]");
      expect((await progress.boundingBox())!.width).toBeLessThanOrEqual(240);
      const details = resume.getByRole("button", { name: `${TWO_CHAPTER_TITLE} details`, exact: true });
      const progressBox = (await progress.boundingBox())!;
      const detailsBox = (await details.boundingBox())!;
      const statusBox = (await resume.locator("[data-library-progress-status]").boundingBox())!;
      expect(detailsBox.y).toBeGreaterThanOrEqual(progressBox.y + progressBox.height);
      expect(detailsBox.x + detailsBox.width).toBeCloseTo(progressBox.x + progressBox.width, 0);
      expect(detailsBox.y).toBeGreaterThanOrEqual(statusBox.y);
      expect(detailsBox.y + detailsBox.height).toBeLessThanOrEqual(statusBox.y + statusBox.height);
      await expect(resume.locator("[data-library-continue-actions]").getByRole("button")).toHaveCount(1);
      await expect(resume.getByRole("button", { name: "Continue reading", exact: true })).toBeInViewport({ ratio: 1 });
      const coverBox = (await cover.boundingBox())!;
      const actionsBox = (await resume.locator("[data-library-continue-actions]").boundingBox())!;
      if (width > 600) {
        expect(actionsBox.x).toBeGreaterThan((await progress.boundingBox())!.x + 240);
        expect(actionsBox.y).toBeLessThan(coverBox.y + coverBox.height);
        expect(actionsBox.y + actionsBox.height).toBeGreaterThan(coverBox.y);
      } else {
        expect(actionsBox.y).toBeGreaterThanOrEqual(coverBox.y + coverBox.height + 16);
        expect(actionsBox.x).toBe(coverBox.x);
      }
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "Import book", exact: true })).toBeVisible();
      await expect(page.locator('input[type="file"]')).toHaveAttribute("accept", ".epub");
      await page.screenshot({ path: test.info().outputPath(`continue-reading-${width}.png`) });
    }
    const search = page.getByRole("searchbox", { name: "Search library" });
    await resume.getByRole("button", { name: `${TWO_CHAPTER_TITLE} details`, exact: true }).click();
    const detailsDialog = page.getByRole("dialog", { name: "Book details", exact: true });
    await expect(detailsDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detailsDialog).toBeHidden();
    await search.fill("Two-Chapter");
    await expect(resume).toHaveCount(0);
    await search.fill("");
    await expect(resume).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: test.info().outputPath("continue-reading-dark.png") });
    await page.emulateMedia({ forcedColors: "active" });
    const action = resume.getByRole("button", { name: "Continue reading", exact: true });
    await action.focus();
    await expect(action).toHaveCSS("outline-style", "solid");
    await page.emulateMedia({ forcedColors: "none" });
    await readerPage.evaluate(async () => Reflect.get(window, "__readerController").library.setLocalePreference("fr"));
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const t = getTranslate("fr");
    await expect(page.getByRole("button", { name: t("library.importEpub"), exact: true })).toBeVisible();
    const frenchResume = page.getByRole("region", { name: t("library.continueReading"), exact: true });
    expect(await frenchResume.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await readerPage.close();
    const opened = context.waitForEvent("page");
    await frenchResume.getByRole("button", { name: t("library.continueReading"), exact: true }).click();
    const resumed = await opened;
    await expect(resumed.locator("[data-ambra-toolbar-title]")).toContainText("Chapter Two");
  } finally {
    await context.close();
  }
});

/** Covers the Library redesign (themed action buttons/trash-can remove,
 * a full-browser-tab expand option, and book-grid sorting) added on top
 * of the pre-existing bare-bones grid. */
test.describe("Library UX: sorting, full-tab expand, themed remove", () => {
  test("sorting by title reorders the grid and the choice persists across a reload", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT, { viewport: { width: 1000, height: 700 } });
    try {
      await libraryPage.goto(`${libraryPage.url()}?view=tab`);
      await libraryPage.locator('input[type="file"]').setInputFiles([TWO_CHAPTER]);

      const titlesInOrder = () =>
        libraryPage
          .locator("[data-library-collection] p")
          .evaluateAll((nodes, titles) =>
            nodes
              .map((n) => n.textContent?.trim())
              .filter((text): text is string => !!text && titles.includes(text)),
            [LONG_CONTENT_TITLE, TWO_CHAPTER_TITLE],
          );

      // Newest-first and alphabetical order must disagree for these fixtures.
      await expect.poll(titlesInOrder).toEqual([TWO_CHAPTER_TITLE, LONG_CONTENT_TITLE]);

      await expandLibraryTools(libraryPage);
      await libraryPage.getByRole("button", { name: "Sort library" }).click();
      await libraryPage.getByRole("menuitemradio", { name: "Title (A–Z)" }).click();
      await expect.poll(titlesInOrder).toEqual([LONG_CONTENT_TITLE, TWO_CHAPTER_TITLE]);

      // The grid updates optimistically. A read transaction queues behind the
      // preference write, so reload cannot abort that still-pending commit.
      expect(await libraryPage.evaluate(() => new Promise<unknown>((resolve, reject) => {
        const opening = indexedDB.open("ambra-library");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const transaction = db.transaction("preferences", "readonly");
          const request = transaction.objectStore("preferences").get("defaultLibrarySort");
          transaction.oncomplete = () => {
            db.close();
            resolve(request.result?.value);
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }))).toBe("titleAsc");

      await libraryPage.reload();
      await expect.poll(titlesInOrder).toEqual([LONG_CONTENT_TITLE, TWO_CHAPTER_TITLE]);
    } finally {
      await context.close();
    }
  });

  test("the expand button opens the library as its own full tab, which then hides that same button", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT, { viewport: { width: 1000, height: 700 } });
    try {
      const expandButton = libraryPage.getByRole("button", { name: "Open library in new tab", exact: true });
      await expect(expandButton).toBeVisible();

      const [fullTabPage] = await Promise.all([context.waitForEvent("page"), expandButton.click()]);
      await fullTabPage.waitForLoadState("domcontentloaded");
      await fullTabPage.waitForTimeout(500);

      expect(fullTabPage.url()).toContain("?view=tab");
      await expect(fullTabPage.getByRole("button", { name: "Open library in new tab", exact: true })).toHaveCount(0);
      // The rest of the page still works normally in the full tab.
      await expect(fullTabPage.locator("[data-library-collection]").getByRole("button", { name: new RegExp(`^Open ${LONG_CONTENT_TITLE}`) })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("focused-book Delete confirms before removing a book", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT, { viewport: { width: 1000, height: 700 } });
    try {
      // The modal hides the unchanged collection from the accessibility tree.
      const cover = libraryPage.getByRole("button", { name: `Open ${LONG_CONTENT_TITLE}`, exact: true, includeHidden: true });
      await expect(cover).toBeVisible();
      await cover.press("Delete");
      const confirm = libraryPage.getByRole("alertdialog");
      await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await expect(cover).toHaveCount(1);
      await confirm.getByRole("button", { name: "Remove from library", exact: true }).click();
      await expect(cover).toHaveCount(0);
      await expect(libraryPage.getByRole("heading", { name: "No books yet" })).toBeVisible();
      await expect(libraryPage.getByRole("button", { name: "Import book", exact: true })).toBeFocused();
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

/** Covers issue #106: a themed, friendly error surface for
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

        await expect(libraryPage.getByText("Oh dear, that doesn't look like a valid EPUB file.")).toBeVisible();
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

        await alert.getByRole("button", { name: "Dismiss" }).click();
        await expect(libraryPage.getByText("Oh dear, that doesn't look like a valid EPUB file.")).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
});
