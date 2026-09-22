import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { launchReader } from "../harness.js";

/**
 * A real, confirmed layout bug (issue #110) found in the "Accessible
 * EPUB 3" O'Reilly sample (real-books/accessible-epub-3.epub) — distinct
 * from issue #103's blank-facing-column bug. The book's own stylesheet
 * ships the classic Eric Meyer-style universal reset
 * (`html, body, div, span, ... { margin: 0; padding: 0; ... }`), which is
 * extremely common EPUB production boilerplate, not a deliberate choice
 * about page width. Since book CSS loads after `ReadingTheme.CSS` (so a
 * book's deliberate typography wins), that reset silently zeroed out our
 * `body`'s centering `max-width`/`margin`/`padding`, flushing every page's
 * content to one edge instead of centering it in the column — most
 * visible (and most damaging-looking) on the left column of a two-page
 * spread, where there's no gutter buffer to soften it, so the text reads
 * as visually clipped/cut off.
 *
 * Fixed in `ReadingTheme.CSS` by marking those three properties
 * `!important` — they're the page's own horizontal envelope, a
 * pagination/page-container concern the reading system always owns, not
 * book typography — the same reasoning already established for `pre`'s
 * `white-space`/`overflow-x` in `EpubCssReset`.
 */
test("a book's own universal CSS reset doesn't defeat the reading theme's page centering (issue #110)", async () => {
  const { context, readerPage } = await launchReader(
    path.resolve(__dirname, "../real-books/accessible-epub-3.epub"),
    { viewport: { width: 1546, height: 878 } },
  );

  await readerPage.keyboard.press("ArrowRight");
  await readerPage.waitForTimeout(600);

  const measurements = await readerPage.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe")).filter((f) => {
      const rect = f.getBoundingClientRect();
      // Disposed/off-canvas hosts can still report `visibility: visible`
      // while parked at a large negative offset — restrict to iframes
      // actually within the viewport's horizontal bounds.
      return getComputedStyle(f).visibility === "visible" && rect.x >= 0 && rect.x < window.innerWidth;
    });
    return iframes.map((f) => {
      const rect = f.getBoundingClientRect();
      const body = f.contentDocument!.body;
      // `getBoundingClientRect` on an element inside a same-origin iframe
      // is relative to that iframe's own viewport, not the top document —
      // so `bodyRect.x` is already the local left gap, with no need (and
      // no correctness) in mixing it with the host iframe's own `rect.x`.
      const bodyRect = body.getBoundingClientRect();
      return {
        iframeWidth: rect.width,
        bodyWidth: bodyRect.width,
        leftGap: bodyRect.x,
        rightGap: rect.width - (bodyRect.x + bodyRect.width),
        text: body.innerText.slice(0, 30),
      };
    });
  });

  expect(measurements.length).toBeGreaterThan(0);
  for (const m of measurements) {
    // Centered means the left and right gaps around the narrower content
    // column are equal (within a px of rounding) — the bug's signature was
    // one gap collapsing to ~0 while the other absorbed all the slack.
    expect(Math.abs(m.leftGap - m.rightGap)).toBeLessThan(2);
    expect(m.leftGap).toBeGreaterThan(10);
  }

  await context.close();
});
