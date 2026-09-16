import { describe, expect, it } from "vitest";
import { aggregateBookPosition, computePriorityOrder, resolveGlobalPage } from "./BookPagination.js";

describe("computePriorityOrder", () => {
  it("starts with the current spine index", () => {
    expect(computePriorityOrder(2, 5)).toEqual([2, 3, 4, 1, 0]);
  });

  it("handles the current index being the first item", () => {
    expect(computePriorityOrder(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("handles the current index being the last item", () => {
    expect(computePriorityOrder(4, 5)).toEqual([4, 3, 2, 1, 0]);
  });

  it("returns an empty order for an empty spine", () => {
    expect(computePriorityOrder(0, 0)).toEqual([]);
  });

  it("clamps an out-of-range current index instead of throwing", () => {
    expect(computePriorityOrder(99, 3)).toEqual([2, 1, 0]);
    expect(computePriorityOrder(-1, 3)).toEqual([0, 1, 2]);
  });

  it("handles a single-item spine", () => {
    expect(computePriorityOrder(0, 1)).toEqual([0]);
  });
});

describe("aggregateBookPosition", () => {
  it("computes both fields once every count is known", () => {
    const counts = [10, 8, 12];
    // Reader is on the 3rd page (index 2) of spine item 1 (0-based).
    expect(aggregateBookPosition(counts, 1, 2)).toEqual({ currentPage: 13, totalPages: 30 });
  });

  it("computes currentPage as soon as items up to the current one are known, even if later ones aren't", () => {
    const counts = [10, 8, undefined, 12];
    expect(aggregateBookPosition(counts, 1, 0)).toEqual({ currentPage: 11, totalPages: undefined });
  });

  it("leaves currentPage undefined if an earlier item isn't measured yet", () => {
    const counts = [undefined, 8, 12];
    expect(aggregateBookPosition(counts, 1, 0)).toEqual({ currentPage: undefined, totalPages: undefined });
  });

  it("only needs the current item to have been reached, not fully counted, for currentPage", () => {
    // Spine item 0 is fully known; spine item 1 (the current one) hasn't
    // finished measuring yet, but that's fine — only its own in-progress
    // page index matters, not its eventual total page count.
    const counts = [10, undefined];
    expect(aggregateBookPosition(counts, 1, 3)).toEqual({ currentPage: 14, totalPages: undefined });
  });

  it("handles being on the very first page of the very first item", () => {
    const counts = [5, 5];
    expect(aggregateBookPosition(counts, 0, 0)).toEqual({ currentPage: 1, totalPages: 10 });
  });

  it("returns totalPages of 0 for an empty pageCounts array", () => {
    expect(aggregateBookPosition([], 0, 0)).toEqual({ currentPage: 1, totalPages: 0 });
  });
});

describe("resolveGlobalPage", () => {
  it("resolves a page within the first spine item", () => {
    const counts = [10, 8, 12];
    expect(resolveGlobalPage(counts, 5)).toEqual({ spineIndex: 0, pageIndexInItem: 4 });
  });

  it("resolves a page at the exact boundary between two spine items", () => {
    const counts = [10, 8, 12];
    // Page 10 is the last page of item 0; page 11 is the first of item 1.
    expect(resolveGlobalPage(counts, 10)).toEqual({ spineIndex: 0, pageIndexInItem: 9 });
    expect(resolveGlobalPage(counts, 11)).toEqual({ spineIndex: 1, pageIndexInItem: 0 });
  });

  it("resolves a page within a later spine item", () => {
    const counts = [10, 8, 12];
    expect(resolveGlobalPage(counts, 25)).toEqual({ spineIndex: 2, pageIndexInItem: 6 });
  });

  it("clamps an out-of-range (too high) target to the last page of the book", () => {
    const counts = [10, 8, 12];
    expect(resolveGlobalPage(counts, 999)).toEqual({ spineIndex: 2, pageIndexInItem: 11 });
  });

  it("clamps a too-low (zero or negative) target to page 1", () => {
    const counts = [10, 8, 12];
    expect(resolveGlobalPage(counts, 0)).toEqual({ spineIndex: 0, pageIndexInItem: 0 });
    expect(resolveGlobalPage(counts, -5)).toEqual({ spineIndex: 0, pageIndexInItem: 0 });
  });

  it("rounds a fractional target to the nearest whole page", () => {
    const counts = [10, 8, 12];
    expect(resolveGlobalPage(counts, 5.4)).toEqual({ spineIndex: 0, pageIndexInItem: 4 });
    expect(resolveGlobalPage(counts, 5.6)).toEqual({ spineIndex: 0, pageIndexInItem: 5 });
  });

  it("returns undefined when the spine item containing the target isn't measured yet", () => {
    const counts = [10, undefined, 12];
    expect(resolveGlobalPage(counts, 15)).toBeUndefined();
  });

  it("returns undefined for an empty pageCounts array", () => {
    expect(resolveGlobalPage([], 1)).toBeUndefined();
  });

  it("returns undefined when clamping to the last page but that page isn't measured", () => {
    const counts = [10, undefined];
    expect(resolveGlobalPage(counts, 999)).toBeUndefined();
  });
});
