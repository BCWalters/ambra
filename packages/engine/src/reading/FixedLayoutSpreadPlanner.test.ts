import { describe, expect, it } from "vitest";
import { ManifestItem, SpineItemRef, type PageProgressionDirection, type RenditionLayout } from "../container/PackageDocument.js";
import { FixedLayoutSpreadPlanner, type FixedSpread } from "./FixedLayoutSpreadPlanner.js";

/** A minimal `SpineItemRef` for planner tests — the planner never reads
 * anything from `ManifestItem`/`packageCfiSteps`, so both are stubbed to
 * whatever's cheapest to construct. `spreadProps` is exactly what would
 * appear in the real OPF itemref's `properties` attribute (e.g.
 * `"page-spread-left"`, `"rendition:layout-reflowable"`). */
function item(id: string, spreadProps: string[] = []): SpineItemRef {
  const manifestItem = new ManifestItem(id, `OEBPS/${id}.xhtml`, "application/xhtml+xml", new Set());
  return new SpineItemRef(manifestItem, true, new Set(spreadProps), []);
}

/** `page-blanche`-style spine: every item explicitly alternates
 * left/right, starting right (a real, common convention — see
 * `page-blanche.epub`'s own spine, this session's motivating example). */
function alternatingFxlSpine(count: number): SpineItemRef[] {
  const items: SpineItemRef[] = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? "page-spread-right" : "page-spread-left";
    items.push(item(`p${i}`, [side]));
  }
  return items;
}

const PRE_PAGINATED: RenditionLayout = "pre-paginated";
const REFLOWABLE: RenditionLayout = "reflowable";
const LTR: PageProgressionDirection = "ltr";
const RTL: PageProgressionDirection = "rtl";

describe("FixedLayoutSpreadPlanner.isSpreadModeEligible", () => {
  it("is never eligible for rendition:spread=none, regardless of size", () => {
    expect(FixedLayoutSpreadPlanner.isSpreadModeEligible("none", 4000, 2000)).toBe(false);
  });

  it("requires at least the minimum total width even for spread=both", () => {
    expect(FixedLayoutSpreadPlanner.isSpreadModeEligible("both", 500, 2000)).toBe(false);
    expect(FixedLayoutSpreadPlanner.isSpreadModeEligible("both", 900, 2000)).toBe(true);
  });

  it("spread=both is eligible regardless of orientation (portrait-shaped viewport)", () => {
    expect(FixedLayoutSpreadPlanner.isSpreadModeEligible("both", 1000, 1600)).toBe(true);
  });

  it("spread=landscape requires a landscape-shaped viewport", () => {
    expect(FixedLayoutSpreadPlanner.isSpreadModeEligible("landscape", 1000, 1600)).toBe(false);
    expect(FixedLayoutSpreadPlanner.isSpreadModeEligible("landscape", 1600, 1000)).toBe(true);
  });

  it("spread=auto is resolved the same way as landscape", () => {
    expect(FixedLayoutSpreadPlanner.isSpreadModeEligible("auto", 1000, 1600)).toBe(false);
    expect(FixedLayoutSpreadPlanner.isSpreadModeEligible("auto", 1600, 1000)).toBe(true);
  });
});

describe("FixedLayoutSpreadPlanner.spreadContaining — explicit page-spread-left/right (page-blanche style)", () => {
  // Mirrors page-blanche.epub's own spine exactly: right, left, right,
  // left, right, left — a lone cover starting alone on the right (the
  // EPUB 3.3 spec's own worked example, "Starting the first document on
  // the right," shows exactly this: nothing to its left, not paired),
  // then proper left+right spreads for the rest, with one further
  // trailing single if the run ends on an odd item with nothing left to
  // pair it with.
  const spine = alternatingFxlSpine(6);

  it("a lone leading page-spread-right item with nothing before it is single, not paired", () => {
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 0)).toEqual<FixedSpread>({
      kind: "single",
      spineIndex: 0,
    });
  });

  it("pairs the next left+right item into one spread", () => {
    const spread1 = FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 1);
    expect(spread1).toEqual<FixedSpread>({ kind: "pair", leftSpineIndex: 1, rightSpineIndex: 2 });

    // Querying the *other* half of the same pair returns the identical spread.
    const spread2 = FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 2);
    expect(spread2).toEqual<FixedSpread>(spread1);
  });

  it("continues pairing consistently through the rest of the run", () => {
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 3)).toEqual<FixedSpread>({
      kind: "pair",
      leftSpineIndex: 3,
      rightSpineIndex: 4,
    });
  });

  it("a trailing item with nothing left to pair it with is single", () => {
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 5)).toEqual<FixedSpread>({
      kind: "single",
      spineIndex: 5,
    });
  });

  it("falls back to single pages when spread mode isn't eligible (e.g. narrow viewport)", () => {
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, false, 0)).toEqual<FixedSpread>({
      kind: "single",
      spineIndex: 0,
    });
  });
});

describe("FixedLayoutSpreadPlanner.spreadContaining — default alternation with no explicit property", () => {
  it("LTR: pairs (first, second) as (left, right) by default", () => {
    const spine = [item("a"), item("b"), item("c"), item("d")];
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 0)).toEqual<FixedSpread>({
      kind: "pair",
      leftSpineIndex: 0,
      rightSpineIndex: 1,
    });
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 2)).toEqual<FixedSpread>({
      kind: "pair",
      leftSpineIndex: 2,
      rightSpineIndex: 3,
    });
  });

  it("RTL: pairs (first, second) as (right, left) by default", () => {
    const spine = [item("a"), item("b"), item("c"), item("d")];
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, RTL, true, 0)).toEqual<FixedSpread>({
      kind: "pair",
      leftSpineIndex: 1,
      rightSpineIndex: 0,
    });
  });
});

describe("FixedLayoutSpreadPlanner.spreadContaining — page-spread-center and mismatched sides", () => {
  it("a page-spread-center item is always single, never paired with a neighbor", () => {
    const spine = [item("a", ["page-spread-left"]), item("center", ["page-spread-center"]), item("c", ["page-spread-right"])];
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 1)).toEqual<FixedSpread>({
      kind: "single",
      spineIndex: 1,
    });
    // Its neighbors are also single — a center page never absorbs one
    // side of what would otherwise be a pair.
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 0)).toEqual<FixedSpread>({
      kind: "single",
      spineIndex: 0,
    });
  });

  it("two same-side pages in a row: the first is single (no valid predecessor or successor pairing), the second still pairs with its own valid successor", () => {
    const spine = [item("a", ["page-spread-left"]), item("b", ["page-spread-left"]), item("c", ["page-spread-right"])];
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 0)).toEqual<FixedSpread>({
      kind: "single",
      spineIndex: 0,
    });
    // "b" doesn't pair with "a" before it (left+left isn't a valid
    // pairing), but greedily still pairs with "c" right after it
    // (left+right *is* valid) — the mismatch with "a" only ever costs
    // "a" its own pairing, not "b"'s.
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 1)).toEqual<FixedSpread>({
      kind: "pair",
      leftSpineIndex: 1,
      rightSpineIndex: 2,
    });
  });

  it("both prefixed and unprefixed page-spread properties on the same item are equivalent (not a conflict)", () => {
    const spine = [item("a", ["rendition:page-spread-left", "page-spread-left"]), item("b", ["page-spread-right"])];
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 0)).toEqual<FixedSpread>({
      kind: "pair",
      leftSpineIndex: 0,
      rightSpineIndex: 1,
    });
  });
});

describe("FixedLayoutSpreadPlanner.spreadContaining — mixed reflowable/fixed-layout books", () => {
  it("a reflowable item is always single and never pairs with a neighbor", () => {
    const spine = [
      item("cover", ["page-spread-right"]),
      item("reflowable-chapter", ["rendition:layout-reflowable"]),
      item("a", ["page-spread-right"]),
      item("b", ["page-spread-left"]),
    ];
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 1)).toEqual<FixedSpread>({
      kind: "single",
      spineIndex: 1,
    });
  });

  it("a fresh run after a reflowable interruption starts its own independent pairing", () => {
    const spine = [
      item("a", ["page-spread-right"]),
      item("reflowable", ["rendition:layout-reflowable"]),
      // No explicit properties — starts a brand new run, paired from
      // scratch (LTR default: first=left, second=right), unaffected by
      // whatever side "a" (in a completely different, already-closed
      // run) happened to be on.
      item("c"),
      item("d"),
    ];
    expect(FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 2)).toEqual<FixedSpread>({
      kind: "pair",
      leftSpineIndex: 2,
      rightSpineIndex: 3,
    });
  });
});

describe("FixedLayoutSpreadPlanner.nextSpread / previousSpread", () => {
  // right, left, right, left, right, left → single(0), pair(1,2), pair(3,4), single(5).
  const spine = alternatingFxlSpine(6);

  it("steps from the lone leading single into the first proper pair", () => {
    const first = FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 0);
    expect(first).toEqual<FixedSpread>({ kind: "single", spineIndex: 0 });
    const second = FixedLayoutSpreadPlanner.nextSpread(spine, PRE_PAGINATED, LTR, true, first);
    expect(second).toEqual<FixedSpread>({ kind: "pair", leftSpineIndex: 1, rightSpineIndex: 2 });
  });

  it("steps backward symmetrically", () => {
    const third = FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 4);
    expect(third).toEqual<FixedSpread>({ kind: "pair", leftSpineIndex: 3, rightSpineIndex: 4 });
    const second = FixedLayoutSpreadPlanner.previousSpread(spine, PRE_PAGINATED, LTR, true, third);
    expect(second).toEqual<FixedSpread>({ kind: "pair", leftSpineIndex: 1, rightSpineIndex: 2 });
  });

  it("returns undefined past either end of the spine", () => {
    const last = FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 5);
    expect(FixedLayoutSpreadPlanner.nextSpread(spine, PRE_PAGINATED, LTR, true, last)).toBeUndefined();

    const first = FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, true, 0);
    expect(FixedLayoutSpreadPlanner.previousSpread(spine, PRE_PAGINATED, LTR, true, first)).toBeUndefined();
  });

  it("single-page mode (not spread-eligible) steps one spine item at a time", () => {
    const first = FixedLayoutSpreadPlanner.spreadContaining(spine, PRE_PAGINATED, LTR, false, 0);
    expect(first).toEqual<FixedSpread>({ kind: "single", spineIndex: 0 });
    const second = FixedLayoutSpreadPlanner.nextSpread(spine, PRE_PAGINATED, LTR, false, first);
    expect(second).toEqual<FixedSpread>({ kind: "single", spineIndex: 1 });
  });
});

describe("FixedLayoutSpreadPlanner — per-item rendition:layout-pre-paginated override in an otherwise-reflowable book", () => {
  it("a lone pre-paginated item inside a reflowable book is still just single (no neighbor to pair with)", () => {
    const spine = [
      item("chapter1"),
      item("full-page-plate", ["rendition:layout-pre-paginated"]),
      item("chapter2"),
    ];
    expect(
      FixedLayoutSpreadPlanner.spreadContaining(spine, REFLOWABLE, LTR, true, 1),
    ).toEqual<FixedSpread>({ kind: "single", spineIndex: 1 });
  });
});
