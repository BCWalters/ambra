import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EPUB = path.resolve(here, "..", "fixtures", "two-chapter.epub");

/** The Library page previously had no chrome-theme awareness at all —
 * picking any reader "Reader Theme" besides the default left it reading
 * as a second, undecorated app the moment a reader left the book. This
 * suite covers the functional half of fixing that (the theme preference
 * genuinely carrying across from the reader's Settings menu to a
 * separately-loaded page reading the same `LibraryDatabase` value), not
 * the purely cosmetic result — see this session's own visual
 * verification (screenshots) for that half. */
test.describe("Library page picks up the reader's chrome theme (issue #86 follow-up)", () => {
  test("switching the reader theme away from the Ambra default and reloading the library page carries the same color across", async () => {
    const { context, libraryPage, readerPage } = await launchReader(EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      const heading = libraryPage.getByRole("heading", { name: "Ambra", level: 1, exact: true });

      // Before ever touching the theme picker, the library reads the
      // Ambra default (see `DEFAULT_CHROME_THEME`) — not literally
      // untouched/unthemed.
      await expect(heading).toHaveCSS("color", "rgb(122, 62, 0)"); // Accessible Ambra text accent.

      await readerPage.getByRole("button", { name: "Settings" }).click();
      await readerPage.getByRole("menuitem", { name: /^Reader theme/ }).press("ArrowRight");
      await readerPage.getByRole("menuitemradio", { name: "Silver", exact: true }).click();
      await readerPage.keyboard.press("Escape");
      await readerPage.keyboard.press("Escape");
      await libraryPage.reload();
      await expect(heading).toHaveCSS("color", "rgb(64, 74, 89)"); // Accessible Silver text accent.
    } finally {
      await context.close();
    }
  });
});
