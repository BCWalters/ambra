import { describe, expect, it } from "vitest";
import { aggregateBookPosition, computePriorityOrder } from "./BookPagination.js";

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
