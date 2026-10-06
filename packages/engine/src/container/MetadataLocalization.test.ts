// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PackageDocument } from "./PackageDocument.js";
import { metadataTextContext } from "./MetadataLocalization.js";
import { getDescendantElementsByNS, getNamespacedAttribute } from "./Xml.js";

function parse(values: string, packageAttributes = "", metadataAttributes = "", progression = "ltr") {
  return PackageDocument.parse(
    `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0" ${packageAttributes}>
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" ${metadataAttributes}>
        <dc:identifier id="uid">urn:example:book</dc:identifier>
        <dc:language>en</dc:language>${values}
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine page-progression-direction="${progression}"><itemref idref="chapter"/></spine>
    </package>`,
    "EPUB/package.opf",
  );
}

describe("package metadata localization", () => {
  it("inherits package direction and language without changing progression or publication language", () => {
    const pkg = parse('<dc:title id="title">Arabic title</dc:title><dc:creator>Author</dc:creator>', 'dir="rtl" xml:lang="ar"');
    expect(pkg.metadata.localization?.package).toEqual({ direction: "rtl", language: "ar" });
    expect(metadataTextContext(pkg.metadata.localization, "title", pkg.metadata.title)).toMatchObject({ direction: "rtl", language: "ar", id: "title" });
    expect(pkg.metadata.language).toBe("en");
    expect(pkg.pageProgressionDirection).toBe("ltr");
  });

  it("preserves Arabic, Hebrew, Persian and mixed-script overrides and alternate-script refinements", () => {
    const pkg = parse(
      `<dc:title id="title" xml:lang="ar">\u0643\u062a\u0627\u0628 2026</dc:title>
       <dc:creator xml:lang="he">\u05de\u05d7\u05d1\u05e8</dc:creator>
       <dc:creator xml:lang="fa">\u0646\u0648\u06cc\u0633\u0646\u062f\u0647</dc:creator>
       <dc:subject dir="ltr" xml:lang="en">English / \u0627\u0644\u0639\u0631\u0628\u064a\u0629</dc:subject>
       <meta property="alternate-script" refines="#title" xml:lang="en" dir="ltr">English title</meta>
       <meta name="legacy" content="Legacy text" xml:lang="fa"/>`,
      'dir="rtl" xml:lang="ar"',
    );
    expect(pkg.metadata.creators).toEqual(["\u05de\u05d7\u05d1\u05e8", "\u0646\u0648\u06cc\u0633\u0646\u062f\u0647"]);
    expect(pkg.metadata.localization?.dcValues.filter(value => value.key === "creator").map(value => value.language)).toEqual(["he", "fa"]);
    expect(pkg.metadata.localization?.dcValues.find(value => value.key === "subject")).toMatchObject({ direction: "ltr", language: "en" });
    expect(pkg.metadata.localization?.metaValues).toMatchObject([
      { key: "alternate-script", value: "English title", refines: "title", direction: "ltr", language: "en" },
      { key: "legacy", value: "Legacy text", direction: "rtl", language: "fa" },
    ]);
    expect(pkg.metadata.title).toBe("\u0643\u062a\u0627\u0628 2026");
  });

  it("inherits metadata-level overrides and honors explicit unknown language and auto direction", () => {
    const pkg = parse('<dc:title xml:lang="" dir="auto">Unknown language</dc:title><dc:publisher>Publisher</dc:publisher>', 'dir="rtl" xml:lang="ar"', 'dir="ltr" xml:lang="he"');
    expect(metadataTextContext(pkg.metadata.localization, "title", pkg.metadata.title)).toMatchObject({ direction: "auto", language: "" });
    expect(metadataTextContext(pkg.metadata.localization, "publisher", pkg.metadata.publisher)).toMatchObject({ direction: "ltr", language: "he" });
  });

  it("uses automatic direction for missing or unrecognized directions and retains unknown language tags", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pkg = parse('<dc:title>Unknown title</dc:title><dc:creator>Author</dc:creator>', 'dir="sideways" xml:lang="zz"');
      expect(pkg.metadata.localization?.package).toEqual({ direction: "auto", language: "zz" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("using auto"));
      const missing = parse("<dc:title>Title</dc:title>");
      expect(missing.metadata.localization?.package).toEqual({ direction: "auto", language: undefined });
      expect(metadataTextContext(missing.metadata.localization, "title", missing.metadata.title)?.language).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps repeated identical values associated with their own context and the selected publication date", () => {
    const pkg = parse(`<dc:title>Title</dc:title><dc:creator> </dc:creator>
      <dc:creator xml:lang="he">Same author</dc:creator><dc:creator xml:lang="fa">Same author</dc:creator>
      <dc:date xml:lang="he">2026</dc:date><dc:date opf:event="publication" xml:lang="fa">2026</dc:date>`);
    expect(metadataTextContext(pkg.metadata.localization, "creator", pkg.metadata.creators[0], 0)?.language).toBe("he");
    expect(metadataTextContext(pkg.metadata.localization, "creator", pkg.metadata.creators[1], 1)?.language).toBe("fa");
    expect(metadataTextContext(pkg.metadata.localization, "date", pkg.metadata.date)?.language).toBe("fa");
    expect(metadataTextContext(pkg.metadata.localization, "creator", "Different author", 0)).toBeUndefined();
    expect(metadataTextContext(undefined, "title", "Title")).toBeUndefined();
  });

  it("supports namespace wildcard lookups and implicitly bound xml attributes", () => {
    const doc = new DOMParser().parseFromString('<root xmlns:dc="http://purl.org/dc/elements/1.1/" xml:lang="ar"><dc:title>A</dc:title><dc:creator>B</dc:creator><title>C</title></root>', "application/xml");
    expect(getDescendantElementsByNS(doc.documentElement, "http://purl.org/dc/elements/1.1/", "*").map(element => element.localName)).toEqual(["title", "creator"]);
    expect(getNamespacedAttribute(doc.documentElement, "http://www.w3.org/XML/1998/namespace", "lang")).toBe("ar");
  });
});
