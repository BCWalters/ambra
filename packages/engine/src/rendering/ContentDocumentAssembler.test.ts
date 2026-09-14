// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
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
});
