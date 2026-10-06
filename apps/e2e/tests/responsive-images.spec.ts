import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import type * as Engine from "../../../packages/engine/src/index.js";
import { launchReader } from "../harness.js";

declare global {
  interface Window {
    responsiveEngine: typeof Engine;
  }
}

const root = path.resolve(import.meta.dirname, "../../..");
let code: string;

if (process.env.AMBRA_RESPONSIVE_IMAGE_EPUB) {
  test.use({ trace: "off", screenshot: "off" });
}

test.beforeAll(async () => {
  const require = createRequire(path.join(root, "apps/extension/package.json"));
  const { build } = await import(require.resolve("vite"));
  const bundle = await build({
    configFile: false, logLevel: "error",
    build: {
      write: false, minify: false,
      lib: { entry: path.join(root, "packages/engine/src/index.ts"), formats: ["iife"], name: "responsiveEngine" },
    },
  });
  code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
    (output: { type: string }) => output.type === "chunk",
  ).code;
});

function book(extra = ""): string {
  const directory = test.info().outputPath("source");
  fs.mkdirSync(path.join(directory, "META-INF"), { recursive: true });
  fs.writeFileSync(path.join(directory, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(directory, "META-INF/container.xml"),
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const images = [["fallback", 20, 10], ["one", 120, 60], ["two", 240, 120],
    ["wide", 320, 80], ["wider", 640, 160], ["comma,name", 120, 60]] as const;
  for (const [name, width, height] of images) {
    fs.writeFileSync(path.join(directory, `${name}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="teal"/></svg>`);
  }
  fs.writeFileSync(path.join(directory, "package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">responsive-images</dc:identifier><dc:title>Responsive images</dc:title><dc:language>en</dc:language></metadata>
      <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
      ${images.map(([name], i) => `<item id="image${i}" href="${name}.svg" media-type="image/svg+xml"/>`).join("")}
      </manifest><spine><itemref idref="chapter"/></spine></package>`);
  fs.writeFileSync(path.join(directory, "nav.xhtml"),
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Images</a></li></ol></nav></body></html>');
  fs.writeFileSync(path.join(directory, "chapter.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Images</title>
      <meta name="viewport" content="width=680,height=900"/>
      <style>img { display:block; width:120px; height:auto; }</style></head><body>
      <img id="density" src="fallback.svg" srcset="one.svg 1x, two.svg 2x"/>
      <img id="width" sizes="120px" srcset="one.svg 120w, two.svg 240w"/>
      <picture><source media="(min-width:600px)" sizes="320px" type="image/svg+xml" srcset="wide.svg 320w, wider.svg 640w"/>
        <img id="picture" src="fallback.svg" srcset="one.svg 1x, two.svg 2x"/></picture>
      <img id="comma" srcset="comma,name.svg 1x, two.svg 2x"/>
      <img id="invalid" srcset="not-in-archive.svg 1w 2x, one.svg 1x, two.svg 2x"/>
      ${extra}</body></html>`);
  const output = path.join(directory, "responsive.epub");
  execFileSync("zip", ["-qX0", output, "mimetype"], { cwd: directory });
  execFileSync("zip", ["-qXr", output, "META-INF", "package.opf", "nav.xhtml", "chapter.xhtml",
    ...images.map(([name]) => `${name}.svg`)], { cwd: directory });
  return output;
}

for (const deviceScaleFactor of [1, 2]) {
  test(`responsive resources select and paint before layout at DPR ${deviceScaleFactor}`, async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ deviceScaleFactor, viewport: { width: 1200, height: 1000 } });
    try {
      const page = await context.newPage();
      const unexpected: string[] = [];
      await page.route("**/*", route => {
        if (route.request().url() === "http://responsive.test/") {
          return route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" });
        }
        unexpected.push(route.request().url());
        return route.abort();
      });
      await page.goto("http://responsive.test/");
      await page.addScriptTag({ content: code });
      const results = await page.evaluate(async ({ bytes, deviceScaleFactor }) => {
        const E = window.responsiveEngine;
        const loader = await E.ContentLoader.create(await E.EpubContainer.open(
          Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
        ));
        const resolver = new E.ResourceUrlResolver(loader);
        const rows = [];
        try {
          for (const width of [480, 680]) {
            for (const mode of ["paginated", "scroll", "fixed"]) {
              const host = mode === "fixed" ? new E.FixedContentHost(width, 900)
                : mode === "scroll" ? new E.ScrollContentHost(width, 900)
                : new E.PaginatedContentHost(width, 900);
              document.body.append(host.element);
              try {
                if (host instanceof E.FixedContentHost) await host.open(loader, resolver, 0, undefined);
                else await host.open(loader, resolver, 0);
                const doc = host.element.contentDocument!;
                const images = [];
                for (const image of Array.from(doc.images).filter(image => image.id !== "restricted")) {
                  const expected = image.id === "picture" && (mode === "fixed" || width >= 600)
                    ? (deviceScaleFactor === 2 ? "wider" : "wide")
                    : image.id === "comma" && deviceScaleFactor === 1 ? "comma,name"
                    : deviceScaleFactor === 2 ? "two" : "one";
                  images.push({ id: image.id, complete: image.complete, decoded: image.naturalWidth > 0,
                    selected: image.currentSrc === await resolver.resolve(`${expected}.svg`) });
                }
                let fullyVisible = true;
                let pages = 1;
                if (host instanceof E.PaginatedContentHost) {
                  pages = host.pageCount;
                  const budget = Number.parseFloat(doc.documentElement.style.getPropertyValue(E.ReadingTheme.PAGE_CONTENT_HEIGHT_PROPERTY));
                  const paintTop = new DOMMatrixReadOnly(getComputedStyle(doc.body).transform).m42;
                  const windows: [number, number][] = [];
                  for (let i = 0; i < pages; i++) {
                    host.goToPageIndex(i);
                    const current = host.currentPageAndDocument();
                    if (!current) throw new Error("Responsive image page has no measured bounds");
                    const page = current.page;
                    windows.push([page.topY, page.topY + Math.min(page.height, budget)]);
                  }
                  host.goToPageIndex(0);
                  fullyVisible = Array.from(doc.images).filter(image => image.id !== "restricted").every(image => {
                    const rect = image.getBoundingClientRect();
                    const top = rect.top - paintTop, bottom = rect.bottom - paintTop;
                    const containing = windows.filter(([start, end]) => start <= top + 0.5 && end >= bottom - 0.5);
                    return containing.length === 1 && rect.height > 0;
                  });
                }
                const restricted = doc.querySelector<HTMLImageElement>("#restricted")!;
                rows.push({ width, mode, images, fullyVisible, pages,
                  restrictedBlocked: restricted.complete && restricted.naturalWidth === 0,
                  restrictedCandidates: restricted.getAttribute("srcset") });
              } finally {
                host.dispose();
                host.element.remove();
              }
            }
          }
          const url = await resolver.resolve("one.svg");
          const cached = url === await resolver.resolve("one.svg");
          resolver.dispose();
          const probe = new Image();
          probe.src = url;
          let revoked = false;
          try { await probe.decode(); } catch (error) {
            if (!(error instanceof DOMException)) throw error;
            revoked = true;
          }
          return { rows, cached, revoked };
        } finally {
          resolver.dispose();
        }
      }, { bytes: fs.readFileSync(book(
        '<img id="restricted" srcset="https://example.invalid/one.svg 1x, data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22120%22%20height=%2260%22/%3E 2x"/>',
      )).toString("base64"), deviceScaleFactor });
      expect(results.rows).toHaveLength(6);
      for (const row of results.rows) {
        expect(row.images).toHaveLength(5);
        expect(row.images.every(image => image.complete && image.decoded && image.selected), JSON.stringify(row)).toBe(true);
        expect(row.pages).toBeGreaterThan(0);
        expect(row.fullyVisible).toBe(true);
        expect(row.restrictedBlocked).toBe(true);
        expect(row.restrictedCandidates).toBeNull();
      }
      expect(results.cached).toBe(true);
      expect(results.revoked).toBe(true);
      expect(unexpected).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });
}

test("a missing packaged candidate fails explicitly instead of silently dropping srcset", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://responsive.test/", route => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
    await page.goto("http://responsive.test/");
    await page.addScriptTag({ content: code });
    const failure = await page.evaluate(async bytes => {
      const E = window.responsiveEngine;
      const loader = await E.ContentLoader.create(await E.EpubContainer.open(
        Uint8Array.from(atob(bytes), c => c.charCodeAt(0)),
      ));
      const host = new E.PaginatedContentHost(680, 900);
      const resolver = new E.ResourceUrlResolver(loader);
      document.body.append(host.element);
      try {
        await host.open(loader, resolver, 0);
        return null;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return { name: error.name, message: error.message };
      } finally {
        host.dispose(); resolver.dispose();
      }
    }, fs.readFileSync(book('<img srcset="missing.svg 2x"/>')).toString("base64"));
    expect(failure?.message).toContain("No manifest item found for resource path: missing.svg");
  } finally {
    await browser.close();
  }
});

test("packaged reader imports responsive artwork without a blank image page", async () => {
  const { context, readerPage } = await launchReader(book(), { viewport: { width: 680, height: 900 } });
  try {
    const content = readerPage.getByRole("main").locator("iframe").first().contentFrame();
    const image = content.locator("#density");
    await expect(image).toBeInViewport({ ratio: 1 });
    expect(await image.evaluate(img => img instanceof HTMLImageElement && img.complete &&
      img.naturalWidth > 0 && img.currentSrc.startsWith("blob:"))).toBe(true);
    await expect(readerPage.getByRole("slider", { name: "Position in book" }))
      .toHaveAttribute("aria-valuetext", /Page 1 of [1-9]/);
  } finally {
    await context.close();
  }
});

test.describe("opt-in local Standard Ebooks regression", () => {
  test("title artwork loads without removing its density candidates", async () => {
    const filename = process.env.AMBRA_RESPONSIVE_IMAGE_EPUB;
    test.skip(!filename, "Set AMBRA_RESPONSIVE_IMAGE_EPUB to a local compatible Standard Ebooks EPUB.");
    const { context, readerPage } = await launchReader(filename!, { viewport: { width: 680, height: 900 } });
    try {
      const image = readerPage.getByRole("main").locator("iframe").first().contentFrame().locator("img[srcset]").first();
      await expect(image).toBeInViewport();
      expect(await image.evaluate(img => img instanceof HTMLImageElement && img.complete &&
        img.naturalWidth > 0 && img.currentSrc.startsWith("blob:") && img.srcset.includes(" 2x"))).toBe(true);
    } finally {
      await context.close();
    }
  });
});
