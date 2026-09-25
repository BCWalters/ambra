import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader, outerMarginPoint } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

function longChapterFixture(info: TestInfo): string {
  const epub = navigationFixture(info, [1, 1]);
  const text = "This original synthetic passage tests reliable reading of a very long chapter. ";
  const paragraphs = Array.from({ length: 872 }, (_, index) =>
    `<p>Paragraph ${index + 1}. ${text.repeat(index % 20 === 0 ? 100 : 10)}</p>`).join("");
  const source = info.outputPath("navigation-source");
  fs.writeFileSync(path.join(source, "EPUB/c1.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Long chapter</title></head><body>${paragraphs}</body></html>`);
  execFileSync("zip", ["-q", "-X", epub, "EPUB/c1.xhtml"], { cwd: source });
  return epub;
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const controller = Reflect.get(window, "__readerController");
    return !controller.isTurningPage && !controller.isLoadInFlight && !controller.isApplyingLayout;
  });
}

test("a concentrated long chapter reuses documents without animation and guarded boundaries with animation", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  test.setTimeout(120_000);
  const { context, readerPage: page } = await launchReader(longChapterFixture(info), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount !== undefined);
    const result = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.setPageTurnAnimationStyle("none");
      await controller.turnPage(1);
      const originalDocuments = controller.host.contentDocuments();
      const prototype = Object.getPrototypeOf(controller.host.first);
      const open = prototype.open;
      const relayout = prototype.relayout;
      let opens = 0;
      let reflows = 0;
      let transferred = 0;
      prototype.open = function (...args: unknown[]) {
        opens++;
        if (args[6] !== undefined) transferred++;
        return open.apply(this, args);
      };
      prototype.relayout = function (...args: unknown[]) { reflows++; return relayout.apply(this, args); };
      try {
        const before = controller.host.positions.first.pageIndex;
        controller.focusReadingContent(controller.host.primaryContentDocument());
        const start = performance.now();
        await controller.turnPage(1);
        const expected = controller.host.currentPosition();
        const native = controller.nativeReading.current();
        const readingEntryMatches = native?.node === expected?.node &&
          (native?.offset ?? 0) === (expected?.offset ?? 0);
        await controller.turnPage(-1);
        const instant = {
          ms: performance.now() - start, opens, reflows, readingEntryMatches,
          sameDocuments: controller.host.contentDocuments().every((doc: Document, index: number) => doc === originalDocuments[index]),
          page: controller.host.positions.first.pageIndex, before,
        };
        opens = reflows = 0;
        await controller.setPageTurnAnimationStyle("slide");
        const animatedStart = performance.now();
        await controller.turnPage(1);
        return { instant, animated: { opens, reflows, transferred, ms: performance.now() - animatedStart }, pages: controller.host.pageCount };
      } finally { prototype.open = open; prototype.relayout = relayout; }
    });
    expect(result.pages).toBeGreaterThan(400);
    expect(result.instant.sameDocuments).toBe(true);
    expect(result.instant.readingEntryMatches).toBe(true);
    expect(result.instant.opens).toBe(0);
    expect(result.instant.reflows).toBe(0);
    expect(result.instant.page).toBe(result.instant.before);
    expect(result.instant.ms, "two no-animation turns should not remeasure a huge chapter").toBeLessThan(500);
    expect(result.animated).toMatchObject({ opens: 2, reflows: 0, transferred: 2 });
    expect(result.animated.ms, "an animated same-chapter turn should not take multiple seconds").toBeLessThan(1500);
    console.log(`Large chapter: ${JSON.stringify(result)}`);
  } finally { await context.close(); }
});

test("native margin clicks during preparation retain only one extra turn", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [12]), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount !== undefined);
    const point = await outerMarginPoint(page, "right");
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const loader = controller.contentLoader;
      const load = loader.loadSpineDocument;
      const gate = { held: false, release: () => {} };
      Reflect.set(window, "__scaleTurnGate", gate);
      loader.loadSpineDocument = async function (...args: unknown[]) {
        loader.loadSpineDocument = load;
        gate.held = true;
        await new Promise<void>(resolve => { gate.release = resolve; });
        return load.apply(this, args);
      };
      void controller.turnPage(1);
    });
    await page.waitForFunction(() => Reflect.get(window, "__scaleTurnGate").held);
    // Let the shell's idle overlay disappear; the load gate, not a timer, owns the turn.
    await expect(page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator(".."))
      .toHaveCSS("pointer-events", "none", { timeout: 10_000 });
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").queuedTurn)).toBe(1);
    await page.evaluate(() => Reflect.get(window, "__scaleTurnGate").release());
    await settled(page);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").host.positions.first.pageIndex)).toBe(4);
    expect(await page.locator("iframe").count()).toBe(2);
  } finally { await context.close(); }
});

test("unknown cross-chapter footer numbers stay blank instead of showing Page 1 twice", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [1, 2]), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount !== undefined);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      Reflect.set(window, "__savedPageCounts", controller.bookPagination.pageCounts);
      controller.bookPagination.pageCounts = [undefined, undefined];
      controller.notify();
    });
    await expect(page.getByText("Page 1", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Page 2", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Counting pages…", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("slider", { name: "Position in book" }))
      .toHaveAttribute("aria-valuetext", /^Counting pages…/);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.bookPagination.pageCounts = Reflect.get(window, "__savedPageCounts");
      controller.notify();
    });
    await expect(page.getByText("Page 2", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Counting pages…", { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test("optional actual Proust advanced EPUB: largest-chapter turn timings", async () => {
  const book = process.env.AMBRA_PROUST_EPUB;
  test.skip(!book || !fs.existsSync(book), "Set AMBRA_PROUST_EPUB to a local advanced EPUB.");
  test.setTimeout(180_000);
  const { context, readerPage: page } = await launchReader(book!, {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount !== undefined,
      undefined, { timeout: 120_000 });
    const timings = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const spineIndex = controller.pkg.spine.findIndex((item: { manifestItem: { path: string } }) =>
        item.manifestItem.path.endsWith("/chapter-3-1-1.xhtml"));
      if (spineIndex < 0) throw new Error("Expected Proust's largest chapter in the supplied EPUB");
      await controller.openSpineItem(spineIndex, { landOnPageIndex: 10 });
      const results = [];
      for (const style of ["none", "slide", "rotate", "scroll"]) {
        await controller.setPageTurnAnimationStyle(style);
        const start = performance.now();
        const before = controller.host.positions.first.pageIndex;
        await controller.turnPage(1);
        results.push({ style, ms: performance.now() - start, before, after: controller.host.positions.first.pageIndex });
      }
      return { results, pages: controller.host.pageCount, totalPages: controller.snapshot().bookPageCount };
    });
    console.log(`Actual Proust advanced EPUB: ${JSON.stringify(timings)}`);
    for (const result of timings.results) {
      expect(result.after).toBe(result.before + 2);
      expect(result.ms, `${result.style} turn on the actual largest chapter`).toBeLessThan(1500);
    }
    expect(timings.results[0]!.ms).toBeLessThan(500);
    await settled(page);
    const cdp = await context.newCDPSession(page);
    const sample = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      return {
        heap: await cdp.send("Runtime.getHeapUsage"),
        dom: await cdp.send("Memory.getDOMCounters"),
      };
    };
    const before = await sample();
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      for (let index = 0; index < 12; index++) await controller.turnPage(index % 2 ? -1 : 1);
    });
    const after = await sample();
    expect(after.dom.documents, "old chapter documents must not accumulate across animated turns")
      .toBeLessThanOrEqual(before.dom.documents + 2);
    expect(after.heap.usedSize, "retained JS should remain bounded after repeated turns")
      .toBeLessThan(before.heap.usedSize + 16 * 1024 * 1024);
    console.log(`Actual Proust retained memory (not total renderer memory): ${JSON.stringify({ before, after })}`);
  } finally { await context.close(); }
});
