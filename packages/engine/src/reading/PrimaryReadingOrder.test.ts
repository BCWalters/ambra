import { describe, expect, it } from "vitest";
import { adjacentPrimarySpineIndex, primarySpineIndices } from "./PrimaryReadingOrder.js";

describe("primary reading order", () => {
  const spine = [false, true, false, true, false].map(linear => ({ linear }));

  it("retains raw indices and excludes leading, interleaved and trailing supplements", () => {
    expect(primarySpineIndices(spine)).toEqual([1, 3]);
    expect(adjacentPrimarySpineIndex(spine, 1, 1)).toBe(3);
    expect(adjacentPrimarySpineIndex(spine, 3, -1)).toBe(1);
    expect(adjacentPrimarySpineIndex(spine, 1, -1)).toBeUndefined();
    expect(adjacentPrimarySpineIndex(spine, 3, 1)).toBeUndefined();
  });

  it("leaves an explicitly opened supplement toward the nearest primary item", () => {
    expect(adjacentPrimarySpineIndex(spine, 0, 1)).toBe(1);
    expect(adjacentPrimarySpineIndex(spine, 2, 1)).toBe(3);
    expect(adjacentPrimarySpineIndex(spine, 2, -1)).toBe(1);
    expect(adjacentPrimarySpineIndex(spine, 4, -1)).toBe(3);
  });

  it.each([[], [{ linear: false }], [{ linear: false }, { linear: false }]].map(items => ({ items })))(
    "does not invent primary order for empty or all-non-linear publications: %j", ({ items }) => {
      expect(primarySpineIndices(items)).toEqual([]);
      expect(adjacentPrimarySpineIndex(items, 0, 1)).toBeUndefined();
      expect(adjacentPrimarySpineIndex(items, 0, -1)).toBeUndefined();
    },
  );
});
