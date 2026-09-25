#!/usr/bin/env node
// Compare fresh renderer processes, not post-import allocator high-water marks.
// Usage: node scripts/measure-library-memory.mjs BASELINE_BUILD OPTIMIZED_BUILD BOOK.epub [...]
import { chromium, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [baseline, optimized, ...books] = process.argv.slice(2).map((value) => path.resolve(value));
if (!baseline || !optimized || !books.length) throw new Error("Provide two extension builds and one or more EPUB files.");
const output = process.env.AMBRA_MEMORY_OUTPUT
  ? path.resolve(process.env.AMBRA_MEMORY_OUTPUT)
  : fileURLToPath(new URL("../test-results/library-memory-comparison/", import.meta.url));
await mkdir(output, { recursive: true });
const variants = [{ name: "baseline", build: baseline }, { name: "optimized", build: optimized }];
const results = [];

async function launch(variant) {
  const context = await chromium.launchPersistentContext(path.join(output, `${variant.name}-profile`), {
    channel: "chromium", headless: true, viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${variant.build}`, `--load-extension=${variant.build}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html?view=tab`);
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

try {
  for (const variant of variants) {
    await rm(path.join(output, `${variant.name}-profile`), { recursive: true, force: true });
    const { context, page } = await launch(variant);
    try {
      await page.locator('input[type="file"]').setInputFiles(books);
      await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(books.length, { timeout: 120000 });
    } finally { await context.close(); }
  }
  for (let trial = 1; trial <= 3; trial++) {
    for (const variant of variants) {
      const { context, page } = await launch(variant);
      try {
        await expect(page.getByRole("button", { name: /^Open / })).toHaveCount(books.length);
        const covers = await page.getByRole("button", { name: /^Open / }).evaluateAll(async (cards) =>
          Promise.all(cards.map(async (card) => {
            const background = getComputedStyle(card).backgroundImage;
            if (background === "none") return null;
            const image = new Image();
            image.src = background.slice(5, -2);
            await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight };
          })),
        );
        await page.waitForTimeout(2000);
        const cdp = await context.newCDPSession(page);
        await cdp.send("HeapProfiler.collectGarbage");
        const heap = await cdp.send("Runtime.getHeapUsage");
        const events = [];
        cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
        await cdp.send("Tracing.start", {
          categories: "blink.user_timing,disabled-by-default-memory-infra", transferMode: "ReportEvents",
        });
        await page.evaluate(() => performance.mark("ambra-library-memory"));
        const dump = await cdp.send("Tracing.requestMemoryDump", { levelOfDetail: "detailed", deterministic: true });
        const stopped = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
        await cdp.send("Tracing.end");
        await stopped;
        const pid = events.find((event) => event.name === "ambra-library-memory")?.pid;
        if (!pid || !dump.success) throw new Error("Renderer identity or memory dump unavailable.");
        const rssKiB = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim());
        const processTotals = events.find((event) => event.pid === pid && event.args?.dumps?.process_totals)?.args.dumps.process_totals;
        const result = { variant: variant.name, trial, pid, rssKiB, heap, processTotals, covers };
        results.push(result);
        console.log(JSON.stringify(result));
      } finally { await context.close(); }
    }
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify({
    environment: "macOS; isolated headless Chromium; 1400x900; fresh process per sample; post-GC; no reader opened",
    books: books.map((book) => path.basename(book)), variants, results,
    limitations: "RSS, private footprint, JS heap and Chrome hover memory differ. These controls do not explain the entire reported 453 MB or establish a leak.",
  }, null, 2));
} finally {
  for (const variant of variants) await rm(path.join(output, `${variant.name}-profile`), { recursive: true, force: true });
}
