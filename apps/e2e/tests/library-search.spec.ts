import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIRST = path.resolve(here, "../fixtures/long-content.epub");
const SECOND = path.resolve(here, "../fixtures/two-chapter.epub");
const TITLE = "Ambra Long Content Test Fixture";

test("short compact Library keeps books and footer reachable below the sticky filters", async () => {
  const { context, libraryPage: page } = await launchReader(FIRST, { viewport: { width: 320, height: 256 } });
  try {
    await page.bringToFront();
    const open = page.getByRole("main").getByRole("button", { name: /^Open / }).first();
    await open.focus();
    await expect(open).toBeInViewport({ ratio: 1 });
    const cover = (await open.boundingBox())!;
    const filters = (await page.locator("[data-library-filters]").boundingBox())!;
    expect(cover.y + cover.height / 2).toBeGreaterThanOrEqual(filters.y + filters.height);
    const expand = page.getByRole("button", { name: "Open library in new tab", exact: true });
    await expand.focus();
    await expect(expand).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});

for (const width of [360, 1200]) {
  test(`${width}px library search filters local metadata, preserves sorting and opens the matching book (#269)`, async ({ browserName: _browserName }, testInfo) => {
    const requests: string[] = [];
    const { context, libraryPage: page, readerPage } = await launchReader(FIRST, {
      viewport: { width, height: 800 },
      beforeBookImport: async (library) => {
        await library.route(/^https?:\/\//, async (route) => {
          requests.push(route.request().url());
          await route.abort();
        });
      },
    });
    try {
      const readerUrl = readerPage.url();
      await readerPage.close();
      if (width > 600) await page.goto(`${page.url()}?view=tab`);
      await page.locator('input[type="file"]').setInputFiles(SECOND);
      const covers = page.locator("[data-library-collection]").getByRole("button", { name: /^Open / });
      await expect(covers).toHaveCount(2);
      await page.getByRole("button", { name: "Sort library", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Title (A–Z)" }).click();
      await expect(covers.first()).toHaveAccessibleName(new RegExp(`^Open ${TITLE}`));
      const sorted = await covers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
      const search = page.getByRole("searchbox", { name: "Search library" });
      const searchFrame = search.locator("..");
      await page.bringToFront();
      for (const forcedColors of ["none", "active"] as const) {
        await page.emulateMedia({ forcedColors, reducedMotion: "reduce" });
        await search.click();
        await expect(search).toBeFocused();
        await expect(search).toHaveCSS("box-shadow", "none");
        await expect(search).toHaveCSS("outline-style", "none");
        await expect.poll(() => searchFrame.evaluate(element =>
          getComputedStyle(element, "::after").transform)).toBe("matrix(1, 0, 0, 1, 0, 0)");
        const frameFocus = await searchFrame.evaluate(element => {
          const frame = getComputedStyle(element);
          const underline = getComputedStyle(element, "::after");
          return { outline: frame.outlineStyle, outlineWidth: frame.outlineWidth,
            underline: underline.borderBottomWidth, transform: underline.transform,
            left: underline.left, right: underline.right };
        });
        if (forcedColors === "active") {
          expect(frameFocus.outline).toBe("solid");
          expect(frameFocus.outlineWidth).toBe("2px");
        } else {
          expect(frameFocus.underline).toBe("2px");
          expect(frameFocus.transform).toBe("matrix(1, 0, 0, 1, 0, 0)");
          expect(frameFocus.left).toBe("-1px");
          expect(frameFocus.right).toBe("-1px");
        }
        await search.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(search).toBeFocused();
        await expect(search).toHaveCSS("box-shadow", "none");
        await page.screenshot({ path: testInfo.outputPath(`library-search-focus-${width}-${forcedColors}.png`), fullPage: true });
      }
      await page.emulateMedia({ forcedColors: "none" });
      await search.fill("  LoVELace   long  ");
      await expect(covers).toHaveCount(1);
      await expect(covers).toHaveAccessibleName(new RegExp(`^Open ${TITLE}`));
      await expect(page.getByRole("status").filter({ hasText: "1 of 2 books" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`library-search-${width}.png`), fullPage: true });

      const find = page.getByRole("button", { name: "Find books", exact: true });
      if (width > 600) {
        await find.click();
        await expect(page.getByRole("dialog", { name: "Find books", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(find).toBeFocused();
      } else {
        const opened = context.waitForEvent("page");
        await find.click();
        const discovery = await opened;
        await expect(discovery.getByRole("dialog", { name: "Find books", exact: true })).toBeVisible();
        await discovery.close();
      }
      await expect(search).toHaveValue("  LoVELace   long  ");
      await expect(covers).toHaveCount(1);
      await search.dispatchEvent("keydown", { key: "Escape", isComposing: true });
      await expect(search).toHaveValue("  LoVELace   long  ");
      await search.press("Escape");
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();
      await expect(covers).toHaveCount(2);
      expect(await covers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))).toEqual(sorted);

      await search.fill(".epub");
      await expect(covers).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: "0 of 2 books" })).toBeVisible();
      await expect(page.getByText("No matching books.", { exact: false })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No books yet" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Import EPUB", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Clear library search", exact: true }).click();
      await expect(search).toBeFocused();
      await expect(covers).toHaveCount(2);
      await search.pressSequentially("?");
      await expect(search).toHaveValue("?");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await search.fill("long");
      expect(requests, "Library filtering must not contact book sites").toEqual([]);
      const opened = context.waitForEvent("page");
      await covers.click();
      const reader = await opened;
      await expect(reader).toHaveURL(readerUrl);
      await expect(reader.getByRole("button", { name: "Show contents", exact: true })).toBeVisible();
      await expect(reader.getByRole("main").locator("iframe").first()).toBeVisible();
      await expect(search).toHaveValue("long");
    } finally {
      await context.close();
    }
  });
}

test("active library searches follow imports and removals without confusing no matches with an empty library (#269)", async () => {
  const { context, libraryPage: page } = await launchReader(FIRST);
  try {
    const search = page.getByRole("searchbox", { name: "Search library" });
    const covers = page.getByRole("main").getByRole("button", { name: /^Open / });
    await search.fill("two-chapter");
    await expect(covers).toHaveCount(0);
    await page.locator('input[type="file"]').setInputFiles(SECOND);
    await expect(covers).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: "1 of 2 books" })).toBeVisible();
    await covers.press("Delete");
    const confirmation = page.getByRole("alertdialog", { includeHidden: true });
    await confirmation.getByRole("button", { name: "Remove from library", exact: true }).click();
    // Removal keys remain modal-owned until the exiting surface unmounts.
    await expect(confirmation).toHaveCount(0);
    await expect(covers).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "0 of 1 books" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No books yet" })).toHaveCount(0);
    await search.fill("long");
    await covers.press("Backspace");
    await expect(confirmation).toContainText(TITLE);
    await confirmation.getByRole("button", { name: "Remove from library", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(search).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No books yet" })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(SECOND);
    await expect(search).toHaveValue("");
    await expect(covers).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("library search relabels live in French without changing its query, and clears on reload (#269)", async () => {
  const { context, libraryPage: page } = await launchReader(FIRST, { viewport: { width: 360, height: 750 } });
  try {
    await page.getByRole("searchbox", { name: "Search library" }).fill("lovelace");
    await page.getByRole("button", { name: "Ambra settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("fr");
    await page.keyboard.press("Escape");
    const t = getTranslate("fr");
    const search = page.getByRole("searchbox", { name: t("library.search") });
    await expect(search).toHaveValue("lovelace");
    await expect(search).toHaveAttribute("placeholder", t("library.searchPlaceholder"));
    await search.focus();
    await expect(page.getByRole("button", { name: t("library.clearSearch") })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: t("library.searchResults", { shown: "1", total: "1" }) })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await search.fill("missing");
    await expect(page.getByText(t("library.searchNoResults"))).toBeVisible();
    await page.reload();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("button", { name: t("library.openBook", { title: TITLE }), exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
