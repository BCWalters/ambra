import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Window } from "happy-dom";
import { collectInspectorReferences } from "./InspectorReferences.js";

const settings = (window as unknown as Window).happyDOM.settings;
const previousCSSLoading = settings.disableCSSFileLoading;
const previousDisabledSuccess = settings.handleDisabledFileLoadingAsSuccess;
beforeAll(() => {
  settings.disableCSSFileLoading = true;
  settings.handleDisabledFileLoadingAsSuccess = true;
});
afterAll(() => {
  settings.disableCSSFileLoading = previousCSSLoading;
  settings.handleDisabledFileLoadingAsSuccess = previousDisabledSuccess;
});
afterEach(() => vi.restoreAllMocks());

function targets(source: string, kind: "markup" | "css" = "markup", path = "OEBPS/chapter.xhtml") {
  return collectInspectorReferences(path, source, kind);
}

describe("Inspector markup references", () => {
  it("finds actual usages, repeated occurrences and stylesheet links, not text/comments", () => {
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="styles/main.css"/></head>\n'
      + '<body><!-- <img src="fake.png"/> --><p>src="fake.png"</p>\n'
      + '<img src="images/pic.png"/><img src="images/pic.png"/></body></html>';
    const found = targets(source);
    expect(found.map(item => item.targetPath)).toEqual([
      "OEBPS/styles/main.css", "OEBPS/images/pic.png", "OEBPS/images/pic.png",
    ]);
    expect(found.map(item => item.reference.elementPath)).toEqual([[0, 0], [1, 1], [1, 2]]);
    expect(found[1]!.reference).toMatchObject({ sourcePath: "OEBPS/chapter.xhtml", kind: "markup", line: 3 });
    expect(found[1]!.reference.textRange).toBeUndefined();
  });

  it("supports namespaced SVG hrefs, resource use and CSS presentation attributes", () => {
    const found = targets('<s:svg xmlns:s="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink">'
      + '<s:image x:href="../images/a.svg#shape"/><s:use href="icons.svg#symbol"/>'
      + '<s:rect fill="url(paint.svg#paint)" title="url(fake.svg)"/></s:svg>');
    expect(found.map(item => item.targetPath)).toEqual(["images/a.svg", "OEBPS/icons.svg", "OEBPS/paint.svg"]);
    expect(found.map(item => item.reference.elementPath)).toEqual([[0], [1], [2]]);
  });

  it("decodes XML entities and URL encoding only after separating query/fragment", () => {
    const found = targets('<root><img src="../images/a%20b%23c%3Fd%25.png?v=1&amp;x=2#view"/>'
      + '<img src="&#105;mages/other.png"/></root>', "markup", "OEBPS/part#1/chapter.xhtml");
    expect(found.map(item => item.targetPath)).toEqual([
      "OEBPS/images/a b#c?d%.png", "OEBPS/part#1/images/other.png",
    ]);
  });

  it("respects inherited xml:base and the document base URL", () => {
    const found = targets('<html xmlns="http://www.w3.org/1999/xhtml"><head><base href="../assets/"/></head>'
      + '<body><img src="cover.png"/><div xml:base="nested/"><img src="../other.png"/></div></body></html>');
    expect(found.map(item => item.targetPath)).toEqual(["assets/cover.png", "assets/other.png"]);
  });

  it("preserves the inherited base for empty base declarations", () => {
    const found = targets('<html><head><base href=""/></head><body xml:base="../images/">'
      + '<div xml:base=""><img src="pic.png"/></div></body></html>');
    expect(found.map(item => item.targetPath)).toEqual(["images/pic.png"]);
  });

  it("does not treat external document bases as local archive paths", () => {
    expect(targets('<html><head><base href="https://example.test/book/"/></head><body><img src="a.png"/></body></html>')).toEqual([]);
    expect(targets('<root xml:base="//example.test/"><img src="a.png"/></root>')).toEqual([]);
  });

  it("honors nearest namespace declarations rather than matching any prefixed href", () => {
    const found = targets('<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink">'
      + '<image x:href="a.png"/><g xmlns:x="urn:unrelated"><image x:href="fake.png"/></g></svg>');
    expect(found.map(item => item.targetPath)).toEqual(["OEBPS/a.png"]);
  });

  it("finds srcset candidates with density/width descriptors and skips data URLs", () => {
    const found = targets('<root><source srcset="small.png 1x, large.png 2x, extra.png 1200w"/>'
      + '<img srcset="data:image/png;base64,abcd 1x, local.png 2x"/></root>');
    expect(found.map(item => item.targetPath)).toEqual([
      "OEBPS/small.png", "OEBPS/large.png", "OEBPS/extra.png", "OEBPS/local.png",
    ]);
  });

  it("finds inline styles and style blocks with element paths and original line numbers", () => {
    const source = '<html><head><style>\n/* url(fake.png) */\n'
      + '@import "theme.css";\np { background: url(images/pic.png); }\n</style></head>'
      + '<body><p style="background: url(&quot;inline.png&quot;);">url(fake.png)</p></body></html>';
    const found = targets(source);
    expect(found.map(item => item.targetPath)).toEqual(["OEBPS/theme.css", "OEBPS/images/pic.png", "OEBPS/inline.png"]);
    expect(found.map(item => item.reference.line)).toEqual([3, 4, 5]);
    expect(found.map(item => item.reference.elementPath)).toEqual([[0, 0], [0, 0], [1, 0]]);
  });

  it("ignores non-CSS style blocks and unrelated attribute lookalikes", () => {
    expect(targets('<root><style type="text/plain">url(fake.png)</style><p title="url(fake.png)">image.png</p></root>')).toEqual([]);
  });

  it("handles CDATA style content without treating it as markup", () => {
    // happy-dom lacks XML CDATA parsing; the equivalent DOM preserves CSS text.
    const document = new DOMParser().parseFromString('<root><style/><img src="direct.png"/></root>', "application/xhtml+xml");
    document.querySelector("style")!.textContent = '\np{background:url(image.png)}\n';
    vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(document);
    const found = targets('<root><style><![CDATA[\np{background:url(image.png)}\n]]></style><img src="direct.png"/></root>');
    expect(found.map(item => item.targetPath)).toEqual(["OEBPS/image.png", "OEBPS/direct.png"]);
    expect(found[0]!.reference.line).toBe(2);
  });

  it("retains file/line context when custom entities prevent exact element mapping", () => {
    const document = new DOMParser().parseFromString('<root><img src="image.png"/></root>', "application/xhtml+xml");
    vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(document);
    const found = targets('<!DOCTYPE root [<!ENTITY image "image.png">]>\n<root><img src="&image;"/></root>');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ targetPath: "OEBPS/image.png", reference: { line: 2, kind: "markup" } });
    expect(found[0]!.reference.elementPath).toBeUndefined();
    expect(found[0]!.reference.snippet).toContain('src="&image;"');
  });

  it("reports expanded XML structures rather than silently omitting usages", () => {
    const document = new DOMParser().parseFromString('<root><img src="image.png"/></root>', "application/xhtml+xml");
    vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(document);
    expect(() => targets('<!DOCTYPE root [<!ENTITY image \'<img src="image.png"/>\'>]><root>&image;</root>'))
      .toThrow(/Expanded XML structure/);
  });

  it("rejects malformed XML instead of returning a false empty result", () => {
    expect(() => targets('<root><img src="image.png"></root>')).toThrow(/Malformed XML/);
  });
});

describe("Inspector CSS references", () => {
  it("finds quoted/unquoted url(), imports and repeats, with exact LF-normalized ranges", () => {
    const source = '@import "base.css";\r\n@import url(theme.css) screen;\r\n'
      + 'p{background:url("../img/a.png?v=1#crop"),url(../img/a.png);}\r\n';
    const normalized = source.replace(/\r\n/g, "\n");
    const found = targets(source, "css", "OEBPS/styles/main.css");
    expect(found.map(item => item.targetPath)).toEqual([
      "OEBPS/styles/base.css", "OEBPS/styles/theme.css", "OEBPS/img/a.png", "OEBPS/img/a.png",
    ]);
    expect(found.map(item => item.reference.line)).toEqual([1, 2, 3, 3]);
    expect(found.map(item => {
      const { start, end } = item.reference.textRange!;
      return normalized.slice(start, end);
    })).toEqual(['"base.css"', "url(theme.css)", 'url("../img/a.png?v=1#crop")', "url(../img/a.png)"]);
    expect(found.every(item => item.reference.elementPath === undefined)).toBe(true);
  });

  it("understands CSS escapes in function names, URLs and imports", () => {
    const source = String.raw`@im\70ort "the\6d e.css"; p{background:\75rl(im\61 ge\20 one.png), URL('a\)b.png'),url("fo\
o.png");}`;
    expect(targets(source, "css").map(item => item.targetPath)).toEqual([
      "OEBPS/theme.css", "OEBPS/image one.png", "OEBPS/a)b.png", "OEBPS/foo.png",
    ]);
  });

  it("ignores CSS comments and ordinary strings, including escaped quotes", () => {
    const source = String.raw`/* @import "fake.css"; url(fake.png) */
p { content: "url(fake.png) \" @import 'fake.css'"; background: url(real.png); }`;
    expect(targets(source, "css").map(item => item.targetPath)).toEqual(["OEBPS/real.png"]);
  });

  it("handles comments around import strings and quoted URL closing delimiters", () => {
    expect(targets('@import /*comment*/ "base.css";p{background:url("a)b.png" /*comment*/)}', "css")
      .map(item => item.targetPath)).toEqual(["OEBPS/base.css", "OEBPS/a)b.png"]);
  });

  it.each([
    "https://example.test/a.png",
    "//example.test/a.png",
    "data:image/png;base64,abcd",
    "blob:some-id",
    "file:///image.png",
  ])("excludes non-archive URL %s from markup and CSS", value => {
    expect(targets(`<root><img src="${value}"/></root>`)).toEqual([]);
    expect(targets(`p{background:url("${value}")}`, "css")).toEqual([]);
  });

  it("handles root-relative paths and encoded delimiters without decoding the source path", () => {
    expect(targets('p{background:url("/images/a%23b%3Fc%25.png?x#y")}', "css", "styles/special#?.css")[0]!.targetPath)
      .toBe("images/a#b?c%.png");
  });

  it("excludes escaped external URL schemes and does not mistake longer identifiers for url()", () => {
    const source = String.raw`p{a:myurl(fake.png);b:url(h\74tps://example.test/fake.png);c:1url(fake.png);d:#url(fake.png);e:url(local.png)}`;
    expect(targets(source, "css").map(item => item.targetPath)).toEqual(["OEBPS/local.png"]);
  });

  it("bounds snippets and preserves each occurrence", () => {
    const found = targets(`p{${" ".repeat(400)}background:url(a.png),url(a.png);${" ".repeat(400)}}`, "css");
    expect(found).toHaveLength(2);
    expect(found.every(item => item.reference.snippet.length <= 200)).toBe(true);
    expect(found[0]!.reference.textRange).not.toEqual(found[1]!.reference.textRange);
  });

  it.each(['/* never closed', 'p{content:"never closed}', 'p{background:url(a.png}', 'p{background:url("a.png)}'])(
    "surfaces CSS tokenization errors: %s",
    source => expect(() => targets(source, "css")).toThrow(/Cannot inspect references/),
  );
});
