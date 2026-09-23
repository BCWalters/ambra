import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FXL_SPREAD_LTR_EPUB = path.resolve(here, "..", "fixtures", "fxl-spread-ltr.epub");

/** A plain, manual mousedown/mouseup (rather than Playwright's own
 * `locator.click()`, which — confirmed via direct investigation while
 * writing this suite — hangs indefinitely against this toolbar's
 * `Tooltip`-wrapped `MenuTrigger` button specifically, seemingly an
 * actionability/stability check that never resolves against its hover
 * transition, unrelated to anything this session's own fixed-layout
 * work touches) reliably opens/operates the reader's Settings menu. */
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

/** All visible iframes' own text, in DOM order (left column, if any,
 * before right) — see `fixed-layout-navigation.spec.ts`'s identical
 * helper for why this exactly reflects a `FixedSpreadHost` spread's
 * currently-loaded page(s). */
async function visiblePageTexts(readerPage: Page): Promise<string[]> {
  return readerPage.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter((f) => getComputedStyle(f).visibility !== "hidden")
      .map((f) => (f as HTMLIFrameElement).contentDocument?.body?.innerText.trim() ?? ""),
  );
}

/**
 * Fixed-layout (FXL) page-turn animation (`ReaderController
 * .animateFixedSpreadTurn`): until this session, every fixed-layout
 * turn was a plain instant swap, regardless of the reader's own
 * "rotate"/"slide"/"scroll" page-turn animation preference (which
 * already applied to every reflowable turn) — the Settings menu didn't
 * even expose that choice while reading a fixed-layout book at all. Each
 * style reuses the exact same underlying transition machinery
 * reflowable's own chapter-crossing turn already uses
 * (`playPageTurnAnimation`/`playScrollTurn`), just applied to a whole
 * `FixedSpreadHost` wrapper as one rigid sheet — but a real, confirmed
 * bug specific to fixed-layout content was caught and fixed while
 * building this: that wrapper has no opaque background of its own (a
 * fixed-layout page is letterboxed inside it, per
 * `FixedContentHost.applyScale`), so without painting one on for the
 * animation's duration, the *other* side's own colors bled straight
 * through the animating side's own letterboxed margins mid-turn. These
 * tests exercise all three styles end-to-end (not just instant-swap
 * correctness, already covered by `fixed-layout-navigation.spec.ts`)
 * to confirm a turn actually completes and lands on the right content
 * regardless of which animation plays alongside it.
 */
test.describe("fixed-layout (FXL) page-turn animation", () => {
  for (const style of ["rotate", "slide", "scroll"] as const) {
    test(`${style}: forward/backward turns complete and land on the correct spread`, async () => {
      const { context, readerPage } = await launchReader(FXL_SPREAD_LTR_EPUB, {
        viewport: { width: 1200, height: 900 },
      });
      try {
        await exposeReaderController(readerPage);
        await readerPage.waitForTimeout(500);
        await setPageTurnAnimationStyle(readerPage, style);

        // Cover (single, unpaired) -> first real pair.
        await manualClick(readerPage, 1150, 450);
        await readerPage.waitForTimeout(700);
        expect(await visiblePageTexts(readerPage), `${style}: cover -> first pair`).toEqual(["P1", "P2"]);

        // Pair -> pair, forward.
        await manualClick(readerPage, 1150, 450);
        await readerPage.waitForTimeout(700);
        expect(await visiblePageTexts(readerPage), `${style}: pair -> pair forward`).toEqual(["P3", "P4"]);

        // Pair -> pair, backward.
        await manualClick(readerPage, 50, 450);
        await readerPage.waitForTimeout(700);
        expect(await visiblePageTexts(readerPage), `${style}: pair -> pair backward`).toEqual(["P1", "P2"]);

        // Inspect the actual staging wrapper, not the shell's intentional transform.
        const wrapperTransform = await readerPage.evaluate(() =>
          Reflect.get(window, "__readerController").hostWrapperEl.style.transform,
        );
        expect(wrapperTransform, `${style}: no leftover transform on the host wrapper after settling`).toBe("");
      } finally {
        await context.close();
      }
    });
  }

  test("switching to \"none\" still turns pages instantly (no regression from the animation work)", async () => {
    const { context, readerPage } = await launchReader(FXL_SPREAD_LTR_EPUB, {
      viewport: { width: 1200, height: 900 },
    });
    try {
      await readerPage.waitForTimeout(500);
      await setPageTurnAnimationStyle(readerPage, "none");
      await manualClick(readerPage, 1150, 450);
      await readerPage.waitForTimeout(300);
      expect(await visiblePageTexts(readerPage)).toEqual(["P1", "P2"]);
    } finally {
      await context.close();
    }
  });
});
