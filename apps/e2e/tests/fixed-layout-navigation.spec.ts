import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FXL_SPREAD_LTR_EPUB = path.resolve(here, "..", "fixtures", "fxl-spread-ltr.epub");
const FXL_SPREAD_RTL_EPUB = path.resolve(here, "..", "fixtures", "fxl-spread-rtl.epub");

/** All visible iframes' own text, in DOM order (left column, if any,
 * before right) — for a `FixedSpreadHost` spread, this is exactly its
 * currently-loaded page(s)' own rendered text. */
async function visiblePageTexts(readerPage: import("@playwright/test").Page): Promise<string[]> {
  return readerPage.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter((f) => getComputedStyle(f).visibility !== "hidden")
      .map((f) => (f as HTMLIFrameElement).contentDocument?.body?.innerText.trim() ?? ""),
  );
}

/**
 * Fixed-layout (FXL) reader support: until this session, fixed-layout
 * books had *no page-turn navigation implemented at all* — neither
 * clicking nor keyboard arrows did anything once a book was open (a TOC
 * jump was the only way to move at all), and separately, synthetic
 * two-page spreads (`rendition:spread`/`page-spread-left`/`-right`/
 * `-center`/`page-progression-direction`) were entirely unimplemented,
 * every spine item always shown alone regardless of what the book
 * declared. Both fixtures here are small, synthetic, EPUB-3-spec-legal
 * fixed-layout books (see `FixedLayoutSpreadPlanner`'s own doc comment
 * for the exact pairing algorithm and its primary sources) built
 * specifically to exercise this: `fxl-spread-ltr.epub` mirrors
 * `page-blanche.epub`'s own real-world spine shape (a lone
 * `page-spread-right` cover, then two ordinary alternating pairs) —
 * the exact structure that originally surfaced the "three spine items,
 * never side by side, can't navigate the book" bug report this
 * session's fixed-layout work responds to. `fxl-spread-rtl.epub`
 * mirrors `haruko-html-jpeg.epub`'s manga-style spine
 * (`page-progression-direction="rtl"`), the primary real-world reason
 * `page-progression-direction` and reversed click-zone direction exist
 * at all.
 */
test.describe("fixed-layout (FXL) navigation and spread pairing", () => {
  test("LTR: a lone leading page-spread-right cover shows alone, then pairs correctly, and click-to-turn actually works", async () => {
    const { context, readerPage } = await launchReader(FXL_SPREAD_LTR_EPUB, {
      viewport: { width: 1200, height: 900 },
    });
    try {
      await readerPage.waitForTimeout(600);
      const initial = await visiblePageTexts(readerPage);
      expect(initial, "the book's lone leading cover should open alone, not paired with anything").toEqual([
        "Cover",
      ]);

      // A real, confirmed bug this exact click-and-wait sequence caught
      // while building this feature: the very first attempt at a
      // fixed-layout page turn hung forever, because the incoming
      // `FixedSpreadHost`'s element was never attached to the live
      // document before `open()` was called — the same "a detached
      // iframe's `src` assignment never actually navigates" hazard
      // already documented elsewhere in this codebase for the
      // reflowable merge feature. A short, bounded wait here is exactly
      // what would have caught that: the screen simply never changes.
      await readerPage.mouse.click(1150, 450);
      await readerPage.waitForTimeout(800);
      const afterFirstClick = await visiblePageTexts(readerPage);
      expect(
        afterFirstClick,
        "clicking the cover's own right-third should turn the page into the first real pair",
      ).toEqual(["P1", "P2"]);

      await readerPage.mouse.click(1150, 450);
      await readerPage.waitForTimeout(800);
      const afterSecondClick = await visiblePageTexts(readerPage);
      expect(afterSecondClick, "a further forward click should reach the next pair").toEqual(["P3", "P4"]);

      // Backward navigation, symmetrically.
      await readerPage.mouse.click(50, 450);
      await readerPage.waitForTimeout(800);
      const afterBack = await visiblePageTexts(readerPage);
      expect(afterBack, "clicking the left third should turn back to the previous pair").toEqual(["P1", "P2"]);
    } finally {
      await context.close();
    }
  });

  test("RTL: page-progression-direction=rtl pairs (right=earlier, left=later) and reverses which screen side means forward", async () => {
    const { context, readerPage } = await launchReader(FXL_SPREAD_RTL_EPUB, {
      viewport: { width: 1200, height: 900 },
    });
    try {
      await readerPage.waitForTimeout(600);
      const initial = await visiblePageTexts(readerPage);
      expect(initial, "the book's lone leading page-spread-left item should open alone").toEqual(["P1"]);

      // For RTL, reading "forward" moves right-to-left across the
      // screen — the *left* third of the pane is what advances, the
      // exact opposite of every other case this reader handles (see
      // `ReaderController.fixedSpreadThirdActions`'s own doc comment).
      // A right-side click here must be a no-op (there's nothing before
      // the book's own first page to go "back" to), confirming the
      // direction really is reversed, not merely a coincidence of which
      // side happened to be clicked first.
      await readerPage.mouse.click(1150, 450);
      await readerPage.waitForTimeout(800);
      expect(
        await visiblePageTexts(readerPage),
        "a right-side click at the very start of an RTL book must not be treated as 'forward' — it should stay put",
      ).toEqual(["P1"]);

      await readerPage.mouse.click(50, 450);
      await readerPage.waitForTimeout(800);
      const afterLeftClick = await visiblePageTexts(readerPage);
      // DOM order is left-column-first, right-column-second (see
      // `visiblePageTexts`) — an RTL pair puts the *later* spine item
      // (p3) in the left column and the *earlier* one (p2) in the
      // right column (`FixedLayoutSpreadPlanner`'s own RTL pairing
      // rule), the opposite of LTR's left=earlier/right=later.
      expect(
        afterLeftClick,
        "a left-side click (forward, for RTL) should reach the first real pair, with the later page on the left",
      ).toEqual(["P3", "P2"]);

      // And the reverse check: from here, a *right*-side click (back,
      // for RTL) should return to the lone first page.
      await readerPage.mouse.click(1150, 450);
      await readerPage.waitForTimeout(800);
      expect(
        await visiblePageTexts(readerPage),
        "a right-side click (back, for RTL) should return to the book's own first page",
      ).toEqual(["P1"]);
    } finally {
      await context.close();
    }
  });
});
