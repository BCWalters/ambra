// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readingPositionForLocator } from "./CfiReadingPosition.js";
import { LocatorResolutionError, type ResolvedLocator } from "./Locator.js";
import { markReaderOwnedContent } from "../content/ReaderOwnedContent.js";
import { Page } from "../layout/Page.js";
import { PaginationEngine } from "../layout/PaginationEngine.js";
import { findChunkForPosition } from "../layout/ScrollPositionTracker.js";

function fixture() {
  const doc = document;
  doc.body.innerHTML = '<p id="first">Before after</p><p id="second"><em>Next</em></p><img id="image" alt="Picture"/>';
  return { doc, text: doc.getElementById("first")!.firstChild!, second: doc.getElementById("second")!,
    next: doc.querySelector("em")!.firstChild!, image: doc.getElementById("image")! };
}

function point(node: Node, offset?: number, sideBias?: "a" | "b"): ResolvedLocator {
  return { spineIndex: 0, node, characterOffset: offset, sideBias };
}

describe("CFI visual reading affinity", () => {
  it("keeps temporal affinity on its media owner rather than adjacent prose", () => {
    const doc = document;
    doc.body.innerHTML = '<p>Before</p><audio id="target"></audio><p>After</p>';
    const audio = doc.getElementById("target")!;
    expect(readingPositionForLocator({
      ...point(audio, undefined, "b"), mediaOffsets: { temporalOffsetSeconds: 1 },
    })).toEqual({ node: audio, offset: 0 });
  });

  it("selects opposite natural pages and scroll lines without changing the original boundary", () => {
    const { doc, text } = fixture();
    const start = { node: text, offset: 0 };
    const boundary = { node: text, offset: 7 };
    const end = { node: text, offset: 12 };
    const pages = [new Page(0, start, boundary, 0, 20), new Page(1, boundary, end, 20, 40)];
    const chunks = [{ breakBefore: start, top: 0, bottom: 20 }, { breakBefore: boundary, top: 20, bottom: 40 }];
    for (const bias of ["b", "a"] as const) {
      const original = point(text, 7, bias);
      const probe = readingPositionForLocator(original);
      expect(PaginationEngine.findPageForPosition(pages, probe.node, probe.offset!, doc)?.index)
        .toBe(bias === "b" ? 0 : 1);
      expect(findChunkForPosition(chunks, probe.node, probe.offset!)?.top).toBe(bias === "b" ? 0 : 20);
      expect(original.characterOffset).toBe(7);
    }
  });

  it("attaches an element start before the element or to its first child content", () => {
    const { text, second, next } = fixture();
    expect(readingPositionForLocator(point(second, undefined, "b"))).toEqual({ node: text, offset: 11 });
    expect(readingPositionForLocator(point(second, undefined, "a"))).toEqual({ node: next, offset: 0 });
  });

  it("walks across nested text edges in either direction", () => {
    const { text, next, image } = fixture();
    expect(readingPositionForLocator(point(next, 0, "b"))).toEqual({ node: text, offset: 11 });
    expect(readingPositionForLocator(point(text, 12, "a"))).toEqual({ node: next, offset: 0 });
    expect(readingPositionForLocator(point(next, 4, "a"))).toEqual({ node: image, offset: 0 });
  });

  it("attaches an image start backward but keeps after affinity on the image", () => {
    const { image, next } = fixture();
    expect(readingPositionForLocator(point(image, undefined, "b"))).toEqual({ node: next, offset: 3 });
    expect(readingPositionForLocator(point(image, undefined, "a"))).toEqual({ node: image, offset: 0 });
  });

  it("does not turn a nonzero alternative-text position into an image-start boundary", () => {
    const { image } = fixture();
    expect(readingPositionForLocator({ ...point(image, undefined, "b"), alternativeTextOffset: 3 }))
      .toEqual({ node: image, offset: 0 });
  });

  it.each(["a", "b"] as const)("keeps %s affinity inside an atomic inline SVG", bias => {
    document.body.innerHTML = '<p>Before</p><svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/><text>Words</text></svg><p>After</p>';
    const graphic = document.querySelector("svg")!;
    const text = graphic.querySelector("text")!.firstChild!;
    expect(readingPositionForLocator(point(text, bias === "b" ? 0 : 5, bias)))
      .toEqual({ node: graphic, offset: 0 });
  });

  it("skips reader-owned content, comments, empty text and non-rendered document metadata", () => {
    const { doc, text, second, next } = fixture();
    const owned = doc.createElement("span");
    owned.textContent = "Reader controls";
    markReaderOwnedContent(owned);
    second.before(owned, doc.createComment("ignored"), doc.createTextNode(""));
    expect(readingPositionForLocator(point(second, undefined, "b"))).toEqual({ node: text, offset: 11 });
    expect(readingPositionForLocator(point(text, 12, "a"))).toEqual({ node: next, offset: 0 });
    expect(readingPositionForLocator(point(text, 0, "b"))).toEqual({ node: text, offset: 0 });
  });

  it("preserves ordinary unbiased locators and document-edge locations", () => {
    const { text, image } = fixture();
    expect(readingPositionForLocator(point(text, 7))).toEqual({ node: text, offset: 7 });
    expect(readingPositionForLocator(point(text, 0, "b"))).toEqual({ node: text, offset: 0 });
    expect(readingPositionForLocator(point(image, 0, "a"))).toEqual({ node: image, offset: 0 });
  });

  it.each([-1, 13, NaN, Infinity, 0.5])("rejects an invalid biased character offset: %s", offset => {
    const { text } = fixture();
    expect(() => readingPositionForLocator(point(text, offset, "b"))).toThrow(LocatorResolutionError);
  });
});
