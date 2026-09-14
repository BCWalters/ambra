// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader, ContentLoaderError } from "./ContentLoader.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("ContentLoader", () => {
  let loader: ContentLoader;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("content-loader.epub"));
    loader = await ContentLoader.create(container);
  });

  it("loads and parses a spine document by index", async () => {
    const doc = await loader.loadSpineDocument(0);

    expect(doc.manifestItem.id).toBe("ch1");
    expect(doc.rawText).toContain("Chapter 1");
    expect(doc.document.querySelector("h1")?.textContent).toBe("Chapter 1");
  });

  it("throws ContentLoaderError for an out-of-range spine index", async () => {
    await expect(loader.loadSpineDocument(99)).rejects.toThrow(ContentLoaderError);
  });

  it("loads a non-spine manifest item (e.g. the nav document) as a content document", async () => {
    const navItem = loader.packageDocument.findNavDocument();
    const doc = await loader.loadContentDocument(navItem!);

    expect(doc.document.querySelector("nav")).not.toBeNull();
  });

  it("loads raw resource bytes by path", async () => {
    const bytes = await loader.loadResourceBytes("OEBPS/fonts/font.otf");
    const text = new TextDecoder().decode(bytes);

    expect(text).toBe("FAKE-FONT-BYTES-FOR-TESTING-ONLY");
  });

  it("loads raw resource bytes by manifest id", async () => {
    const bytes = await loader.loadResourceBytesById("font1");
    const text = new TextDecoder().decode(bytes);

    expect(text).toBe("FAKE-FONT-BYTES-FOR-TESTING-ONLY");
  });

  it("throws ContentLoaderError for an unknown manifest id", async () => {
    await expect(loader.loadResourceBytesById("does-not-exist")).rejects.toThrow(
      ContentLoaderError,
    );
  });

  describe("findResourceReferences", () => {
    it("finds img, link[stylesheet], and svg:image references, resolved to archive-relative paths", async () => {
      const doc = await loader.loadSpineDocument(0);
      const references = loader.findResourceReferences(doc);

      const byPath = new Map(references.map((ref) => [ref.path, ref]));
      expect(byPath.get("OEBPS/images/photo.png")?.attributeName).toBe("src");
      expect(byPath.get("OEBPS/styles/main.css")?.attributeName).toBe("href");
      expect(byPath.get("OEBPS/images/diagram.png")?.attributeName).toBe("xlink:href");
    });

    it("does not treat <a href> hyperlinks as resource references", async () => {
      const doc = await loader.loadSpineDocument(0);
      const references = loader.findResourceReferences(doc);

      expect(references.some((ref) => ref.path.includes("ch1.xhtml"))).toBe(false);
    });

    it("finds exactly the three expected references, no more", async () => {
      const doc = await loader.loadSpineDocument(0);
      const references = loader.findResourceReferences(doc);

      expect(references).toHaveLength(3);
    });
  });
});
