import { expect, test, type Locator } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = path.resolve(here, "../fixtures/reading-entry.epub");
const secondBook = path.resolve(here, "../fixtures/long-content.epub");

test.describe("Library card focus and long labels", () => {
  // Switching tabs here must never take focus from the maintainer's browser.
  test.skip(process.env.AMBRA_E2E_HEADLESS !== "1", "Requires isolated headless Chromium");

  test("pointer-opened books do not retain action visibility after tab return; keyboard actions remain available (#173)", async () => {
    const { context, libraryPage, readerPage } = await launchReader(book);
    try {
      await libraryPage.bringToFront();
      await libraryPage.locator('input[type="file"]').setInputFiles(secondBook);
      const second = libraryPage.getByRole("button", { name: /^Open Ambra Long Content Test Fixture/ });
      await expect(second).toBeVisible();
      await readerPage.close();
      const first = libraryPage.getByRole("button", { name: /^Open Reading Entry/ });
      const details = libraryPage.getByRole("button", { name: "Reading Entry details", exact: true });
      const remove = libraryPage.getByRole("button", { name: "Remove Reading Entry from library", exact: true });
      const secondDetails = libraryPage.getByRole("button", { name: "Ambra Long Content Test Fixture details", exact: true });

      const [opened] = await Promise.all([context.waitForEvent("page"), first.click()]);
      await opened.waitForLoadState("domcontentloaded");
      await opened.bringToFront();
      await libraryPage.bringToFront();
      await second.hover();
      await expect(first).toBeFocused();
      await expect(details).toHaveCSS("opacity", "0");
      await expect(remove).toHaveCSS("pointer-events", "none");
      await expect(secondDetails).toHaveCSS("opacity", "1");

      await libraryPage.mouse.move(880, 680);
      // Tab away from the pointer-focused cover, then back, using real input.
      await libraryPage.keyboard.press("Tab");
      await expect(details).toBeFocused();
      await libraryPage.keyboard.press("Shift+Tab");
      await expect(first).toBeFocused();
      await expect(details).toHaveCSS("opacity", "1");
      await libraryPage.keyboard.press("Tab");
      await expect(details).toBeFocused();
      await expect(remove).toHaveCSS("opacity", "1");
      await libraryPage.keyboard.press("Enter");
      const dialog = libraryPage.getByRole("dialog", { name: "Book details", exact: true });
      await expect(dialog).toBeVisible();
      await libraryPage.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(details).toBeFocused();
      await expect(details).toHaveCSS("opacity", "1");
      await libraryPage.keyboard.press("Tab");
      await expect(remove).toBeFocused();
      await expect(remove).toHaveCSS("opacity", "1");
      // This is the final card, so forward Tab may leave the document for
      // browser chrome. Move explicitly to the previous card instead.
      await libraryPage.keyboard.press("Shift+Tab");
      await libraryPage.keyboard.press("Shift+Tab");
      await libraryPage.keyboard.press("Shift+Tab");
      await expect(libraryPage.getByRole("button", {
        name: "Remove Ambra Long Content Test Fixture from library", exact: true,
      })).toBeFocused();
      await expect(details).toHaveCSS("opacity", "0");
    } finally {
      await context.close();
    }
  });

  test("coverless titles and creators stay within their card, and long tooltips can be scrolled", async () => {
    const { context, libraryPage, readerPage } = await launchReader(book, { viewport: { width: 360, height: 700 } });
    const title = "UnbrokenBookTitle".repeat(100);
    const creator = "長い著者".repeat(100);
    try {
      await exposeReaderController(readerPage);
      await readerPage.evaluate(async ({ title, creator }) => {
        const controller = Reflect.get(window, "__readerController");
        const library = controller.library;
        const stored = await library.getBookMetadata(controller.bookId);
        if (!stored) throw new Error("Fixture book metadata not found");
        await new Promise<void>((resolve, reject) => {
          const transaction = library.db.transaction(["books", "bookCovers"], "readwrite");
          transaction.objectStore("books").put({ ...stored, title, creator });
          transaction.objectStore("bookCovers").delete(controller.bookId);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      }, { title, creator });
      await libraryPage.reload();
      await libraryPage.bringToFront();
      const cover = libraryPage.getByRole("button", { name: new RegExp(`^Open ${title}`) });
      const card = cover.locator("../..");
      const coverTitle = cover.locator("span");
      const author = card.locator("p").filter({ hasText: creator });
      await expect(coverTitle).toHaveText(title);
      await expect(coverTitle).toHaveCSS("-webkit-line-clamp", "6");
      await expect(author).toHaveText(creator);
      await expect(author).toHaveCSS("-webkit-line-clamp", "2");
      const assertClamped = async (label: Locator) => {
        expect(await label.evaluate(element => element.clientHeight <=
          parseInt(getComputedStyle(element).webkitLineClamp) * parseFloat(getComputedStyle(element).lineHeight) + 1,
        )).toBe(true);
        expect(await label.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      };
      await assertClamped(coverTitle);
      await assertClamped(author);
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

      const details = libraryPage.getByRole("button", { name: `${title} details`, exact: true });
      await cover.hover();
      await details.hover();
      const tooltip = libraryPage.getByRole("tooltip");
      await expect(tooltip).toHaveText(`${title} details`);
      await expect(tooltip).toHaveCSS("overflow-y", "auto");
      await expect(tooltip).toHaveCSS("pointer-events", "auto");
      const bounds = await tooltip.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeLessThanOrEqual(328);
      expect(bounds!.height).toBeLessThanOrEqual(240);
      await tooltip.hover();
      await libraryPage.mouse.wheel(0, 180);
      await expect.poll(() => tooltip.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await expect(details).toHaveAttribute("aria-label", `${title} details`);
    } finally {
      await context.close();
    }
  });
});
