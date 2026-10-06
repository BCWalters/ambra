import { describe, expect, it, vi } from "vitest";
import { ReflowableSpreadPlanner, type ReflowableSpread } from "./ReflowableSpreadPlanner.js";
import { adjacentPrimarySpineIndex } from "./PrimaryReadingOrder.js";

describe("ReflowableSpreadPlanner", () => {
  it("pairs only primary pages across supplements while keeping direct supplemental access", async () => {
    const spine = [false, true, false, true, false].map(linear => ({ linear }));
    const count = vi.fn(async (_index: number) => 1);
    const planner = new ReflowableSpreadPlanner(count,
      index => spine[index]?.linear === true,
      (index, direction) => adjacentPrimarySpineIndex(spine, index, direction));
    const primary = { first: { spineIndex: 1, pageIndex: 0 }, second: { spineIndex: 3, pageIndex: 0 } };
    expect(await planner.containing({ spineIndex: 1, pageIndex: 0 })).toEqual(primary);
    expect(await planner.containing({ spineIndex: 3, pageIndex: 0 })).toEqual(primary);
    expect(await planner.turn(primary, 1)).toBeUndefined();
    expect(await planner.turn(primary, -1)).toBeUndefined();
    expect(count.mock.calls.map(call => call[0]).every(index => index === 1 || index === 3)).toBe(true);
    expect(await planner.containing({ spineIndex: 2, pageIndex: 0 })).toEqual({
      first: { spineIndex: 2, pageIndex: 0 }, second: undefined,
    });
    expect(await planner.adjacent({ spineIndex: 2, pageIndex: 0 }, 1)).toEqual({ spineIndex: 3, pageIndex: 0 });
    expect(await planner.adjacent({ spineIndex: 2, pageIndex: 0 }, -1)).toEqual({ spineIndex: 1, pageIndex: 0 });
  });

  it.each([[1, 1, 1, 7], [3, 4, 1, 1, 2], [2, 2], [1]])(
    "pairs every page exactly once and reverses identically: %j",
    async (...counts: number[]) => {
      const planner = new ReflowableSpreadPlanner(
        async (index) => counts[index]!,
        (index) => index >= 0 && index < counts.length,
      );
      const spreads: ReflowableSpread[] = [];
      let current: ReflowableSpread | undefined = await planner.containing({
        spineIndex: 0,
        pageIndex: 0,
      });
      while (current) {
        spreads.push(current);
        current = await planner.turn(current, 1);
      }
      const pages = counts.flatMap((count, spineIndex) =>
        Array.from({ length: count }, (_, pageIndex) => ({ spineIndex, pageIndex })),
      );
      expect(
        spreads.flatMap((spread) =>
          spread.second ? [spread.first, spread.second] : [spread.first],
        ),
      ).toEqual(pages);
      for (const spread of spreads) {
        expect(await planner.containing(spread.first)).toEqual(spread);
        if (spread.second) expect(await planner.containing(spread.second)).toEqual(spread);
      }
      current = spreads.at(-1);
      for (let index = spreads.length - 1; index >= 0; index--) {
        expect(current).toEqual(spreads[index]);
        current = await planner.turn(current!, -1);
      }
      expect(current).toBeUndefined();
    },
  );

  it("does not paginate the whole book before opening its first spread", async () => {
    const count = vi.fn(async () => 10);
    const planner = new ReflowableSpreadPlanner(count, (index) => index >= 0 && index < 1000);
    expect(await planner.containing({ spineIndex: 0, pageIndex: 0 })).toEqual({
      first: { spineIndex: 0, pageIndex: 0 },
      second: { spineIndex: 0, pageIndex: 1 },
    });
    expect(count.mock.calls).toEqual([[0]]);
  });
});
