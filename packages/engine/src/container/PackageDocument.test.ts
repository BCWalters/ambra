// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "./EpubContainer.js";
import { PackageDocument, PackageDocumentError } from "./PackageDocument.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("PackageDocument (reflowable fixture)", () => {
  let pkg: PackageDocument;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("minimal.epub"));
    pkg = await container.getPackageDocument();
  });

  it("parses core dc metadata", () => {
    expect(pkg.metadata.identifier).toBe("urn:uuid:8f8a2c1e-2f1a-4a3b-9c1d-000000000001");
    expect(pkg.metadata.title).toBe("Pagina Minimal Test Fixture");
    expect(pkg.metadata.language).toBe("en");
  });

  it("defaults rendition layout to reflowable when no rendition:layout meta is present", () => {
    expect(pkg.metadata.renditionLayout).toBe("reflowable");
  });

  it("resolves manifest item hrefs to archive-relative paths", () => {
    const nav = pkg.getManifestItem("nav");
    const chapter1 = pkg.getManifestItem("chapter1");

    expect(nav?.path).toBe("OEBPS/nav.xhtml");
    expect(chapter1?.path).toBe("OEBPS/chapter1.xhtml");
  });

  it("identifies the nav document via its nav property", () => {
    expect(pkg.findNavDocument()?.id).toBe("nav");
  });

  it("parses spine order and defaults itemref linear to true", () => {
    expect(pkg.spine).toHaveLength(1);
    expect(pkg.spine[0]?.manifestItem.id).toBe("chapter1");
    expect(pkg.spine[0]?.linear).toBe(true);
  });
});

describe("PackageDocument (fixed-layout fixture)", () => {
  let pkg: PackageDocument;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("fixed-layout.epub"));
    pkg = await container.getPackageDocument();
  });

  it("reads a publication-wide pre-paginated rendition:layout", () => {
    expect(pkg.metadata.renditionLayout).toBe("pre-paginated");
  });

  it("resolves manifest item hrefs nested in subdirectories", () => {
    expect(pkg.getManifestItem("cover-image")?.path).toBe("OEBPS/images/cover.png");
  });

  it("parses manifest item properties (e.g. cover-image)", () => {
    expect(pkg.getManifestItem("cover-image")?.hasProperty("cover-image")).toBe(true);
  });

  it("applies the package-wide rendition layout to a spine item with no override", () => {
    const page1 = pkg.spine.find((ref) => ref.manifestItem.id === "page1");
    expect(page1?.resolveRenditionLayout(pkg.metadata.renditionLayout)).toBe("pre-paginated");
  });

  it("applies a per-spine-item rendition:layout-reflowable override", () => {
    const page2 = pkg.spine.find((ref) => ref.manifestItem.id === "page2");
    expect(page2?.hasProperty("rendition:layout-reflowable")).toBe(true);
    expect(page2?.resolveRenditionLayout(pkg.metadata.renditionLayout)).toBe("reflowable");
  });
});

describe("PackageDocument error handling", () => {
  it("throws PackageDocumentError when a spine itemref references an unknown manifest id", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
          <dc:title>Test</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <manifest>
          <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="does-not-exist"/>
        </spine>
      </package>`;

    expect(() => PackageDocument.parse(xml, "OEBPS/content.opf")).toThrow(PackageDocumentError);
  });

  it("throws PackageDocumentError when required dc:metadata is missing", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Test</dc:title>
        </metadata>
        <manifest></manifest>
        <spine></spine>
      </package>`;

    expect(() => PackageDocument.parse(xml, "OEBPS/content.opf")).toThrow(PackageDocumentError);
  });

  it("throws PackageDocumentError when the <manifest> element is missing entirely", () => {
    const xml = `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="pub-id">urn:uuid:test</dc:identifier>
          <dc:title>Test</dc:title>
          <dc:language>en</dc:language>
        </metadata>
        <spine></spine>
      </package>`;

    expect(() => PackageDocument.parse(xml, "OEBPS/content.opf")).toThrow(PackageDocumentError);
  });
});
