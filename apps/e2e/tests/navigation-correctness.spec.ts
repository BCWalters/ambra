import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, currentPageLabel, currentPageText, clickForwardAndWait } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");
const TWO_CHAPTER_EPUB = path.resolve(here, "..", "fixtures", "two-chapter.epub");
const MERGED_TAIL_VISIBILITY_EPUB = path.resolve(here, "..", "fixtures", "merged-tail-visibility.epub");
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

  test("two-page spread: a chapter ending on a fully paired last spread opens the next chapter fresh, with no duplicate page or forced right-start (#94 regression fix)", async () => {
    // The same 1400px viewport as the #91 test just above, for the same
    // reason: it lands `TWO_CHAPTER_EPUB`'s chapter one last spread
    // exactly *paired* (both columns showing real content, nothing left
    // unpaired) — the opposite condition from the #90/#94 test below,
    // and the specific one this test needs: crossing out of a chapter
    // whose own ending needs no merge at all must still fall through to
    // the *ordinary* chapter-open path, not get caught by the #94 fix
    // meant only for a genuinely unpaired last page. A real, confirmed
    // regression here: an off-by-one in that fix's own "would the next
    // ordinary turn land on an unpaired page" check misfired right at
    // *any* even-length chapter's true last spread — a `Math.min` clamp
    // meant to detect "one more step lands unpaired" instead read
    // "there's no further step at all" as if it were exactly that,
    // wrongly duplicating the chapter's own already-visible last page
    // into a merge and force-starting chapter two on the right.
    const { context, readerPage } = await launchReader(TWO_CHAPTER_EPUB, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      // Same sampling technique as the #91/#90/#94 tests above/below —
      // see their own doc comments for why.
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

      let sawChapterOnePairedEnd = false;
      let sawChapterTwoOpen = false;
      let duplicatedLastPageIntoChapterTwoSpread = false;
      for (let click = 0; click < 20; click++) {
        const visible = await visibleParagraphs();
        const hasChapterOneEnd = visible.includes("1:120");
        const hasChapterTwo = visible.some((p) => p.startsWith("2:"));
        if (hasChapterOneEnd && !hasChapterTwo) {
          // Chapter one's own true last spread — both columns already
          // real content (this viewport's whole point), so this is
          // simply "still reading the end of chapter one," not a bug.
          sawChapterOnePairedEnd = true;
        }
        if (hasChapterTwo) {
          sawChapterTwoOpen = true;
          if (hasChapterOneEnd) {
            // The regression: chapter one's already-seen last page
            // reappearing in the *same* spread as chapter two's first
            // page — the merge path is only ever correct for a
            // genuinely *unpaired* last page, never one that was just
            // shown fully paired with its own real companion.
            duplicatedLastPageIntoChapterTwoSpread = true;
          }
          break;
        }
        await readerPage.mouse.click(1200, 450);
        await readerPage.waitForTimeout(500);
      }
      expect(
        sawChapterOnePairedEnd,
        "never reached chapter one's own fully paired last spread — check the fixture/viewport still lands an even page count",
      ).toBe(true);
      expect(
        duplicatedLastPageIntoChapterTwoSpread,
        "chapter one's already-seen last page reappeared alongside chapter two's first page — a paired last spread should never merge",
      ).toBe(false);
      expect(sawChapterTwoOpen, "never reached chapter two's content").toBe(true);
    } finally {
      await context.close();
    }
  });

  test("two-page spread: a chapter starting right after the previous one's unpaired last page merges directly into the same spread, with no intervening blank/repeated page (issues #90/#94)", async () => {
    // A width chosen so `TWO_CHAPTER_EPUB`'s chapter one (120 short
    // paragraphs) lands its own real last page *unpaired* — alone in the
    // left column, the right column empty — the opposite condition from
    // the test above (which needs chapter one's last page *paired*) and
    // the specific one this regression needs: the forward turn off
    // chapter one's own last *paired* spread must land directly on the
    // merged spread — chapter one's real last page in the left column,
    // chapter two's real first page already in the right — without ever
    // passing through an intermediate spread showing chapter one's last
    // page *alone* first (issue #94: that intermediate blank-facing-page
    // state, followed by a second turn that repeated chapter one's last
    // page alongside chapter two's first, was exactly the bug — one
    // extra turn, and one blank page, more than a reader should ever
    // see).
    const { context, readerPage } = await launchReader(TWO_CHAPTER_EPUB, {
      viewport: { width: 1200, height: 900 },
    });
    try {
      // Same technique as the test above — see its own doc comment for
      // why `elementFromPoint` sampling (not `innerText`, which reflects
      // a spine item's entire flowing document regardless of scroll
      // position) is what actually reflects which page(s) are on screen.
      async function visibleParagraphs(): Promise<string[]> {
        return readerPage.evaluate(() => {
          // `> 400`, not `600` (the test above's own threshold, correct
          // for *its* 1400px-wide/680px-column viewport) — this test's
          // narrower 1200px viewport gives each column only 580px
          // (`SpreadPaginatedHost`'s own `MIN_SPREAD_COLUMN_WIDTH` is
          // 480), which a 600px threshold would wrongly exclude
          // entirely, same as an actually-narrow/non-spread column
          // should be.
          const iframes = Array.from(document.querySelectorAll("iframe")).filter(
            (el) => el.getBoundingClientRect().width > 400 && getComputedStyle(el).visibility !== "hidden",
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

      let sawUnpairedChapterOneEndAlone = false;
      let sawMergedSpread = false;
      for (let click = 0; click < 20; click++) {
        const visible = await visibleParagraphs();
        const hasChapterOneEnd = visible.includes("1:120");
        const hasChapterTwo = visible.some((p) => p.startsWith("2:"));
        if (hasChapterOneEnd && !hasChapterTwo) {
          // The exact state issue #94 reports: chapter one's own last
          // page shown *alone*, with no trace of chapter two yet — a
          // blank facing column a reader has to turn *past* before ever
          // reaching chapter two, instead of chapter two's first page
          // already being right there alongside it.
          sawUnpairedChapterOneEndAlone = true;
        }
        if (hasChapterOneEnd && hasChapterTwo) {
          sawMergedSpread = true;
          break;
        }
        // Comfortably inside the 1200px-wide pane (not right at its
        // edge, which risks landing outside the page entirely and
        // silently doing nothing — a real, confirmed flake at this
        // narrower width, unlike the 1400px-wide test above where 1200
        // is safely central).
        await readerPage.mouse.click(1100, 450);
        await readerPage.waitForTimeout(500);
      }
      expect(
        sawUnpairedChapterOneEndAlone,
        "chapter one's own unpaired last page was shown alone (with an empty facing column) at some point, instead of always merging directly into chapter two's first page in the very same spread",
      ).toBe(false);
      expect(
        sawMergedSpread,
        "chapter one's last page and chapter two's first page were never shown together in the same spread — check the fixture/viewport still produces an odd page count",
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  test("two-page spread: the merged tail column is actually visible, not just structurally present", async () => {
    // A real, confirmed bug in the #90/#94 merge itself: the borrowed
    // tail page (see `ReaderController.prepareMergedIncomingSpreadFromUpcomingLastPage`)
    // is built as a standalone element, hidden (`opacity: 0`, `pointer-
    // events: none`) while it's still loading off to the side — exactly
    // the same "hide until ready" pattern every other incoming host
    // here uses. But *unlike* every other one, nothing ever reset it
    // back once the merge succeeded, so the tail stayed permanently
    // invisible (and unclickable) even after `sync()` correctly marked
    // it the visible column — indistinguishable from the very blank
    // page this whole feature exists to eliminate, and only "fixed"
    // itself by building a *different* incoming host from scratch (an
    // ordinary chapter-open, no merge at all) on the next crossing.
    // `MERGED_TAIL_VISIBILITY_EPUB`'s own `index.xhtml` is sized so this
    // viewport lands its real last page unpaired, needing exactly this
    // merge to reach chapter two without an intervening blank spread.
    const { context, readerPage } = await launchReader(MERGED_TAIL_VISIBILITY_EPUB, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await readerPage.mouse.click(1000, 450);
      await readerPage.waitForTimeout(300);

      let label = await currentPageLabel(readerPage);
      let hasChapterTwo = false;
      for (let click = 0; click < 8 && !hasChapterTwo; click++) {
        const result = await clickForwardAndWait(readerPage, { x: 1300, y: 450 });
        label = result.after;
        hasChapterTwo = await readerPage.evaluate(() =>
          Array.from(document.querySelectorAll("iframe")).some((f) =>
            (f as HTMLIFrameElement).contentDocument?.body?.innerText?.includes("Chapter Two"),
          ),
        );
      }
      expect(hasChapterTwo, "never reached the merged spread (chapter two never appeared)").toBe(true);

      const columns = await readerPage.evaluate(() => {
        return Array.from(document.querySelectorAll("iframe"))
          .filter((el) => getComputedStyle(el).visibility !== "hidden")
          .map((el) => {
            const doc = (el as HTMLIFrameElement).contentDocument;
            return {
              opacity: getComputedStyle(el).opacity,
              text: doc?.body?.innerText ?? "",
              htmlOverflow: doc ? getComputedStyle(doc.documentElement).overflow : undefined,
              bodyOverflow: doc?.body ? getComputedStyle(doc.body).overflow : undefined,
            };
          });
      });
      for (const column of columns) {
        expect(
          column.opacity,
          `a visible column had opacity "${column.opacity}" instead of fully opaque — content present in the DOM but invisible on screen is exactly this bug (label was "${label}")`,
        ).toBe("1");
        // A second, related bug found right after fixing the first: the
        // borrowed tail's own document has its native scrollbar-
        // suppressing `overflow: hidden` (set once by `PaginatedContentHost
        // .open()`) silently lost — the same cross-origin-iframe-move
        // reload `openMergedWithPreviousTail`'s own defensive
        // `goToPageIndex` reapplication already exists for (see
        // `PaginatedContentHost.reapplyOverflowHidden`'s doc comment) —
        // masked until the tail became visible at all, then showing up
        // as a real native scrollbar on the tail page. Content taller
        // than one page must always be clipped by the pagination
        // engine's own transform/height, never left to native scrolling.
        expect(
          column.htmlOverflow,
          `a visible column's own document had "overflow: ${column.htmlOverflow}" on <html> instead of "hidden" — its native scrollbar-suppression was lost (label was "${label}")`,
        ).toBe("hidden");
        expect(
          column.bodyOverflow,
          `a visible column's own document had "overflow: ${column.bodyOverflow}" on <body> instead of "hidden" — its native scrollbar-suppression was lost (label was "${label}")`,
        ).toBe("hidden");
      }
      // The left column specifically must show `index.xhtml`'s own last
      // real paragraph (its borrowed tail), not just chapter two's —
      // opacity alone wouldn't catch the tail existing but being blank
      // for some *other* reason (e.g. never actually landing on the
      // right page within its own document).
      expect(
        columns.some((column) => column.text.includes("Para 20")),
        `index.xhtml's own last paragraph never appeared alongside chapter two (label was "${label}")`,
      ).toBe(true);
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
