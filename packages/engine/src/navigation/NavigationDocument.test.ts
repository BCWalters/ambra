// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { NavigationDocument, NavigationDocumentError } from "./NavigationDocument.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("NavigationDocument.load (EPUB3 Nav Document, nested TOC fixture)", () => {
  it("parses a nested table of contents, including a headless structural heading", async () => {
    const container = await EpubContainer.open(await loadFixture("nested-toc.epub"));
    const nav = await NavigationDocument.load(container);

    expect(nav.toc.items).toHaveLength(1);
    const partOne = nav.toc.items[0]!;
    expect(partOne.label).toBe("Part One");
    expect(partOne.isLinked).toBe(false);
    expect(partOne.path).toBeUndefined();

    expect(partOne.children).toHaveLength(2);
    const [chapter1, chapter2] = partOne.children;
    expect(chapter1!.label).toBe("Chapter 1");
    expect(chapter1!.path).toBe("OEBPS/ch1.xhtml");
    expect(chapter1!.fragment).toBeUndefined();
    expect(chapter2!.label).toBe("Chapter 2");
    expect(chapter2!.path).toBe("OEBPS/ch2.xhtml");
  });

  it("parses a nested sub-section entry with a fragment", async () => {
    const container = await EpubContainer.open(await loadFixture("nested-toc.epub"));
    const nav = await NavigationDocument.load(container);

    const chapter1 = nav.toc.items[0]!.children[0]!;
    expect(chapter1.children).toHaveLength(1);
    expect(chapter1.children[0]!.label).toBe("Chapter 1, Section 1");
    expect(chapter1.children[0]!.path).toBe("OEBPS/ch1.xhtml");
    expect(chapter1.children[0]!.fragment).toBe("s1");
  });

  it("parses the optional landmarks list", async () => {
    const container = await EpubContainer.open(await loadFixture("nested-toc.epub"));
    const nav = await NavigationDocument.load(container);

    expect(nav.landmarks?.items.map((item) => item.label)).toEqual(["Cover", "Start of Content"]);
    expect(nav.landmarks?.items[0]?.path).toBe("OEBPS/cover.xhtml");
  });

  it("parses the optional page-list, with fragments", async () => {
    const container = await EpubContainer.open(await loadFixture("nested-toc.epub"));
    const nav = await NavigationDocument.load(container);

    expect(nav.pageList?.items.map((item) => item.label)).toEqual(["1", "2", "3"]);
    expect(nav.pageList?.items[0]?.fragment).toBe("page1");
  });
});

describe("NavigationDocument.load (NCX fallback fixture, no EPUB3 Nav Document)", () => {
  it("parses the NCX navMap as the toc", async () => {
    const container = await EpubContainer.open(await loadFixture("ncx.epub"));
    const nav = await NavigationDocument.load(container);

    expect(nav.toc.items).toHaveLength(2);
    expect(nav.toc.items[0]!.label).toBe("Chapter 1");
    expect(nav.toc.items[0]!.path).toBe("OEBPS/ch1.xhtml");
  });

  it("parses nested navPoints", async () => {
    const container = await EpubContainer.open(await loadFixture("ncx.epub"));
    const nav = await NavigationDocument.load(container);

    const chapter1 = nav.toc.items[0]!;
    expect(chapter1.children).toHaveLength(1);
    expect(chapter1.children[0]!.label).toBe("Chapter 1, Section 1");
    expect(chapter1.children[0]!.fragment).toBe("s1");
  });

  it("parses the NCX pageList", async () => {
    const container = await EpubContainer.open(await loadFixture("ncx.epub"));
    const nav = await NavigationDocument.load(container);

    expect(nav.pageList?.items.map((item) => item.label)).toEqual(["1", "2"]);
    expect(nav.pageList?.items[0]?.fragment).toBe("page1");
  });

  it("has no landmarks (NCX has no equivalent concept)", async () => {
    const container = await EpubContainer.open(await loadFixture("ncx.epub"));
    const nav = await NavigationDocument.load(container);

    expect(nav.landmarks).toBeUndefined();
  });
});

describe("NavigationDocument.load error handling", () => {
  it("throws NavigationDocumentError when neither a Nav Document nor an NCX is declared", async () => {
    const container = await EpubContainer.open(await loadFixture("no-navigation.epub"));

    await expect(NavigationDocument.load(container)).rejects.toThrow(NavigationDocumentError);
  });
});

describe("NavigationDocument.parseNavDocument error handling", () => {
  it('throws NavigationDocumentError when there is no <nav epub:type="toc">', () => {
    const xml = `<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
        <body>
          <nav epub:type="landmarks"><ol><li><a href="cover.xhtml">Cover</a></li></ol></nav>
        </body>
      </html>`;

    expect(() => NavigationDocument.parseNavDocument(xml, "OEBPS/nav.xhtml")).toThrow(
      NavigationDocumentError,
    );
  });
});
