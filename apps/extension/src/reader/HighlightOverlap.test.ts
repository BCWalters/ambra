import { describe, expect, it } from "vitest";
import { HighlightTheme } from "@ambra/engine";
import { computeHighlightRangeGroups } from "./HighlightOverlap.js";
import type { HighlightRangeEntry } from "./HighlightOverlap.js";

/** Builds a `Range` spanning `[start, end)` of `node`'s own text content
 * — every test case here highlights (possibly overlapping) spans of one
 * shared text node, since the overlap algorithm itself is about
 * *position* ordering, not any particular DOM shape; `HighlightInteraction`'s
 * own tests already cover resolving a real saved `Highlight`'s CFI into
 * a `Range` in the first place. */
function rangeOf(node: Text, start: number, end: number): Range {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

/** A group's ranges, reduced to plain `[start, end]` offset tuples for
 * easy comparison — real `Range` objects don't have a useful `toEqual`
 * shape of their own. */
function toTuples(ranges: Range[] | undefined): Array<[number, number]> {
  return (ranges ?? [])
    .map((r): [number, number] => [r.startOffset, r.endOffset])
    .sort((a, b) => a[0] - b[0]);
}

describe("computeHighlightRangeGroups", () => {
  it("returns an empty map for no entries", () => {
    expect(computeHighlightRangeGroups(document, [])).toEqual(new Map());
  });

  it("keeps non-overlapping highlights in their own plain style group", () => {
    const node = document.createTextNode("The quick brown fox jumps over the lazy dog");
    const entries: HighlightRangeEntry[] = [
      { style: "yellow", range: rangeOf(node, 0, 9) },
      { style: "blue", range: rangeOf(node, 20, 30) },
    ];
    const groups = computeHighlightRangeGroups(document, entries);
    expect(toTuples(groups.get(HighlightTheme.highlightName("yellow")))).toEqual([[0, 9]]);
    expect(toTuples(groups.get(HighlightTheme.highlightName("blue")))).toEqual([[20, 30]]);
    expect(groups.size).toBe(2);
  });

  it("blends two fully-overlapping highlights of different colors into one combined group", () => {
    const node = document.createTextNode("The quick brown fox jumps over the lazy dog");
    const entries: HighlightRangeEntry[] = [
      { style: "yellow", range: rangeOf(node, 4, 15) },
      { style: "blue", range: rangeOf(node, 4, 15) },
    ];
    const groups = computeHighlightRangeGroups(document, entries);
    const blendName = HighlightTheme.blendHighlightName(["blue", "yellow"]);
    expect(toTuples(groups.get(blendName))).toEqual([[4, 15]]);
    // Nothing left over under either solo style — the whole span blended.
    expect(groups.has(HighlightTheme.highlightName("yellow"))).toBe(false);
    expect(groups.has(HighlightTheme.highlightName("blue"))).toBe(false);
  });

  it("splits a partial overlap into solo-before, blended-middle, solo-after", () => {
    const node = document.createTextNode("The quick brown fox jumps over the lazy dog");
    const entries: HighlightRangeEntry[] = [
      { style: "yellow", range: rangeOf(node, 0, 10) },
      { style: "pink", range: rangeOf(node, 5, 15) },
    ];
    const groups = computeHighlightRangeGroups(document, entries);
    expect(toTuples(groups.get(HighlightTheme.highlightName("yellow")))).toEqual([[0, 5]]);
    expect(toTuples(groups.get(HighlightTheme.highlightName("pink")))).toEqual([[10, 15]]);
    const blendName = HighlightTheme.blendHighlightName(["pink", "yellow"]);
    expect(toTuples(groups.get(blendName))).toEqual([[5, 10]]);
  });

  it("blends three overlapping highlights into a single three-way combination (bonus: more than two)", () => {
    const node = document.createTextNode("The quick brown fox jumps over the lazy dog");
    const entries: HighlightRangeEntry[] = [
      { style: "yellow", range: rangeOf(node, 0, 20) },
      { style: "blue", range: rangeOf(node, 5, 25) },
      { style: "purple", range: rangeOf(node, 10, 30) },
    ];
    const groups = computeHighlightRangeGroups(document, entries);
    // [0,5) yellow only; [5,10) yellow+blue; [10,20) yellow+blue+purple;
    // [20,25) blue+purple; [25,30) purple only.
    expect(toTuples(groups.get(HighlightTheme.highlightName("yellow")))).toEqual([[0, 5]]);
    expect(toTuples(groups.get(HighlightTheme.blendHighlightName(["blue", "yellow"])))).toEqual([[5, 10]]);
    expect(toTuples(groups.get(HighlightTheme.blendHighlightName(["blue", "purple", "yellow"])))).toEqual([
      [10, 20],
    ]);
    expect(toTuples(groups.get(HighlightTheme.blendHighlightName(["blue", "purple"])))).toEqual([[20, 25]]);
    expect(toTuples(groups.get(HighlightTheme.highlightName("purple")))).toEqual([[25, 30]]);
  });

  it("treats two overlapping highlights of the identical style as that one style, not a self-blend", () => {
    const node = document.createTextNode("The quick brown fox jumps over the lazy dog");
    const entries: HighlightRangeEntry[] = [
      { style: "green", range: rangeOf(node, 0, 10) },
      { style: "green", range: rangeOf(node, 5, 15) },
    ];
    const groups = computeHighlightRangeGroups(document, entries);
    expect(toTuples(groups.get(HighlightTheme.highlightName("green")))).toEqual([
      [0, 5],
      [5, 10],
      [10, 15],
    ]);
    expect(groups.size).toBe(1);
  });

  it("keeps underline as its own independent decoration layered over a solo background color, not a blend", () => {
    const node = document.createTextNode("The quick brown fox jumps over the lazy dog");
    const entries: HighlightRangeEntry[] = [
      { style: "yellow", range: rangeOf(node, 0, 10) },
      { style: "underline", range: rangeOf(node, 5, 15) },
    ];
    const groups = computeHighlightRangeGroups(document, entries);
    // The background stays a plain solo "yellow" everywhere it's shown
    // (underline never contributes to — or dilutes — a color blend) —
    // split into two adjacent ranges at the underline's own boundary
    // (the scan-line algorithm splits at every input boundary point,
    // even ones that don't actually change the active style set), which
    // renders identically to one continuous span either way.
    expect(toTuples(groups.get(HighlightTheme.highlightName("yellow")))).toEqual([
      [0, 5],
      [5, 10],
    ]);
    // ...while underline gets its own registration for exactly its own
    // span, overlapping or not (again split at the yellow highlight's
    // own boundary at 10, same harmless fragmentation as above).
    expect(toTuples(groups.get(HighlightTheme.highlightName("underline")))).toEqual([
      [5, 10],
      [10, 15],
    ]);
    // No "blend" group is created for underline + a single color — there's
    // only one background color there to begin with.
    expect([...groups.keys()].some((name) => name.includes("blend"))).toBe(false);
  });
});
