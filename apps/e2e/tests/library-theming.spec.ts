import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EPUB = path.resolve(here, "..", "real-books", "alice-in-wonderland.epub");

/** The Library page previously had no chrome-theme awareness at all —
 * picking any reader "Reader Theme" besides the default left it reading
 * as a second, undecorated app the moment a reader left the book. This
 * suite covers the functional half of fixing that (the theme preference
 * genuinely carrying across from the reader's Settings menu to a
 * separately-loaded page reading the same `LibraryDatabase` value), not
 * the purely cosmetic result — see this session's own visual
 * verification (screenshots) for that half. */
test.describe("Library page picks up the reader's chrome theme (issue #86 follow-up)", () => {
  test("switching the reader theme to Ambra and reloading the library page carries the same color across", async () => {
    const { context, libraryPage, readerPage } = await launchReader(EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      const titleColor = () =>
        libraryPage.evaluate(() => {
          const heading = Array.from(document.querySelectorAll("*")).find(
            (el) => el.children.length === 0 && el.textContent?.trim() === "Ambra",
          );
          return heading ? getComputedStyle(heading).color : null;
        });

      // Before ever touching the theme picker, the library reads the
      // silver default — not literally untouched/unthemed.
      const silverColor = await titleColor();
      expect(silverColor).toBe("rgb(91, 100, 114)"); // CHROME_THEMES.silver.accent (#5b6472)

      await readerPage.getByRole("button", { name: "Settings" }).click();
      await readerPage.getByText("Ambra", { exact: true }).click();
      await readerPage.keyboard.press("Escape");
      await readerPage.waitForTimeout(300);

      await libraryPage.reload();
      await libraryPage.waitForTimeout(500);

      const ambraColor = await titleColor();
      expect(ambraColor).toBe("rgb(245, 165, 49)"); // CHROME_THEMES.ambra.accent (#f5a531)
      expect(ambraColor).not.toBe(silverColor);
    } finally {
      await context.close();
    }
  });
});
