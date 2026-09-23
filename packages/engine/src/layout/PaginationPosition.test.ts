// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { PaginationEngine, planPageBreaks } from "./PaginationEngine.js";
import type { Chunk } from "./LineMeasurement.js";

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
