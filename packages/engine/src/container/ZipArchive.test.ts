import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ZipArchive, ZipFormatError, ZipIntegrityError } from "./ZipArchive.js";

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

    expect(() => ZipArchive.open(surrounding.subarray(0, corrupted.length))).toThrow(ZipFormatError);
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

  it("reports unsupported ZIP64 directory offsets as ZipFormatError", () => {
    const bytes = mutatedFixture((view, eocdOffset) => {
      view.setUint32(eocdOffset + 16, 0xffffffff, true);
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
