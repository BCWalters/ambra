import { chromium, expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

// Generate with: node apps/e2e/scripts/generate-scale-fixtures.mjs
// Run: pnpm --filter @ambra/e2e exec playwright test scale-validation.spec.ts
//   --output real-books/scale-validation/results --trace off
// Timings include real UI/import work, not direct engine shortcuts. Bounds catch
// hangs rather than promise a hardware-independent frame-rate benchmark.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../real-books/scale-validation",
);
const manifestPath = path.join(root, "manifest.json");
test.skip(!fs.existsSync(manifestPath), "Run scripts/generate-scale-fixtures.mjs first.");
test.setTimeout(180_000);

async function launch(book: string) {
  const profile = path.join(root, `profile-${process.pid}-${Date.now()}`);
  fs.mkdirSync(profile, { recursive: true });
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  // This suite intentionally keeps Chromium's profile and scratch files in the
  // ignored fixture directory, including during large-archive import.
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    env: { ...process.env, TMPDIR: runtime },
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    viewport: { width: 760, height: 900 },
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const id = worker.url().split("/")[2]!;
    const library = await context.newPage();
    await library.goto(`chrome-extension://${id}/src/library/index.html`);
    await expect(library.locator('input[type="file"]')).toBeEnabled();
    const started = Date.now();
    await library.locator('input[type="file"]').setInputFiles(path.join(root, `${book}.epub`));
    const open = library.getByRole("button", { name: /^Open / }).first();
    await open.waitFor({ timeout: 60_000 });
    const importMs = Date.now() - started;
    expect(importMs, "import must not become a minute-long operation").toBeLessThan(30_000);
    console.log(`${book}: import ${importMs}ms`);
    const opening = Date.now();
    const readerPromise = context.waitForEvent("page");
    await open.click({ force: true });
    const page = await readerPromise;
    await page.waitForLoadState("domcontentloaded");
    await expect.poll(() => heading(page), { timeout: 60_000 }).not.toBe("");
    expect(Date.now() - opening, "first chapter readiness").toBeLessThan(15_000);
    console.log(`${book}: open ${Date.now() - opening}ms`);
    return {
      page,
      library,
      importMs,
      openMs: Date.now() - opening,
      close: async () => {
        await context.close();
        fs.rmSync(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}

async function heading(page: Page) {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll("iframe"))
        .filter(
          (f) => f.getBoundingClientRect().width > 0 && getComputedStyle(f).visibility !== "hidden",
        )
        .map((f) => f.contentDocument?.querySelector("h1")?.textContent ?? "")
        .find(Boolean) ?? "",
  );
}
async function position(page: Page) {
  return page.getByRole("slider", { name: "Position in book" }).getAttribute("aria-valuetext");
}
async function toolbar(page: Page, name: string) {
  await page.mouse.move(350, 2);
  await page.getByRole("button", { name, exact: true }).click();
}
async function toc(page: Page, title: string) {
  await toolbar(page, "Show contents");
  await page
    .getByRole("navigation", { name: "Table of contents" })
    .getByRole("button")
    .filter({ has: page.locator("span").filter({ hasText: new RegExp(`^${title}$`) }) })
    .click();
  await expect.poll(() => heading(page)).toBe(title);
}
async function turn(page: Page) {
  const before = await position(page);
  const start = Date.now();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(
      async () => {
        const after = await position(page);
        return after !== null && after !== before;
      },
      { timeout: 5000, intervals: [50] },
    )
    .toBe(true);
  return Date.now() - start;
}
async function measure(name: string, data: object) {
  console.log(`${name}: ${JSON.stringify(data)}`);
  await test.info().attach(`${name}.json`, {
    body: JSON.stringify(data, null, 2),
    contentType: "application/json",
  });
}

test("100+ MiB image book imports, persists, turns, spreads and scrolls (#130)", async () => {
  expect(fs.statSync(path.join(root, "large-images.epub")).size).toBeGreaterThan(100 * 1024 * 1024);
  const reader = await launch("large-images");
  const { page } = reader;
  try {
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll("iframe")).some((f) =>
            Array.from(f.contentDocument?.images ?? []).some(
              (i) => i.complete && i.naturalWidth === 768,
            ),
          ),
        ),
      )
      .toBe(true);
    const storage = await reader.library.evaluate(() => navigator.storage.estimate());
    expect(storage.usage).toBeGreaterThan(100 * 1024 * 1024);
    await expect.poll(() => position(page)).toMatch(/Page \d+ of \d+/);
    const turns = [];
    for (let i = 0; i < 4; i++) turns.push(await turn(page));
    await page.reload();
    await expect.poll(() => heading(page), { timeout: 30_000 }).toContain("Image chapter");
    const spreadStart = Date.now();
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Array.from(document.querySelectorAll("iframe")).filter(
              (f) =>
                f.getBoundingClientRect().width > 0 && getComputedStyle(f).visibility !== "hidden",
            ).length,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    const spreadReadyMs = Date.now() - spreadStart;
    const spreadTurnMs = await turn(page);
    await toolbar(page, "Settings");
    await page.getByRole("menuitem", { name: /^Reading mode/ }).click();
    await page.getByRole("menuitemradio", { name: "Scroll", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "Scroll", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("slider", { name: "Position in book" })).toHaveCount(0);
    const chapterLoadsMs = [];
    for (let chapter = 1; chapter <= 24; chapter++) {
      const start = Date.now();
      await toc(page, `Image chapter ${chapter}`);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const frame = document.querySelector("iframe");
            const images = Array.from(frame?.contentDocument?.images ?? []);
            return images.length === 4 && images.every((i) => i.complete && i.naturalWidth === 768);
          }),
        )
        .toBe(true);
      chapterLoadsMs.push(Date.now() - start);
    }
    const frame = page.frames().find((f) => f.parentFrame() && f.url() !== "about:blank");
    expect(frame).toBeDefined();
    await frame!.evaluate(() => window.scrollBy(0, 600));
    await expect
      .poll(() => frame!.evaluate(() => document.scrollingElement!.scrollTop))
      .toBeGreaterThan(0);
    const scroll = await frame!.evaluate(() => {
      const el = document.scrollingElement!;
      return {
        after: el.scrollTop,
        height: el.scrollHeight,
        viewport: el.clientHeight,
        images: Array.from(document.images).map((i) => ({
          complete: i.complete,
          width: i.naturalWidth,
        })),
      };
    });
    expect(scroll.images).toHaveLength(4);
    expect(scroll.images.every((i) => i.complete && i.width === 768)).toBe(true);
    await measure("large-images", {
      archiveBytes: fs.statSync(path.join(root, "large-images.epub")).size,
      importMs: reader.importMs,
      openMs: reader.openMs,
      storage,
      turnsMs: turns,
      spreadReadyMs,
      spreadTurnMs,
      decodedImages: 96,
      chapterLoadsMs,
      scroll,
    });
  } finally {
    await reader.close();
  }
});

test("120-chapter 199k-word omnibus pagination, TOC, seek and search (#131)", async () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  expect(manifest.long.chapters).toBe(120);
  expect(manifest.long.words).toBeGreaterThan(190_000);
  const reader = await launch("long-omnibus");
  const { page } = reader;
  try {
    const paginationStart = Date.now();
    await expect
      .poll(async () => (await position(page))?.match(/Page \d+ of (\d+)/)?.[1], {
        timeout: 90_000,
      })
      .toBeTruthy();
    const total = Number((await position(page))!.match(/Page \d+ of (\d+)/)![1]);
    expect(total).toBeGreaterThan(500);
    const paginationMs = Date.now() - paginationStart;
    const turnsMs = [await turn(page), await turn(page), await turn(page)];
    const tocStart = Date.now();
    await toolbar(page, "Show contents");
    const nav = page.getByRole("navigation", { name: "Table of contents" });
    await expect(nav.getByRole("button", { name: /Omnibus chapter/ })).toHaveCount(120);
    await nav.getByRole("button", { name: /Omnibus chapter 120/ }).click();
    await expect.poll(() => heading(page)).toBe("Omnibus chapter 120");
    const tocMs = Date.now() - tocStart;
    const slider = page.getByRole("slider", { name: "Position in book" });
    const seekStart = Date.now();
    await slider.focus();
    await slider.press("Home");
    await expect.poll(() => heading(page)).toBe("Omnibus chapter 001");
    await slider.press("End");
    await expect.poll(() => heading(page)).toBe("Omnibus chapter 120");
    await expect(slider).toHaveAttribute("aria-valuetext", new RegExp(`Page ${total} of ${total}`));
    const seekMs = Date.now() - seekStart;
    await toolbar(page, "Search");
    const searchStart = Date.now();
    await page.getByPlaceholder("Search this book…").fill("Destinationtoken060");
    const result = page.getByRole("button", { name: /Omnibus chapter 060.*Destinationtoken060/ });
    await expect(result).toHaveCount(1, { timeout: 30_000 });
    const searchMs = Date.now() - searchStart;
    await result.click();
    await expect.poll(() => heading(page)).toBe("Omnibus chapter 060");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const doc = document.querySelector("iframe")?.contentDocument;
          const target = Array.from(doc?.querySelectorAll("p") ?? []).find((p) =>
            p.textContent?.includes("Destinationtoken060"),
          );
          if (!target || !doc) return false;
          const rect = target.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.bottom <= doc.documentElement.clientHeight &&
            doc.elementFromPoint(rect.left + 5, rect.top + rect.height / 2)?.closest("p") === target
          );
        }),
      )
      .toBe(true);
    await measure("long-omnibus", {
      ...manifest.long,
      importMs: reader.importMs,
      openMs: reader.openMs,
      totalPages: total,
      paginationMs,
      turnsMs,
      tocMs,
      seekMs,
      searchMs,
    });
  } finally {
    await reader.close();
  }
});

test("valid EPUB XHTML specimens render and paginate without losing chapter tails (#132)", async () => {
  const reader = await launch("html-variety");
  const { page } = reader;
  const titles = [
    "Tables",
    "Definition lists",
    "Footnotes and asides",
    "Details and summary",
    "MathML",
    "Inline SVG",
    "Ruby text",
  ];
  const checks = [];
  try {
    for (const title of titles) {
      if ((await heading(page)) !== title) await toc(page, title);
      const specimen = page.frameLocator("iframe").first().locator("#specimen");
      await expect(specimen).toBeVisible();
      const geometry = await specimen.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          bottom: rect.bottom,
          viewport: el.ownerDocument.documentElement.clientHeight,
          namespace: el.namespaceURI,
        };
      });
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.height).toBeGreaterThan(0);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);
      if (title === "MathML") expect(geometry.namespace).toBe("http://www.w3.org/1998/Math/MathML");
      if (title === "Inline SVG") expect(geometry.namespace).toBe("http://www.w3.org/2000/svg");
      if (title === "Details and summary") {
        await specimen.locator("summary").click();
        await expect(specimen).toHaveAttribute("open", "");
        await expect(specimen.locator("#disclosure")).toBeVisible();
      }
      if (title === "Footnotes and asides") {
        await page.frameLocator("iframe").first().locator("#reference").click();
        await expect(page.getByRole("dialog", { name: "Footnote" })).toContainText(
          "carefully recorded",
        );
        await page.keyboard.press("Escape");
      }
      let sawTail = false;
      let turns = 0;
      for (; turns < 12; turns++) {
        sawTail = await page.evaluate(() => {
          const frame = document.querySelector("iframe");
          const el = frame?.contentDocument?.getElementById("chapter-end");
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const doc = el.ownerDocument;
          return (
            rect.top >= 0 &&
            rect.bottom <= doc.documentElement.clientHeight &&
            !!doc
              .elementFromPoint(rect.left + 5, rect.top + rect.height / 2)
              ?.closest("#chapter-end")
          );
        });
        if (sawTail) break;
        await turn(page);
        expect(await heading(page)).toBe(title);
      }
      expect(sawTail, `unreachable tail in ${title}`).toBe(true);
      checks.push({ title, geometry, turns });
    }
    await measure("html-variety", { checks });
  } finally {
    await reader.close();
  }
});
