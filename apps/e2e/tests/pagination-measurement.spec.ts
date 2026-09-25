import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import type * as Engine from "../../../packages/engine/src/index.js";

declare global {
  interface Window {
    paginationEngine: typeof Engine;
  }
}

const root = path.resolve(import.meta.dirname, "../../..");
let code: string;

test.beforeAll(async () => {
  const require = createRequire(path.join(root, "apps/extension/package.json"));
  const { build } = await import(require.resolve("vite"));
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    build: {
      write: false, minify: false,
      lib: { entry: path.join(root, "packages/engine/src/index.ts"), formats: ["iife"], name: "paginationEngine" },
    },
  });
  code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
    (output: { type: string }) => output.type === "chunk",
  ).code;
});

async function browser(): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const directory = test.info().outputPath("browser");
  const runtime = path.join(directory, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(directory, "profile"), {
    headless: true, viewport: { width: 1400, height: 900 },
    env: { ...process.env, TMPDIR: runtime },
  });
  const page = await context.newPage();
  await page.route("http://pagination.test/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><body style='margin:0'></body></html>",
  }));
  await page.goto("http://pagination.test/");
  await page.addScriptTag({ content: code });
  return {
    context, page,
    close: async () => {
      await context.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function accessibleHeadings(context: BrowserContext, page: Page): Promise<string[]> {
  const cdp = await context.newCDPSession(page);
  try {
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const trees = await Promise.all((frameTree.childFrames ?? []).map(frame =>
      cdp.send("Accessibility.getFullAXTree", { frameId: frame.frame.id }),
    ));
    return trees.flatMap(tree => tree.nodes.filter(node =>
      !node.ignored && node.role?.value === "heading",
    ).map(node => String(node.name?.value).replace(/\s+/g, " ").trim()));
  } finally { await cdp.detach(); }
}

function book(content: string): string {
  const directory = test.info().outputPath("book");
  fs.mkdirSync(path.join(directory, "META-INF"), { recursive: true });
  fs.writeFileSync(path.join(directory, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(directory, "META-INF/container.xml"),
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  fs.writeFileSync(path.join(directory, "package.opf"),
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">pagination-test</dc:identifier><dc:title>Pagination test</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="image" href="image.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  fs.writeFileSync(path.join(directory, "image.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="216"><rect width="300" height="216" fill="blue"/></svg>');
  fs.writeFileSync(path.join(directory, "nav.xhtml"),
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Test</a></li></ol></nav></body></html>');
  fs.writeFileSync(path.join(directory, "chapter.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body>${content}</body></html>`);
  const output = path.join(directory, "test.epub");
  for (const args of [["-qX0", output, "mimetype"], ["-qXr", output, "META-INF", "package.opf", "nav.xhtml", "chapter.xhtml", "image.svg"]]) {
    const result = spawnSync("zip", args, { cwd: directory, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  const bytes = fs.readFileSync(output).toString("base64");
  fs.rmSync(directory, { recursive: true, force: true });
  return bytes;
}

test("offscreen semantic headings do not crop images; visible absolute content still counts (LTR/RTL)", async () => {
  const session = await browser();
  try {
    const bytes = book(`<h1 style="position:absolute;left:-999em;top:160px">Accessible publication title</h1>
      <h2 style="position:absolute;right:-999em;top:4000px">Accessible offscreen subtitle</h2>
      <img alt="Title artwork" style="display:block;width:300px;height:216px" src="image.svg"/>
      <p id="positioned" style="position:absolute;left:20px;top:350px">Visible positioned caption</p>
      <p>Adjacent flowing content</p><details><summary>Disclosure summary</summary><p>Closed content</p></details>`);
    for (const direction of ["ltr", "rtl"]) {
      const result = await session.page.evaluate(async ({ bytes, direction }) => {
        const E = window.paginationEngine;
        const loader = await E.ContentLoader.create(await E.EpubContainer.open(
          Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
        ));
        const resolver = new E.ResourceUrlResolver(loader);
        const host = new E.PaginatedContentHost(680, 900);
        document.body.append(host.element);
        await host.open(loader, resolver, 0, undefined, doc => { doc.body.dir = direction; });
        const doc = host.element.contentDocument!;
        const image = doc.querySelector("img")!.getBoundingClientRect();
        const captionRange = doc.createRange();
        captionRange.selectNodeContents(doc.querySelector("#positioned")!);
        const caption = captionRange.getBoundingClientRect();
        const clip = host.element.style.clipPath.match(/[\d.]+/g)!.map(Number);
        const top = clip[0]!;
        const bottom = 900 - clip[2]!;
        return {
          image: { top: image.top, bottom: image.bottom, height: image.height },
          caption: { top: caption.top, bottom: caption.bottom },
          clip: { top, bottom },
          heading: { display: getComputedStyle(doc.querySelector("h1")!).display,
            ariaHidden: doc.querySelector("h1")!.getAttribute("aria-hidden") },
          pages: host.pageCount,
        };
      }, { bytes, direction });
      expect(result.image.height).toBe(216);
      expect(result.image.top).toBeGreaterThanOrEqual(result.clip.top - 0.1);
      expect(result.image.bottom).toBeLessThanOrEqual(result.clip.bottom + 0.1);
      expect(result.caption.bottom).toBeLessThanOrEqual(result.clip.bottom + 0.1);
      expect(result.heading).toEqual({ display: "block", ariaHidden: null });
      expect(result.pages).toBe(1);
      expect(await accessibleHeadings(session.context, session.page)).toContain("Accessible publication title");
      expect(await accessibleHeadings(session.context, session.page)).toContain("Accessible offscreen subtitle");
    }
  } finally { await session.close(); }
});

test("incremental measurement yields inside a long leaf, preserves exact boundaries, and cancels", async () => {
  const session = await browser();
  try {
    const result = await session.page.evaluate(async () => {
      const E = window.paginationEngine;
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:680px;height:900px";
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.body.innerHTML = `<p>${"Original synthetic paragraph text for pagination. ".repeat(3000)}</p>
        <div dir="rtl">نص عربي <em>نص آخر</em><p>فصل آخر</p></div>
        <details><summary>Closed summary</summary><p>Hidden text</p></details>
        <details open=""><summary>Open summary</summary><p>Visible text</p></details>`;
      doc.body.style.cssText = "font:18px/30px serif;width:600px;margin:20px";
      const sync = E.PaginationEngine.paginate(doc.body, 700);
      const gaps: number[] = [];
      let previous = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        gaps.push(now - previous);
        previous = now;
      }, 0);
      const start = performance.now();
      const incremental = await E.PaginationEngine.paginateIncrementally(doc.body, 700, { timeSliceMs: 4 });
      const elapsed = performance.now() - start;
      clearInterval(heartbeat);
      const identical = sync.length === incremental.length && sync.every((page, i) => {
        const other = incremental[i]!;
        return page.topY === other.topY && page.bottomY === other.bottomY &&
          page.startBreak.node === other.startBreak.node && page.startBreak.offset === other.startBreak.offset &&
          page.endBreak.node === other.endBreak.node && page.endBreak.offset === other.endBreak.offset;
      });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 0);
      let cancelled = false;
      const cancelStart = performance.now();
      try {
        await E.PaginationEngine.paginateIncrementally(doc.body, 700, { signal: controller.signal, timeSliceMs: 4 });
      } catch (error) { cancelled = error instanceof DOMException && error.name === "AbortError"; }
      return { identical, pages: sync.length, heartbeats: gaps.length, maxGap: Math.max(...gaps), elapsed,
        cancelled, cancelMs: performance.now() - cancelStart };
    });
    const report = test.info().outputPath("incremental-measurement.json");
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    await test.info().attach("incremental-measurement.json", { path: report, contentType: "application/json" });
    expect(result.identical).toBe(true);
    expect(result.pages).toBeGreaterThan(50);
    expect(result.heartbeats).toBeGreaterThan(5);
    expect(result.maxGap).toBeLessThan(100);
    expect(result.cancelled).toBe(true);
    expect(result.cancelMs).toBeLessThan(100);
  } finally { await session.close(); }
});

test("point probes preserve prefix-algorithm boundaries for prose, whitespace, bidi and complex inline content", async () => {
  const session = await browser();
  try {
    const result = await session.page.evaluate(() => {
      const E = window.paginationEngine;
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:680px;height:900px";
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.body.style.cssText = "font:18px/30px serif;width:600px;margin:20px";
      const prose = "A flowing paragraph with office ligatures, café, e\u0301 and 🌍. ".repeat(145);
      doc.body.innerHTML = [
        `<p>${prose.repeat(4)}</p>`,
        `<p style="white-space:pre-wrap">${"  spaces\tand tabs\n\nnew lines ".repeat(150)}</p>`,
        `<p style="white-space:pre-line">${"a line\n\nb line\t  ".repeat(90)}</p>`,
        `<p>${"  collapsed    whitespace     ".repeat(300)}</p>`,
        `<p dir="rtl">${"نص عربي mixed English אבג 123 ".repeat(300)}</p>`,
        `<p style="text-transform:uppercase;font-variant:small-caps">${prose}</p>`,
        `<p style="word-break:break-all">${"unbrokenTextWith🌍Ande\u0301".repeat(80)}</p>`,
        `<p>${prose.slice(0, 1000)}<em>${prose.slice(0, 1000)}</em><strong>${prose.slice(0, 1000)}</strong></p>`,
        `<p>${prose.slice(0, 1000)}<br/>${prose.slice(0, 1000)}<ruby>字<rt>pronunciation</rt></ruby></p>`,
        '<p>Before <math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mi>y</mi></mfrac></math> after.</p>',
      ].join("");
      doc.body.getBoundingClientRect();
      const start = performance.now();
      const optimizedChunks = E.measureChunks(doc.body);
      const optimized = E.planPageBreaks(optimizedChunks, 700, { node: doc.body, offset: doc.body.childNodes.length });
      const optimizedMs = performance.now() - start;
      const prototype = Object.getPrototypeOf(doc.createRange()) as Range;
      const native = prototype.getClientRects;
      let pointProbes = 0;
      // Reproduce the prior prefix query at each optimized one-character probe.
      // Full/complex inline ranges still take their unchanged production path.
      prototype.getClientRects = function (this: Range): DOMRectList {
        if (this.startContainer.nodeType === Node.TEXT_NODE &&
            this.startContainer === this.endContainer && this.endOffset === this.startOffset + 1) {
          pointProbes++;
          const prefix = doc.createRange();
          prefix.selectNodeContents(this.startContainer.parentNode!);
          prefix.setEnd(this.endContainer, this.endOffset);
          return native.call(prefix);
        }
        return native.call(this);
      };
      const referenceStart = performance.now();
      const referenceChunks = E.measureChunks(doc.body);
      const reference = E.planPageBreaks(referenceChunks, 700, { node: doc.body, offset: doc.body.childNodes.length });
      const prefixMs = performance.now() - referenceStart;
      prototype.getClientRects = native;
      const identicalChunks = optimizedChunks.length === referenceChunks.length && optimizedChunks.every((chunk, i) => {
        const other = referenceChunks[i]!;
        return chunk.top === other.top && chunk.bottom === other.bottom &&
          chunk.breakBefore.node === other.breakBefore.node && chunk.breakBefore.offset === other.breakBefore.offset;
      });
      const identical = identicalChunks && optimized.length === reference.length && optimized.every((page, i) => {
        const other = reference[i]!;
        return page.topY === other.topY && page.bottomY === other.bottomY &&
          page.startBreak.node === other.startBreak.node && page.startBreak.offset === other.startBreak.offset &&
          page.endBreak.node === other.endBreak.node && page.endBreak.offset === other.endBreak.offset;
      });
      const differences = optimized.flatMap((page, i) => {
        const other = reference[i]!;
        return page.startBreak.node !== other?.startBreak.node || page.startBreak.offset !== other?.startBreak.offset
          ? [{ page: i, optimized: page.startBreak.offset, reference: other?.startBreak.offset,
            parent: page.startBreak.node.parentElement?.outerHTML.slice(0, 150) }] : [];
      }).slice(0, 10);
      return { identical, chunks: optimizedChunks.length, pages: optimized.length, optimizedMs, prefixMs, pointProbes, differences };
    });
    const report = test.info().outputPath("point-probe-parity.json");
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    await test.info().attach("point-probe-parity.json", { path: report, contentType: "application/json" });
    expect(result.identical).toBe(true);
    expect(result.pages).toBeGreaterThan(30);
    expect(result.pointProbes).toBeGreaterThan(500);
  } finally { await session.close(); }
});

test("actual Davies title and imprint images remain fully painted with headings exposed to accessibility", async () => {
  const file = process.env.AMBRA_VISUAL_CLIPPING_EPUB;
  test.skip(!file, "Set AMBRA_VISUAL_CLIPPING_EPUB to the local Davies advanced EPUB.");
  const bytes = fs.readFileSync(file!).toString("base64");
  const session = await browser();
  try {
    const results = await session.page.evaluate(async bytes => {
      const E = window.paginationEngine;
      const loader = await E.ContentLoader.create(await E.EpubContainer.open(
        Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
      ));
      const resolver = new E.ResourceUrlResolver(loader);
      const results = [];
      for (let index = 0; index < loader.packageDocument.spine.length; index++) {
        const source = await loader.loadSpineDocument(index);
        if (!/\/(titlepage|imprint)\.xhtml$/.test(source.manifestItem.path)) continue;
        const host = new E.PaginatedContentHost(680, 900);
        document.body.append(host.element);
        await host.open(loader, resolver, index);
        const doc = host.element.contentDocument!;
        const clip = host.element.style.clipPath.match(/[\d.]+/g)!.map(Number);
        results.push({
          path: source.manifestItem.path,
          clipTop: clip[0]!, clipBottom: 900 - clip[2]!,
          headings: Array.from(doc.querySelectorAll("h1,h2")).map(el => el.textContent!.trim()),
          images: Array.from(doc.querySelectorAll("img")).map(el => {
            const rect = el.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: rect.height };
          }),
        });
      }
      return results;
    }, bytes);
    expect(results).toHaveLength(2);
    const headings = await accessibleHeadings(session.context, session.page);
    for (const result of results) {
      expect(result.images.length).toBeGreaterThan(0);
      for (const image of result.images) {
        expect(image.height).toBeGreaterThan(0);
        expect(image.top).toBeGreaterThanOrEqual(result.clipTop - 0.1);
        expect(image.bottom).toBeLessThanOrEqual(result.clipBottom + 0.1);
      }
      for (const heading of result.headings) {
        expect(headings).toContain(heading.replace(/\s+/g, " "));
      }
    }
    const report = test.info().outputPath("davies-image-bounds.json");
    fs.writeFileSync(report, JSON.stringify(results, null, 2));
    await test.info().attach("davies-image-bounds.json", { path: report, contentType: "application/json" });
  } finally { await session.close(); }
});

test("background estimates yield within a large chapter and immediately retire superseded hosts", async () => {
  const session = await browser();
  try {
    const text = "Original synthetic prose for responsive background pagination. ";
    const bytes = book(Array.from({ length: 872 }, (_, index) =>
      `<p>${text.repeat(index === 400 ? 135 : 14)}</p>`,
    ).join(""));
    const result = await session.page.evaluate(async bytes => {
      const E = window.paginationEngine;
      const loader = await E.ContentLoader.create(await E.EpubContainer.open(
        Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
      ));
      const resolver = new E.ResourceUrlResolver(loader);
      const hidden = document.createElement("div");
      hidden.style.cssText = "position:absolute;left:-100000px;top:0";
      document.body.append(hidden);
      const estimator = new E.BookPaginationEstimator(
        loader, resolver, loader.packageDocument.spine,
        loader.packageDocument.metadata.renditionLayout, hidden, undefined,
        new E.LocatorResolver(loader.packageDocument, loader),
      );
      let syncPasses = 0;
      const sync = E.PaginationEngine.paginate;
      E.PaginationEngine.paginate = (...args) => { syncPasses++; return sync.apply(E.PaginationEngine, args); };
      const incremental = E.PaginationEngine.paginateIncrementally;
      let started!: () => void;
      let signal: AbortSignal | undefined;
      E.PaginationEngine.paginateIncrementally = (...args) => {
        signal = args[2]?.signal;
        started?.();
        return incremental.apply(E.PaginationEngine, args);
      };
      const progress: number[] = [];
      const run = (scale: number) => estimator.run(
        0, 680, 900, scale, E.ReadingTheme.DEFAULT_FONT_FAMILY,
        E.ReadingTheme.DEFAULT_LINE_SPACING, E.ReadingTheme.DEFAULT_LETTER_SPACING,
        E.ReadingTheme.DEFAULT_CONTENT_WIDTH_EM,
        () => progress.push(estimator.positionFor(0, 0).totalPages ?? 0),
      );
      const firstStarted = new Promise<void>(resolve => { started = resolve; });
      const first = run(1);
      await firstStarted;
      const firstSignal = signal!;
      const gaps: number[] = [];
      let previous = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        gaps.push(now - previous);
        previous = now;
      }, 0);
      const start = performance.now();
      const second = run(1.1);
      const retiredImmediately = firstSignal.aborted && hidden.children.length === 0;
      await Promise.all([first, second]);
      const elapsed = performance.now() - start;
      clearInterval(heartbeat);
      const hostsAfterCompletion = hidden.children.length;
      const totalPages = estimator.positionFor(0, 0).totalPages;
      const lastPageCfi = Reflect.get(estimator, "pageStarts")[0].at(-1);
      const lastPageIndex = estimator.pageIndexForCfi(0, lastPageCfi);
      const thirdStarted = new Promise<void>(resolve => { started = resolve; });
      const third = run(1.2);
      await thirdStarted;
      estimator.dispose();
      const disposedImmediately = signal!.aborted && hidden.children.length === 0;
      await third;
      resolver.dispose();
      hidden.remove();
      return { retiredImmediately, disposedImmediately, syncPasses, progress, hostsAfterCompletion,
        totalPages, lastPageIndex, elapsed, heartbeats: gaps.length, maxGap: Math.max(...gaps) };
    }, bytes);
    const report = test.info().outputPath("background-pagination.json");
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    await test.info().attach("background-pagination.json", { path: report, contentType: "application/json" });
    expect(result.retiredImmediately).toBe(true);
    expect(result.disposedImmediately).toBe(true);
    expect(result.hostsAfterCompletion).toBe(0);
    expect(result.syncPasses).toBe(0);
    expect(result.progress).toHaveLength(1);
    expect(result.totalPages).toBeGreaterThan(300);
    expect(result.lastPageIndex).toBe(result.totalPages! - 1);
    expect(result.heartbeats).toBeGreaterThan(5);
    expect(result.maxGap).toBeLessThan(150);
  } finally { await session.close(); }
});

test("identical fresh documents reuse DOM-free boundaries; changed typography and disclosures remeasure", async () => {
  const session = await browser();
  try {
    const text = "This original synthetic passage tests reliable reading of a very long chapter. ";
    const bytes = book(Array.from({ length: 872 }, (_, index) =>
      `<p>Paragraph ${index + 1}. ${text.repeat(index % 20 === 0 ? 100 : 10)}</p>`,
    ).join("") + "<details><summary>More</summary><p>Extra disclosed content</p></details>");
    const result = await session.page.evaluate(async bytes => {
      const E = window.paginationEngine;
      const loader = await E.ContentLoader.create(await E.EpubContainer.open(
        Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
      ));
      const resolver = new E.ResourceUrlResolver(loader);
      const create = () => {
        const host = new E.PaginatedContentHost(680, 900);
        document.body.append(host.element);
        return host;
      };
      const source = create();
      const initialStart = performance.now();
      await source.open(loader, resolver, 0);
      const initialMs = performance.now() - initialStart;
      source.goToPageIndex(20);
      const snapshot = JSON.parse(JSON.stringify(source.paginationSnapshot()));
      const pageCount = source.pageCount;
      source.dispose();
      source.element.remove();
      const original = E.PaginationEngine.paginate;
      let measurements = 0;
      E.PaginationEngine.paginate = (...args) => {
        measurements++;
        return original.apply(E.PaginationEngine, args);
      };
      const target = create();
      const start = performance.now();
      await target.open(loader, resolver, 0, undefined, undefined, undefined, snapshot);
      const cachedMs = performance.now() - start;
      target.goToPageIndex(21);
      const sameBoundaries = JSON.stringify(target.paginationSnapshot()?.pages) === JSON.stringify(snapshot.pages);
      const targetOwned = target.currentPosition()?.node.ownerDocument === target.element.contentDocument;
      const reuseMeasurements = measurements;
      const typography = create();
      await typography.open(loader, resolver, 0, undefined, doc => {
        E.ReadingTheme.applyFontScale(doc, 1.2);
      }, undefined, snapshot);
      const typographyMeasurements = measurements - reuseMeasurements;
      const changed = create();
      await changed.open(loader, resolver, 0, undefined, doc => {
        doc.querySelector("details")!.open = true;
      }, undefined, snapshot);
      const disclosureMeasurements = measurements - reuseMeasurements - typographyMeasurements;
      target.element.contentDocument!.querySelector("details")!.open = true;
      const invalidatedSource = target.paginationSnapshot() === undefined;
      for (const host of [target, typography, changed]) { host.dispose(); host.element.remove(); }
      resolver.dispose();
      return { pageCount, initialMs, cachedMs, sameBoundaries, targetOwned, reuseMeasurements,
        typographyMeasurements, disclosureMeasurements, invalidatedSource };
    }, bytes);
    const report = test.info().outputPath("pagination-snapshot.json");
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    await test.info().attach("pagination-snapshot.json", { path: report, contentType: "application/json" });
    expect(result.pageCount).toBeGreaterThan(400);
    expect(result.reuseMeasurements).toBe(0);
    expect(result.sameBoundaries).toBe(true);
    expect(result.targetOwned).toBe(true);
    expect(result.typographyMeasurements).toBe(1);
    expect(result.disclosureMeasurements).toBe(1);
    expect(result.invalidatedSource).toBe(true);
  } finally { await session.close(); }
});

test("a local real large chapter reuses boundaries after disposing its source document", async () => {
  const file = process.env.AMBRA_PAGINATION_SCALE_EPUB;
  test.skip(!file, "Set AMBRA_PAGINATION_SCALE_EPUB to the local Proust advanced EPUB.");
  const bytes = fs.readFileSync(file!).toString("base64");
  const session = await browser();
  try {
    const result = await session.page.evaluate(async bytes => {
      const E = window.paginationEngine;
      const container = await E.EpubContainer.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
      const loader = await E.ContentLoader.create(container);
      const resolver = new E.ResourceUrlResolver(loader);
      const candidates = loader.packageDocument.spine.map((item, index) => ({
        index, path: item.manifestItem.path, bytes: container.requireEntry(item.manifestItem.path).uncompressedSize,
      }));
      const largest = candidates.sort((a, b) => b.bytes - a.bytes)[0]!;
      const source = new E.PaginatedContentHost(680, 900);
      document.body.append(source.element);
      const initialStart = performance.now();
      await source.open(loader, resolver, largest.index);
      const initialMs = performance.now() - initialStart;
      const pageCount = source.pageCount;
      const snapshot = source.paginationSnapshot();
      source.dispose();
      source.element.remove();
      const target = new E.PaginatedContentHost(680, 900);
      document.body.append(target.element);
      const original = E.PaginationEngine.paginate;
      let measurements = 0;
      E.PaginationEngine.paginate = (...args) => {
        measurements++;
        return original.apply(E.PaginationEngine, args);
      };
      const cachedStart = performance.now();
      await target.open(loader, resolver, largest.index, undefined, undefined, undefined, snapshot);
      const cachedMs = performance.now() - cachedStart;
      const identical = JSON.stringify(target.paginationSnapshot()?.pages) === JSON.stringify(snapshot?.pages);
      const newDocument = target.currentPosition()?.node.ownerDocument === target.element.contentDocument;
      target.dispose();
      target.element.remove();
      resolver.dispose();
      return { largest, pageCount, initialMs, cachedMs, snapshotAvailable: !!snapshot, measurements, identical, newDocument };
    }, bytes);
    const report = test.info().outputPath("real-large-chapter.json");
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    await test.info().attach("real-large-chapter.json", { path: report, contentType: "application/json" });
    expect(result.snapshotAvailable).toBe(true);
    expect(result.pageCount).toBeGreaterThan(100);
    expect(result.measurements).toBe(0);
    expect(result.identical).toBe(true);
    expect(result.newDocument).toBe(true);
  } finally { await session.close(); }
});

test("SMIL and opaque media decline snapshot transfer while static inline SVG remains eligible", async () => {
  const session = await browser();
  try {
    const cases = [
      {
        name: "SMIL", eligible: false,
        content: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><animate attributeName="height" values="20;80;20" dur="1s" repeatCount="indefinite"/><rect width="100" height="100" fill="blue"/></svg>',
      },
      { name: "image", eligible: false, content: '<img src="image.svg" alt="Opaque image resource"/>' },
      { name: "video", eligible: false, content: '<video controls="controls" width="100" height="100"></video>' },
      {
        name: "static SVG", eligible: true,
        content: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"><rect width="100" height="20" fill="blue"/></svg>',
      },
    ];
    for (const entry of cases) {
      const bytes = book(`<p>Publication before the graphic.</p>${entry.content}<p>Publication after the graphic.</p>`);
      const result = await session.page.evaluate(async bytes => {
        const E = window.paginationEngine;
        const loader = await E.ContentLoader.create(await E.EpubContainer.open(
          Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
        ));
        const resolver = new E.ResourceUrlResolver(loader);
        const source = new E.PaginatedContentHost(680, 900);
        document.body.append(source.element);
        await source.open(loader, resolver, 0);
        const webAnimations = source.element.contentDocument!.getAnimations().length;
        const snapshot = source.paginationSnapshot();
        const target = new E.PaginatedContentHost(680, 900);
        document.body.append(target.element);
        const original = E.PaginationEngine.paginate;
        let measurements = 0;
        E.PaginationEngine.paginate = (...args) => {
          measurements++;
          return original.apply(E.PaginationEngine, args);
        };
        await target.open(loader, resolver, 0, undefined, undefined, undefined, snapshot);
        E.PaginationEngine.paginate = original;
        for (const host of [source, target]) { host.dispose(); host.element.remove(); }
        resolver.dispose();
        return { eligible: !!snapshot, webAnimations, measurements };
      }, bytes);
      expect(result.eligible, entry.name).toBe(entry.eligible);
      expect(result.measurements, entry.name).toBe(entry.eligible ? 0 : 1);
      if (entry.name === "SMIL") expect(result.webAnimations).toBe(0);
    }
  } finally { await session.close(); }
});

test("mixed inline offscreen semantics use visible prefix rects and paint every marker once in LTR/RTL", async () => {
  const session = await browser();
  try {
    const markers = Array.from({ length: 120 }, (_, index) => `M${String(index).padStart(3, "0")}`);
    const bytes = book(`<p style="font:20px/32px monospace;margin:0">${markers.slice(0, 20).join(" ")}
      <span role="heading" aria-level="2" style="position:relative;left:-999em;top:2000px">Accessible inline heading</span>
      ${markers.slice(20).join(" ")}</p>`);
    for (const direction of ["ltr", "rtl"]) {
      const result = await session.page.evaluate(async ({ bytes, direction }) => {
        const E = window.paginationEngine;
        const loader = await E.ContentLoader.create(await E.EpubContainer.open(
          Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
        ));
        const resolver = new E.ResourceUrlResolver(loader);
        const host = new E.PaginatedContentHost(480, 400);
        document.body.append(host.element);
        await host.open(loader, resolver, 0, undefined, doc => { doc.body.dir = direction; });
        const doc = host.element.contentDocument!;
        doc.body.style.transform = "";
        const paragraph = doc.querySelector("p")!;
        const fullRange = doc.createRange();
        fullRange.selectNodeContents(paragraph);
        const viewport = doc.documentElement.clientWidth;
        const visible = (rect: DOMRect) => rect.height > 0 && rect.right > 0 && rect.left < viewport;
        const rects = Array.from(fullRange.getClientRects()).filter(visible);
        const chunks = E.measureChunks(doc.body);
        const prefixTops = [-Infinity];
        // Independent linear oracle: no bisection, and no point-probe shortcut.
        for (let offset = 1; offset <= E.totalTextLength(paragraph); offset++) {
          const position = E.globalTextOffsetToPosition(paragraph, offset)!;
          const prefix = fullRange.cloneRange();
          prefix.setEnd(position.node, position.offset);
          prefixTops.push(Array.from(prefix.getClientRects()).filter(visible).at(-1)?.top ?? -Infinity);
        }
        const exactChunks = chunks.length === rects.length && chunks.every((chunk, index) => {
          if (chunk.top !== rects[index]!.top || chunk.bottom !== rects[index]!.bottom) return false;
          if (index === 0) return chunk.breakBefore.node === paragraph && chunk.breakBefore.offset === 0;
          const offset = prefixTops.findIndex(top => top >= chunk.top - 1);
          const expected = E.globalTextOffsetToPosition(paragraph, offset)!;
          return chunk.breakBefore.node === expected.node && chunk.breakBefore.offset === expected.offset;
        });
        const painted: string[] = [];
        for (let page = 0; page < host.pageCount; page++) {
          host.goToPageIndex(page);
          const clip = host.element.style.clipPath.match(/[\d.]+/g)!.map(Number);
          const top = clip[0]!;
          const bottom = 400 - clip[2]!;
          const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            for (const match of (node.textContent ?? "").matchAll(/M\d{3}/g)) {
              const range = doc.createRange();
              range.setStart(node, match.index!);
              range.setEnd(node, match.index! + match[0].length);
              const rect = range.getBoundingClientRect();
              if (visible(rect) && rect.top >= top - 0.1 && rect.bottom <= bottom + 0.1) {
                painted.push(match[0]);
              }
            }
          }
        }
        return { exactChunks, painted, pages: host.pageCount, chunks: chunks.length,
          retainedHeading: doc.querySelector('[role="heading"]')?.textContent };
      }, { bytes, direction });
      expect(result.exactChunks, direction).toBe(true);
      expect(result.pages).toBeGreaterThan(1);
      expect(result.painted, direction).toEqual(markers);
      expect(result.retainedHeading).toBe("Accessible inline heading");
      expect(await accessibleHeadings(session.context, session.page)).toContain("Accessible inline heading");
    }
  } finally { await session.close(); }
});
