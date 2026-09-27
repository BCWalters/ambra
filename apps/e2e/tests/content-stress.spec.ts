import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clickReadingPage, launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import {
  contentStressCases,
  generateContentStressFixture,
  type StressTarget,
} from "../content-stress-fixtures.js";

interface StressState {
  section: string;
  spine: string;
  currentPage: number | undefined;
  shownPages: number[];
  totalPages: number | undefined;
  isSpread: boolean;
  entries: { label: string; page: number | undefined }[];
}

async function state(page: Page): Promise<StressState> {
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const s = c.snapshot();
    const flatten = (items: typeof s.toc): typeof s.toc =>
      items.flatMap((item: (typeof s.toc)[number]) => [item, ...flatten(item.children)]);
    return {
      section: s.currentChapterLabel as string,
      spine: s.currentSpinePath as string,
      currentPage: s.bookPageIndex as number,
      shownPages: (s.isSpread ? s.spreadPageNumbers : [s.bookPageIndex]) as number[],
      totalPages: s.bookPageCount as number,
      isSpread: s.isSpread as boolean,
      entries: flatten(s.toc).map((item: (typeof s.toc)[number]) => ({
        label: item.label as string,
        page: s.tocPageNumbers.get(item.target) as number | undefined,
      })),
    };
  });
}

async function openContents(page: Page) {
  await page.mouse.move(350, 2);
  await page.getByRole("button", { name: "Show contents", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Table of contents" });
  await expect(navigation).toBeVisible();
  return navigation;
}

async function idle(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        return Boolean(
          c.isTurningPage || c.isLoadInFlight || c.isApplyingLayout || c.pendingLayout,
        );
      }),
    )
    .toBe(false);
}

async function captureDiagnostic<T>(label: string, capture: () => Promise<T>) {
  try {
    return await capture();
  } catch (error) {
    console.error(`Content-stress diagnostic capture failed (${label}):`, error);
    return undefined;
  }
}

async function select(page: Page, target: StressTarget) {
  const navigation = await openContents(page);
  await navigation
    .getByRole("button")
    .filter({
      has: page.locator("span").filter({ hasText: new RegExp(`^${target.label}$`) }),
    })
    .click();
  await expect(navigation).not.toBeVisible();
  // At a cross-chapter spread the primary reading position can be on
  // the facing chapter. Validate the requested target's actual paint below.
  if (!(await state(page)).isSpread) {
    await expect.poll(async () => (await state(page)).section).toBe(target.label);
    await expect.poll(async () => (await state(page)).spine).toBe(`EPUB/ch${target.chapter}.xhtml`);
  }
  await idle(page);
}

async function visibleTarget(page: Page, target: StressTarget) {
  return page.evaluate(
    ({ id, label }) =>
      Array.from(document.querySelectorAll("iframe")).some((frame) => {
        if (getComputedStyle(frame).visibility === "hidden") return false;
        const element = frame.contentDocument?.getElementById(id);
        if (element?.textContent !== label) return false;
        const r = element.getBoundingClientRect();
        const f = frame.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.top < frame.clientHeight &&
          r.right > 0 &&
          r.left < frame.clientWidth &&
          f.width > 0 &&
          f.height > 0 &&
          f.right > 0 &&
          f.left < innerWidth
        );
      }),
    target,
  );
}

test.describe("bounded synthetic content stress", () => {
  test.setTimeout(180_000);
  for (const variation of contentStressCases) {
    test(variation.id, async () => {
      const testInfo = test.info();
      const { book, targets } = generateContentStressFixture(
        testInfo.outputPath("fixture"),
        variation,
      );
      const started = Date.now();
      const { context, readerPage: page } = await launchReader(book, {
        viewport: { width: variation.width, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const timings: Record<string, number> = { importAndOpenMs: Date.now() - started };
      try {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await exposeReaderController(page);
        await expect.poll(async () => (await state(page)).entries.length).toBe(targets.length);
        if (variation.mode)
          await page.evaluate(() =>
            Reflect.get(window, "__readerController").setViewMode("scroll"),
          );
        else
          await expect
            .poll(
              async () => (await state(page)).entries.every((entry) => entry.page !== undefined),
              { timeout: 45_000 },
            )
            .toBe(true);

        const initial = await state(page);
        if (!variation.mode) {
          expect(initial.totalPages).toBeGreaterThan(0);
          const pages = initial.entries.map((entry) => entry.page!);
          expect(pages).toEqual([...pages].sort((a, b) => a - b));
          expect(pages.every((number) => number >= 1 && number <= initial.totalPages!)).toBe(true);
        }
        const first = targets[0]!;
        const last = targets.at(-1)!;
        const deep = targets[Math.min(variation.depth - 1, targets.length - 1)]!;
        const middle = targets[Math.floor(targets.length / 2)]!;
        const contents = await openContents(page);
        await contents
          .getByRole("button")
          .filter({
            has: page.locator("span").filter({ hasText: new RegExp(`^${last.label}$`) }),
          })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath("contents-tail.png") });
        await page.keyboard.press("Escape");
        await expect(contents).not.toBeVisible();
        for (const target of [last, deep, middle, first]) {
          const start = Date.now();
          await select(page, target);
          await expect.poll(() => visibleTarget(page, target)).toBe(true);
          if (!variation.mode) {
            await expect
              .poll(async () => {
                const snapshot = await state(page);
                return snapshot.shownPages.includes(
                  snapshot.entries.find((entry) => entry.label === target.label)!.page!,
                );
              })
              .toBe(true);
          }
          timings[`navigate-${target.label}`] = Date.now() - start;
        }
        await page.screenshot({ path: testInfo.outputPath("specimen.png") });
        if (variation.feature === "notes" || variation.feature === "mixed") {
          const before = await state(page);
          // The event exercises the app's noteref handler even when the authored
          // note is below the first viewport; page-location assertions remain real.
          await page.evaluate(() => {
            const reference = Array.from(document.querySelectorAll("iframe"))
              .filter((frame) => getComputedStyle(frame).visibility !== "hidden")
              .map((frame) => frame.contentDocument?.getElementById("reference-1"))
              .find(Boolean);
            if (!reference)
              throw new Error("Fixture note reference missing from the displayed spread");
            reference.click();
          });

          const note = page.getByRole("dialog", { name: "Footnote", exact: true });
          await expect(note).toBeVisible();
          await expect(note).toContainText("Original note 1: the blue pebble");
          await expect(note).toContainText("Nested evidence remains readable.");
          expect((await state(page)).currentPage).toBe(before.currentPage);
          await page.screenshot({ path: testInfo.outputPath("footnote.png") });
          await page.keyboard.press("Escape");
          await expect(note).not.toBeVisible();
        }
        if (variation.feature === "media") {
          await expect
            .poll(() =>
              page.evaluate(() => {
                const doc = Reflect.get(
                  window,
                  "__readerController",
                ).primaryContentDocument() as Document;
                return Array.from(doc.images).map(
                  (image) => image.complete && image.naturalWidth > 0,
                );
              }),
            )
            .toEqual([true, true, true]);
        }
        if (variation.feature === "overflow") {
          const before = (await state(page)).shownPages;
          await page.evaluate(() => {
            const doc = Reflect.get(
              window,
              "__readerController",
            ).primaryContentDocument() as Document;
            doc.querySelector("pre")!.focus({ preventScroll: true });
          });
          await page.keyboard.press("ArrowRight");
          await expect
            .poll(() =>
              page.evaluate(() => {
                const doc = Reflect.get(
                  window,
                  "__readerController",
                ).primaryContentDocument() as Document;
                return doc.querySelector("pre")!.scrollLeft;
              }),
            )
            .toBeGreaterThan(0);
          expect((await state(page)).shownPages).toEqual(before);
        }
        if (!variation.mode) {
          const beforeTurn = (await state(page)).shownPages;
          await clickReadingPage(page, variation.rtl ? "left" : "right");
          await expect.poll(async () => (await state(page)).shownPages).not.toEqual(beforeTurn);
          await idle(page);
          await clickReadingPage(page, variation.rtl ? "right" : "left");
          await expect.poll(async () => (await state(page)).shownPages).toEqual(beforeTurn);
          await idle(page);
          await expect.poll(() => visibleTarget(page, first)).toBe(true);
        }

        await select(page, last);
        await expect.poll(() => visibleTarget(page, last)).toBe(true);
        const saved = await state(page);
        await page.evaluate(() => Reflect.get(window, "__readerController").flushProgress());
        await page.reload();
        await expect(page.getByRole("main").locator("iframe").first()).toBeVisible({
          timeout: 30_000,
        });
        await expect(page.getByRole("progressbar")).toHaveCount(0, { timeout: 30_000 });
        await exposeReaderController(page);
        await expect
          .poll(async () => (await state(page)).section, { timeout: 30_000 })
          .toBe(last.label);
        expect((await state(page)).spine).toBe(saved.spine);
        await expect.poll(() => visibleTarget(page, last)).toBe(true);
        if (!variation.mode)
          await expect.poll(async () => (await state(page)).currentPage).toBe(saved.currentPage);
        await page.screenshot({ path: testInfo.outputPath("resumed-last.png") });

        await page.evaluate(() => Reflect.get(window, "__readerController").setFontScale(1.3));
        await select(page, middle);
        await expect.poll(() => visibleTarget(page, middle)).toBe(true);
        await select(page, first);
        await page.screenshot({ path: testInfo.outputPath("larger-type.png") });
        expect(errors, "uncaught reader exceptions").toEqual([]);
        const report = {
          variation,
          targets: targets.length,
          initialPages: initial.totalPages,
          saved,
          timings,
          errors,
        };
        fs.writeFileSync(testInfo.outputPath("measurements.json"), JSON.stringify(report, null, 2));
        await testInfo.attach("measurements", {
          body: JSON.stringify(report),
          contentType: "application/json",
        });
      } catch (error) {
        await captureDiagnostic("failure screenshot", () =>
          page.screenshot({ path: testInfo.outputPath("failure.png") }),
        );
        const capturedState = await captureDiagnostic("failure reader state", () => state(page));
        await captureDiagnostic("failure report", async () => {
          fs.writeFileSync(
            testInfo.outputPath("failure.json"),
            JSON.stringify(
              {
                variation,
                timings,
                errors,
                error: String(error),
                state: capturedState ?? null,
              },
              null,
              2,
            ),
          );
        });
        throw error;
      } finally {
        await context.close();
      }
    });
  }
});

for (const mode of ["single", "spread", "scroll"] as const) {
  test.describe(`encoded fragment regression ${mode} (#228)`, () => {
    for (const encoded of [false, true]) {
      test(`Unicode fragment ${encoded ? "percent-encoded" : "literal control"}`, async () => {
        const directory = test.info().outputPath("fixture");
        execFileSync(process.execPath, [
          fileURLToPath(new URL("../scripts/generate-encoded-fragment-repro.mjs", import.meta.url)),
          directory,
        ]);
        const book = path.join(directory, `${encoded ? "encoded" : "literal"}-fragment.epub`);
        const { context, readerPage: page } = await launchReader(book, {
          viewport: { width: mode === "spread" ? 1400 : 900, height: 900 },
        });
        try {
          await exposeReaderController(page);
          if (mode === "scroll")
            await page.evaluate(() =>
              Reflect.get(window, "__readerController").setViewMode("scroll"),
            );
          else {
            await expect
              .poll(async () =>
                (await state(page)).entries.every((entry) => entry.page !== undefined),
              )
              .toBe(true);
            const entries = (await state(page)).entries;
            expect(entries[1]!.page).toBeGreaterThan(entries[0]!.page!);
          }
          const navigation = await openContents(page);
          await navigation
            .getByRole("button")
            .filter({
              has: page.locator("span").filter({ hasText: /^Destination$/ }),
            })
            .click();
          await expect(navigation).not.toBeVisible();
          await page.screenshot({ path: test.info().outputPath("after-navigation.png") });
          await expect.poll(async () => (await state(page)).section).toBe("Destination");
          await expect
            .poll(() =>
              visibleTarget(page, {
                id: "arrivée",
                label: "Destination",
                chapter: 1,
                href: "ch.xhtml#arrivée",
              }),
            )
            .toBe(true);
          const destination = await state(page);
          if (mode !== "scroll") {
            expect(destination.shownPages).toContain(destination.entries[1]!.page);
          }
          await page.evaluate(() => Reflect.get(window, "__readerController").flushProgress());
          await page.reload();
          await expect(page.getByRole("main").locator("iframe").first()).toBeVisible();
          await expect(page.getByRole("progressbar")).toHaveCount(0);
          await exposeReaderController(page);
          await expect.poll(async () => (await state(page)).section).toBe("Destination");
          if (mode !== "scroll")
            await expect
              .poll(async () => (await state(page)).currentPage)
              .toBe(destination.currentPage);
        } finally {
          try {
            fs.writeFileSync(
              test.info().outputPath("navigation.json"),
              JSON.stringify(await state(page), null, 2),
            );
            await page.screenshot({ path: test.info().outputPath("final.png") });
          } finally {
            await context.close();
          }
        }
      });
    }
  });
}

test.describe("wide table native reachability", () => {
  test.skip(
    process.env.AMBRA_E2E_TABLE_REPRO !== "1",
    "Explicit opt-in: confirmed paginated table content loss #229 with Scroll-mode controls.",
  );
  for (const id of [
    "wide-table-pre-narrow",
    "overflow-unicode-scroll",
    "minimal-table-paginated",
    "minimal-table-scroll",
  ]) {
    test(id, async () => {
      const existing = contentStressCases.find((item) => item.id === id);
      const variation = existing ?? {
        id,
        width: 600,
        mode: id.endsWith("scroll") ? "scroll" : undefined,
      };
      let book: string;
      let first: StressTarget;
      if (existing) {
        const generated = generateContentStressFixture(test.info().outputPath("fixture"), existing);
        book = generated.book;
        first = generated.targets[0]!;
      } else {
        const directory = test.info().outputPath("fixture");
        execFileSync(process.execPath, [
          fileURLToPath(new URL("../scripts/generate-wide-table-repro.mjs", import.meta.url)),
          directory,
        ]);
        book = path.join(directory, "wide-table.epub");
        first = { id: "table", label: "Wide table", chapter: 1, href: "ch1.xhtml#table" };
      }
      const { context, readerPage: page } = await launchReader(book, {
        viewport: { width: variation.width, height: 900 },
      });
      const inspect = () =>
        page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          const doc = c.primaryContentDocument() as Document;
          const table = doc.querySelector("table")!;
          const cell = table.querySelector("th:last-child")!;
          const frame = doc.defaultView!.frameElement as HTMLIFrameElement;
          const box = cell.getBoundingClientRect();
          const tableBox = table.getBoundingClientRect();
          const frameBox = frame.getBoundingClientRect();
          const ancestors = [];
          for (let element: HTMLElement | null = table; element; element = element.parentElement) {
            const style = doc.defaultView!.getComputedStyle(element);
            ancestors.push({
              tag: element.tagName,
              width: element.clientWidth,
              scrollWidth: element.scrollWidth,
              scrollLeft: element.scrollLeft,
              overflowX: style.overflowX,
              tabindex: element.getAttribute("tabindex"),
            });
          }
          return {
            page: c.snapshot().bookPageIndex as number | undefined,
            lastHeader: cell.textContent,
            lastHeaderVisible:
              box.left >= 0 &&
              box.right <= frame.clientWidth &&
              box.top >= 0 &&
              box.bottom <= frame.clientHeight,
            lastHeaderBounds: {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            },
            frameWidth: frame.clientWidth,
            point: {
              x: frameBox.left + Math.min(frame.clientWidth - 25, tableBox.left + 50),
              y: frameBox.top + Math.max(10, Math.min(frame.clientHeight - 25, tableBox.top + 20)),
            },
            ancestors,
          };
        });
      const evidence = [];
      try {
        await exposeReaderController(page);
        if (variation.mode)
          await page.evaluate(() =>
            Reflect.get(window, "__readerController").setViewMode("scroll"),
          );
        await select(page, first);
        evidence.push({ action: "initial", ...(await inspect()) });
        const initial = await inspect();
        await page.mouse.move(initial.point.x, initial.point.y);
        const deltaX = initial.lastHeaderBounds.right - initial.frameWidth + 40;
        await page.mouse.wheel(deltaX, 0);
        // Native wheel dispatch is asynchronous; observe its settled paint before measuring.
        await page.waitForTimeout(500);
        evidence.push({ action: `native horizontal wheel +${deltaX}`, ...(await inspect()) });
        await page.screenshot({ path: test.info().outputPath("after-native-wheel.png") });
        if (!variation.mode) {
          for (let i = 0; i < 20; i++) {
            const before = (await state(page)).currentPage;
            await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
            await idle(page);
            if ((await state(page)).spine !== "EPUB/ch1.xhtml") break;
            if ((await state(page)).currentPage === before) break;
            evidence.push({ action: `forward page ${i + 1}`, ...(await inspect()) });
          }
        }
        fs.writeFileSync(
          test.info().outputPath("table-evidence.json"),
          JSON.stringify(evidence, null, 2),
        );
        expect(
          evidence.some((item) => item.lastHeaderVisible),
          "Rightmost table column must be reachable",
        ).toBe(true);
      } finally {
        try {
          fs.writeFileSync(
            test.info().outputPath("table-evidence.json"),
            JSON.stringify(evidence, null, 2),
          );
        } finally {
          await context.close();
        }
      }
    });
  }
});
