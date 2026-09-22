import { describe, expect, it, vi } from "vitest";
import { ReflowableSpreadPlanner, type ReflowableSpread } from "./ReflowableSpreadPlanner.js";

describe("ReflowableSpreadPlanner", () => {
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
