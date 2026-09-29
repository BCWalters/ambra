import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import type * as Engine from "../../../packages/engine/src/index.js";
import type * as TableControls from "../../extension/src/reader/TableControls.js";

declare global {
  interface Window {
    paginationEngine: typeof Engine;
    tableControls: typeof TableControls;
  }
}

const root = path.resolve(import.meta.dirname, "../../..");
let code: string;

// Local publication content must not end up in traces or screenshots.
if (process.env.AMBRA_BREAK_INSIDE_EPUB || process.env.AMBRA_SIMPLE_TABLE_EPUB) {
  test.use({ trace: "off", screenshot: "off" });
}

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
  const controls = await build({
    configFile: false, logLevel: "error",
    build: {
      write: false, minify: false,
      lib: { entry: path.join(root, "apps/extension/src/reader/TableControls.ts"), formats: ["iife"], name: "tableControls" },
    },
  });
  code += "\n" + (Array.isArray(controls) ? controls[0] : controls).output.find(
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
    contentType: "text/html",
    // Cache-equivalence tests must not give only the first iframe native :hover state.
    body: "<!doctype html><html><head><style>iframe{pointer-events:none}</style></head><body style='margin:0'></body></html>",
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

test("simple contents tables paginate intact rows, suppress zoom, and preserve anchors", async () => {
  const session = await browser();
  try {
    const result = await session.page.evaluate(async () => {
      const E = window.paginationEngine;
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:600px;height:300px";
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.body.innerHTML = `<style>
        body{margin:0;font:18px/24px Arial} p{margin:0}
        table{margin:auto;border-spacing:0;width:180px} td{padding:2px}
      </style><p>Contents</p><table id="contents"><tbody>${Array.from({ length: 28 }, (_, i) =>
        `<tr><td><a id="link${i}" href="#target">Chapter ${i + 1}${i === 4 ? " with a longer title that wraps across lines" : ""}</a></td></tr>`).join("")}
      </tbody></table><p id="target">After the contents</p>`;
      const original = doc.body.innerHTML;
      E.ReadingTheme.applyPageContentHeight(doc, 140);
      const table = doc.querySelector("table")!;
      const rows = E.measureSimpleTableRows(table, 140)!;
      const pages = E.PaginationEngine.paginate(doc.body, 140);
      const incremental = await E.PaginationEngine.paginateIncrementally(doc.body, 140, { timeSliceMs: 1 });
      const parity = pages.length === incremental.length && pages.every((page, i) => {
        const other = incremental[i]!;
        return page.topY === other.topY && page.bottomY === other.bottomY &&
          page.startBreak.node === other.startBreak.node && page.startBreak.offset === other.startBreak.offset;
      });
      const rowPages = rows.map(row => E.PaginationEngine.findPageForPosition(
        pages, row.element.querySelector("a")!.firstChild!, 0, doc)!);
      const fullyContained = rows.every((row, i) =>
        row.top >= rowPages[i]!.topY && row.bottom <= rowPages[i]!.bottomY);
      const paintedOnce = rows.every(row =>
        pages.filter(page => row.top >= page.topY && row.bottom <= page.bottomY).length === 1);
      const anchor = doc.querySelector("#link12")!.firstChild!;
      const forced = E.PaginationEngine.paginate(doc.body, 140, { node: anchor, offset: 2 });
      const anchored = E.PaginationEngine.findPageForPosition(forced, anchor, 2, doc)!;
      const tableAnchorPage = E.PaginationEngine.findPageForPosition(pages, table, 0, doc)!;
      const cleanup = window.tableControls.attachTableControls(doc, "Expand table", () => {}, () => pages[1]);
      const controls = doc.querySelector("[data-ambra-table-controls]")!.shadowRoot!;
      const noZoom = controls.querySelectorAll("button:popover-open").length === 0;
      cleanup();
      const originalUnchanged = original === doc.body.innerHTML;
      // A fitting table stays whole even when there is insufficient room on the current page.
      table.querySelectorAll("tr").forEach((row, i) => { if (i >= 3) row.remove(); });
      doc.querySelector("p")!.style.height = "80px";
      const shortRows = E.measureSimpleTableRows(table, 140)!;
      const shortPages = E.PaginationEngine.paginate(doc.body, 140);
      const shortPage = E.PaginationEngine.findPageForPosition(shortPages, table, 0, doc)!;
      return {
        count: rows.length, parity, fullyContained, paintedOnce, noZoom,
        wrappedRow: rows[4]!.bottom - rows[4]!.top > rows[0]!.bottom - rows[0]!.top,
        pages: new Set(rowPages.map(page => page.index)).size,
        maxHeight: Math.max(...pages.map(page => page.height)),
        anchorTop: anchored.topY === rows[12]!.top,
        tableAnchor: tableAnchorPage.index === rowPages[0]!.index,
        shortWhole: shortRows.every(row => row.top >= shortPage.topY && row.bottom <= shortPage.bottomY),
        originalUnchanged,
      };
    });
    expect(result.count).toBe(28);
    expect(result.wrappedRow).toBe(true);
    expect(result.parity).toBe(true);
    expect(result.fullyContained).toBe(true);
    expect(result.paintedOnce).toBe(true);
    expect(result.noZoom).toBe(true);
    expect(result.pages).toBeGreaterThan(1);
    expect(result.maxHeight).toBeLessThanOrEqual(140);
    expect(result.anchorTop).toBe(true);
    expect(result.tableAnchor).toBe(true);
    expect(result.shortWhole).toBe(true);
    expect(result.originalUnchanged).toBe(true);
  } finally { await session.close(); }
});

test("complex, overflowing and oversized-row tables retain atomic measurement and viewer controls", async () => {
  const session = await browser();
  try {
    const results = await session.page.evaluate(() => {
      const E = window.paginationEngine;
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:600px;height:300px";
      document.body.append(frame);
      const doc = frame.contentDocument!;
      const cases = [
        '<tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr>',
        '<tr><td rowspan="2">A</td></tr><tr><td>B</td></tr>',
        '<tr><td colspan="2">A</td></tr><tr><td>B</td></tr>',
        '<caption>Data</caption><tr><td>A</td></tr><tr><td>B</td></tr>',
        '<thead><tr><th>Heading</th></tr></thead><tbody><tr><td>A</td></tr><tr><td>B</td></tr></tbody>',
        '<tr><td><table><tr><td>Nested</td></tr></table></td></tr><tr><td>B</td></tr>',
        '<tr><td style="height:400px">Tall</td></tr><tr><td>B</td></tr>',
        '<tr><td style="min-width:800px">Wide</td></tr><tr><td>B</td></tr>',
        '<tr><td><span style="display:inline-block;width:5px;overflow:hidden">Clipped text</span></td></tr><tr><td>B</td></tr>',
        '<tr><td><span style="position:relative;top:300px">Offset</span></td></tr><tr><td>B</td></tr>',
        '<tr><td><img alt="Graphic" width="20" height="20"/></td></tr><tr><td>B</td></tr>',
      ];
      return cases.map(markup => {
        doc.body.innerHTML = `<style>body{margin:0;font:18px/24px Arial}</style><table>${markup}</table>`;
        E.ReadingTheme.applyPageContentHeight(doc, 140);
        const table = doc.querySelector("table")!;
        const eligible = !!E.measureSimpleTableRows(table, 140);
        const chunks = E.measureChunks(doc.body, 140);
        const pages = E.PaginationEngine.paginate(doc.body, 140);
        const cleanup = window.tableControls.attachTableControls(doc, "Expand table", () => {}, () => pages[0]);
        const viewer = doc.querySelector("[data-ambra-table-controls]")!.shadowRoot!
          .querySelectorAll("button:popover-open").length;
        cleanup();
        return { markup, eligible, chunks: chunks.length, viewer };
      });
    });
    for (const result of results) {
      expect(result.eligible, result.markup).toBe(false);
      expect(result.chunks, result.markup).toBe(1);
      expect(result.viewer, result.markup).toBe(1);
    }
  } finally { await session.close(); }
});

test("table controls follow row-fit changes and scroll mode without exposing unnecessary zoom", async () => {
  const session = await browser();
  try {
    const result = await session.page.evaluate(async () => {
      const E = window.paginationEngine;
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:600px;height:300px";
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.body.innerHTML = '<style>body{margin:0}td{height:30px}</style><table><tr><td>A</td></tr><tr><td>B</td></tr></table>';
      E.ReadingTheme.applyPageContentHeight(doc, 140);
      const page = new E.Page(0, { node: doc.body }, { node: doc.body, offset: 2 }, 0, 200);
      let paginated = true;
      const cleanup = window.tableControls.attachTableControls(doc, "Expand table", () => {},
        () => paginated ? page : undefined);
      const button = doc.querySelector("[data-ambra-table-controls]")!.shadowRoot!.querySelector("button")!;
      const hiddenInitially = !button.matches(":popover-open");
      const row = doc.querySelector("td")!;
      row.style.height = "160px";
      const settle = () => new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await settle();
      const fallbackShown = button.matches(":popover-open");
      row.style.height = "30px";
      await settle();
      const hiddenAfterResize = !button.matches(":popover-open");
      paginated = false;
      E.ReadingTheme.applyPageContentHeight(doc, undefined);
      doc.dispatchEvent(new Event("scroll"));
      await settle();
      const hiddenInScroll = !button.matches(":popover-open");
      cleanup();
      return { hiddenInitially, fallbackShown, hiddenAfterResize, hiddenInScroll };
    });
    expect(result).toEqual({
      hiddenInitially: true, fallbackShown: true, hiddenAfterResize: true, hiddenInScroll: true,
    });
  } finally { await session.close(); }
});

test("simple-table row geometry is measured once and page planning performs no layout queries", async () => {
  const session = await browser();
  try {
    const result = await session.page.evaluate(() => {
      const E = window.paginationEngine;
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:600px;height:300px";
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.body.innerHTML = `<table>${"<tr><td>Contents entry</td></tr>".repeat(1000)}</table>`;
      // Instrument this document's realm, not the parent harness.
      const elementPrototype = Object.getPrototypeOf(Object.getPrototypeOf(doc.body));
      const rangePrototype = Object.getPrototypeOf(doc.createRange());
      const box = elementPrototype.getBoundingClientRect;
      const rects = rangePrototype.getClientRects;
      let boxes = 0;
      let ranges = 0;
      elementPrototype.getBoundingClientRect = function () {
        boxes++;
        return box.call(this);
      };
      rangePrototype.getClientRects = function () {
        ranges++;
        return rects.call(this);
      };
      try {
        const chunks = E.measureChunks(doc.body, 140);
        const measurementBoxes = boxes;
        const measurementRanges = ranges;
        boxes = ranges = 0;
        const pages = E.planPageBreaks(chunks, 140, { node: doc.body, offset: doc.body.childNodes.length });
        return { chunks: chunks.length, pages: pages.length, measurementBoxes, measurementRanges,
          planningBoxes: boxes, planningRanges: ranges };
      } finally {
        elementPrototype.getBoundingClientRect = box;
        rangePrototype.getClientRects = rects;
      }
    });
    expect(result.chunks).toBe(1000);
    expect(result.pages).toBeGreaterThan(100);
    expect(result.measurementBoxes).toBe(1001);
    expect(result.measurementRanges).toBe(1000);
    expect(result.planningBoxes).toBe(0);
    expect(result.planningRanges).toBe(0);
  } finally { await session.close(); }
});

for (const source of ["synthetic", "local"] as const) {
  test(`${source} contents table paints all 28 links once in single pages and spreads (#241)`, async () => {
    const file = process.env.AMBRA_SIMPLE_TABLE_EPUB;
    test.skip(source === "local" && !file, "Set AMBRA_SIMPLE_TABLE_EPUB to pg84-images-3.epub.");
    const bytes = source === "local" ? fs.readFileSync(file!).toString("base64") : book(
      `<h2>Contents</h2><table style="margin:auto"><tbody>${Array.from({ length: 28 }, (_, i) =>
        `<tr><td><a href="#end">Chapter ${i + 1}</a></td></tr>`).join("")}
      </tbody></table><p id="end">After contents</p>`,
    );
    const session = await browser();
    try {
      const results = await session.page.evaluate(async bytes => {
        const E = window.paginationEngine;
        const loader = await E.ContentLoader.create(await E.EpubContainer.open(
          Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
        ));
        const resolver = new E.ResourceUrlResolver(loader);
        let spineIndex = -1;
        for (let index = 0; index < loader.packageDocument.spine.length; index++) {
          const parsed = await loader.loadSpineDocument(index);
          if (Array.from(parsed.document.querySelectorAll("table")).some(table =>
            table.querySelectorAll("tr").length === 28 && table.querySelectorAll("a[href]").length === 28)) {
            spineIndex = index;
            break;
          }
        }
        if (spineIndex < 0) throw new Error("Expected a contents table with 28 linked rows.");
        const results = [];
        for (const [width, height, scale, spread] of [
          [680, 900, 1, false], [480, 500, 1.5, false], [1400, 700, 1, true],
        ] as const) {
          const host = spread ? new E.SpreadPaginatedHost(width, height) : new E.PaginatedContentHost(width, height);
          document.body.append(host.element);
          const configure = (doc: Document) => E.ReadingTheme.applyFontScale(doc, scale);
          if (host instanceof E.SpreadPaginatedHost) {
            await host.openSpread(loader, resolver, {
              first: { spineIndex, pageIndex: 0 }, second: { spineIndex, pageIndex: 1 },
            }, configure);
          } else await host.open(loader, resolver, spineIndex, undefined, configure);
          const counts = Array<number>(28).fill(0);
          let visibleViewers = 0;
          let footerViolations = 0;
          const pages = host.pageCount;
          for (let pageIndex = 0; pageIndex < pages; pageIndex += spread ? 2 : 1) {
            if (host instanceof E.SpreadPaginatedHost) {
              host.tryGoToSpread({
                first: { spineIndex, pageIndex },
                ...(pageIndex + 1 < pages ? { second: { spineIndex, pageIndex: pageIndex + 1 } } : {}),
              });
            } else host.goToPageIndex(pageIndex);
            const views = host instanceof E.SpreadPaginatedHost
              ? host.documentViews()
              : [{ ...host.currentPageAndDocument()!, revealOverlay: () => host.revealReaderOverlay() }];
            for (const view of views) {
              const doc = view.document;
              const frame = doc.defaultView!.frameElement as HTMLIFrameElement;
              const clip = frame.style.clipPath.match(/[\d.]+/g)!.map(Number);
              const top = clip[0]!;
              const bottom = height - clip[2]!;
              const budget = Number.parseFloat(doc.documentElement.style.getPropertyValue(E.ReadingTheme.PAGE_CONTENT_HEIGHT_PROPERTY));
              if (bottom > top + budget + 0.1) footerViolations++;
              const table = Array.from(doc.querySelectorAll("table")).find(table => table.rows.length === 28)!;
              const links = table.querySelectorAll("a[href]");
              links.forEach((link, index) => {
                const range = doc.createRange();
                range.selectNodeContents(link);
                const rect = range.getBoundingClientRect();
                if (rect.top >= top - 0.1 && rect.bottom <= bottom + 0.1) counts[index]!++;
              });
              const cleanup = window.tableControls.attachTableControls(doc, "Expand table", () => {}, () => view.page);
              visibleViewers += doc.querySelector("[data-ambra-table-controls]")!.shadowRoot!
                .querySelectorAll("button:popover-open").length;
              cleanup();
              if (!view.revealOverlay) throw new Error("Expected paginated overlay clipping.");
              const clipCoordinates = () => doc.body.style.clipPath.slice(8, -1).split(",")
                .map(point => Number.parseFloat(point.trim().split(/\s+/).at(-1)!));
              const close = view.revealOverlay();
              const polygon = clipCoordinates();
              if (Math.abs((polygon[2]! - polygon[0]!) - (bottom - top)) > 0.1) footerViolations++;
              close();
              if (host instanceof E.PaginatedContentHost) {
                host.suppressClipPathForAnimation();
                const animation = clipCoordinates();
                if (Math.abs((animation[2]! - animation[0]!) - (bottom - top)) > 0.1) footerViolations++;
                host.restoreNaturalHeight();
              }
            }
          }
          results.push({ width, height, scale, spread, pages, counts, visibleViewers, footerViolations });
          host.dispose();
          host.element.remove();
        }
        resolver.dispose();
        return results;
      }, bytes);
      for (const result of results) {
        expect(result.pages, JSON.stringify(result)).toBeGreaterThan(1);
        expect(result.counts, JSON.stringify(result)).toEqual(Array<number>(28).fill(1));
        expect(result.visibleViewers).toBe(0);
        expect(result.footerViolations).toBe(0);
      }
    } finally { await session.close(); }
  });
}

for (const declaration of [
  "page-break-inside:avoid", "break-inside:avoid", "break-inside:avoid-page",
  "break-inside:auto", "break-inside:avoid-column",
]) {
  test(`pagination respects Note boxes: ${declaration}`, async () => {
    const session = await browser();
    try {
      const result = await session.page.evaluate(async declaration => {
        const E = window.paginationEngine;
        const frame = document.createElement("iframe");
        frame.style.cssText = "width:680px;height:200px";
        document.body.append(frame);
        const doc = frame.contentDocument!;
        doc.open();
        doc.write(`<style>
          body { margin:0; font:16px/20px Arial } p,h2 { margin:0; font:inherit }
          aside.note { padding:8px; border:2px solid; ${declaration} }
        </style><p>Before one<br>Before two<br>Before three</p>
        <aside class="note" id="note" role="note"><h2>Note</h2><p id="anchor">First line<br>Second line</p></aside>
        <p>After the note</p><div style="height:1000px"></div>`);
        doc.close();
        const original = doc.body.innerHTML;
        const note = doc.querySelector("#note")!;
        const rect = note.getBoundingClientRect();
        const chunks = E.measureChunks(doc.body);
        const noteChunks = chunks.filter(chunk => note.contains(chunk.breakBefore.node));
        const pages = E.PaginationEngine.paginate(doc.body, 100);
        const incremental = await E.PaginationEngine.paginateIncrementally(doc.body, 100, { timeSliceMs: 1 });
        const notePages = [...new Set(noteChunks.map(chunk =>
          E.PaginationEngine.findPageForPosition(pages, chunk.breakBefore.node, chunk.breakBefore.offset ?? 0, doc)!.index))];
        const notePage = pages[notePages[0]!]!;
        const anchor = { node: doc.querySelector("#anchor")!.firstChild!, offset: 2 };
        const anchored = E.PaginationEngine.paginate(doc.body, 100, anchor);
        const anchoredPage = E.PaginationEngine.findPageForPosition(anchored, anchor.node, anchor.offset, doc)!;
        const anchorChunk = E.findChunkForPosition(chunks, anchor.node, anchor.offset)!;
        const scroll = E.ScrollViewEngine.prepare(doc.body);
        scroll.restorePosition(anchor.node, anchor.offset);
        return {
          noteChunks: noteChunks.length, notePages,
          coversBox: notePage.topY <= rect.top && notePage.bottomY >= rect.bottom,
          sameBoundaries: pages.length === incremental.length && pages.every((page, i) => {
            const other = incremental[i]!;
            return page.topY === other.topY && page.bottomY === other.bottomY &&
              page.startBreak.node === other.startBreak.node && page.startBreak.offset === other.startBreak.offset &&
              page.endBreak.node === other.endBreak.node && page.endBreak.offset === other.endBreak.offset;
          }),
          anchorAtTop: anchoredPage.topY === anchorChunk.top,
          scrollChunksUnchanged: scroll.measuredChunks.length === chunks.length &&
            scroll.measuredChunks.every((chunk, i) => chunk.top === chunks[i]!.top && chunk.bottom === chunks[i]!.bottom),
          scrollTop: doc.scrollingElement!.scrollTop, expectedScrollTop: anchorChunk.top,
          unchanged: doc.body.innerHTML === original,
        };
      }, declaration);
      expect(result.noteChunks).toBeGreaterThan(2);
      expect(result.notePages).toHaveLength(declaration.endsWith("auto") || declaration.endsWith("avoid-column") ? 2 : 1);
      if (result.notePages.length === 1) expect(result.coversBox).toBe(true);
      expect(result.sameBoundaries).toBe(true);
      expect(result.anchorAtTop).toBe(true);
      expect(result.scrollChunksUnchanged).toBe(true);
      expect(result.scrollTop).toBeCloseTo(result.expectedScrollTop, 0);
      expect(result.unchanged).toBe(true);
    } finally { await session.close(); }
  });
}

test("oversized avoidance boxes retain nested notes and mixed inline runs", async () => {
  const session = await browser();
  try {
    const result = await session.page.evaluate(async () => {
      const E = window.paginationEngine;
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:680px;height:200px";
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.open();
      doc.write(`<style>body{margin:0;font:16px/20px Arial}p{margin:0}
        section{break-inside:avoid-page}</style>
        <section id="outer">Outer introduction<br>Second line<br>Third line
          <section id="note">Inline note <em>heading</em><p>Nested paragraph<br>Second note line</p>Inline tail</section>
          <p>${"Oversized paragraph line<br>".repeat(12)}</p>
        </section><p>After outer</p>`);
      doc.close();
      const chunks = E.measureChunks(doc.body);
      const pages = E.PaginationEngine.paginate(doc.body, 100);
      const incremental = await E.PaginationEngine.paginateIncrementally(doc.body, 100, { timeSliceMs: 1 });
      const note = doc.querySelector("#note")!;
      const noteChunks = chunks.filter(chunk => note.contains(chunk.breakBefore.node));
      const notePages = new Set(noteChunks.map(chunk =>
        E.PaginationEngine.findPageForPosition(pages, chunk.breakBefore.node, chunk.breakBefore.offset ?? 0, doc)!.index));
      return {
        count: pages.length, noteChunkCount: noteChunks.length, notePageCount: notePages.size,
        heights: pages.map(page => page.height),
        exactCoverage: chunks.every(chunk => pages.filter(page =>
          page.containsPosition(chunk.breakBefore.node, chunk.breakBefore.offset ?? 0, doc)).length === 1),
        sync: pages.map(page => [page.topY, page.bottomY]),
        incremental: incremental.map(page => [page.topY, page.bottomY]),
      };
    });
    expect(result.count).toBeGreaterThan(3);
    expect(result.noteChunkCount).toBeGreaterThanOrEqual(4);
    expect(result.notePageCount).toBe(1);
    expect(result.heights.every(height => height <= 100)).toBe(true);
    expect(result.exactCoverage).toBe(true);
    expect(result.incremental).toEqual(result.sync);
  } finally { await session.close(); }
});

test("overflowing nested avoidance boxes keep their fitting parent intact without duplicate slices", async () => {
  const session = await browser();
  try {
    const result = await session.page.evaluate(async () => {
      const E = window.paginationEngine;
      document.body.innerHTML = `<style>
        body{margin:0;font:16px/20px Arial}p{margin:0}
        #outer{position:relative;height:50px;break-inside:avoid}
        #inner{position:absolute;top:30px;height:80px;border:1px solid;break-inside:avoid}
      </style><p>Before one<br>Before two<br>Before three<br>Before four</p>
      <section id="outer"><p>Parent text</p><aside id="inner">Nested text</aside></section>`;
      const outer = document.querySelector("#outer")!;
      const inner = document.querySelector("#inner")!;
      const outerRect = outer.getBoundingClientRect();
      const innerRect = inner.getBoundingClientRect();
      const chunks = E.measureChunks(document.body);
      const pages = E.PaginationEngine.paginate(document.body, 150);
      const incremental = await E.PaginationEngine.paginateIncrementally(document.body, 150, { timeSliceMs: 1 });
      const groupChunks = chunks.filter(chunk => outer.contains(chunk.breakBefore.node));
      return {
        groupBounds: [outerRect.top, innerRect.bottom],
        overflow: innerRect.bottom > outerRect.bottom,
        sync: pages.map(page => [page.topY, page.bottomY]),
        incremental: incremental.map(page => [page.topY, page.bottomY]),
        groupPages: [...new Set(groupChunks.map(chunk =>
          E.PaginationEngine.findPageForPosition(pages, chunk.breakBefore.node, chunk.breakBefore.offset ?? 0, document)!.index))],
        paintedOnce: chunks.every(chunk => pages.filter(page =>
          chunk.top < page.bottomY && chunk.bottom > page.topY).length === 1),
      };
    });
    expect(result.overflow).toBe(true);
    expect(result.groupBounds).toEqual([80, 192]);
    expect(result.sync).toHaveLength(2);
    expect(result.sync[1]).toEqual(result.groupBounds);
    expect(result.sync[0]![1]).toBeLessThanOrEqual(result.sync[1]![0]!);
    expect(result.groupPages).toEqual([1]);
    expect(result.paintedOnce).toBe(true);
    expect(result.incremental).toEqual(result.sync);
  } finally { await session.close(); }
});

test("1600 short poetry groups measure one box each and never query layout while planning", async () => {
  const session = await browser();
  try {
    const result = await session.page.evaluate(() => {
      const E = window.paginationEngine;
      document.body.innerHTML = `<style>body{margin:0;font:16px/20px Arial}p{margin:0}
        div.groupLines{page-break-inside:avoid}</style>` +
        Array.from({ length: 1600 }, (_, i) => `<div class="groupLines"><p>Verse ${i}</p><p>First short line<br>Second short line</p></div>`).join("");
      const original = Element.prototype.getBoundingClientRect;
      const originalRanges = Range.prototype.getClientRects;
      let boxes = 0;
      let ranges = 0;
      Element.prototype.getBoundingClientRect = function () { boxes++; return original.call(this); };
      Range.prototype.getClientRects = function () { ranges++; return originalRanges.call(this); };
      try {
        const chunks = E.measureChunks(document.body);
        const measuredBoxes = boxes;
        const measuredRanges = ranges;
        const pages = E.planPageBreaks(chunks, 100, { node: document.body, offset: document.body.childNodes.length });
        const planningBoxes = boxes - measuredBoxes;
        const planningRanges = ranges - measuredRanges;
        const style = document.body.querySelector("style")!;
        const fixtureStyle = style.textContent!;
        style.textContent = fixtureStyle + "div.groupLines{break-inside:auto}";
        boxes = ranges = 0;
        const baseline = E.measureChunks(document.body);
        const baselineBoxes = boxes;
        const baselineRanges = ranges;
        // Timing excludes instrumentation and stylesheet/layout setup. Alternate
        // order each pair so warmup, GC and scheduling do not favor one mode.
        Element.prototype.getBoundingClientRect = original;
        Range.prototype.getClientRects = originalRanges;
        const samples = {
          auto: { measurement: [] as number[], planning: [] as number[] },
          avoid: { measurement: [] as number[], planning: [] as number[] },
        };
        for (let pair = 0; pair < 13; pair++) {
          const order = pair % 2 ? ["avoid", "auto"] as const : ["auto", "avoid"] as const;
          for (const mode of order) {
            style.textContent = fixtureStyle + `div.groupLines{break-inside:${mode}}`;
            void document.body.offsetHeight;
            const start = performance.now();
            const measured = E.measureChunks(document.body);
            const measuredAt = performance.now();
            E.planPageBreaks(measured, 100, { node: document.body, offset: document.body.childNodes.length });
            const plannedAt = performance.now();
            if (pair >= 3) {
              samples[mode].measurement.push(measuredAt - start);
              samples[mode].planning.push(plannedAt - measuredAt);
            }
          }
        }
        const summarize = (values: number[]) => {
          const sorted = [...values].sort((a, b) => a - b);
          return { medianMs: (sorted[4]! + sorted[5]!) / 2, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]! };
        };
        const benchmark = Object.fromEntries(Object.entries(samples).map(([mode, sample]) =>
          [mode, { measurement: summarize(sample.measurement), planning: summarize(sample.planning) }]));
        return { benchmark, warmupPairs: 3, measuredPairs: 10,
          measuredBoxes, measuredRanges, planningBoxes,
          planningRanges, baselineBoxes, baselineRanges,
          unchangedChunks: baseline.length === chunks.length && baseline.every((chunk, i) =>
            chunk.top === chunks[i]!.top && chunk.bottom === chunks[i]!.bottom &&
            chunk.breakBefore.node === chunks[i]!.breakBefore.node && chunk.breakBefore.offset === chunks[i]!.breakBefore.offset),
          chunks: chunks.length, pages: pages.length };
      } finally {
        Element.prototype.getBoundingClientRect = original;
        Range.prototype.getClientRects = originalRanges;
      }
    });
    console.log("avoidance operation counts and warmed alternating benchmark", JSON.stringify(result, null, 2));
    expect(result.measuredBoxes).toBe(1600);
    expect(result.planningBoxes).toBe(0);
    expect(result.planningRanges).toBe(0);
    expect(result.baselineBoxes).toBe(0);
    expect(result.measuredRanges).toBe(result.baselineRanges);
    expect(result.unchangedChunks).toBe(true);
    expect(result.pages).toBe(1600);
  } finally { await session.close(); }
});

test.describe("opt-in local avoidance verification", () => {
  test("fitting aside.note boxes in a local EPUB remain on one rendered page", async () => {
    const file = process.env.AMBRA_BREAK_INSIDE_EPUB;
    test.skip(!file, "Set AMBRA_BREAK_INSIDE_EPUB to a local EPUB with aside.note boxes.");
    const bytes = fs.readFileSync(file!).toString("base64");
    const session = await browser();
    let result;
    try {
      result = await session.page.evaluate(async bytes => {
        const E = window.paginationEngine;
        const loader = await E.ContentLoader.create(await E.EpubContainer.open(
          Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
        ));
        const resolver = new E.ResourceUrlResolver(loader);
        const original = E.PaginationEngine.paginate;
        const counts = { notes: 0, fitting: 0, oversized: 0, split: 0, baselineSplit: 0, clipChecks: 0, clipped: 0 };
        let fittingNotes: { element: Element; pageIndex: number }[] = [];
        E.PaginationEngine.paginate = (body, height, anchor) => {
          const pages = original.call(E.PaginationEngine, body, height, anchor);
          const chunks = E.measureChunks(body);
          const baseline = E.planPageBreaks(chunks.map(chunk => ({
            top: chunk.top, bottom: chunk.bottom, breakBefore: chunk.breakBefore,
          })), height, { node: body, offset: body.childNodes.length });
          const pageIndices = (selected: typeof chunks, planned: typeof pages) => new Set(selected.map(chunk =>
            E.PaginationEngine.findPageForPosition(planned, chunk.breakBefore.node, chunk.breakBefore.offset ?? 0, body.ownerDocument)!.index));
          for (const note of body.querySelectorAll("aside.note")) {
            if (!["avoid", "avoid-page"].includes(getComputedStyle(note).breakInside)) continue;
            const selected = chunks.filter(chunk => note.contains(chunk.breakBefore.node));
            if (!selected.length) continue;
            counts.notes++;
            const rect = note.getBoundingClientRect();
            const top = Math.min(rect.top, ...selected.map(chunk => chunk.top));
            const bottom = Math.max(rect.bottom, ...selected.map(chunk => chunk.bottom));
            if (bottom - top > height) { counts.oversized++; continue; }
            counts.fitting++;
            const indices = pageIndices(selected, pages);
            if (indices.size > 1) counts.split++;
            if (pageIndices(selected, baseline).size > 1) counts.baselineSplit++;
            fittingNotes.push({ element: note, pageIndex: indices.values().next().value! });
          }
          return pages;
        };
        try {
          for (let index = 0; index < loader.packageDocument.spine.length; index++) {
            fittingNotes = [];
            const host = new E.PaginatedContentHost(680, 900);
            document.body.append(host.element);
            try {
              await host.open(loader, resolver, index);
              for (const note of fittingNotes) {
                host.goToPageIndex(note.pageIndex);
                const rect = note.element.getBoundingClientRect();
                const clip = host.element.style.clipPath.match(/[\d.]+/g)!.map(Number);
                counts.clipChecks++;
                if (rect.top < clip[0]! - 0.1 || rect.bottom > 900 - clip[2]! + 0.1) counts.clipped++;
              }
            } finally { host.dispose(); host.element.remove(); }
          }
        } finally {
          E.PaginationEngine.paginate = original;
          resolver.dispose();
        }
        return counts;
      }, bytes);
    } finally { await session.close(); }
    console.log("local EPUB avoidance counts (no publication content)", result);
    expect(result.notes).toBeGreaterThan(0);
    expect(result.fitting).toBeGreaterThan(0);
    expect(result.split).toBe(0);
    expect(result.clipChecks).toBe(result.fitting);
    expect(result.clipped).toBe(0);
  });
});

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
      const secondStarted = new Promise<void>(resolve => { started = resolve; });
      const start = performance.now();
      const second = run(1.1);
      const retiredImmediately = firstSignal.aborted && hidden.children.length === 0;
      // Iframe parsing/layout cannot yield; measure cooperative pagination and
      // CFI generation separately from browser-controlled document startup.
      await secondStarted;
      const gaps: number[] = [];
      let previous = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        gaps.push(now - previous);
        previous = now;
      }, 0);
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
      const identityDifferences = JSON.parse(snapshot.identity).flatMap((value: unknown, index: number) =>
        JSON.stringify(value) === JSON.stringify(JSON.parse(Reflect.get(target, "measurementIdentity") ?? "[]")[index])
          ? [] : [index],
      );
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
        typographyMeasurements, disclosureMeasurements, invalidatedSource, identityDifferences };
    }, bytes);
    const report = test.info().outputPath("pagination-snapshot.json");
    fs.writeFileSync(report, JSON.stringify(result, null, 2));
    await test.info().attach("pagination-snapshot.json", { path: report, contentType: "application/json" });
    expect(result.pageCount).toBeGreaterThan(400);
    expect(result.reuseMeasurements, JSON.stringify(result)).toBe(0);
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
        const sameIdentity = snapshot?.identity === Reflect.get(target, "measurementIdentity");
        for (const host of [source, target]) { host.dispose(); host.element.remove(); }
        resolver.dispose();
        return { eligible: !!snapshot, webAnimations, measurements, sameIdentity };
      }, bytes);
      expect(result.eligible, entry.name).toBe(entry.eligible);
      expect(result.measurements, `${entry.name}: ${JSON.stringify(result)}`).toBe(entry.eligible ? 0 : 1);
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
