import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LINEAR_ALGEBRA_EPUB = path.resolve(here, "..", "real-books", "linear-algebra.epub");

/**
 * Issue #102: "A First Course in Linear Algebra" (a real, freely-licensed
 * textbook — see `download-real-books.mjs`'s note on why it isn't
 * auto-downloaded) is 94 spine items, several of which are 1-2MB single
 * chapters that are *94% MathML by byte count* (one matrix-heavy example
 * ran to 68KB for a single equation). Before this fix, an ordinary page
 * turn into content like this took 20-35+ seconds — routinely long enough
 * to look like a hang, and reported as one — because pagination's
 * line-break bisection (`LineMeasurement.ts`) treated a `<math>`
 * element's own deeply-nested internal markup as ordinary breakable text
 * mass, both re-walking it from scratch on every bisection probe
 * (`DomTextWalker.ts`, fixed separately) *and* bisecting into equations
 * at all (never intended — an equation should never be split mid-formula
 * any more than an image or table already isn't).
 *
 * This is a real-world timing assertion (not a synthetic-fixture
 * correctness check like `navigation-correctness.spec.ts`), so the bound
 * below is deliberately generous — normal turns land in well under a
 * second post-fix, but this only needs to catch the class of regression
 * that made this book "unusable due to perf" in the first place.
 */
test.describe("MathML-dense book performance (issue #102)", () => {
  test("an ordinary forward page turn completes in a few seconds, not tens of seconds", async () => {
    test.skip(
      !fs.existsSync(LINEAR_ALGEBRA_EPUB),
      "linear-algebra.epub not present — see download-real-books.mjs's note on this fixture.",
    );
    test.setTimeout(30_000);

    const { context, readerPage } = await launchReader(LINEAR_ALGEBRA_EPUB, {
      viewport: { width: 1200, height: 800 },
    });
    try {
      const contentText = () =>
        readerPage.evaluate(() => {
          const iframe = document.querySelector("iframe");
          return iframe?.contentDocument?.body?.textContent?.slice(0, 80) ?? "";
        });

      const before = await contentText();
      const start = Date.now();
      await readerPage.keyboard.press("ArrowRight");
      let after = before;
      while (Date.now() - start < 10_000) {
        await readerPage.waitForTimeout(50);
        after = await contentText();
        if (after !== before) break;
      }
      const elapsed = Date.now() - start;

      expect(after, "page turn never actually advanced").not.toBe(before);
      expect(elapsed, `page turn took ${elapsed}ms — regressed toward the pre-fix multi-second hang`).toBeLessThan(
        5000,
      );
    } finally {
      await context.close();
    }
  });
});
