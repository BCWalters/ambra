import { describe, expect, it } from "vitest";
import { BOOKMARK_ROW_HEIGHT, groupBookmarkMarkers } from "./BookmarkGroups.js";

const marker = (id: string, fraction: number) => ({ id, fraction });

describe("groupBookmarkMarkers", () => {
  it("keeps isolated positions as directly navigable single flags", () => {
    const marks = [marker("a", 0.1), marker("b", 0.5), marker("c", 1)];
    expect(groupBookmarkMarkers(marks, 1000)).toEqual(marks.map(mark => ({
      markers: [mark], fraction: mark.fraction, width: 24,
    })));
  });

  it("retains distinct saved bookmarks on the same page in stable input order", () => {
    const marks = [marker("later-id", 0.25), marker("earlier-id", 0.25)];
    const groups = groupBookmarkMarkers(marks, 1000);
    expect(groups).toEqual([{ markers: marks, fraction: 0.25, width: 40 }]);
    expect(marks).toEqual([marker("later-id", 0.25), marker("earlier-id", 0.25)]);
  });

  it("uses the position range center and separates groups when space permits", () => {
    const marks = [marker("a", 0.25), marker("b", 0.29)];
    expect(groupBookmarkMarkers(marks, 300)).toEqual([
      { markers: marks, fraction: 0.27, width: 40 },
    ]);
    expect(groupBookmarkMarkers(marks, 1000)).toHaveLength(2);
  });

  it("includes count badges when merging colliding hit areas", () => {
    const marks = [
      marker("a", 0.1), marker("b", 0.1),
      marker("c", 0.128), marker("d", 0.128),
    ];
    expect(groupBookmarkMarkers(marks, 1000)).toHaveLength(1);
  });

  it("keeps dense data bounded without discarding or mutating bookmarks", () => {
    const marks = Array.from({ length: 10_000 }, (_, index) =>
      Object.freeze(marker(String(index), 0.5 + index / 1_000_000)),
    );
    const groups = groupBookmarkMarkers(Object.freeze(marks), 1200);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.markers).toHaveLength(10_000);
    expect(groups[0]!.width).toBe(40);
    expect(BOOKMARK_ROW_HEIGHT).toBe(24);
  });

  it.each([240, 320, 800, 1400])("produces nonoverlapping sorted hit areas at %spx", width => {
    const marks = Array.from({ length: 50 }, (_, index) => marker(String(index), (index / 49) ** 2)).reverse();
    const groups = groupBookmarkMarkers(marks, width);
    expect(groups.flatMap(group => group.markers)).toHaveLength(marks.length);
    groups.slice(1).forEach((group, index) => {
      const previous = groups[index]!;
      expect((group.fraction - previous.fraction) * width)
        .toBeGreaterThanOrEqual((group.width + previous.width) / 2 + 2 - 0.001);
    });
  });

  it("does not guess positions before the track has layout", () => {
    expect(groupBookmarkMarkers([marker("a", 0.2)], 0)).toEqual([]);
    expect(groupBookmarkMarkers([], 1000)).toEqual([]);
  });
});
