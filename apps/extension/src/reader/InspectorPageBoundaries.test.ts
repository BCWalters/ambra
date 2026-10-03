import { describe, expect, it, vi } from "vitest";
import { buildInspectorSourceMap } from "./InspectorSourceMap.js";
import { inspectorSourcePointOffset, mapInspectorPageMarkers } from "./InspectorPageBoundaries.js";
import type { InspectorSourcePoint, InspectorVisiblePage } from "./ReaderTypes.js";

function offset(text: string, point: InspectorSourcePoint) {
  return inspectorSourcePointOffset(text, buildInspectorSourceMap(text), point);
}

describe("Inspector page boundary source coordinates", () => {
  it("maps two boundaries inside the same paragraph without rounding to its element", () => {
    const text = "<root><p>One two three four</p></root>";
    expect(offset(text, { elementPath: [0], childIndex: 0, textOffset: 4 })).toBe(text.indexOf("two"));
    expect(offset(text, { elementPath: [0], childIndex: 0, textOffset: 14 })).toBe(text.indexOf("four"));
  });

  it("preserves the original spelling of XML entities and supplementary characters", () => {
    const text = "<root>A&amp;B&#x1F600;C&#10;D</root>";
    expect(offset(text, { elementPath: [], childIndex: 0, textOffset: 2 })).toBe(text.indexOf("B"));
    expect(offset(text, { elementPath: [], childIndex: 0, textOffset: 5 })).toBe(text.indexOf("C"));
    expect(offset(text, { elementPath: [], childIndex: 0, textOffset: 7 })).toBe(text.indexOf("D"));
    expect(() => offset(text, { elementPath: [], childIndex: 0, textOffset: 4 })).toThrow(/splits/);
  });

  it("counts comments, processing instructions, inline elements and CDATA as child nodes", () => {
    const text = "<root>before<!--comment--><?note ok?><em>inside</em><![CDATA[a<b]]>after</root>";
    // happy-dom interprets markup in CDATA; use its equivalent element tree.
    const document = new DOMParser().parseFromString("<root><em>inside</em></root>", "application/xhtml+xml");
    const parser = vi.spyOn(DOMParser.prototype, "parseFromString").mockReturnValue(document);
    try {
      expect(offset(text, { elementPath: [], childIndex: 3 })).toBe(text.indexOf("<em>"));
      expect(offset(text, { elementPath: [], childIndex: 4, textOffset: 2 })).toBe(text.indexOf("b]]>"));
      expect(offset(text, { elementPath: [], childIndex: 5, textOffset: 2 })).toBe(text.indexOf("ter</root>"));
      expect(offset(text, { elementPath: [], childIndex: 6 })).toBe(text.indexOf("</root>"));
      expect(offset(text, { elementPath: [0] })).toBe(text.indexOf("<em>"));
      expect(offset(text, { elementPath: [0], childIndex: 1 })).toBe(text.indexOf("</em>"));
    } finally {
      parser.mockRestore();
    }
  });

  it("maps an exclusive end after the final image and an empty element", () => {
    const text = "<root><img/><img/></root>";
    expect(offset(text, { elementPath: [], childIndex: 2 })).toBe(text.indexOf("</root>"));
    expect(offset(text, { elementPath: [0], childIndex: 0 })).toBe(text.indexOf("<img/>") + 6);
  });

  it("reports precise one-based line and column coordinates for both pages", () => {
    const text = "<root>\n<p>One two three</p>\n</root>";
    const middle = { elementPath: [0], childIndex: 0, textOffset: 4 };
    const pages: InspectorVisiblePage[] = [
      { path: "chapter.xhtml", spineIndex: 0, pageIndex: 2, pageNumber: 3, physicalSide: "left",
        start: { elementPath: [0], childIndex: 0, textOffset: 0 }, end: middle, hasPositionOverrides: false },
      { path: "chapter.xhtml", spineIndex: 0, pageIndex: 3, pageNumber: 4, physicalSide: "right",
        start: middle, end: { elementPath: [0], childIndex: 0, textOffset: 13 }, hasPositionOverrides: false },
    ];
    const markers = mapInspectorPageMarkers(text, pages);
    expect(markers.map(marker => [marker.page.pageIndex, marker.edge, marker.line, marker.column]))
      .toEqual([[2, "start", 2, 4], [2, "end", 2, 8], [3, "start", 2, 8], [3, "end", 2, 17]]);
    expect(markers[1]!.offset).toBe(markers[2]!.offset);
  });

  it.each([
    { elementPath: [8] }, { elementPath: [], childIndex: -1 },
    { elementPath: [], childIndex: 0, textOffset: 50 },
    { elementPath: [], childIndex: 4 }, { elementPath: [], childIndex: 0, textOffset: 0 },
    { elementPath: [], textOffset: 1 },
  ])("rejects unmappable points rather than guessing: %j", point => {
    expect(() => offset("<root><p>Text</p></root>", point)).toThrow();
  });

  it("rejects malformed XML and custom entities before producing any markers", () => {
    expect(() => buildInspectorSourceMap("<root>&custom;</root>")).toThrow();
    expect(() => offset("<root><p></root>", { elementPath: [] })).toThrow();
  });
});
