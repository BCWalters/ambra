import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getChromeTheme } from "../../extension/src/reader/chromeTheme.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EPUB = path.resolve(here, "..", "fixtures", "two-chapter.epub");
const asRgb = (hex: string) => `rgb(${hex.slice(1).match(/../g)!.map(part => Number.parseInt(part, 16)).join(", ")})`;

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
      await libraryPage.emulateMedia({ colorScheme: "light" });
      await readerPage.emulateMedia({ colorScheme: "light" });
      const heading = libraryPage.getByRole("heading", { name: "Ambra", level: 1, exact: true });

      // Before ever touching the theme picker, the library reads the
      // Ambra default (see `DEFAULT_CHROME_THEME`) — not literally
      // untouched/unthemed.
      await expect(heading).toHaveCSS("color", asRgb(getChromeTheme("ambra", "light").accentForeground));

      await readerPage.getByRole("button", { name: "Ambra settings", exact: true }).click();
      await readerPage.getByRole("combobox", { name: "Interface theme", exact: true }).selectOption("silver");
      await readerPage.keyboard.press("Escape");
      await expect(readerPage.getByRole("dialog", { name: "Ambra settings", exact: true })).toBeHidden();
      await expect(heading).toHaveCSS("color", asRgb(getChromeTheme("silver", "light").accentForeground));
      await libraryPage.reload();
      await expect(heading).toHaveCSS("color", asRgb(getChromeTheme("silver", "light").accentForeground));
    } finally {
      await context.close();
    }
  });
});
