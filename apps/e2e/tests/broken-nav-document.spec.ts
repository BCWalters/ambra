import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BROKEN_NAV_EPUB = path.resolve(here, "..", "fixtures", "broken-nav.epub");

/**
 * A single broken/missing part of an otherwise-valid EPUB shouldn't take
 * down the whole book — part of the dedicated error-handling review.
 * This fixture's Nav Document has no `<nav epub:type="toc">` at all (a
 * real, fairly common authoring mistake), which previously threw
 * straight out of `ReaderController.open`, failing the *entire* book
 * before a reader ever saw a single page — even though every actual
 * chapter is perfectly fine. It should now open normally (with a
 * dismissable, useful-to-an-author notice about the missing TOC)
 * instead.
 */
test("a book with a broken Nav Document still opens and is fully readable", async () => {
  const { context, readerPage } = await launchReader(BROKEN_NAV_EPUB);
  try {
    // The actual content rendered normally, not a blocking error screen.
    const iframeText = await readerPage.evaluate(() => {
      const iframe = document.querySelector("iframe");
      return iframe?.contentDocument?.body?.innerText ?? "";
    });
    expect(iframeText).toContain("This chapter reads fine");

    // A transient (non-blocking, dismissable) notice explains why —
    // useful both to a reader and to whoever authored this book.
    await expect(readerPage.getByText("Table of Contents couldn't be loaded", { exact: false })).toBeVisible();
    await expect(readerPage.getByText("no <nav", { exact: false })).toBeVisible();

    // Forward navigation (next chapter) still works normally — the book
    // is fully readable via ordinary page/chapter turns even without a
    // working TOC.
    await readerPage.keyboard.press("ArrowRight");
    await readerPage.waitForTimeout(500);
    const secondChapterText = await readerPage.evaluate(() => {
      const iframe = document.querySelector("iframe");
      return iframe?.contentDocument?.body?.innerText ?? "";
    });
    expect(secondChapterText).toContain("Second chapter");
  } finally {
    await context.close();
  }
});
