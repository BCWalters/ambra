import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importBook } from "./BookImporter.js";
import type { LibraryDatabase } from "./LibraryDatabase.js";

const png = new Uint8Array(readFileSync(fileURLToPath(new NodeURL(
  "../../../../packages/engine/test/fixtures/fixed-layout-epub-src/OEBPS/images/cover.png", import.meta.url,
))));
const svg = strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="#805020"/></svg>');

function publication({
  metadata = '<meta name="cover" content="legacy-cover"/>',
  manifest = '<item id="legacy-cover" href="../images/cover.png" media-type="image/png"/>',
  resources = { "images/cover.png": png },
  version = "2.0",
}: {
  metadata?: string;
  manifest?: string;
  resources?: Record<string, Uint8Array>;
  version?: string;
} = {}): Uint8Array {
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`),
    "EPUB/package.opf": strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="uid">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="uid">urn:ambra:synthetic-cover</dc:identifier>
        <dc:title>Synthetic cover book</dc:title><dc:creator>Ambra tests</dc:creator><dc:language>en</dc:language>
        ${metadata}
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>${manifest}</manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`),
    "EPUB/chapter.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Test</title></head><body><p>Original synthetic text.</p></body></html>'),
    ...resources,
  }, { level: 0 });
}

const file = (bytes: Uint8Array) => new File([new Uint8Array(bytes)], "synthetic.epub", { type: "application/epub+zip" });
const library = () => ({
  addBook: vi.fn<LibraryDatabase["addBook"]>().mockResolvedValue({ id: "saved", outcome: "added" }),
});

describe("EPUB metadata cover import with the real package and resource APIs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves the EPUB2 cover ID and OPF-relative image path without rewriting the publication", async () => {
    const bytes = publication({ metadata: '<meta name="cover" content="  id-1333544245392521156  "/>',
      manifest: '<item id="id-1333544245392521156" href="../images/cover.png" media-type="image/png"/>' });
    const db = library();
    const phases = vi.fn();
    await expect(importBook(db, file(bytes), phases)).resolves.toEqual({ id: "saved", outcome: "added" });
    const [storedFile, metadata, cover] = db.addBook.mock.calls[0]!;
    expect(new Uint8Array(await storedFile.arrayBuffer())).toEqual(bytes);
    expect(metadata).toMatchObject({ title: "Synthetic cover book", creator: "Ambra tests", fileName: "synthetic.epub" });
    expect(cover?.type).toBe("image/png");
    expect(new Uint8Array(await cover!.arrayBuffer())).toEqual(png);
    expect(phases.mock.calls).toEqual([["processing"], ["saving"]]);
  });

  it.each(["image/jpeg", "image/png", "image/gif", "image/svg+xml", "image/webp", "image/avif", "image/bmp"])(
    "accepts the supported %s declaration and preserves resource bytes and MIME type", async (mediaType) => {
      const db = library();
      // Selection is based on the declaration; image decoding remains the existing cover renderer's job.
      await importBook(db, file(publication({
        manifest: `<item id="legacy-cover" href="cover" media-type="${mediaType}"/>`,
        resources: { "EPUB/cover": mediaType === "image/svg+xml" ? svg : png },
      })));
      const cover = db.addBook.mock.calls[0]![2]!;
      expect(cover.type).toBe(mediaType);
      expect(new Uint8Array(await cover.arrayBuffer())).toEqual(mediaType === "image/svg+xml" ? svg : png);
    },
  );

  it.each(["2.0", "3.0"])("prefers the EPUB3 cover-image property over legacy metadata in a version %s package", async (version) => {
    const db = library();
    await importBook(db, file(publication({
      version,
      manifest: `<item id="legacy-cover" href="../images/cover.png" media-type="image/png"/>
        <item id="modern-cover" href="modern.svg" media-type="image/svg+xml" properties="cover-image"/>`,
      resources: { "images/cover.png": png, "EPUB/modern.svg": svg },
    })));
    const cover = db.addBook.mock.calls[0]![2]!;
    expect(cover.type).toBe("image/svg+xml");
    expect(new Uint8Array(await cover.arrayBuffer())).toEqual(svg);
  });

  it.each([
    "",
    '<meta name="cover"/>',
    '<meta name="cover" content=" "/>',
    '<meta property="cover" refines="#chapter">legacy-cover</meta>',
  ])("imports without a cover when no publication-level cover ID is supplied: %s", async (metadata) => {
    const db = library();
    await importBook(db, file(publication({ metadata, resources: {} })));
    expect(db.addBook.mock.calls[0]![2]).toBeUndefined();
  });

  it.each([
    "",
    '<item id="legacy-cover" href="absent.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="legacy-cover" href="absent.bin" media-type="application/octet-stream"/>',
    '<item id="legacy-cover" href="absent.tiff" media-type="image/tiff"/>',
    '<item id="legacy-cover" href="absent.jp2" media-type="image/jp2"/>',
    '<item id="legacy-cover" href="absent.unknown" media-type="image/unknown"/>',
  ])("reports invalid legacy references without loading non-cover resources or blocking import: %s", async (manifest) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = library();
    await importBook(db, file(publication({ manifest, resources: {} })));
    expect(db.addBook).toHaveBeenCalledOnce();
    expect(db.addBook.mock.calls[0]![2]).toBeUndefined();
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      "Ambra ignored a cover declaration that does not reference a supported image.", "legacy-cover",
    );
  });

  it("propagates a missing declared image resource instead of storing a success-shaped cover fallback", async () => {
    const db = library();
    const phases = vi.fn();
    await expect(importBook(db, file(publication({ resources: {} })), phases)).rejects.toThrow("images/cover.png");
    expect(db.addBook).not.toHaveBeenCalled();
    expect(phases.mock.calls).toEqual([["processing"]]);
  });

  it.each([false, true])("propagates corrupt selected resource errors without saving or falling back (EPUB3: %s)", async (modern) => {
    const bytes = publication({
      manifest: `<item id="legacy-cover" href="../images/cover.png" media-type="image/png"/>
        <item id="svg-cover" href="cover.svg" media-type="image/svg+xml"${modern ? ' properties="cover-image"' : ""}/>`,
      metadata: `<meta name="cover" content="${modern ? "legacy-cover" : "svg-cover"}"/>`,
      resources: { "images/cover.png": png, "EPUB/cover.svg": svg },
    });
    const offset = bytes.findIndex((_byte, index) => svg.every((byte, part) => bytes[index + part] === byte));
    expect(offset).toBeGreaterThan(0);
    bytes[offset] = bytes[offset]! ^ 1;
    const db = library();
    const phases = vi.fn();
    await expect(importBook(db, file(bytes), phases)).rejects.toThrow(/CRC-32 mismatch.*EPUB\/cover\.svg/);
    expect(db.addBook).not.toHaveBeenCalled();
    expect(phases.mock.calls).toEqual([["processing"]]);
  });

  it("preserves duplicate outcomes and storage failures after selecting a legacy cover", async () => {
    const db = library();
    db.addBook.mockResolvedValueOnce({ id: "existing", outcome: "existing" });
    await expect(importBook(db, file(publication()))).resolves.toEqual({ id: "existing", outcome: "existing" });
    db.addBook.mockRejectedValueOnce(new DOMException("Storage is full", "QuotaExceededError"));
    await expect(importBook(db, file(publication()))).rejects.toThrow("Storage is full");
  });
});
