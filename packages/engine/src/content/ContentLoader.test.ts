// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ManifestItem } from "../container/PackageDocument.js";
import { ContentLoader, ContentLoaderError, findResourceReferencesInDocument } from "./ContentLoader.js";

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
    it("discovers density and width candidates on images and picture sources", () => {
      const document = new DOMParser().parseFromString(
        `<html xmlns="http://www.w3.org/1999/xhtml"><body>
          <picture><source media="(min-width: 800px)" srcset="../images/wide.png 800w, ../images/wider.png 1600w"/>
          <img src="../images/fallback.png" srcset="../images/one.png 1x, ../images/two.png 2x"/></picture>
        </body></html>`,
        "application/xhtml+xml",
      );
      const references = findResourceReferencesInDocument(document, "OEBPS/text/chapter.xhtml");
      expect(references.map(ref => ref.path)).toEqual([
        "OEBPS/images/fallback.png", "OEBPS/images/wide.png", "OEBPS/images/wider.png",
        "OEBPS/images/one.png", "OEBPS/images/two.png",
      ]);
      for (const ref of references.filter(ref => ref.attributeName === "srcset")) {
        expect(ref.attributeRange).toBeDefined();
        const value = ref.element.getAttribute("srcset")!;
        expect(value.slice(ref.attributeRange!.start, ref.attributeRange!.end)).toMatch(/^\.\.\/images\/\w+\.png$/);
      }
    });

    it("keeps schemes, fragment-only candidates, and non-picture sources out of archive resolution", () => {
      const document = new DOMParser().parseFromString(
        `<html xmlns="http://www.w3.org/1999/xhtml"><body>
          <img srcset="https://example.test/OEBPS/local.png 1x, //example.test/local.png 2x,
            data:image/png;base64,AAAA 3x, blob:external 4x, #local 5x, local.png 6x"/>
          <video><source srcset="not-an-image.png 1x"/></video>
        </body></html>`,
        "application/xhtml+xml",
      );
      expect(findResourceReferencesInDocument(document, "OEBPS/chapter.xhtml").map(ref => ref.path))
        .toEqual(["OEBPS/local.png"]);
    });

    it("preserves commas, encoded filenames and fragment suffixes in candidate spans", () => {
      const document = new DOMParser().parseFromString(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><img srcset="images/a,b.png 1x, images/100%25%23photo.svg#view 2x"/></body></html>',
        "application/xhtml+xml",
      );
      const references = findResourceReferencesInDocument(document, "OEBPS/part#one/chapter.xhtml");
      expect(references.map(ref => ref.path)).toEqual([
        "OEBPS/part#one/images/a,b.png", "OEBPS/part#one/images/100%#photo.svg",
      ]);
      const ref = references[1]!;
      expect(ref.element.getAttribute("srcset")!.slice(ref.attributeRange!.end)).toBe("#view 2x");
    });

    it("preserves encoded delimiters in resource filenames and literal delimiters in the base path", () => {
      const document = new DOMParser().parseFromString(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="images/100%25%23photo.png"/></body></html>',
        "application/xhtml+xml",
      );

      expect(findResourceReferencesInDocument(document, "OEBPS/part#one/chapter.xhtml")[0]?.path).toBe(
        "OEBPS/part#one/images/100%#photo.png",
      );
    });

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

describe("ContentLoader font de-obfuscation integration", () => {
  it("transparently de-obfuscates both IDPF- and Adobe-obfuscated fonts via loadResourceBytes", async () => {
    const container = await EpubContainer.open(await loadFixture("font-obfuscation.epub"));
    const loader = await ContentLoader.create(container);
    const expectedPlaintext = await loadFixture("font-obfuscation-plaintext.bin");

    const idpfBytes = await loader.loadResourceBytesById("idpf-font");
    const adobeBytes = await loader.loadResourceBytesById("adobe-font");

    expect(idpfBytes).toEqual(expectedPlaintext);
    expect(adobeBytes).toEqual(expectedPlaintext);
  });
});

describe("ContentLoader manifest fallback chain integration", () => {
  it("transparently falls back to a supported content document when the spine item's own media type isn't renderable", async () => {
    const container = await EpubContainer.open(await loadFixture("manifest-fallback.epub"));
    const loader = await ContentLoader.create(container);

    const doc = await loader.loadSpineDocument(0);

    // The spine's own item is the unsupported "ch1-pdf"; the content
    // document actually returned is its fallback, "ch1-html".
    expect(doc.manifestItem.id).toBe("ch1-html");
    expect(doc.rawText).toContain("XHTML fallback");
  });

  it("throws ContentLoaderError when neither the item nor anything in its fallback chain is renderable", async () => {
    const container = await EpubContainer.open(await loadFixture("manifest-fallback.epub"));
    const loader = await ContentLoader.create(container);
    const deadEnd = new ManifestItem("dead-end", "OEBPS/ch1.pdf", "application/pdf", new Set());

    await expect(loader.loadContentDocument(deadEnd)).rejects.toThrow(ContentLoaderError);
  });
});
