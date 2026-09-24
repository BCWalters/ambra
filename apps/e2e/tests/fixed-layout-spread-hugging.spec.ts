import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, clickReadingPage } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FXL_SPREAD_LTR_EPUB = path.resolve(here, "..", "fixtures", "fxl-spread-ltr.epub");

/** Every visible fixed-layout iframe's own bounding rect, left-to-right
 * in DOM order (left column before right — same convention
 * `FixedSpreadHost.contentDocuments` documents). */
async function visiblePageRects(
  readerPage: import("@playwright/test").Page,
): Promise<Array<{ left: number; right: number; width: number }>> {
  return readerPage.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter((f) => getComputedStyle(f).visibility !== "hidden")
      .map((f) => {
        const rect = f.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      }),
  );
}

/**
 * Fixed-layout (FXL) two-page spreads must stay tightly adjacent to
 * each other (only `FixedSpreadHost.GUTTER_WIDTH`'s own fixed-width
 * shadow between them) regardless of how wide the reader pane is —
 * reported directly: as the window widened well past a spread's own
 * combined aspect ratio, the *old* per-column-independent scaling (each
 * `FixedContentHost` scaling its own page to fill its own generous
 * half-share of the available width) visibly pushed the two pages apart
 * from each other, which is wrong for spread-heavy fixed-layout content
 * (art spanning both pages, common in comics/picture books) — any extra
 * space belongs *outside* the whole spread, not between its two pages.
 * `fxl-spread-ltr.epub`'s own pages are all 800x1100 (see
 * `FixedLayoutSpreadPlanner`'s test fixtures), so both columns of any
 * of its pairs always share the exact same natural size/aspect ratio —
 * a useful property this test leans on to assert the two rendered
 * pages come out *exactly* the same width (proving they share one
 * scale, not each computing its own independently).
 */
test.describe("fixed-layout (FXL) two-page spreads stay tightly hugged together", () => {
  test("at a very wide viewport, the two pages stay adjacent (only the gutter between them), not spread across the whole width", async () => {
    const { context, readerPage } = await launchReader(FXL_SPREAD_LTR_EPUB, {
      viewport: { width: 2000, height: 900 },
    });
    try {
      await readerPage.waitForTimeout(500);
      // Cover (single) -> first real pair.
      await clickReadingPage(readerPage, "right");
      await readerPage.waitForTimeout(700);

      const rects = await visiblePageRects(readerPage);
      expect(rects, "exactly two visible pages for a pair spread").toHaveLength(2);
      const [left, right] = rects as [
        { left: number; right: number; width: number },
        { left: number; right: number; width: number },
      ];

      // Both pages share the exact same natural size/aspect ratio in
      // this fixture — sharing one scale means they must render at
      // *exactly* the same width, not just similar.
      expect(Math.abs(left.width - right.width), "both pages render at the same (shared-scale) width").toBeLessThan(
        1,
      );

      // Only the (fixed-width) gutter sits between the two pages' own
      // edges — nowhere near the ~600px+ gap the old per-column
      // independent scaling left at this viewport width.
      const gap = right.left - left.right;
      expect(gap, "gap between the two pages is just the gutter, not a wide empty margin").toBeLessThan(40);

      // The leftover space this very wide viewport doesn't need for
      // the (now-tightly-hugged) spread appears symmetrically outside
      // it — confirming the whole unit is centered as one piece, not
      // just coincidentally adjacent.
      const viewportWidth = 2000;
      const outerLeftMargin = left.left;
      const outerRightMargin = viewportWidth - right.right;
      expect(
        Math.abs(outerLeftMargin - outerRightMargin),
        "leftover space is split evenly between both outer edges",
      ).toBeLessThan(2);
      expect(outerLeftMargin, "there is in fact leftover space outside the hugged spread").toBeGreaterThan(100);
    } finally {
      await context.close();
    }
  });

  test("resizing to a much wider viewport re-hugs the pair without breaking navigation", async () => {
    const { context, readerPage } = await launchReader(FXL_SPREAD_LTR_EPUB, {
      viewport: { width: 1200, height: 900 },
    });
    try {
      await readerPage.waitForTimeout(500);
      await clickReadingPage(readerPage, "right");
      await readerPage.waitForTimeout(700);

      await readerPage.setViewportSize({ width: 2200, height: 900 });
      await readerPage.waitForTimeout(400);

      const rects = await visiblePageRects(readerPage);
      expect(rects).toHaveLength(2);
      const [left, right] = rects as [
        { left: number; right: number; width: number },
        { left: number; right: number; width: number },
      ];
      expect(right.left - left.right, "still tightly hugged after resizing").toBeLessThan(40);

      // Navigation still works after the resize.
      await clickReadingPage(readerPage, "right");
      await readerPage.waitForTimeout(700);
      const texts = await readerPage.evaluate(() =>
        Array.from(document.querySelectorAll("iframe"))
          .filter((f) => getComputedStyle(f).visibility !== "hidden")
          .map((f) => (f as HTMLIFrameElement).contentDocument?.body?.innerText.trim() ?? ""),
      );
      expect(texts).toEqual(["P3", "P4"]);
    } finally {
      await context.close();
    }
  });
});
