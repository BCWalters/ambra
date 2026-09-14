// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer, EpubContainerError } from "./EpubContainer.js";

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

  it("resolves the OPF rootfile path from META-INF/container.xml", async () => {
    const container = await EpubContainer.open(fixtureBytes);
    expect(container.rootFilePath).toBe("OEBPS/content.opf");
  });

  it("exposes the resolved OPF entry, readable as text", async () => {
    const container = await EpubContainer.open(fixtureBytes);
    const opfText = await container.getRootFileEntry().readText();

    expect(opfText).toContain("Pagina Minimal Test Fixture");
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
