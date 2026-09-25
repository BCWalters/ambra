import { describe, expect, it } from "vitest";
import { planPageBreaks } from "./PaginationEngine.js";
import type { Chunk } from "./LineMeasurement.js";
import type { DomBreakPoint } from "./Page.js";

const END_OF_DOC: DomBreakPoint = { node: {} as Node, offset: 0 };

function chunk(top: number, bottom: number, breakNode: string): Chunk {
  return { top, bottom, breakBefore: { node: { name: breakNode } as unknown as Node } };
}

describe("planPageBreaks", () => {
  it("returns no pages for an empty chunk list", () => {
    expect(planPageBreaks([], 100, END_OF_DOC)).toEqual([]);
  });

  it("places all chunks on one page when they all fit", () => {
    const chunks = [chunk(0, 20, "a"), chunk(20, 40, "b"), chunk(40, 60, "c")];

    const pages = planPageBreaks(chunks, 100, END_OF_DOC);

    expect(pages).toHaveLength(1);
    expect(pages[0]!.topY).toBe(0);
    expect(pages[0]!.bottomY).toBe(60);
    expect(pages[0]!.endBreak).toBe(END_OF_DOC);
  });

  it("includes the full bounds of visible positioned content in nonvisual DOM order", () => {
    const chunks = [chunk(160, 200, "positioned-heading"), chunk(54, 270, "image"), chunk(220, 240, "caption")];
    const pages = planPageBreaks(chunks, 700, END_OF_DOC);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.topY).toBe(54);
    expect(pages[0]!.bottomY).toBe(270);
    expect(pages[0]!.startBreak).toBe(chunks[0]!.breakBefore);
  });

  it("splits chunks across pages when they exceed page height", () => {
    // Each chunk is 30px tall; page height 50 fits at most 1 (30 fits, 60
    // doesn't), so this should break after every single chunk.
    const chunks = [chunk(0, 30, "a"), chunk(30, 60, "b"), chunk(60, 90, "c")];

    const pages = planPageBreaks(chunks, 50, END_OF_DOC);

    expect(pages).toHaveLength(3);
    expect(pages[0]!.topY).toBe(0);
    expect(pages[0]!.bottomY).toBe(30);
    expect(pages[1]!.topY).toBe(30);
    expect(pages[1]!.bottomY).toBe(60);
    expect(pages[2]!.topY).toBe(60);
    expect(pages[2]!.bottomY).toBe(90);
  });

  it("fits as many chunks as possible per page before breaking", () => {
    // Chunks of height 20 each; page height 50 should fit 2 per page
    // (40 <= 50) but not 3 (60 > 50).
    const chunks = [
      chunk(0, 20, "a"),
      chunk(20, 40, "b"),
      chunk(40, 60, "c"),
      chunk(60, 80, "d"),
      chunk(80, 100, "e"),
    ];

    const pages = planPageBreaks(chunks, 50, END_OF_DOC);

    expect(pages).toHaveLength(3);
    expect(pages[0]!.bottomY).toBe(40); // a, b
    expect(pages[1]!.topY).toBe(40);
    expect(pages[1]!.bottomY).toBe(80); // c, d
    expect(pages[2]!.topY).toBe(80);
    expect(pages[2]!.bottomY).toBe(100); // e
  });

  it("gives an oversized chunk (taller than a full page) its own page rather than splitting or dropping it", () => {
    const chunks = [chunk(0, 10, "before"), chunk(10, 300, "huge-image"), chunk(300, 320, "after")];

    const pages = planPageBreaks(chunks, 100, END_OF_DOC);

    // "before" alone fits on page 1. "huge-image" (290px) exceeds the
    // 100px page height on its own, but since it would be the *first*
    // chunk on its page, it's placed anyway (allowed to overflow) rather
    // than never being placed or corrupting later breaks.
    expect(pages).toHaveLength(3);
    expect(pages[0]!.topY).toBe(0);
    expect(pages[0]!.bottomY).toBe(10);
    expect(pages[1]!.topY).toBe(10);
    expect(pages[1]!.bottomY).toBe(300);
    expect(pages[1]!.height).toBe(290); // genuinely overflows the 100px page height
    expect(pages[2]!.topY).toBe(300);
    expect(pages[2]!.bottomY).toBe(320);
  });

  it("handles consecutive oversized chunks, each getting its own page", () => {
    const chunks = [chunk(0, 200, "huge-1"), chunk(200, 400, "huge-2")];

    const pages = planPageBreaks(chunks, 100, END_OF_DOC);

    expect(pages).toHaveLength(2);
    expect(pages[0]!.bottomY).toBe(200);
    expect(pages[1]!.topY).toBe(200);
    expect(pages[1]!.bottomY).toBe(400);
  });

  it("assigns sequential zero-based indices to pages", () => {
    const chunks = [chunk(0, 30, "a"), chunk(30, 60, "b"), chunk(60, 90, "c")];

    const pages = planPageBreaks(chunks, 50, END_OF_DOC);

    expect(pages.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("only the last page's endBreak is the provided end-of-document marker", () => {
    const chunks = [chunk(0, 30, "a"), chunk(30, 60, "b")];

    const pages = planPageBreaks(chunks, 20, END_OF_DOC);

    expect(pages[0]!.endBreak).not.toBe(END_OF_DOC);
    expect(pages[pages.length - 1]!.endBreak).toBe(END_OF_DOC);
  });

  it("forces a page break at forcedBreakBefore even though the chunk would otherwise still fit", () => {
    // All four chunks (20px each) fit within an 80px page on their own,
    // so without a forced break this would be a single page.
    const chunks = [chunk(0, 20, "a"), chunk(20, 40, "b"), chunk(40, 60, "c"), chunk(60, 80, "d")];

    const pages = planPageBreaks(chunks, 80, END_OF_DOC, chunks[2]!.breakBefore);

    expect(pages).toHaveLength(2);
    expect(pages[0]!.topY).toBe(0);
    expect(pages[0]!.bottomY).toBe(40); // a, b
    expect(pages[1]!.topY).toBe(40);
    expect(pages[1]!.bottomY).toBe(80); // c, d — "c" now starts a fresh page
    expect(pages[1]!.startBreak).toBe(chunks[2]!.breakBefore);
  });

  it("does not force a break at forcedBreakBefore if it's already the first chunk on its page", () => {
    // Page height only fits 2 chunks per page (40 <= 50, 60 > 50), so "c"
    // is naturally already the first chunk of page 2 — forcing a break
    // there again would be a no-op, not an extra empty page.
    const chunks = [chunk(0, 20, "a"), chunk(20, 40, "b"), chunk(40, 60, "c"), chunk(60, 80, "d")];

    const pages = planPageBreaks(chunks, 50, END_OF_DOC, chunks[2]!.breakBefore);

    expect(pages).toHaveLength(2);
    expect(pages[0]!.bottomY).toBe(40); // a, b
    expect(pages[1]!.topY).toBe(40);
    expect(pages[1]!.bottomY).toBe(80); // c, d
  });

  it("ignores a forcedBreakBefore that doesn't match any chunk's breakBefore", () => {
    const chunks = [chunk(0, 20, "a"), chunk(20, 40, "b")];
    const unrelated: DomBreakPoint = { node: { name: "elsewhere" } as unknown as Node };

    const pages = planPageBreaks(chunks, 100, END_OF_DOC, unrelated);

    expect(pages).toHaveLength(1);
  });
});
