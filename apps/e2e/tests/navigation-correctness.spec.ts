import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { navigationFixture } from "../navigation-fixture.js";
import {
  launchReader,
  currentPageLabel,
  currentPageText,
  clickForwardAndWait,
  clickReadingPage,
} from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");
const TWO_CHAPTER_EPUB = path.resolve(here, "..", "fixtures", "two-chapter.epub");
const MERGED_TAIL_VISIBILITY_EPUB = path.resolve(
  here,
  "..",
  "fixtures",
  "merged-tail-visibility.epub",
);
const BOOK_START_MERGE_EPUB = path.resolve(here, "..", "fixtures", "book-start-merge.epub");
const CHAINED_SINGLE_PAGE_CHAPTERS_EPUB = path.resolve(
  here,
  "..",
  "fixtures",
  "chained-single-page-chapters.epub",
);
const TOTAL_PARAGRAPHS = 30;

// Read only painted lines, not the full chapter DOM hidden by pagination.
async function visibleSpreadSample(readerPage: Page) {
  return readerPage.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe"))
      .filter((frame) => {
        if (!frame.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
        const rect = frame.getBoundingClientRect();
        const clip = getComputedStyle(frame).clipPath.match(/inset\(([\d.]+)px 0px ([\d.]+)px/);
        let left = Math.max(0, rect.left);
        let right = Math.min(innerWidth, rect.right);
        let top = Math.max(0, rect.top + Number(clip?.[1] ?? 0));
        let bottom = Math.min(innerHeight, rect.bottom - Number(clip?.[2] ?? 0));
        // Estimator frames have real layout boxes inside a zero-sized clipping
        // parent; their own computed visibility still says "visible".
        for (let parent = frame.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const bounds = parent.getBoundingClientRect();
          if (/hidden|clip|scroll|auto/.test(style.overflowX)) {
            left = Math.max(left, bounds.left);
            right = Math.min(right, bounds.right);
          }
          if (/hidden|clip|scroll|auto/.test(style.overflowY)) {
            top = Math.max(top, bounds.top);
            bottom = Math.min(bottom, bounds.bottom);
          }
        }
        return right > left && bottom > top &&
          document.elementFromPoint((left + right) / 2, (top + bottom) / 2) === frame;
      })
      .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
    const text = frames.map((frame) => {
        const doc = frame.contentDocument;
        if (!doc?.body) return "";
        const clip = getComputedStyle(frame).clipPath.match(/inset\(([\d.]+)px 0px ([\d.]+)px/);
        const top = Number(clip?.[1] ?? 0);
        const bottom = frame.clientHeight - Number(clip?.[2] ?? 0);
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        let text = "";
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
            const range = doc.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const r = range.getBoundingClientRect();
            if (
              r.width > 0 &&
              r.top >= top - 0.5 &&
              r.bottom <= bottom + 0.5 &&
              r.right > 0 &&
              r.left < frame.clientWidth
            ) {
              text += node.textContent![i];
            }
          }
        }
        return text.replace(/\s+/g, " ").trim();
      });
    const images = frames.flatMap(frame =>
      Array.from(frame.contentDocument?.querySelectorAll("img, svg") ?? []).map(image => {
        const rect = image.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          viewportWidth: frame.clientWidth,
          viewportHeight: frame.clientHeight,
        };
      }));
    return { text, images };
  });
}

async function visibleSpreadText(readerPage: Page): Promise<string[]> {
  return (await visibleSpreadSample(readerPage)).text;
}

// The scrubber announces the committed position after the old host is disposed.
// Fixed sleeps can sample both outgoing and incoming pages during slow CI turns.
async function turnAndWait(readerPage: Page, turn: () => Promise<unknown>): Promise<void> {
  const position = readerPage.getByRole("slider", { name: "Position in book" });
  await expect(position).toHaveAttribute("aria-valuetext", /Page \d+ of \d+/);
  const pageNumber = async () =>
    (await position.getAttribute("aria-valuetext"))?.match(/Page (\d+) of \d+/)?.[1];
  const before = await pageNumber();
  await turn();
  // Background estimation can change the total without completing a turn.
  await expect.poll(async () => (await pageNumber()) ?? before).not.toBe(before);
}

async function visibleParagraphs(readerPage: Page): Promise<string[]> {
  return (await visibleSpreadText(readerPage)).flatMap(text =>
    [...text.matchAll(/C(\d)Para (\d+)/g)].map(match => `${match[1]}:${match[2]}`));
}

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
  test("painted spread sampling excludes clipped measurement and transparent staging frames", async () => {
    const { context, readerPage } = await launchReader(CHAINED_SINGLE_PAGE_CHAPTERS_EPUB, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      const before = await visibleSpreadSample(readerPage);
      expect(before.text).toHaveLength(2);
      await readerPage.evaluate(async () => {
        for (const hiddenBy of ["clipping", "opacity"]) {
          const container = document.createElement("div");
          Object.assign(container.style, {
            position: "fixed", left: "0", top: "0",
            ...(hiddenBy === "clipping"
              ? { width: "0", height: "0", overflow: "hidden" }
              : { opacity: "0", pointerEvents: "none" }),
          });
          const frame = document.createElement("iframe");
          Object.assign(frame.style, { width: "680px", height: "900px", border: "0" });
          const loaded = new Promise<void>(resolve => frame.addEventListener("load", () => resolve(), { once: true }));
          frame.srcdoc = '<p>Unpainted Chapter 23 probe text</p><svg width="123" height="234" xmlns="http://www.w3.org/2000/svg"><rect width="123" height="234"/></svg>';
          container.appendChild(frame);
          document.body.appendChild(container);
          await loaded;
        }
      });
      expect(await visibleSpreadSample(readerPage), "only the reader's painted pages are sampled").toEqual(before);
    } finally {
      await context.close();
    }
  });

  test("spread positions survive seeking to the start and forward/backward round trips (#129)", async () => {
    test.setTimeout(120_000);
    const { context, readerPage } = await launchReader(CHAINED_SINGLE_PAGE_CHAPTERS_EPUB, {
      viewport: { width: 1400, height: 900 },
    });
    const visibleText = () => visibleSpreadText(readerPage);
    try {
      const snapshots: string[][] = [];
      for (let i = 0; i < 50; i++) {
        const text = await visibleText();
        snapshots.push(text);
        if (text.join(" ").includes("C1 Para 200.")) break;
        await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowRight"));
      }
      expect(snapshots[0]?.join(" ")).toContain("Cover Para 1");
      const painted = snapshots.flat().join(" ");
      const expectedText = ["cover.xhtml", "titlepage.xhtml", "contents.xhtml", "chapter1.xhtml"]
        .map(file => execFileSync("unzip", ["-p", CHAINED_SINGLE_PAGE_CHAPTERS_EPUB, `OEBPS/${file}`], { encoding: "utf8" })
          .match(/<body[^>]*>([\s\S]*?)<\/body>/)![1]!.replace(/<[^>]+>/g, ""))
        .join("");
      expect(painted.replace(/\s/g, ""), "every painted character occurs once, in book order")
        .toBe(expectedText.replace(/\s/g, ""));
      expect(painted).toContain("Contents Para 1");
      expect([...painted.matchAll(/Title Para (\d+)\./g)].map((match) => Number(match[1]))).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      expect([...painted.matchAll(/C1 Para (\d+)\./g)].map((match) => Number(match[1]))).toEqual(
        Array.from({ length: 200 }, (_, i) => i + 1),
      );
      expect(painted.match(/Chapter One/g)).toHaveLength(1);
      for (let i = snapshots.length - 2; i >= 0; i--) {
        await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowLeft"));
        expect(await visibleText(), `backward spread ${i}`).toEqual(snapshots[i]);
      }
      await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowRight"));
      const slider = readerPage.getByRole("slider").first();
      await slider.focus();
      await slider.press("Home");
      await slider.press("Enter");
      await expect.poll(visibleText, { message: "seek-to-start uses the same pair" }).toEqual(snapshots[0]);
      await slider.blur();
      for (let i = 1; i <= 3; i++) {
        await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowRight"));
        expect(await visibleText(), `forward after seek ${i}`).toEqual(snapshots[i]);
      }
      for (let i = 2; i >= 0; i--) {
        await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowLeft"));
        expect(await visibleText(), `backward after seek ${i}`).toEqual(snapshots[i]);
      }
    } finally {
      await context.close();
    }
  });

  for (const name of ["alice-in-wonderland", "frankenstein"]) {
    test(`real book: ${name} fitted cover and exact spread round trips survive nondefault fonts (#129)`, async () => {
      const book = path.resolve(here, "..", "real-books", `${name}.epub`);
      test.skip(!fs.existsSync(book), "Optional real-book corpus is not installed");
      const { context, readerPage } = await launchReader(book, {
        viewport: { width: 1400, height: 900 },
      });
      try {
        await readerPage.mouse.move(700, 20);
        await readerPage.getByRole("button", { name: "Text and page options" }).click();
        await readerPage.getByRole("menuitem", { name: "Text", exact: true }).click();
        const font = readerPage.getByRole("slider", { name: "Font size" });
        await font.focus();
        await font.press("ArrowRight");
        await font.press("ArrowRight");
        await readerPage.keyboard.press("Escape");
        await readerPage.keyboard.press("Escape");
        await readerPage.waitForTimeout(800);
        const slider = readerPage.getByRole("slider", { name: "Position in book" });
        await slider.focus();
        await slider.press("Home");
        await readerPage.waitForTimeout(800);
        await slider.blur();
        const imageBounds = async () => (await visibleSpreadSample(readerPage)).images;
        const images = await imageBounds();
        expect(images.length).toBeGreaterThan(0);
        for (const image of images) {
          expect(image.width).toBeLessThanOrEqual(image.viewportWidth + 1);
          expect(image.height).toBeLessThanOrEqual(image.viewportHeight + 1);
        }
        const snapshots: string[][] = [];
        for (let i = 0; i < 5; i++) {
          snapshots.push(await visibleSpreadText(readerPage));
          await readerPage.keyboard.press("ArrowRight");
          await readerPage.waitForTimeout(600);
        }
        for (let i = 4; i >= 0; i--) {
          await readerPage.keyboard.press("ArrowLeft");
          await readerPage.waitForTimeout(600);
          expect(await visibleSpreadText(readerPage), `real-book backward spread ${i}`).toEqual(
            snapshots[i],
          );
        }
        expect(await imageBounds()).toEqual(images);
      } finally {
        await context.close();
      }
    });
  }

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

        const { changed, before, after } = await clickForwardAndWait(readerPage, {
          x: 700,
          y: 450,
        });
        expect(
          changed,
          `click ${click} never advanced past "${before}" (stuck/dead click — issue #82)`,
        ).toBe(true);
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
          Array.from(document.querySelectorAll("iframe")).map(
            (f) => f.contentDocument?.body?.innerText ?? "",
          ),
        );
        seenPerPage.push(paragraphNumbers(iframeTexts.join("\n")));

        if (total !== undefined && index !== undefined && index >= total - 1) {
          break;
        }
        const { changed, before } = await clickForwardAndWait(readerPage, { x: 1200, y: 450 });
        expect(
          changed,
          `spread click ${click} never advanced past "${before}" (stuck/dead click)`,
        ).toBe(true);
      }

      const allSeen = seenPerPage.flat();
      const uniqueSeen = [...new Set(allSeen)];
      const missing = Array.from({ length: TOTAL_PARAGRAPHS }, (_, i) => i + 1).filter(
        (n) => !uniqueSeen.includes(n),
      );
      expect(
        missing,
        "paragraphs missing across the whole spread-mode run (skipped content)",
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("two-page spread: crossing a chapter boundary never redisplays the same spread (issue #91)", async () => {
    // Issue #91: `SpreadPaginatedHost.nextSpread`/
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
        const visible = await visibleParagraphs(readerPage);
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
        const madeProgress =
          (!chapterOneDone && c1 > bestC1) || (sawChapterTwo && !chapterTwoDone && c2 > bestC2);
        const alreadyAtBookEnd = chapterOneDone && chapterTwoDone;
        expect(
          madeProgress || alreadyAtBookEnd,
          `click ${click} made no forward progress (chapter one max ${bestC1}, chapter two max ${bestC2}, ` +
            `currently visible [${visible.sort().join(",")}]) — a page turn silently failed to advance`,
        ).toBe(true);
        bestC1 = Math.max(bestC1, c1);
        bestC2 = Math.max(bestC2, c2);
        if (bestC2 === 60) break;
        await turnAndWait(readerPage, () => clickReadingPage(readerPage, { x: 1200, y: 450 }));
      }
      expect(sawChapterTwo, "never reached chapter two's content").toBe(true);
      expect(bestC1, "never reached chapter one's actual last paragraph").toBe(120);
      expect(bestC2, "never reached chapter two's actual last paragraph").toBe(60);
    } finally {
      await context.close();
    }
  });

  test("two-page spread: a chapter ending on a fully paired last spread opens the next chapter fresh, with no duplicate page or forced right-start (#94 regression fix)", async () => {
    // Four real pages regardless of the platform's default serif font.
    const { context, readerPage } = await launchReader(navigationFixture(test.info(), [4, 2]), {
      viewport: { width: 1400, height: 900 },
    });
    try {
      expect(await visibleSpreadText(readerPage)).toEqual(["C1Para 1.", "C1Para 2."]);
      await turnAndWait(readerPage, () => clickReadingPage(readerPage, { x: 1200, y: 450 }));
      expect(await visibleSpreadText(readerPage), "chapter one's fully paired last spread")
        .toEqual(["C1Para 3.", "C1Para 4."]);
      await turnAndWait(readerPage, () => clickReadingPage(readerPage, { x: 1200, y: 450 }));
      expect(await visibleSpreadText(readerPage), "chapter two opens left, without repeating chapter one")
        .toEqual(["C2Para 1.", "C2Para 2."]);
    } finally {
      await context.close();
    }
  });

  test("two-page spread: a chapter starting right after the previous one's unpaired last page merges directly into the same spread, with no intervening blank/repeated page (issues #90/#94)", async () => {
    const { context, readerPage } = await launchReader(navigationFixture(test.info(), [3, 3]), {
      viewport: { width: 1200, height: 900 },
    });
    try {
      expect(await visibleSpreadText(readerPage)).toEqual(["C1Para 1.", "C1Para 2."]);
      await turnAndWait(readerPage, () => clickReadingPage(readerPage, { x: 1100, y: 450 }));
      expect(await visibleSpreadText(readerPage), "the first turn already merges the unpaired tail")
        .toEqual(["C1Para 3.", "C2Para 1."]);
      await turnAndWait(readerPage, () => clickReadingPage(readerPage, { x: 1100, y: 450 }));
      expect(await visibleSpreadText(readerPage), "the next turn never repeats either merged page")
        .toEqual(["C2Para 2.", "C2Para 3."]);
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
      expect(hasChapterTwo, "never reached the merged spread (chapter two never appeared)").toBe(
        true,
      );

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

  test("two-page spread: the book's very first spread merges forward immediately, with no blank facing page and with working click-to-turn", async () => {
    // A real, confirmed bug distinct from (though related to) the two
    // above: this whole merge feature (issues #90/#92/#94) only ever
    // triggered from a forward *page turn*, crossing from an
    // already-on-screen chapter into the next one. It never applied to
    // a spine item's own *first* open — most commonly hit by a lone
    // cover image as the book's very first spine item (exactly one
    // page, no companion): opening the book showed it alone with a
    // permanently blank facing page, exactly the state this whole
    // feature exists to eliminate everywhere else. `BOOK_START_MERGE_EPUB`'s
    // own `cover.xhtml` is sized so this viewport lands it as a single,
    // unpaired page, with `chapter1.xhtml` right behind it.
    //
    // Fixing that (`ReaderController.openSpineItem`'s own retroactive
    // merge, checked immediately after any fresh spine-item open) hit a
    // *second*, independent bug of its own along the way: the merged
    // host was, at first, revealed the same way every other freshly-
    // opened host here is — moved into a `stageHiddenHostElement`
    // wrapper — but that unconditionally reparents whatever's passed to
    // it, which reloads an *already-loaded* host's nested iframes (this
    // one already fully built by `buildMergedSpreadHost`), silently
    // discarding the click-to-turn listeners `setUpDragPageTurn` had
    // just attached moments earlier. The reader looked completely
    // correct on screen — right down to which page was showing — but
    // every click did precisely nothing; only keyboard navigation still
    // worked, since it doesn't depend on any content-iframe listener.
    // This test's own second half is a direct regression test for
    // exactly that: not just "no blank page," but "clicking the very
    // first spread actually turns the page."
    const { context, readerPage } = await launchReader(BOOK_START_MERGE_EPUB, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await readerPage.waitForTimeout(500);

      const visibleColumnsText = async (): Promise<string[]> =>
        readerPage.evaluate(() =>
          Array.from(document.querySelectorAll("iframe"))
            .filter((f) => getComputedStyle(f).visibility !== "hidden")
            .map((f) => (f as HTMLIFrameElement).contentDocument?.body?.innerText ?? ""),
        );

      const initialColumns = await visibleColumnsText();
      expect(
        initialColumns.some((text) => text.includes("Cover Para 1")),
        "the cover's own content never appeared on the book's very first spread",
      ).toBe(true);
      expect(
        initialColumns.some((text) => text.includes("C1 Para 1")),
        "chapter1's own opening content never appeared alongside the cover — the facing page was left blank instead of merging forward",
      ).toBe(true);
      expect(
        initialColumns.every((text) => text.trim().length > 0),
        "a visible column on the book's very first spread was blank",
      ).toBe(true);

      const result = await clickForwardAndWait(readerPage, { x: 1300, y: 450 });
      expect(
        result.changed,
        `clicking the book's very first (merged) spread did not turn the page (label stayed "${result.before}") — the merge's own listeners were likely attached to since-reloaded, no-longer-on-screen documents`,
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

      const initial = (await currentPageLabel(readerPage))?.match(/Page (\d+) of (\d+)/);
      expect(initial).not.toBeNull();
      expect(Number(initial![1])).toBe(1);
      const pages = Number(initial![2]);
      expect(pages).toBeGreaterThan(1);
      const snapshots = [await visibleSpreadText(readerPage)];
      for (let page = 2; page <= pages; page++) {
        await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowRight"));
        expect(await currentPageLabel(readerPage)).toBe(`Page ${page} of ${pages}`);
        snapshots.push(await visibleSpreadText(readerPage));
      }
      for (let page = pages - 1; page >= 1; page--) {
        await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowLeft"));
        expect(await visibleSpreadText(readerPage)).toEqual(snapshots[page - 1]);
      }
      for (let page = 2; page <= pages; page++) {
        await turnAndWait(readerPage, () => clickReadingPage(readerPage, { x: 650, y: 450 }));
        expect(await visibleSpreadText(readerPage), `click and ArrowRight agree on page ${page}`)
          .toEqual(snapshots[page - 1]);
      }
    } finally {
      await context.close();
    }
  });

  test("two-page spread: an ordinary forward turn landing on a lone unpaired chapter merges the next chapter in immediately, never showing a blank facing column (issue #103)", async () => {
    const { context, readerPage } = await launchReader(navigationFixture(test.info(), [2, 1, 1, 2]), {
      viewport: { width: 1400, height: 900 },
    });
    try {
      expect(await visibleSpreadText(readerPage)).toEqual(["C1Para 1.", "C1Para 2."]);
      await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowRight"));
      expect(await visibleSpreadText(readerPage), "ordinary chapter-open immediately pairs two short chapters")
        .toEqual(["C2Para 1.", "C3Para 1."]);
      await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowRight"));
      expect(await visibleSpreadText(readerPage)).toEqual(["C4Para 1.", "C4Para 2."]);
      await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowLeft"));
      expect(await visibleSpreadText(readerPage)).toEqual(["C2Para 1.", "C3Para 1."]);
    } finally {
      await context.close();
    }
  });

  test("real book: ordinary forward turns never leave a blank facing column (issue #103)", async () => {
    // A real book (not a synthetic fixture) whose short front-matter
    // sections (each its own spine item — "Using Code Examples",
    // "Safari® Books Online", "How to Contact Us", ...) are exactly the
    // kind of short, single-page-when-paginated chapters this bug needs:
    // reached via an *ordinary* forward turn (`openSpineItem`'s own
    // `landOnLastPage: direction === -1` — an explicit `false`, not an
    // omitted property), not the direct chapter-start/chapter-end merge
    // paths already covered by the synthetic fixtures above.
    const ACCESSIBLE_EPUB_3 = path.resolve(here, "..", "real-books", "accessible-epub-3.epub");
    test.skip(!fs.existsSync(ACCESSIBLE_EPUB_3), "Optional real-book corpus is not installed");
    const { context, readerPage } = await launchReader(ACCESSIBLE_EPUB_3, {
      viewport: { width: 1546, height: 878 },
    });
    try {
      // The right-column slot sits at roughly half the viewport width
      // (see `SpreadPaginatedHost`'s own layout) — an iframe positioned
      // there that's `visibility: hidden` (rather than simply absent)
      // is the bug's exact signature: content silently failed to merge
      // in, rather than there genuinely being no more book left.
      const rightSlotHidden = () =>
        readerPage.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll("iframe"));
          return iframes.some((f) => {
            const rect = f.getBoundingClientRect();
            return rect.x > 700 && getComputedStyle(f).visibility === "hidden";
          });
        });

      // Twelve pages in is nowhere near this 153-page book's real end,
      // so a hidden right-slot column at any of these stops can only be
      // this bug, never a legitimate last-page-of-the-book case.
      for (let press = 0; press < 12; press++) {
        await turnAndWait(readerPage, () => readerPage.keyboard.press("ArrowRight"));
        expect(await rightSlotHidden(), `press ${press}: right column present but hidden`).toBe(
          false,
        );
      }
    } finally {
      await context.close();
    }
  });

  test("two-page spread: navigating backward across more than one chained single-page chapter lands on the book's true start, not a stale re-paginated spread (issue #120)", async () => {
    // `CHAINED_SINGLE_PAGE_CHAPTERS_EPUB` chains three consecutive
    // one-page spine items (cover, title page, contents) before its
    // first real (multi-page) chapter — the exact shape that exposed
    // issue #120 in a real Project Gutenberg book: the merge machinery
    // (issues #90/#92/#94/#103) only ever handled a *single* merge
    // boundary at a time. Landing backward on the second (or later)
    // one-page chapter in the chain reopened it as a fresh, independent
    // host and took `SpreadPaginatedHost.goToLastPage()`'s unmerged
    // "show the real last page paired with the one before it" trick —
    // which degenerates to nothing for a genuinely one-page chapter —
    // instead of recognizing it should merge with whatever precedes
    // *it* too. A second, independent bug made this worse: a later,
    // unconditional second `goToLastPage()` call in `openSpineItem`
    // silently undid an already-correctly-built merge immediately after
    // constructing it, landing on a lone, blank-facing page regardless.
    //
    // Note: pagination never fragments the DOM (see
    // `SpreadPaginatedHost`'s own doc comment), so a chapter's *whole*
    // text is always present in its iframe's `innerText` regardless of
    // which page is currently clipped into view — comparing raw
    // `innerText` between two turns cannot distinguish "the same page"
    // from "a different page of the same chapter." This checks which
    // *spine item's* own distinctive markers are visible instead (and,
    // for "is a facing column missing when it shouldn't be," a hidden
    // iframe positioned in the right-column slot — the same signature
    // the issue #103 test above checks for).
    const { context, readerPage } = await launchReader(CHAINED_SINGLE_PAGE_CHAPTERS_EPUB, {
      viewport: { width: 1400, height: 900 },
    });
    const rightSlotHiddenIframe = () =>
      readerPage.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll("iframe"));
        return iframes.some((f) => {
          const rect = f.getBoundingClientRect();
          return rect.x > 700 && getComputedStyle(f).visibility === "hidden";
        });
      });
    const visibleMarkers = () =>
      readerPage.evaluate(() => {
        const texts = Array.from(document.querySelectorAll("iframe"))
          .filter((f) => getComputedStyle(f).visibility !== "hidden")
          .map((f) => (f as HTMLIFrameElement).contentDocument?.body?.innerText ?? "");
        return {
          columnCount: texts.length,
          everyColumnHasText: texts.every((t) => t.trim().length > 0),
          hasCover: texts.some((t) => t.includes("Cover Para 1")),
          hasTitle: texts.some((t) => t.includes("Title Para 1")),
          hasContents: texts.some((t) => t.includes("Contents Para 1")),
          hasChapter1: texts.some((t) => t.includes("Chapter One")),
        };
      });

    try {
      await readerPage.waitForTimeout(500);

      // The book's very first spread merges forward immediately (see
      // the `BOOK_START_MERGE_EPUB` test above) — cover and title page
      // shown side by side, with no hidden facing column.
      const initialMarkers = await visibleMarkers();
      expect(
        initialMarkers.everyColumnHasText,
        "the book's very first spread had a blank visible column",
      ).toBe(true);
      expect(
        initialMarkers.hasCover && initialMarkers.hasTitle,
        "the book didn't open on cover+title merged",
      ).toBe(true);
      expect(
        await rightSlotHiddenIframe(),
        "the book's very first spread had a hidden facing column",
      ).toBe(false);

      // Advance well into the real (27-page) first chapter.
      for (let press = 0; press < 8; press++) {
        await readerPage.keyboard.press("ArrowRight");
        await readerPage.waitForTimeout(500);
      }

      // Now navigate all the way back past every chained single-page
      // chapter. At no point should a facing column be hidden when it
      // shouldn't be (issue #120's "some blank pages"), and the front-
      // matter chain's own chapters (title page, contents) must each
      // actually appear at some point along the way — silently skipping
      // over one entirely, or getting stuck re-showing chapter 1
      // forever, would both be issue #120's "duplicated content" in a
      // different guise.
      let sawTitle = false;
      let sawContents = false;
      let reachedStart = false;
      const MAX_BACK_PRESSES = 15;
      for (let press = 0; press < MAX_BACK_PRESSES && !reachedStart; press++) {
        await readerPage.keyboard.press("ArrowLeft");
        await readerPage.waitForTimeout(700);
        expect(
          await rightSlotHiddenIframe(),
          `back-press ${press}: a facing column was hidden`,
        ).toBe(false);
        const markers = await visibleMarkers();
        expect(markers.everyColumnHasText, `back-press ${press}: a visible column was blank`).toBe(
          true,
        );
        sawTitle ||= markers.hasTitle;
        sawContents ||= markers.hasContents;
        reachedStart =
          markers.hasCover && markers.hasTitle && !markers.hasContents && !markers.hasChapter1;
      }

      expect(
        reachedStart,
        "backward navigation never returned to the book's cover+title start",
      ).toBe(true);
      expect(
        sawTitle,
        "the title page chapter was never actually shown while navigating backward",
      ).toBe(true);
      expect(
        sawContents,
        "the contents chapter was never actually shown while navigating backward",
      ).toBe(true);

      // Once at the true start, further backward presses must leave it
      // there unchanged, not drift to some other, incorrect state.
      for (let press = 0; press < 3; press++) {
        await readerPage.keyboard.press("ArrowLeft");
        await readerPage.waitForTimeout(500);
        const markers = await visibleMarkers();
        expect(
          markers.hasCover && markers.hasTitle && !markers.hasContents && !markers.hasChapter1,
          `press past the start (#${press}) changed the display`,
        ).toBe(true);
      }
    } finally {
      await context.close();
    }
  });
});
