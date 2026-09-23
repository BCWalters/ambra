import { afterEach, describe, expect, it, vi } from "vitest";
import formatXml from "xml-formatter";
import {
  buildInspectorSourceMap,
  inspectorElementAtOffset,
  inspectorElementForPath,
} from "./InspectorSourceMap.js";

afterEach(() => vi.restoreAllMocks());

describe("buildInspectorSourceMap", () => {
  it("returns precise half-open ranges, including attributes and closing tags", () => {
    const text = '<root title="a > b" other=\'quoted " >\'><child attr="1" />word</root>';
    const childStart = text.indexOf("<child");
    const childEnd = text.indexOf("/>") + 2;
    expect(buildInspectorSourceMap(text)).toEqual([
      { elementPath: [], start: 0, openingEnd: childStart, end: text.length },
      { elementPath: [0], start: childStart, openingEnd: childEnd, end: childEnd },
    ]);
  });

  it("maps repeated, idless elements by Element.children rather than text or identity", () => {
    const text = "<root>same<!--comment--><p>same<b>same</b></p>same<p>same</p></root>";
    const elements = buildInspectorSourceMap(text);
    expect(elements.map((element) => element.elementPath)).toEqual([[], [0], [0, 0], [1]]);
    expect(text.slice(elements[1]!.start, elements[1]!.end)).toBe("<p>same<b>same</b></p>");
    expect(text.slice(elements[3]!.start, elements[3]!.end)).toBe("<p>same</p>");
  });

  it("preserves paths after pretty-printing XHTML", () => {
    const text = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Title</title></head><body><p>same</p><p><em>same</em></p><br/></body></html>';
    const formatted = formatXml(text, { indentation: "  " });
    const originalElements = buildInspectorSourceMap(text);
    const formattedElements = buildInspectorSourceMap(formatted);
    expect(formattedElements.map((element) => element.elementPath))
      .toEqual(originalElements.map((element) => element.elementPath));
    expect(formattedElements.map((element) => formatted.slice(element.start, element.openingEnd)))
      .toEqual(originalElements.map((element) => text.slice(element.start, element.openingEnd)));
    expect(formattedElements[3]!.start).not.toBe(originalElements[3]!.start);
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0"/></g><circle/></svg>',
    '<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:g><s:path/></s:g><s:circle/></s:svg>',
    "<Book><Chapter><Section/></Chapter><Chapter/></Book>",
    "<本><章><段/></章><章/></本>",
  ])("maps XML and SVG roots without inserting HTML wrappers: %s", (text) => {
    expect(buildInspectorSourceMap(text).map((element) => element.elementPath))
      .toEqual([[], [0], [0, 0], [1]]);
  });

  it("ignores declarations, comments and processing instructions", () => {
    const text = '\uFEFF<?xml version="1.0"?>\n<!DOCTYPE root SYSTEM "urn:test">\n'
      + '<!-- <fake/> &custom; --><?before instruction?>'
      + '<root><?inside instruction?><!-- <fake/> --><real/></root><?after done?>';
    const elements = buildInspectorSourceMap(text);
    expect(elements.map((element) => element.elementPath)).toEqual([[], [0]]);
    expect(elements[0]!.start).toBe(text.indexOf("<root>"));
    expect(elements[0]!.end).toBe(text.indexOf("</root>") + "</root>".length);
    expect(elements[1]!.start).toBe(text.indexOf("<real/>"));
  });

  it("handles quoted doctype delimiters and markup inside processing instructions", () => {
    // happy-dom terminates these tokens early. Verify the lexer against the
    // equivalent element tree instead of depending on those parser limitations.
    const document = new DOMParser().parseFromString("<root><real/></root>", "application/xhtml+xml");
    vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(document);
    const text = '<!DOCTYPE root SYSTEM "urn:test[>"><?before <fake/> ?>'
      + '<root><?inside <fake/> ?><real/></root>';
    const elements = buildInspectorSourceMap(text);
    expect(elements.map((element) => element.elementPath)).toEqual([[], [0]]);
    expect(elements[0]!.start).toBe(text.indexOf("<root>"));
    expect(elements[1]!.start).toBe(text.indexOf("<real/>"));
  });

  it("does not treat CDATA content as tags or entities", () => {
    // happy-dom rejects valid XML CDATA. Supply its equivalent DOM to exercise
    // the lexer and correspondence check without weakening production parsing.
    const document = new DOMParser().parseFromString("<root><real/></root>", "application/xhtml+xml");
    document.documentElement.insertBefore(
      document.createTextNode('<fake>&custom; "</root>'),
      document.documentElement.firstChild,
    );
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(document);
    const text = '<root><![CDATA[<fake>&custom; "</root>]]><real/></root>';
    const elements = buildInspectorSourceMap(text);
    expect(parser).toHaveBeenCalledWith(text, "application/xhtml+xml");
    expect(elements.map((element) => element.elementPath)).toEqual([[], [0]]);
    expect(elements[1]!.start).toBe(text.indexOf("<real/>"));
  });

  it("retains source offsets across predefined and numeric entities and non-BMP text", () => {
    const text = '<root title="&quot;&apos;&amp;&lt;&gt;&#62;&#x3e;">😀 &lt;fake/&gt;&#x1F600;<real/></root>';
    const elements = buildInspectorSourceMap(text);
    expect(elements[1]!.start).toBe(text.indexOf("<real/>"));
    expect(elements[1]!.end).toBe(text.indexOf("<real/>") + "<real/>".length);
    expect(elements[0]!.end).toBe(text.length);
  });

  it.each([
    "",
    "plain text",
    "<root>",
    "<root><child></root>",
    "<root></ROOT>",
    "<root/><other/>",
    "before<root/>",
    "<root/>after",
    "<root><!-- unclosed</root>",
    "<root><!-- invalid -- comment --></root>",
    "<root><![CDATA[unclosed</root>",
    "<![CDATA[text]]><root/>",
    "<root>]]></root>",
    "<?unclosed<root/>",
    '<!DOCTYPE root SYSTEM "unclosed><root/>',
    "<!DOCTYPE root><!DOCTYPE root><root/>",
    "<root><!DOCTYPE root></root>",
    "<!unknown><root/>",
    "<root a=unquoted/>",
    '<root a="unclosed/>',
    '<root a="<"/>',
    '<root a="1" a="2"/>',
    '<root a="1"b="2"/>',
    "<root / >",
    "<root></root extra>",
    "<root>bare & text</root>",
    "<root>&unknown;</root>",
    '<root attr="&unknown;"/>',
    "<root>&#0;</root>",
    "<root>&#xD800;</root>",
    "<root>&#x110000;</root>",
  ])("rejects malformed or unsafe XML: %s", (text) => {
    expect(() => buildInspectorSourceMap(text)).toThrow(/Inspector source mapping unavailable:/);
  });

  it.each([
    '<!DOCTYPE root [<!ENTITY item "<child/>">]><root>&item;</root>',
    '<!DOCTYPE root [<!ENTITY % setup SYSTEM "file:///never-load">%setup;]><root/>',
    "<!DOCTYPE root [<!ELEMENT root ANY><!-- ]> <fake/> -->]><root/>",
  ])("rejects internal subsets before any entity expansion: %s", (text) => {
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString");
    expect(() => buildInspectorSourceMap(text)).toThrow(/internal subsets/);
    expect(parser).not.toHaveBeenCalled();
  });

  it.each([
    "<root><extra/><child/></root>",
    "<root/>",
    "<root><other/></root>",
    "<root><child><extra/></child></root>",
  ])("fails closed if the parsed DOM does not match the source: %s", (parsedText) => {
    const document = new DOMParser().parseFromString(parsedText, "application/xhtml+xml");
    vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(document);
    expect(() => buildInspectorSourceMap("<root><child/></root>")).toThrow(/structure differs/);
  });

  it("rejects changed nesting even when element preorder is identical", () => {
    const document = new DOMParser().parseFromString("<root><a/><b/></root>", "application/xhtml+xml");
    vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(document);
    expect(() => buildInspectorSourceMap("<root><a><b/></a></root>")).toThrow(/structure differs/);
  });

  it("allows a legitimate element named parsererror", () => {
    expect(buildInspectorSourceMap("<parsererror/>")).toEqual([
      { elementPath: [], start: 0, openingEnd: 14, end: 14 },
    ]);
  });
});

describe("inspectorElementAtOffset", () => {
  const text = "\n<root><p title='value'>text<b>nested</b>tail</p><empty/></root>\n";
  const elements = buildInspectorSourceMap(text);

  it.each(["<p", "title", "value", "text", "tail", "</p>"])("maps %s to the containing element", (needle) => {
    expect(inspectorElementAtOffset(elements, text.indexOf(needle))?.elementPath).toEqual([0]);
  });

  it.each(["<b>", "nested", "</b>"])("chooses the innermost element for %s", (needle) => {
    expect(inspectorElementAtOffset(elements, text.indexOf(needle))?.elementPath).toEqual([0, 0]);
  });

  it("uses exclusive ends for adjacent tags and the document boundary", () => {
    const empty = elements[3]!;
    expect(inspectorElementAtOffset(elements, empty.start)).toBe(empty);
    expect(inspectorElementAtOffset(elements, empty.end - 1)).toBe(empty);
    expect(inspectorElementAtOffset(elements, empty.end)?.elementPath).toEqual([]);
    expect(inspectorElementAtOffset(elements, elements[0]!.end)).toBeUndefined();
  });

  it.each([-1, 0, text.length, text.length + 1, Number.NaN, Infinity, 1.5])("has no mapping for offset %s", (offset) => {
    expect(inspectorElementAtOffset(elements, offset)).toBeUndefined();
  });

  it("handles an empty map", () => {
    expect(inspectorElementAtOffset([], 0)).toBeUndefined();
  });
});

describe("inspectorElementForPath", () => {
  it("uses the complete structural path, including the root", () => {
    const elements = buildInspectorSourceMap("<root><a><b/></a><a/></root>");
    expect(inspectorElementForPath(elements, [])).toBe(elements[0]);
    expect(inspectorElementForPath(elements, [0, 0])).toBe(elements[2]);
    expect(inspectorElementForPath(elements, [1])).toBe(elements[3]);
    expect(inspectorElementForPath(elements, [0, 1])).toBeUndefined();
    expect(inspectorElementForPath(elements, [0, 0, 0])).toBeUndefined();
    expect(inspectorElementForPath([], [])).toBeUndefined();
  });
});
