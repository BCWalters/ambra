import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { zipSync } from "fflate";
import { ZipArchive, ZipFormatError, ZipIntegrityError } from "./ZipArchive.js";
import { singleEntryZipFixture, zip64Envelope, type Zip64FixtureField } from "./ZipTestFixture.js";

const FIXTURE_PATH = fileURLToPath(new URL("../../test/fixtures/minimal.epub", import.meta.url));

async function loadFixtureBytes(): Promise<Uint8Array> {
  const buffer = await readFile(FIXTURE_PATH);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("ZipArchive", () => {
  let fixtureBytes: Uint8Array;

  beforeAll(async () => {
    fixtureBytes = await loadFixtureBytes();
  });

  function mutatedFixture(
    mutate: (view: DataView, eocdOffset: number, directoryOffset: number) => void,
  ): Uint8Array {
    const bytes = Uint8Array.from(fixtureBytes);
    const view = new DataView(bytes.buffer);
    const eocdOffset = bytes.length - 22;
    mutate(view, eocdOffset, view.getUint32(eocdOffset + 16, true));
    return bytes;
  }

  it("lists all entries from a real-world zip file (built by the system `zip` tool)", () => {
    const archive = ZipArchive.open(fixtureBytes);
    const names = archive.entries.map((entry) => entry.fileName).sort();

    expect(names).toEqual(
      [
        "mimetype",
        "META-INF/",
        "META-INF/container.xml",
        "OEBPS/",
        "OEBPS/nav.xhtml",
        "OEBPS/chapter1.xhtml",
        "OEBPS/content.opf",
      ].sort(),
    );
  });

  it("reads a stored (uncompressed) entry back exactly", async () => {
    const archive = ZipArchive.open(fixtureBytes);
    const text = await archive.requireEntry("mimetype").readText();

    expect(text).toBe("application/epub+zip");
  });

  it("reads deflated entries back exactly, matching the original source files", async () => {
    const archive = ZipArchive.open(fixtureBytes);

    const containerXml = await archive.requireEntry("META-INF/container.xml").readText();
    expect(containerXml).toContain('full-path="OEBPS/content.opf"');

    const opf = await archive.requireEntry("OEBPS/content.opf").readText();
    expect(opf).toContain("Ambra Minimal Test Fixture");

    const nav = await archive.requireEntry("OEBPS/nav.xhtml").readText();
    expect(nav).toContain('epub:type="toc"');

    const chapter = await archive.requireEntry("OEBPS/chapter1.xhtml").readText();
    expect(chapter).toContain("Hello, Ambra!");
  });

  it("treats directory entries as empty, non-throwing reads", async () => {
    const archive = ZipArchive.open(fixtureBytes);
    const dirEntry = archive.requireEntry("META-INF/");

    expect(dirEntry.isDirectory).toBe(true);
    expect(dirEntry.uncompressedSize).toBe(0);
    await expect(dirEntry.read()).resolves.toEqual(new Uint8Array(0));
  });

  it("throws ZipFormatError for a missing entry via requireEntry", () => {
    const archive = ZipArchive.open(fixtureBytes);
    expect(() => archive.requireEntry("does/not/exist.xml")).toThrow(ZipFormatError);
  });

  it("returns undefined for a missing entry via getEntry", () => {
    const archive = ZipArchive.open(fixtureBytes);
    expect(archive.getEntry("does/not/exist.xml")).toBeUndefined();
  });

  it("throws ZipFormatError when the buffer has no End of Central Directory record", () => {
    const notAZip = new TextEncoder().encode("this is definitely not a zip file");
    expect(() => ZipArchive.open(notAZip)).toThrow(ZipFormatError);
  });

  it("throws ZipIntegrityError when compressed bytes are corrupted", async () => {
    const corrupted = Uint8Array.from(fixtureBytes);
    // Flip a byte inside the *first* local file header's data region (the
    // stored `mimetype` entry begins right after its 30-byte fixed header +
    // an 8-byte file name, so byte 40 lands inside its content).
    corrupted[40] = (corrupted[40] as number) ^ 0xff;

    const archive = ZipArchive.open(corrupted);
    await expect(archive.requireEntry("mimetype").read()).rejects.toThrow(ZipIntegrityError);
  });

  it("ignores signature-looking bytes inside a valid ZIP comment", async () => {
    const commentLength = 30;
    const bytes = new Uint8Array(fixtureBytes.length + commentLength).fill(0x61);
    bytes.set(fixtureBytes);
    const view = new DataView(bytes.buffer);
    view.setUint16(fixtureBytes.length - 2, commentLength, true);
    view.setUint32(fixtureBytes.length, 0x06054b50, true);

    const archive = ZipArchive.open(bytes);

    expect(archive.entries.map((entry) => entry.fileName)).toEqual(
      ZipArchive.open(fixtureBytes).entries.map((entry) => entry.fileName),
    );
    expect(await archive.requireEntry("mimetype").readText()).toBe("application/epub+zip");
  });

  it("does not mistake an EOCD-shaped comment for an empty archive", () => {
    const bytes = new Uint8Array(fixtureBytes.length + 22);
    bytes.set(fixtureBytes);
    const view = new DataView(bytes.buffer);
    view.setUint16(fixtureBytes.length - 2, 22, true);
    view.setUint32(fixtureBytes.length, 0x06054b50, true);

    expect(ZipArchive.open(bytes).entries.map((entry) => entry.fileName)).toEqual(
      ZipArchive.open(fixtureBytes).entries.map((entry) => entry.fileName),
    );
  });

  it("reads an archive supplied as a nonzero-offset view without including surrounding bytes", async () => {
    const surrounding = new Uint8Array(fixtureBytes.length + 64).fill(0xff);
    surrounding.set(fixtureBytes, 32);
    const archive = ZipArchive.open(surrounding.subarray(32, 32 + fixtureBytes.length));

    expect(await archive.requireEntry("mimetype").readText()).toBe("application/epub+zip");
  });

  it("rejects a directory outside the supplied view even if its backing buffer has extra bytes", () => {
    const corrupted = mutatedFixture((view, eocdOffset) => {
      view.setUint32(eocdOffset + 16, fixtureBytes.length + 10, true);
    });
    const surrounding = new Uint8Array(corrupted.length + 1024);
    surrounding.set(corrupted);

    expect(() => ZipArchive.open(surrounding.subarray(0, corrupted.length))).toThrow(
      ZipFormatError,
    );
  });

  it("supports an empty ordinary ZIP archive", () => {
    const bytes = new Uint8Array(22);
    new DataView(bytes.buffer).setUint32(0, 0x06054b50, true);

    expect(ZipArchive.open(bytes).entries).toEqual([]);
  });

  it("rejects a truncated EOCD comment", () => {
    const bytes = mutatedFixture((view, eocdOffset) => {
      view.setUint16(eocdOffset + 20, 1, true);
    });

    expect(() => ZipArchive.open(bytes)).toThrow(ZipFormatError);
  });

  it("rejects a central directory overlapping the EOCD record", () => {
    const bytes = mutatedFixture((view, eocdOffset) => {
      view.setUint32(eocdOffset + 12, view.getUint32(eocdOffset + 12, true) + 1, true);
    });

    expect(() => ZipArchive.open(bytes)).toThrow(ZipFormatError);
  });

  it("rejects truncated central-directory entry headers", () => {
    const bytes = mutatedFixture((view, eocdOffset) => {
      const extraEntryCount = view.getUint16(eocdOffset + 10, true) + 1;
      view.setUint16(eocdOffset + 8, extraEntryCount, true);
      view.setUint16(eocdOffset + 10, extraEntryCount, true);
    });

    expect(() => ZipArchive.open(bytes)).toThrow(ZipFormatError);
  });

  it("rejects variable-length entry fields extending beyond the central directory", () => {
    const bytes = mutatedFixture((view, _eocdOffset, directoryOffset) => {
      view.setUint16(directoryOffset + 28, 0xffff, true);
    });

    expect(() => ZipArchive.open(bytes)).toThrow(ZipFormatError);
  });

  it("reports a missing ZIP64 locator as ZipFormatError", () => {
    const bytes = mutatedFixture((view, eocdOffset) => {
      view.setUint32(eocdOffset + 16, 0xffffffff, true);
    });

    describe("ZIP64 v1 and OCF ZIP constraints", () => {
      const fieldCombinations = [
        [],
        ["uncompressedSize"],
        ["compressedSize"],
        ["localHeaderOffset"],
        ["diskNumber"],
        ["compressedSize", "localHeaderOffset"],
        ["uncompressedSize", "compressedSize", "localHeaderOffset", "diskNumber"],
      ] satisfies readonly Zip64FixtureField[][];
      it.each(fieldCombinations.map((fields) => ({ fields })))(
        "expands only sentinel fields in their specified order: %j",
        async ({ fields }) => {
          const fixture = singleEntryZipFixture({ zip64: true, fields });
          const archive = ZipArchive.open(fixture.bytes);
          archive.validateOcfHeaders();
          expect(archive.entries).toHaveLength(1);
          expect(await archive.requireEntry("file.txt").readText()).toBe("hello");
        },
      );

      it("reads ZIP64 records relative to a supplied nonzero-offset view", async () => {
        const fixture = singleEntryZipFixture({ zip64: true });
        const surrounding = new Uint8Array(fixture.bytes.length + 80);
        surrounding.set(fixture.bytes, 40);
        const archive = ZipArchive.open(surrounding.subarray(40, 40 + fixture.bytes.length));
        expect(await archive.requireEntry("file.txt").readText()).toBe("hello");
      });

      it("supports a ZIP64 entry count above the ZIP32 maximum", async () => {
        const count = 65_536;
        const entries = Object.fromEntries(
          Array.from({ length: count }, (_, index) => [`f${index}`, new Uint8Array()]),
        );
        const archive = ZipArchive.open(zip64Envelope(zipSync(entries, { level: 0 }), count));
        expect(archive.entries).toHaveLength(count);
        expect(await archive.requireEntry(`f${count - 1}`).read()).toEqual(new Uint8Array());
      });

      it.each([24, 32, 40, 48])("rejects unsafe ZIP64 EOCD integers at field %s", (offset) => {
        const fixture = singleEntryZipFixture({ zip64: true });
        new DataView(fixture.bytes.buffer).setBigUint64(
          fixture.zip64EndOffset + offset,
          2n ** 53n,
          true,
        );
        expect(() => ZipArchive.open(fixture.bytes)).toThrow("safe integer");
      });

      it("rejects an unsafe ZIP64 locator offset", () => {
        const fixture = singleEntryZipFixture({ zip64: true });
        new DataView(fixture.bytes.buffer).setBigUint64(
          fixture.zip64LocatorOffset + 8,
          2n ** 53n,
          true,
        );
        expect(() => ZipArchive.open(fixture.bytes)).toThrow("safe integer");
      });

      it("rejects unsafe extended-information sizes before decompression", () => {
        const fixture = singleEntryZipFixture({ zip64: true });
        new DataView(fixture.bytes.buffer).setBigUint64(
          fixture.centralExtraOffset + 4,
          2n ** 53n,
          true,
        );
        expect(() => ZipArchive.open(fixture.bytes)).toThrow("safe integer");
      });

      it("rejects a truncated ZIP64 record and unsupported version 2", () => {
        const short = singleEntryZipFixture({ zip64: true });
        new DataView(short.bytes.buffer).setBigUint64(short.zip64EndOffset + 4, 43n, true);
        expect(() => ZipArchive.open(short.bytes)).toThrow("bounds");
        const version2 = singleEntryZipFixture({ zip64: true });
        new DataView(version2.bytes.buffer).setUint16(version2.zip64EndOffset + 14, 62, true);
        expect(() => ZipArchive.open(version2.bytes)).toThrow("only v1");
      });

      it("rejects missing and truncated ZIP64 entry extra fields", () => {
        const missing = singleEntryZipFixture({ zip64: true });
        new DataView(missing.bytes.buffer).setUint16(missing.centralExtraOffset, 2, true);
        expect(() => ZipArchive.open(missing.bytes)).toThrow("Missing required ZIP64");
        const short = singleEntryZipFixture({ zip64: true, fields: ["uncompressedSize"] });
        new DataView(short.bytes.buffer).setUint16(short.centralExtraOffset + 2, 7, true);
        new DataView(short.bytes.buffer).setUint16(short.directoryOffset + 30, 11, true);
        expect(() => ZipArchive.open(short.bytes)).toThrow("Truncated ZIP64");
      });

      it.each([16, 20])("rejects ZIP64 multi-disk fields at offset %s", (offset) => {
        const fixture = singleEntryZipFixture({ zip64: true });
        new DataView(fixture.bytes.buffer).setUint32(fixture.zip64EndOffset + offset, 1, true);
        expect(() => ZipArchive.open(fixture.bytes)).toThrow("Multi-disk");
      });

      it("rejects a multi-disk ZIP64 locator and inconsistent legacy count", () => {
        const fixture = singleEntryZipFixture({ zip64: true });
        const view = new DataView(fixture.bytes.buffer);
        view.setUint32(fixture.zip64LocatorOffset + 16, 2, true);
        expect(() => ZipArchive.open(fixture.bytes)).toThrow("Multi-disk");
        view.setUint32(fixture.zip64LocatorOffset + 16, 1, true);
        view.setUint16(fixture.endOffset + 10, 2, true);
        expect(() => ZipArchive.open(fixture.bytes)).toThrow("disagree");
      });

      it.each([1, 0x40, 0x2000])("rejects native encryption flag %s in either header", (flag) => {
        const central = singleEntryZipFixture();
        new DataView(central.bytes.buffer).setUint16(central.directoryOffset + 8, flag, true);
        expect(() => ZipArchive.open(central.bytes)).toThrow("encryption");
        const local = singleEntryZipFixture();
        new DataView(local.bytes.buffer).setUint16(6, flag, true);
        expect(() => ZipArchive.open(local.bytes).validateOcfHeaders()).toThrow("encryption");
      });

      it.each([0, 21, 46, 62])("rejects unsupported version %s in either header", (version) => {
        const central = singleEntryZipFixture();
        new DataView(central.bytes.buffer).setUint16(central.directoryOffset + 6, version, true);
        expect(() => ZipArchive.open(central.bytes)).toThrow("version-needed-to-extract");
        const local = singleEntryZipFixture();
        new DataView(local.bytes.buffer).setUint16(4, version, true);
        expect(() => ZipArchive.open(local.bytes).validateOcfHeaders()).toThrow(
          "version-needed-to-extract",
        );
      });

      it.each([1, 9, 99])("rejects unsupported compression method %s", (method) => {
        const fixture = singleEntryZipFixture({ method });
        expect(() => ZipArchive.open(fixture.bytes)).toThrow("Unsupported compression");
      });

      it("requires strict UTF-8 names without stripping a filename's BOM character", async () => {
        expect(() =>
          ZipArchive.open(singleEntryZipFixture({ nameBytes: new Uint8Array([0xff]) }).bytes),
        ).toThrow("UTF-8");
        const archive = ZipArchive.open(singleEntryZipFixture({ name: "\uFEFFfile.txt" }).bytes);
        expect(await archive.requireEntry("\uFEFFfile.txt").readText()).toBe("hello");
        expect(archive.getEntry("file.txt")).toBeUndefined();
      });

      for (const width of [32, 64] as const) {
        for (const signed of [false, true]) {
          it(`reads ${signed ? "signed" : "unsigned"} ${width}-bit data descriptors`, async () => {
            const fixture = singleEntryZipFixture({
              zip64: width === 64,
              descriptor: width,
              signedDescriptor: signed,
            });
            const archive = ZipArchive.open(fixture.bytes);
            archive.validateOcfHeaders();
            expect(await archive.requireEntry("file.txt").readText()).toBe("hello");
          });
        }
      }

      it("rejects a descriptor that disagrees with central metadata", () => {
        const fixture = singleEntryZipFixture({ descriptor: 32 });
        new DataView(fixture.bytes.buffer).setUint32(fixture.descriptorOffset + 4, 123, true);
        expect(() => ZipArchive.open(fixture.bytes).validateOcfHeaders()).toThrow(
          "data descriptor",
        );
      });

      it.each([
        { maxEntryCount: 0 },
        { maxEntryUncompressedBytes: 4 },
        { maxTotalUncompressedBytes: 4 },
      ])("enforces configured resource limits: %j", (limits) => {
        expect(() => ZipArchive.open(singleEntryZipFixture().bytes, limits)).toThrow("configured");
      });

      it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
        "rejects invalid limits: %s",
        (limit) => {
          expect(() =>
            ZipArchive.open(singleEntryZipFixture().bytes, { maxEntryCount: limit }),
          ).toThrow(RangeError);
        },
      );

      it("bounds actual Deflate output rather than trusting declared small sizes", async () => {
        const data = new Uint8Array(32_768).fill(65);
        const fixture = singleEntryZipFixture({
          data,
          compressedData: deflateRawSync(data),
          method: 8,
        });
        const view = new DataView(fixture.bytes.buffer);
        view.setUint32(22, 1, true);
        view.setUint32(fixture.directoryOffset + 24, 1, true);
        const archive = ZipArchive.open(fixture.bytes, { maxEntryUncompressedBytes: 1 });
        await expect(archive.requireEntry("file.txt").read()).rejects.toThrow(
          "Deflate output exceeds",
        );
      });

      it("preserves successful Deflate and CRC verification for ZIP64 entries", async () => {
        const data = new TextEncoder().encode("ZIP64 Deflate content ".repeat(200));
        const fixture = singleEntryZipFixture({
          data,
          compressedData: deflateRawSync(data),
          method: 8,
          zip64: true,
        });
        const archive = ZipArchive.open(fixture.bytes);
        archive.validateOcfHeaders();
        expect(await archive.requireEntry("file.txt").read()).toEqual(data);
      });
    });

    expect(() => ZipArchive.open(bytes)).toThrow(ZipFormatError);
  });

  it("reports unsupported multi-disk records as ZipFormatError", () => {
    const bytes = mutatedFixture((view, eocdOffset) => {
      view.setUint16(eocdOffset + 4, 1, true);
    });

    expect(() => ZipArchive.open(bytes)).toThrow(ZipFormatError);
  });

  it("rejects a local header outside the supplied view rather than reading its backing buffer", async () => {
    const bytes = mutatedFixture((view, _eocdOffset, directoryOffset) => {
      view.setUint32(directoryOffset + 42, fixtureBytes.length - 4, true);
    });
    const surrounding = new Uint8Array(bytes.length + 100);
    surrounding.set(bytes);
    const archive = ZipArchive.open(surrounding.subarray(0, bytes.length));

    await expect(archive.requireEntry("mimetype").read()).rejects.toThrow(ZipFormatError);
  });

  it("rejects local variable-length fields extending beyond the archive", async () => {
    const bytes = mutatedFixture((view) => {
      view.setUint16(26, 0xffff, true);
    });
    const archive = ZipArchive.open(bytes);

    await expect(archive.requireEntry("mimetype").read()).rejects.toThrow(ZipFormatError);
  });

  it("rejects compressed data extending beyond the archive instead of truncating the subarray", async () => {
    const bytes = mutatedFixture((view, _eocdOffset, directoryOffset) => {
      view.setUint32(directoryOffset + 20, fixtureBytes.length, true);
    });
    const archive = ZipArchive.open(bytes);

    await expect(archive.requireEntry("mimetype").read()).rejects.toThrow(ZipFormatError);
  });

  it("verifies the recorded uncompressed size even when the CRC matches", async () => {
    const bytes = mutatedFixture((view, _eocdOffset, directoryOffset) => {
      view.setUint32(directoryOffset + 24, view.getUint32(directoryOffset + 24, true) + 1, true);
    });
    const archive = ZipArchive.open(bytes);

    await expect(archive.requireEntry("mimetype").read()).rejects.toThrow(ZipIntegrityError);
  });
});
