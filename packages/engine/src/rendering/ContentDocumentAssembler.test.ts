// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentDocument, ContentLoader } from "../content/ContentLoader.js";
import { ContentDocumentAssembler } from "./ContentDocumentAssembler.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("ContentDocumentAssembler", () => {
  let loader: ContentLoader;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("content-loader.epub"));
    loader = await ContentLoader.create(container);
  });

  it("rewrites resource references to the provided blob URLs", async () => {
    const doc = await loader.loadSpineDocument(0);
    const resourceUrls = new Map([
      ["OEBPS/images/photo.png", "blob:mock-photo-url"],
      ["OEBPS/styles/main.css", "blob:mock-style-url"],
      ["OEBPS/images/diagram.png", "blob:mock-diagram-url"],
    ]);

    const assembled = ContentDocumentAssembler.assemble(doc, resourceUrls);

    expect(assembled).toContain('src="blob:mock-photo-url"');
    expect(assembled).toContain('href="blob:mock-style-url"');
    expect(assembled).toContain('xlink:href="blob:mock-diagram-url"');
  });

  it("rewrites every srcset URL without changing candidate descriptors, sizes, media or the source DOM", async () => {
    const fixture = await loader.loadSpineDocument(0);
    const raw = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Responsive</title></head><body>
      <picture><source media="(min-width: 800px)" type="image/png" sizes="50vw"
        srcset="images/wide.png 800w, images/wider.png 1600w"/>
      <img src="images/photo.png" sizes="100vw"
        srcset="images/photo.png 1x,  images/double.png#view 2x"/></picture>
      <img srcset="data:image/png;base64,AAAA 1x, images/photo.png 2x, missing.png 3x"/>
      <img srcset="https://example.test/images/photo.png 1x, images/double.png 2x"/>
    </body></html>`;
    const original = new DOMParser().parseFromString(raw, "application/xhtml+xml");
    const doc = new ContentDocument(fixture.manifestItem, original, raw);
    const urls = new Map([
      ["OEBPS/images/photo.png", "blob:photo"],
      ["OEBPS/images/double.png", "blob:a-longer-double-image-url"],
      ["OEBPS/images/wide.png", "blob:wide"],
      ["OEBPS/images/wider.png", "blob:wider"],
    ]);
    for (const applyReadingTheme of [true, false]) {
      const output = new DOMParser().parseFromString(
        ContentDocumentAssembler.assemble(doc, urls, { applyReadingTheme }), "text/html",
      );
      const source = output.querySelector("source")!;
      expect(source.getAttribute("srcset")).toBe("blob:wide 800w, blob:wider 1600w");
      expect(source.getAttribute("media")).toBe("(min-width: 800px)");
      expect(source.getAttribute("sizes")).toBe("50vw");
      expect(source.getAttribute("type")).toBe("image/png");
      const images = output.querySelectorAll("img");
      expect(images[0]!.getAttribute("src")).toBe("blob:photo");
      expect(images[0]!.getAttribute("srcset")).toBe("blob:photo 1x,  blob:a-longer-double-image-url#view 2x");
      expect(images[0]!.getAttribute("sizes")).toBe("100vw");
      expect(images[1]!.getAttribute("srcset")).toBe("data:image/png;base64,AAAA 1x, blob:photo 2x, missing.png 3x");
      expect(images[2]!.getAttribute("srcset")).toBe("https://example.test/images/photo.png 1x, blob:a-longer-double-image-url 2x");
      expect(output.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"))
        .toContain("img-src blob:;");
    }
    expect(original.querySelector("img")?.getAttribute("srcset")).toBe("images/photo.png 1x,  images/double.png#view 2x");
    expect(doc.rawText).toBe(raw);
  });

  it("leaves the original ContentDocument's parsed DOM untouched", async () => {
    const doc = await loader.loadSpineDocument(0);
    const resourceUrls = new Map([["OEBPS/images/photo.png", "blob:mock-photo-url"]]);

    ContentDocumentAssembler.assemble(doc, resourceUrls);

    // The assembler re-parses from rawText rather than mutating doc.document.
    const img = doc.document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("images/photo.png");
  });

  it("leaves a reference untouched when no URL is provided for its path", async () => {
    const doc = await loader.loadSpineDocument(0);

    const assembled = ContentDocumentAssembler.assemble(doc, new Map());

    expect(assembled).toContain('src="images/photo.png"');
  });

  it("injects a restrictive Content-Security-Policy meta tag", async () => {
    const doc = await loader.loadSpineDocument(0);

    const assembled = ContentDocumentAssembler.assemble(doc, new Map());

    expect(assembled).toContain('http-equiv="Content-Security-Policy"');
    expect(assembled).toContain("script-src 'none'");
    expect(assembled).toContain("default-src 'none'");
  });

  it("does not rewrite the hyperlink to a resource URL", async () => {
    const doc = await loader.loadSpineDocument(0);
    const resourceUrls = new Map([["OEBPS/ch1.xhtml", "blob:should-not-be-used"]]);

    const assembled = ContentDocumentAssembler.assemble(doc, resourceUrls);

    expect(assembled).toContain('href="ch1.xhtml#footnote1"');
  });

  it("injects the base CSS reset as a <style> element", async () => {
    const doc = await loader.loadSpineDocument(0);

    const assembled = ContentDocumentAssembler.assemble(doc, new Map());

    expect(assembled).toContain("<style>");
    expect(assembled).toContain("box-sizing: border-box");
  });

  it("injects the reading theme by default, after the CSS reset", async () => {
    const doc = await loader.loadSpineDocument(0);

    const assembled = ContentDocumentAssembler.assemble(doc, new Map());

    const resetIndex = assembled.indexOf("box-sizing: border-box");
    const themeIndex = assembled.indexOf("--ambra-font-scale");
    expect(themeIndex).toBeGreaterThan(resetIndex);
  });

  it("omits the reading theme when applyReadingTheme is false", async () => {
    const doc = await loader.loadSpineDocument(0);

    const assembled = ContentDocumentAssembler.assemble(doc, new Map(), { applyReadingTheme: false });

    expect(assembled).not.toContain("--ambra-font-scale");
    expect(assembled).not.toContain("data-ambra-page-theme");
    // The reset itself is unaffected by the option.
    expect(assembled).toContain("box-sizing: border-box");
  });

  it("orders the CSS reset after the CSP meta tag but before the book's own stylesheet link", async () => {
    const doc = await loader.loadSpineDocument(0);

    const assembled = ContentDocumentAssembler.assemble(doc, new Map());

    const cspIndex = assembled.indexOf("Content-Security-Policy");
    const resetIndex = assembled.indexOf("box-sizing: border-box");
    const themeIndex = assembled.indexOf("--ambra-font-scale");
    const bookStylesheetIndex = assembled.indexOf('href="styles/main.css"');

    expect(cspIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(cspIndex);
    expect(themeIndex).toBeGreaterThan(resetIndex);
    expect(bookStylesheetIndex).toBeGreaterThan(themeIndex);
  });
});
