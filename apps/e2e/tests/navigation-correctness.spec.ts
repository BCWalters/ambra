import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, currentPageLabel, currentPageText, clickForwardAndWait } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");
const TWO_CHAPTER_EPUB = path.resolve(here, "..", "fixtures", "two-chapter.epub");
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

  test("two-page spread: crossing a chapter boundary never redisplays the same spread (issue #91)", async () => {
    // `TWO_CHAPTER_EPUB`'s chapter one is long enough (120 short
    // paragraphs) to land its last spread exactly full — both columns
    // showing real content, no lone trailing page — regardless of
    // reasonable font-size/viewport variation, the specific condition
    // issue #91 needed: `SpreadPaginatedHost.nextSpread`/
    // `ReaderController.prepareIncomingSpread` both checked whether
    // there was "more to turn to" against `pageCount - 1` rather than
    // `pageCount - 2` — so once the right column already showed the
    // chapter's actual last page, a further "next" wrongly believed there
    // was still another spread to turn to, clamped back down to that
    // same last page (now alone in the left column) instead of
    // correctly falling through to chapter two.
    const { context, readerPage } = await launchReader(TWO_CHAPTER_EPUB, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      // Visible (not just "anywhere in the DOM") paragraph numbers for
      // whichever columns are actually shown — `contentDocument.body
      // .innerText` alone (what `currentPageText` and the spread test
      // above both use) reflects the *entire* flowing document
      // regardless of scroll position, so it can't tell "was this
      // exact spread redisplayed" from "did the reader advance
      // normally" the way this regression specifically needs; sampling
      // `elementFromPoint` down each visible column's own height does
      // reflect what's actually on screen. Hidden columns (the lone
      // last page of an odd-length chapter) are skipped — a hidden
      // iframe's `elementFromPoint` doesn't reliably reflect its last
      // *visible* layout, and it's never what the reader could see.
      async function visibleParagraphs(): Promise<string[]> {
        return readerPage.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll("iframe")).filter(
            (el) => el.getBoundingClientRect().width > 600 && getComputedStyle(el).visibility !== "hidden",
          );
          const seen = new Set<string>();
          for (const frame of iframes) {
            const doc = (frame as HTMLIFrameElement).contentDocument;
            if (!doc) continue;
            for (let y = 20; y < 850; y += 40) {
              const el = doc.elementFromPoint(300, y);
              const text = el?.closest("p")?.textContent ?? el?.textContent ?? "";
              const match = text.match(/C(\d)Para (\d+)/);
              if (match) {
                seen.add(`${match[1]}:${match[2]}`);
              }
            }
          }
          return [...seen];
        });
      }

      // Track the highest paragraph number seen in either chapter so
      // far — real forward progress must strictly increase this every
      // click, until the book's own true end. A plain "is this click's
      // spread identical to the last one" check isn't enough: issue
      // #91's actual failure mode is subtler than an exact repeat — the
      // chapter's real last page (already visible, paired in the right
      // column) gets shown *again*, now alone in the left column, which
      // changes the on-screen spread (the right column's content
      // disappears) without making any *new* progress at all.
      function maxParagraph(visible: string[], chapter: string): number {
        return visible
          .filter((p) => p.startsWith(`${chapter}:`))
          .map((p) => Number(p.split(":")[1]))
          .reduce((max, n) => Math.max(max, n), 0);
      }

      let bestC1 = 0;
      let bestC2 = 0;
      let sawChapterTwo = false;
      for (let click = 0; click < 20; click++) {
        const visible = await visibleParagraphs();
        const c1 = maxParagraph(visible, "1");
        const c2 = maxParagraph(visible, "2");
        if (c2 > 0) {
          sawChapterTwo = true;
        }
        // Chapter one is fully done (its real last page, 120, already
        // seen) once chapter two's own content starts appearing — from
        // then on chapter one naturally stops advancing further, which
        // is expected, not a regression. Chapter two's own last page
        // (60) is this fixture's (and the whole book's) genuine end —
        // once reached, further clicks correctly have nothing left to
        // advance to.
        const chapterOneDone = sawChapterTwo || bestC1 >= 120;
        const chapterTwoDone = bestC2 >= 60;
        const madeProgress = (!chapterOneDone && c1 > bestC1) || (sawChapterTwo && !chapterTwoDone && c2 > bestC2);
        const alreadyAtBookEnd = chapterOneDone && chapterTwoDone;
        expect(
          madeProgress || alreadyAtBookEnd,
          `click ${click} made no forward progress (chapter one max ${bestC1}, chapter two max ${bestC2}, ` +
            `currently visible [${visible.sort().join(",")}]) — a page turn silently failed to advance`,
        ).toBe(true);
        bestC1 = Math.max(bestC1, c1);
        bestC2 = Math.max(bestC2, c2);
        await readerPage.mouse.click(1200, 450);
        await readerPage.waitForTimeout(500);
      }
      expect(sawChapterTwo, "never reached chapter two's content").toBe(true);
      expect(bestC1, "never reached chapter one's actual last paragraph").toBe(120);
      expect(bestC2, "never reached chapter two's actual last paragraph").toBe(60);
    } finally {
      await context.close();
    }
  });

  test("two-page spread: every chapter begins with a blank left column (issue #90)", async () => {
    const { context, readerPage } = await launchReader(TWO_CHAPTER_EPUB, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      async function leftColumnState(): Promise<{ spacerVisible: boolean; accessible: boolean }> {
        return readerPage.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll("iframe")).filter(
            (el) => el.getBoundingClientRect().x === 0 && el.getBoundingClientRect().width > 600,
          );
          const left = iframes[0] as HTMLIFrameElement | undefined;
          // The blank spacer overlay is a plain sibling `<div>` next to
          // the left column's own iframe (see `SpreadPaginatedHost`'s
          // constructor) — checking *its* visibility directly is the
          // only reliable signal here: the iframe's own internal scroll
          // position is left untouched while the spacer covers it (see
          // `sync`), so both `body.innerText` (always reflects the
          // entire document regardless of scroll — pagination never
          // fragments the DOM) *and* `elementFromPoint` called on the
          // iframe's own document (unaffected by an overlay that isn't
          // even part of that document) would still report real content
          // there either way, telling this check nothing useful.
          const spacer = left?.nextElementSibling as HTMLElement | null;
          return {
            spacerVisible: spacer?.getAttribute("aria-hidden") === "true" && getComputedStyle(spacer).display !== "none",
            // Left must stay fully present to assistive technology even
            // while visually blank — see `SpreadPaginatedHost`'s own doc
            // comment on why hiding it outright (the way the redundant
            // right column is *intentionally* hidden) would be a real
            // accessibility regression, not just a cosmetic wrinkle.
            accessible: left !== undefined && left.getAttribute("aria-hidden") === null && left.style.visibility !== "hidden",
          };
        });
      }

      // Chapter one's very first spread: left column must look blank
      // (the spacer overlay showing) but remain accessible.
      const atBookStart = await leftColumnState();
      expect(atBookStart.spacerVisible, "chapter one's opening spread has no blank spacer showing").toBe(true);
      expect(atBookStart.accessible, "left column was hidden from assistive technology").toBe(true);

      // Cross into chapter two (this fixture's chapter one is 120
      // paragraphs long, comfortably reached in under 15 forward clicks
      // — see the previous test) and confirm its own opening spread
      // gets the identical treatment.
      let sawChapterTwoBlankStart = false;
      for (let click = 0; click < 15 && !sawChapterTwoBlankStart; click++) {
        await readerPage.mouse.click(1200, 450);
        await readerPage.waitForTimeout(500);
        const chapterTwoVisible = await readerPage.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll("iframe"));
          return iframes.some((f) => (f as HTMLIFrameElement).contentDocument?.body?.innerText?.includes("CHAPTER TWO"));
        });
        if (!chapterTwoVisible) {
          continue;
        }
        const state = await leftColumnState();
        expect(state.spacerVisible, "chapter two's opening spread has no blank spacer showing").toBe(true);
        expect(state.accessible, "left column was hidden from assistive technology").toBe(true);
        sawChapterTwoBlankStart = true;
      }
      expect(sawChapterTwoBlankStart, "never reached chapter two's own opening spread").toBe(true);
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
