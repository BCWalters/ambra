// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { PaginationEngine, planPageBreaks } from "./PaginationEngine.js";
import type { Chunk } from "./LineMeasurement.js";
import { findChunkForPosition } from "./ScrollPositionTracker.js";

beforeEach(() => {
  document.body.innerHTML = `<div class="chapter" id="chapter">
    <h2><a id="empty-anchor"></a>BOOK II</h2>
    <p>First paragraph</p><p>Middle paragraph</p><p>Last paragraph</p>
  </div>`;
});

function chapterPages() {
  const chunks: Chunk[] = Array.from(document.querySelectorAll("h2, p")).map((element, index) => ({
    breakBefore: { node: element.lastChild!, offset: 0 },
    top: index * 40,
    bottom: index * 40 + 30,
  }));
  return planPageBreaks(chunks, 50, { node: document.body, offset: document.body.childNodes.length });
}

describe("PaginationEngine.findPageForPosition", () => {
  it("maps disjoint figure ranges without stealing image, caption, or surrounding positions (#264)", () => {
    document.body.innerHTML = "<p>Before.</p><figure><figcaption>abcdefgh</figcaption><svg></svg></figure><p>After.</p>";
    const figure = document.querySelector("figure")!;
    const caption = document.querySelector("figcaption")!;
    const text = caption.firstChild!;
    const image = document.querySelector("svg")!;
    const start = { node: document.body, offset: 1 };
    const end = { node: document.body, offset: 2 };
    const captionStart = { node: caption, offset: 0 };
    const middle = { node: text, offset: 4 };
    const imageStart = { node: figure, offset: 1 };
    const scope = { start, end };
    const chunks: Chunk[] = [
      { top: 0, bottom: 30, breakBefore: { node: document.body.firstChild!, offset: 0 } },
      { top: 30, bottom: 60, breakBefore: start, positionOverride: { scope, ranges: [
        { start, end: captionStart }, { start: imageStart, end },
      ] } },
      { top: 60, bottom: 90, breakBefore: captionStart, positionOverride: {
        scope, ranges: [{ start: captionStart, end: middle }],
      } },
      { top: 90, bottom: 120, breakBefore: middle, positionOverride: {
        scope, ranges: [{ start: middle, end: imageStart }],
      } },
      { top: 120, bottom: 150, breakBefore: { node: document.body.lastChild!, offset: 0 } },
    ];
    const pages = planPageBreaks(chunks, 30, { node: document.body, offset: 3 });
    for (const [node, offset, index] of [
      [figure, 0, 1], [image, 0, 1], [figure, 1, 1], [caption, 0, 2],
      [text, 0, 2], [text, 3, 2], [text, 4, 3], [text, 7, 3],
      [document.body.firstChild!.firstChild!, 1, 0], [document.body.lastChild!.firstChild!, 1, 4],
    ] as const) {
      expect(pages.filter(page => page.containsPosition(node, offset, document))).toEqual([pages[index]]);
      expect(PaginationEngine.findPageForPosition(pages, node, offset, document)).toBe(pages[index]);
      expect(findChunkForPosition(chunks, node, offset)).toBe(chunks[index]);
    }
    const together = planPageBreaks(chunks, 60, { node: document.body, offset: 3 });
    expect(together[1]!.containsPosition(image, 0, document)).toBe(true);
    expect(together[1]!.containsPosition(text, 3, document)).toBe(true);
    expect(together[1]!.containsPosition(text, 4, document)).toBe(false);

    const after = { ...chunks[4]!, bottom: 130 };
    const endOfDocument = { node: document.body, offset: 3 };
    const baseline = planPageBreaks([
      chunks[0]!, { top: 30, bottom: 120, breakBefore: start }, after,
    ], 80, endOfDocument);
    const fragmented = planPageBreaks([...chunks.slice(0, 4), after], 80, endOfDocument);
    for (const node of [document.body.firstChild!.firstChild!, document.body.lastChild!.firstChild!]) {
      const oldPage = PaginationEngine.findPageForPosition(baseline, node, 0, document)!;
      const newPage = PaginationEngine.findPageForPosition(fragmented, node, 0, document)!;
      expect([newPage.topY, newPage.bottomY], "surrounding content keeps its original page windows")
        .toEqual([oldPage.topY, oldPage.bottomY]);
    }
  });

  it.each(["chapter", "empty-anchor"])("opens leading #%s on the first page, not the chapter's last (#152)", id => {
    // Gutenberg's Odyssey links BOOK II to the enclosing chapter div.
    // Both that boundary and its empty heading anchor precede the first
    // measured text chunk, so neither is contained in any page range.
    const pages = chapterPages();
    const target = document.getElementById(id)!;
    expect(pages).toHaveLength(4);
    expect(pages.some(page => page.containsPosition(target, 0, document))).toBe(false);
    expect(PaginationEngine.findPageForPosition(pages, target, 0, document)).toBe(pages[0]);
  });

  it("clamps the body start to the first page", () => {
    const pages = chapterPages();
    expect(PaginationEngine.findPageForPosition(pages, document.body, 0, document)).toBe(pages[0]);
  });

  it("keeps shared page boundaries on the later page", () => {
    const pages = chapterPages();
    for (const page of pages) {
      expect(PaginationEngine.findPageForPosition(pages, page.startBreak.node, 0, document)).toBe(page);
    }
  });

  it("keeps text positions and chapter end on their existing pages", () => {
    const pages = chapterPages();
    const paragraphs = document.querySelectorAll("p");
    expect(PaginationEngine.findPageForPosition(pages, paragraphs[1]!.firstChild!, 4, document)).toBe(pages[2]);
    const chapter = document.getElementById("chapter")!;
    expect(PaginationEngine.findPageForPosition(pages, chapter, chapter.childNodes.length, document)).toBe(pages.at(-1));
    expect(PaginationEngine.findPageForPosition(pages, document.body, 1, document)).toBe(pages.at(-1));
  });

  it("preserves offsets on a chapter container rather than treating all of it as its start", () => {
    const pages = chapterPages();
    const chapter = document.getElementById("chapter")!;
    const middle = document.querySelectorAll("p")[1]!;
    const offset = Array.from(chapter.childNodes).indexOf(middle) + 1;
    expect(PaginationEngine.findPageForPosition(pages, chapter, offset, document)).toBe(pages[2]);
  });

  it("does not throw for an empty pagination or an unrelated target", () => {
    const pages = chapterPages();
    expect(PaginationEngine.findPageForPosition([], document.body, 0, document)).toBeUndefined();
    expect(PaginationEngine.findPageForPosition(pages, document.createElement("p"), 0, document)).toBe(pages.at(-1));
  });
});
