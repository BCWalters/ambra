// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer, EpubContainerError } from "./EpubContainer.js";
import { strToU8, zipSync, type Zippable } from "fflate";
import { zip64Envelope } from "./ZipTestFixture.js";

const FIXTURE_PATH = fileURLToPath(
  new NodeURL("../../test/fixtures/minimal.epub", import.meta.url),
);

async function loadFixtureBytes(): Promise<Uint8Array> {
  const buffer = await readFile(FIXTURE_PATH);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("EpubContainer", () => {
  let fixtureBytes: Uint8Array;

  beforeAll(async () => {
    fixtureBytes = await loadFixtureBytes();
  });

  describe("OCF mimetype and ZIP64 containers", () => {
    function publication(
      mimetype: string | null = "application/epub+zip",
      compressed = false,
      extra = false,
    ) {
      const files: Zippable = {};
      if (mimetype !== null) {
        files.mimetype = [
          strToU8(mimetype),
          {
            level: compressed ? 6 : 0,
            ...(extra ? { extra: { 0xcafe: new Uint8Array([1]) } } : {}),
          },
        ];
      }
      files["META-INF/container.xml"] = strToU8(
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      );
      files["EPUB/package.opf"] = strToU8(
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:zip64</dc:identifier><dc:title>ZIP64 publication</dc:title><dc:language>en</dc:language></metadata><manifest/><spine/></package>',
      );
      return zipSync(files, { level: 0 });
    }

    it("opens a complete small ZIP64 v1 EPUB and parses its package", async () => {
      const container = await EpubContainer.open(zip64Envelope(publication()));
      expect((await container.getPackageDocument()).metadata.title).toBe("ZIP64 publication");
    });

    it.each([
      " application/epub+zip",
      "application/epub+zip\n",
      "\uFEFFapplication/epub+zip",
      "application/zip",
    ])("rejects noncanonical mimetype bytes: %j", async (value) => {
      await expect(EpubContainer.open(publication(value))).rejects.toThrow("must contain exactly");
    });

    it("rejects a missing mimetype", async () => {
      await expect(EpubContainer.open(publication(null))).rejects.toThrow(
        "Missing required OCF entry: mimetype",
      );
    });

    it("rejects compressed and extra-field mimetype entries", async () => {
      await expect(EpubContainer.open(publication("application/epub+zip", true))).rejects.toThrow(
        "first, uncompressed",
      );
      await expect(
        EpubContainer.open(publication("application/epub+zip", false, true)),
      ).rejects.toThrow("no extra field");
    });

    it("rejects a mimetype entry that is not the first physical file", async () => {
      const files: Zippable = {
        "before.txt": strToU8("before"),
        mimetype: strToU8("application/epub+zip"),
      };
      await expect(EpubContainer.open(zipSync(files, { level: 0 }))).rejects.toThrow(
        "first, uncompressed",
      );
    });
  });

  it("resolves the OPF rootfile path from META-INF/container.xml", async () => {
    const container = await EpubContainer.open(fixtureBytes);
    expect(container.rootFilePath).toBe("OEBPS/content.opf");
  });

  it("exposes the resolved OPF entry, readable as text", async () => {
    const container = await EpubContainer.open(fixtureBytes);
    const opfText = await container.getRootFileEntry().readText();

    expect(opfText).toContain("Ambra Minimal Test Fixture");
  });

  it("delegates entry access to the underlying zip archive", async () => {
    const container = await EpubContainer.open(fixtureBytes);
    const mimetype = await container.requireEntry("mimetype").readText();

    expect(mimetype).toBe("application/epub+zip");
    expect(container.getEntry("does/not/exist")).toBeUndefined();
  });

  it("throws EpubContainerError when META-INF/container.xml is missing", async () => {
    const bytes = await readFile(
      fileURLToPath(new NodeURL("../../test/fixtures/no-container.epub", import.meta.url)),
    );

    await expect(EpubContainer.open(bytes)).rejects.toThrow(EpubContainerError);
  });

  it("throws EpubContainerError when container.xml has no <rootfile>", async () => {
    const malformedBytes = await readFile(
      fileURLToPath(new NodeURL("../../test/fixtures/malformed-container.epub", import.meta.url)),
    );

    await expect(EpubContainer.open(malformedBytes)).rejects.toThrow(EpubContainerError);
  });
});
