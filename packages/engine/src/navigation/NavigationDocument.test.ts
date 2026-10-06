// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { EpubContainer } from "../container/EpubContainer.js";
import { NavigationDocument, NavigationDocumentError } from "./NavigationDocument.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

const recoveryNcx = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="chapter"><navLabel><text>Compatible chapter</text></navLabel><content src="chapter.xhtml"/></navPoint>
  </navMap><navList><navLabel><text>Illustrations</text></navLabel><navTarget id="figure">
  <navLabel><text>Figure one</text></navLabel><content src="chapter.xhtml#figure"/></navTarget></navList></ncx>`;
const validNav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Modern chapter</a></li></ol></nav></body></html>`;

async function recoveryFixture(
  nav: string | undefined,
  ncx = recoveryNcx,
  guide = "",
): Promise<EpubContainer> {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml":
      strToU8(`<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "EPUB/package.opf":
      strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:original-nav-recovery</dc:identifier>
      <dc:title>Original navigation recovery</dc:title><dc:language>en</dc:language></metadata><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine toc="ncx"><itemref idref="chapter"/></spine>${guide}</package>`),
    "EPUB/toc.ncx": strToU8(ncx),
    "EPUB/chapter.xhtml": strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><p id="figure">Original content</p></body></html>`,
    ),
  };
  if (nav !== undefined) files["EPUB/nav.xhtml"] = strToU8(nav);
  return EpubContainer.open(zipSync(files, { level: 0 }));
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

  it.each([
    ["missing", undefined],
    ["malformed", "<html"],
    ["missing toc", '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>'],
    ["empty toc", validNav.replace('<li><a href="chapter.xhtml">Modern chapter</a></li>', "")],
  ])("uses NCX for a %s Nav, retaining a visible recovery diagnostic", async (_name, xml) => {
    const nav = await NavigationDocument.load(await recoveryFixture(xml));
    expect(nav.toc.items[0]?.label).toBe("Compatible chapter");
    expect(nav.diagnostics).toHaveLength(1);
    expect(nav.additionalLists[0]).toMatchObject({
      label: "Illustrations",
      items: [{ path: "EPUB/chapter.xhtml", fragment: "figure", label: "Figure one" }],
    });
  });

  it("keeps valid modern Nav primary and does not duplicate NCX lists", async () => {
    const nav = await NavigationDocument.load(await recoveryFixture(validNav));
    expect(nav.toc.items[0]?.label).toBe("Modern chapter");
    expect(nav.additionalLists).toEqual([]);
    expect(nav.diagnostics).toEqual([]);
  });

  it("fails explicitly when neither declared navigation resource can be processed", async () => {
    await expect(NavigationDocument.load(await recoveryFixture("<html", "<ncx"))).rejects.toThrow(
      NavigationDocumentError,
    );
  });

  it("maps OPF2 guide targets into landmarks, resolving fragments and merging duplicate roles", async () => {
    const guide = `<guide><reference type="text" title="Start" href="chapter.xhtml#figure"/>
      <reference type="loi" title="Same destination" href="chapter.xhtml#figure"/>
      <reference type="cover" title="Cover" href="chapter.xhtml"/></guide>`;
    const nav = await NavigationDocument.load(await recoveryFixture(validNav, recoveryNcx, guide));
    expect(nav.landmarks?.items).toHaveLength(2);
    expect(nav.landmarks?.items[0]).toMatchObject({
      label: "Start",
      path: "EPUB/chapter.xhtml",
      fragment: "figure",
      epubTypes: ["bodymatter", "loi"],
    });
  });

  it("does not supplement an authored modern landmarks list with a superseded guide", async () => {
    const modern = validNav.replace(
      "</body>",
      `<nav epub:type="landmarks"><ol><li><a href="chapter.xhtml">Modern landmark</a></li></ol></nav></body>`,
    );
    const nav = await NavigationDocument.load(
      await recoveryFixture(
        modern,
        recoveryNcx,
        '<guide><reference type="cover" title="Old cover" href="chapter.xhtml"/></guide>',
      ),
    );
    expect(nav.landmarks?.items.map((item) => item.label)).toEqual(["Modern landmark"]);
  });
});

describe("NavigationDocument.parseNavDocument", () => {
  it("retains semantic landmark tokens with an alternate EPUB namespace prefix", () => {
    const xml = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:e="http://www.idpf.org/2007/ops">
      <body><nav e:type="toc"><ol><li><a href="book.xhtml">Book</a></li></ol></nav>
      <nav e:type="landmarks"><ol>
        <li><a e:type="bodymatter chapter" href="book.xhtml#start">Read</a></li>
        <li><a e:type="backmatter" href="book.xhtml#back">Afterword</a></li>
      </ol></nav></body></html>`;
    const navigation = NavigationDocument.parseNavDocument(xml, "nav.xhtml");
    expect(navigation.landmarks?.items.map(point => point.epubTypes)).toEqual([
      ["bodymatter", "chapter"], ["backmatter"],
    ]);
    expect(navigation.toc.items[0]?.epubTypes).toEqual([]);
  });

  it.each([
    ["arriv%C3%A9e", "arrivée"],
    ["literal%2520id", "literal%20id"],
    ["section%23two%3Fend", "section#two?end"],
  ])("decodes %s once in the TOC, page list and landmarks", (fragment, id) => {
    const list = (type: string) =>
      `<nav epub:type="${type}"><ol><li><a href="ch%23one.xhtml#${fragment}">Destination</a></li></ol></nav>`;
    const xml = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body>${["toc", "page-list", "landmarks"].map(list).join("")}</body></html>`;
    const nav = NavigationDocument.parseNavDocument(xml, "OEBPS/nav.xhtml");
    for (const list of [nav.toc, nav.pageList!, nav.landmarks!]) {
      expect(list.items[0]).toMatchObject({ path: "OEBPS/ch#one.xhtml", fragment: id });
      expect(list.items[0]!.target).toBe(`OEBPS/ch#one.xhtml#${id}`);
    }
  });

  it("distinguishes an encoded hash in a filename from the navigation fragment", () => {
    const xml = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body><nav epub:type="toc"><ol><li>
        <a href="ch%23one.xhtml#section">Chapter</a>
      </li></ol></nav></body>
    </html>`;

    const item = NavigationDocument.parseNavDocument(xml, "OEBPS/nav.xhtml").toc.items[0]!;

    expect(item.path).toBe("OEBPS/ch#one.xhtml");
    expect(item.fragment).toBe("section");
  });

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

describe("NavigationDocument.parseNcx", () => {
  it("decodes nested navigation and page targets exactly once", () => {
    const xml = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
      <navMap><navPoint><navLabel><text>Arrival</text></navLabel><content src="ch.xhtml#arriv%C3%A9e"/>
        <navPoint><navLabel><text>Literal percent</text></navLabel><content src="ch.xhtml#literal%2520id"/></navPoint>
      </navPoint></navMap>
      <pageList><pageTarget><navLabel><text>1</text></navLabel><content src="ch.xhtml#arriv%C3%A9e"/></pageTarget></pageList>
    </ncx>`;
    const nav = NavigationDocument.parseNcx(xml, "OEBPS/toc.ncx");
    expect(nav.toc.items[0]!.fragment).toBe("arrivée");
    expect(nav.toc.items[0]!.children[0]!.fragment).toBe("literal%20id");
    expect(nav.pageList!.items[0]!.fragment).toBe("arrivée");
  });
});
