import { test, expect, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, clickReadingPage } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FXL_SPREAD_LTR_EPUB = path.resolve(here, "..", "fixtures", "fxl-spread-ltr.epub");

/** Every visible fixed-layout iframe's own bounding rect, left-to-right
 * in physical left-to-right order, independently of publication direction. */
async function visiblePageRects(
  readerPage: import("@playwright/test").Page,
): Promise<Array<{ left: number; right: number; width: number }>> {
  return readerPage.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter((f) => getComputedStyle(f).visibility !== "hidden")
      .map((f) => {
        const rect = f.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      }).sort((a, b) => a.left - b.left),
  );
}

/**
 * Fixed-layout (FXL) two-page spreads must stay tightly adjacent to
 * each other without any reserved width or shadow between them,
 * regardless of how wide the reader pane is —
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
  test("at a very wide viewport, the two pages have no gap and stay centered", async () => {
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

      const gap = right.left - left.right;
      expect(Math.abs(gap), "authored page coordinate spaces meet without a visible gap").toBeLessThan(1);

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
      // The explicit right cover fills its half-spread up to the viewport edge.
      await readerPage.frameLocator("iframe").locator("body").press("ArrowRight");
      await readerPage.waitForTimeout(700);

      await readerPage.setViewportSize({ width: 2200, height: 900 });
      await readerPage.waitForTimeout(400);

      const rects = await visiblePageRects(readerPage);
      expect(rects).toHaveLength(2);
      const [left, right] = rects as [
        { left: number; right: number; width: number },
        { left: number; right: number; width: number },
      ];
      expect(Math.abs(right.left - left.right), "still gapless after resizing").toBeLessThan(1);

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

  function mixedPageFixture(info: TestInfo, direction: "ltr" | "rtl"): string {
    const source = info.outputPath("mixed-spread-source");
    fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
    fs.mkdirSync(path.join(source, "EPUB"));
    fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
    fs.writeFileSync(path.join(source, "META-INF/container.xml"),
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    fs.writeFileSync(path.join(source, "EPUB/package.opf"),
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:gapless:${direction}</dc:identifier>
      <dc:title>Gapless mixed spread</dc:title><dc:language>en</dc:language>
      <meta property="dcterms:modified">2026-10-06T00:00:00Z</meta><meta property="rendition:layout">pre-paginated</meta>
      <meta property="rendition:spread">both</meta></metadata>
      <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="p0" href="p0.xhtml" media-type="application/xhtml+xml"/><item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine page-progression-direction="${direction}"><itemref idref="p0" properties="page-spread-${direction === "ltr" ? "left" : "right"}"/>
      <itemref idref="p1" properties="page-spread-${direction === "ltr" ? "right" : "left"}"/></spine></package>`);
    fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="p0.xhtml">Spread</a></li></ol></nav></body></html>');
    for (const [index, size] of [{ width: 400, height: 800 }, { width: 600, height: 600 }].entries()) {
      fs.writeFileSync(path.join(source, `EPUB/p${index}.xhtml`),
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${index}</title>
        <meta name="viewport" content="width=${size.width},height=${size.height}"/>
        <style>html,body{margin:0;background:#ff8800}body{width:${size.width}px;height:${size.height}px}</style>
        </head><body>Original mixed-size page ${index}</body></html>`);
    }
    const target = info.outputPath(`mixed-spread-${direction}.epub`);
    execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: source });
    execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: source });
    return target;
  }

  for (const direction of ["ltr", "rtl"] as const) {
    test(`unequal ${direction} pages share a scale and no gap at constrained and wide widths`, async ({
      page: unusedPage,
    }, info) => {
      void unusedPage;
      const { context, readerPage: page } = await launchReader(mixedPageFixture(info, direction), {
        viewport: { width: 900, height: 900 },
      });
      try {
        await exposeReaderController(page);
        for (const width of [900, 2200]) {
          await page.setViewportSize({ width, height: 900 });
          await expect.poll(() => page.evaluate(() =>
            Reflect.get(window, "__readerController").snapshot().paneWidth,
          )).toBe(width);
          await expect.poll(async () => (await visiblePageRects(page)).length).toBe(2);
          const [left, right] = await visiblePageRects(page);
          expect(Math.abs(right!.left - left!.right)).toBeLessThan(1);
          const expectedScale = await page.evaluate(() => {
            const reader = Reflect.get(window, "__readerController");
            return Math.min(reader.width / 1000, reader.height / 800);
          });
          expect(left!.width).toBeCloseTo((direction === "ltr" ? 400 : 600) * expectedScale, 0);
          expect(right!.width).toBeCloseTo((direction === "ltr" ? 600 : 400) * expectedScale, 0);
          const outerRight = width - right!.right;
          expect(Math.abs(left!.left - outerRight)).toBeLessThan(1);
        }
      } finally {
        await context.close();
      }
    });
  }
});
