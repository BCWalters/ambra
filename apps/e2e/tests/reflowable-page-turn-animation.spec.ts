import { test, expect, type Page, type Locator } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, currentPageLabel } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALICE_EPUB = path.resolve(here, "..", "real-books", "alice-in-wonderland.epub");

/** Same manual mousedown/mouseup pattern as `fixed-layout-animation.spec.ts`
 * (its own doc comment explains why a plain `locator.click()` isn't
 * reliable against this menu). */
async function manualClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(30);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.up();
}

async function setPageTurnAnimationStyle(
  readerPage: Page,
  style: "rotate" | "slide" | "scroll" | "none",
): Promise<void> {
  const settingsButton = readerPage.getByRole("button", { name: "Settings" });
  const box = (await settingsButton.boundingBox())!;
  await manualClick(readerPage, box.x + box.width / 2, box.y + box.height / 2);
  await readerPage.waitForTimeout(150);
  const label = { rotate: "Page flip", slide: "Slide", scroll: "Film strip", none: "Off" }[style];
  const item = readerPage.getByRole("menuitemradio", { name: new RegExp(label) });
  const itemBox = (await item.boundingBox())!;
  await manualClick(readerPage, itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);
  await readerPage.waitForTimeout(100);
  await readerPage.keyboard.press("Escape");
  await readerPage.waitForTimeout(100);
}

/** Every iframe genuinely on-screen right now — a disposed/off-canvas
 * host can briefly still be attached with `visibility: visible` while
 * parked well outside the viewport (confirmed by hand while writing this
 * suite, the same artifact issue #110's own regression test ran into),
 * so position, not just visibility, is what actually distinguishes the
 * real current column(s) from that leftover. */
async function onScreenIframes(readerPage: Page): Promise<Locator[]> {
  const innerWidth = await readerPage.evaluate(() => window.innerWidth);
  const frames = readerPage.locator("iframe");
  const count = await frames.count();
  const result: Locator[] = [];
  for (let i = 0; i < count; i++) {
    const frame = frames.nth(i);
    const box = await frame.boundingBox();
    const visible = await frame.evaluate((el) => getComputedStyle(el).visibility !== "hidden");
    if (visible && box && box.x >= 0 && box.x < innerWidth) {
      result.push(frame);
    }
  }
  return result;
}

/** Each on-screen iframe's own transform, normalized to whether it's
 * visually the identity transform or not — some cleanup paths restore a
 * degenerate no-op value (`rotateY(0deg)`, confirmed by hand on the
 * non-turning column of a "rotate" spread turn) rather than clearing the
 * inline style outright, which is harmless (identical rendering either
 * way) but would make a literal string comparison flaky. */
async function leftoverTransforms(readerPage: Page): Promise<string[]> {
  const frames = await onScreenIframes(readerPage);
  return Promise.all(
    frames.map((f) =>
      f.evaluate((el: HTMLIFrameElement) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return matrix.isIdentity ? "" : el.style.transform;
      }),
    ),
  );
}

/** Each on-screen column's own scroll position within its chapter,
 * concatenated — used (rather than the numeric "Page N of M" label
 * alone, or the content document's own text) to confirm a turn actually
 * moved to different content. Reflowable pagination clips/translates one
 * shared, fully-loaded document per chapter rather than swapping in a
 * new DOM per page (see `PaginatedContentHost`), so `body.innerText` is
 * identical across every page of the same chapter load and can't tell
 * pages apart — confirmed by hand while writing this suite — but the
 * `body`'s own `translateY` (how pagination actually picks which slice
 * of the chapter is visible) reliably does change per page. */
async function pagePositions(readerPage: Page): Promise<string> {
  const frames = await onScreenIframes(readerPage);
  const positions = await Promise.all(
    frames.map((f) =>
      f.evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.style.transform ?? ""),
    ),
  );
  return positions.join(" | ");
}

/**
 * Reflowable page-turn animation (`ReaderController.animatePageTurn`/
 * `animateSpreadTurn`) across all three styles, for both single-column
 * and two-page-spread mode — the fixed-layout equivalent of
 * `fixed-layout-animation.spec.ts`, which this reflowable side lacked
 * entirely before the `PageTurnOrchestrator` extraction/refactor. Exists
 * to catch any regression from that refactor (each style used to share
 * one large function full of `if (style === ...)` branches; the
 * refactor splits them into separate methods) — confirms a turn still
 * actually paints new content, lands back where it started on the way
 * back, and leaves no stray inline styles behind, for every style this
 * reader offers.
 *
 * Clicks land at y=150 deliberately: y=450 (the "physical middle of the
 * pane" convention used elsewhere) actually clips *below* a genuinely
 * short reflowable page's own content, silently falling through to the
 * pane's own default-forward pointer handler regardless of which side
 * was clicked (confirmed by hand while writing this suite) — y=150 stays
 * clear of both the header chrome above it and any short page's own
 * bottom edge.
 */
test.describe("reflowable page-turn animation", () => {
  test.describe("single column", () => {
    for (const style of ["rotate", "slide", "scroll", "none"] as const) {
      test(`${style}: forward and backward turns paint new content and return to the start`, async () => {
        const { context, readerPage } = await launchReader(ALICE_EPUB, {
          viewport: { width: 760, height: 900 },
        });
        try {
          await readerPage.waitForTimeout(500);
          await setPageTurnAnimationStyle(readerPage, style);

          const startLabel = await currentPageLabel(readerPage);
          const startText = await pagePositions(readerPage);
          expect(startLabel, `${style}: has an initial page label`).not.toBeNull();

          await readerPage.mouse.click(650, 150);
          await readerPage.waitForTimeout(700);
          expect(await currentPageLabel(readerPage), `${style}: forward turn changes the page label`).not.toBe(
            startLabel,
          );
          expect(await pagePositions(readerPage), `${style}: forward turn paints new content`).not.toBe(startText);

          await readerPage.mouse.click(80, 150);
          await readerPage.waitForTimeout(700);
          expect(await currentPageLabel(readerPage), `${style}: backward turn returns to the start label`).toBe(
            startLabel,
          );
          expect(await pagePositions(readerPage), `${style}: backward turn returns to the start content`).toBe(
            startText,
          );

          expect(await leftoverTransforms(readerPage), `${style}: no leftover transform after settling`).toEqual([
            "",
          ]);
        } finally {
          await context.close();
        }
      });
    }
  });

  test.describe("two-page spread", () => {
    for (const style of ["rotate", "slide", "scroll", "none"] as const) {
      test(`${style}: forward and backward turns paint new content and return to the start`, async () => {
        const { context, readerPage } = await launchReader(ALICE_EPUB, {
          viewport: { width: 1546, height: 878 },
        });
        try {
          await readerPage.waitForTimeout(500);
          await setPageTurnAnimationStyle(readerPage, style);

          // Skip a couple of spreads past the book's very first one — its
          // forward/backward round trip is a deliberately special-cased
          // merge boundary (see `navigation-correctness.spec.ts`'s "book's
          // very first spread merges forward immediately"), unrelated to
          // the animation mechanics this test actually covers.
          await readerPage.mouse.click(1400, 150);
          await readerPage.waitForTimeout(1000);
          await readerPage.mouse.click(1400, 150);
          await readerPage.waitForTimeout(1000);

          const startLabel = await currentPageLabel(readerPage);
          const startText = await pagePositions(readerPage);
          expect(startLabel, `${style}: has an initial page label`).not.toBeNull();

          await readerPage.mouse.click(1400, 150);
          await readerPage.waitForTimeout(1000);
          expect(await currentPageLabel(readerPage), `${style}: forward turn changes the spread label`).not.toBe(
            startLabel,
          );
          expect(await pagePositions(readerPage), `${style}: forward turn paints new content`).not.toBe(startText);

          await readerPage.mouse.click(150, 150);
          await readerPage.waitForTimeout(1000);
          expect(await currentPageLabel(readerPage), `${style}: backward turn returns to the start label`).toBe(
            startLabel,
          );
          expect(await pagePositions(readerPage), `${style}: backward turn returns to the start content`).toBe(
            startText,
          );

          expect(await leftoverTransforms(readerPage), `${style}: no leftover transform after settling`).toEqual([
            "",
            "",
          ]);
        } finally {
          await context.close();
        }
      });
    }
  });
});
