// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { Page, type DomPositionRange } from "./Page.js";
import { intersectPageRange } from "./PageRange.js";

beforeEach(() => { document.body.innerHTML = "<p>before <em>visible</em> after</p><p>next</p>"; });

function range(start: Node, startOffset: number, end: Node, endOffset: number): Range {
  const result = document.createRange();
  result.setStart(start, startOffset);
  result.setEnd(end, endOffset);
  return result;
}

describe("canonical page range intersections", () => {
  it("clips both ends at exact mid-paragraph offsets while preserving inline markup", () => {
    const paragraph = document.querySelector("p")!;
    const first = paragraph.firstChild!;
    const last = paragraph.lastChild!;
    const page = new Page(1, { node: first, offset: 3 }, { node: last, offset: 4 }, 100, 200);
    const [clipped] = intersectPageRange(page, range(document.body, 0, document.body, 2), document);
    expect(clipped?.toString()).toBe("ore visible aft");
    expect(clipped?.startContainer).toBe(first);
    expect(clipped?.startOffset).toBe(3);
    expect(clipped?.endContainer).toBe(last);
    expect(clipped?.endOffset).toBe(4);
    expect(clipped?.cloneContents().querySelector("em")?.textContent).toBe("visible");
  });

  it("preserves an ordinary within-page range and returns no off-page or boundary-only intersection", () => {
    const text = document.querySelector("em")!.firstChild!;
    const page = new Page(1, { node: text, offset: 1 }, { node: text, offset: 6 }, 100, 200);
    expect(intersectPageRange(page, range(text, 2, text, 4), document)[0]?.toString()).toBe("si");
    expect(intersectPageRange(page, range(text, 0, text, 1), document)).toEqual([]);
    expect(intersectPageRange(page, range(text, 6, text, 7), document)).toEqual([]);
    expect(intersectPageRange(page, range(text, 3, text, 3), document)).toEqual([]);
  });

  it("subtracts reordered scopes from the default interval and retains only canonical override membership", () => {
    document.body.innerHTML = "<p>before</p><figure><span>visible first</span><span>hidden middle</span><figcaption>visible caption</figcaption></figure><p>after</p>";
    const figure = document.querySelector("figure")!;
    const scope: DomPositionRange = { start: { node: figure, offset: 0 }, end: { node: figure, offset: 3 } };
    const page = new Page(1, { node: document.body, offset: 0 }, { node: document.body, offset: 3 }, 100, 200,
      [{ scope, ranges: [
        { start: { node: figure, offset: 0 }, end: { node: figure, offset: 1 } },
        { start: { node: figure, offset: 2 }, end: { node: figure, offset: 3 } },
      ] }]);
    const intersections = intersectPageRange(page, range(figure, 0, figure, 3), document);
    expect(intersections.map(range => range.toString())).toEqual(["visible first", "visible caption"]);
    expect(intersections.some(range => range.toString().includes("hidden"))).toBe(false);
  });

  it("includes override text outside the page's linear anchors and honors first-override precedence", () => {
    const text = document.querySelector("em")!.firstChild!;
    const scope: DomPositionRange = { start: { node: text, offset: 0 }, end: { node: text, offset: 7 } };
    const page = new Page(1, { node: document.body, offset: 1 }, { node: document.body, offset: 2 }, 100, 200,
      [{ scope, ranges: [{ start: { node: text, offset: 1 }, end: { node: text, offset: 3 } }] },
        { scope, ranges: [scope] }]);
    expect(intersectPageRange(page, range(text, 0, text, 7), document).map(range => range.toString())).toEqual(["is"]);
  });

  it("merges adjacent/overlapping override ranges rather than inventing disjoint selections", () => {
    const text = document.querySelector("em")!.firstChild!;
    const scope: DomPositionRange = { start: { node: text, offset: 0 }, end: { node: text, offset: 7 } };
    const page = new Page(1, scope.start, scope.end, 100, 200, [{ scope, ranges: [
      { start: { node: text, offset: 0 }, end: { node: text, offset: 4 } },
      { start: { node: text, offset: 3 }, end: { node: text, offset: 6 } },
      { start: { node: text, offset: 6 }, end: { node: text, offset: 7 } },
    ] }]);
    expect(intersectPageRange(page, range(text, 0, text, 7), document).map(range => range.toString())).toEqual(["visible"]);
  });

  it("rejects stale/disconnected or foreign-document boundaries explicitly", () => {
    const text = document.querySelector("em")!.firstChild!;
    const selected = range(text, 0, text, 7);
    const detached = document.createTextNode("detached");
    expect(() => intersectPageRange(new Page(1, { node: detached }, { node: detached, offset: 8 }, 0, 100), selected, document))
      .toThrow("same live document");
  });
});
