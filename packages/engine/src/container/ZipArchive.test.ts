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
    expect(opf).toContain("Pagina Minimal Test Fixture");

    const nav = await archive.requireEntry("OEBPS/nav.xhtml").readText();
    expect(nav).toContain('epub:type="toc"');

    const chapter = await archive.requireEntry("OEBPS/chapter1.xhtml").readText();
    expect(chapter).toContain("Hello, Pagina!");
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
});
