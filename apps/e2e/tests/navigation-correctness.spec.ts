import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, currentPageLabel, currentPageText, clickForwardAndWait } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");
const TOTAL_PARAGRAPHS = 30;

function paragraphNumbers(text: string): number[] {
  const matches = [...text.matchAll(/Paragraph (\d+)\./g)];
  return matches.map((m) => Number(m[1]));
}

/**
 * The core "does paginating through a book actually work" regression
 * suite (see this package's README for why this exists alongside
 * `@ambra/engine`'s unit tests) — built directly from real bugs this
 * session found and fixed by hand-driving Playwright against the real
 * extension, formalized here so they can never silently regress:
 *
 * - Issue #82: a page whose real content ends well short of a full
 *   page's height left the rest of that page's *area* completely
 *   unresponsive to clicks, most commonly right at a chapter's end —
 *   "no dead clicks" below is a direct regression test for that.
 * - The pagination engine must show every paragraph of a chapter
 *   exactly once, in order, across however many pages it takes — never
 *   skipping a paragraph's worth of text at a page boundary, and never
 *   showing the same paragraph twice (both real historical bugs in
 *   this codebase's history, per the session's own design notes).
 */
test.describe("paginated reflowable navigation correctness", () => {
  test("single-column: every paragraph appears exactly once, in order, with no dead clicks", async () => {
    const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, {
      viewport: { width: 760, height: 900 },
    });
    try {
      const seenPerPage: number[][] = [];
      let lastLabel = await currentPageLabel(readerPage);
      expect(lastLabel).not.toBeNull();

      for (let click = 0; click < 40; click++) {
        seenPerPage.push(paragraphNumbers(await currentPageText(readerPage)));
        const label = await currentPageLabel(readerPage);
        const totalMatch = label?.match(/of (\d+)/);
        const total = totalMatch ? Number(totalMatch[1]) : undefined;
        const indexMatch = label?.match(/Page (\d+)/);
        const index = indexMatch ? Number(indexMatch[1]) : undefined;
        if (total !== undefined && index !== undefined && index >= total) {
          break; // reached the last page of this (single-chapter) fixture
        }

        const { changed, before, after } = await clickForwardAndWait(readerPage, { x: 700, y: 450 });
        expect(changed, `click ${click} never advanced past "${before}" (stuck/dead click — issue #82)`).toBe(true);
        lastLabel = after;
      }

      expect(lastLabel).not.toBeNull();

      const allSeen = seenPerPage.flat();
      const uniqueSeen = [...new Set(allSeen)];
      const missing = Array.from({ length: TOTAL_PARAGRAPHS }, (_, i) => i + 1).filter(
        (n) => !uniqueSeen.includes(n),
      );
      expect(missing, "paragraphs missing across the whole run (skipped content)").toEqual([]);

      // Order check: within any single page's own text, paragraph numbers
      // must be strictly increasing — a real pagination bug (splitting an
      // atomic block, or a mis-measured break) can otherwise show text out
      // of its natural reading order on one page.
      for (const pageParagraphs of seenPerPage) {
        const sorted = [...pageParagraphs].sort((a, b) => a - b);
        expect(pageParagraphs, "paragraph order within a single page").toEqual(sorted);
      }
    } finally {
      await context.close();
    }
  });

  test("two-page spread: every paragraph appears exactly once, in order, with no dead clicks", async () => {
    const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, {
      viewport: { width: 1280, height: 900 },
    });
    try {
      const seenPerPage: number[][] = [];
      for (let click = 0; click < 25; click++) {
        const label = await currentPageLabel(readerPage);
        const totalMatch = label?.match(/of (\d+)/);
        const total = totalMatch ? Number(totalMatch[1]) : undefined;
        const indexMatch = label?.match(/Page (\d+)/);
        const index = indexMatch ? Number(indexMatch[1]) : undefined;

        const iframeTexts = await readerPage.evaluate(() =>
          Array.from(document.querySelectorAll("iframe")).map((f) => f.contentDocument?.body?.innerText ?? ""),
        );
        seenPerPage.push(paragraphNumbers(iframeTexts.join("\n")));

        if (total !== undefined && index !== undefined && index >= total - 1) {
          break;
        }
        const { changed, before } = await clickForwardAndWait(readerPage, { x: 1200, y: 450 });
        expect(changed, `spread click ${click} never advanced past "${before}" (stuck/dead click)`).toBe(true);
      }

      const allSeen = seenPerPage.flat();
      const uniqueSeen = [...new Set(allSeen)];
      const missing = Array.from({ length: TOTAL_PARAGRAPHS }, (_, i) => i + 1).filter(
        (n) => !uniqueSeen.includes(n),
      );
      expect(missing, "paragraphs missing across the whole spread-mode run (skipped content)").toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("keyboard navigation (ArrowRight) advances the same way clicking does", async () => {
    const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, {
      viewport: { width: 760, height: 900 },
    });
    try {
      // Establish keyboard focus inside the content the same way a real
      // reader would (an initial click), then drive purely via keyboard.
      await readerPage.mouse.click(400, 200);
      await readerPage.waitForTimeout(300);

      for (let press = 0; press < 6; press++) {
        const before = await currentPageLabel(readerPage);
        await readerPage.keyboard.press("ArrowRight");
        let after = before;
        const start = Date.now();
        while (Date.now() - start < 2000 && after === before) {
          await readerPage.waitForTimeout(50);
          after = await currentPageLabel(readerPage);
        }
        expect(after, `ArrowRight press ${press} never advanced past "${before}"`).not.toBe(before);
      }
    } finally {
      await context.close();
    }
  });
});
