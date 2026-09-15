// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { Chunk } from "./LineMeasurement.js";
import { compareDomPositions, findChunkAtScrollOffset, findChunkForPosition } from "./ScrollPositionTracker.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("compareDomPositions", () => {
  it("compares offsets directly when both positions share the same node", () => {
    document.body.innerHTML = "<p>hello</p>";
    const text = document.body.firstChild!.firstChild!;

    expect(compareDomPositions({ node: text, offset: 1 }, { node: text, offset: 3 })).toBeLessThan(0);
    expect(compareDomPositions({ node: text, offset: 3 }, { node: text, offset: 1 })).toBeGreaterThan(0);
    expect(compareDomPositions({ node: text, offset: 2 }, { node: text, offset: 2 })).toBe(0);
  });

  it("orders positions in different (sibling) elements by document order", () => {
    document.body.innerHTML = "<p>one</p><p>two</p>";
    const one = document.body.children[0]!.firstChild!;
    const two = document.body.children[1]!.firstChild!;

    expect(compareDomPositions({ node: one, offset: 0 }, { node: two, offset: 0 })).toBeLessThan(0);
    expect(compareDomPositions({ node: two, offset: 0 }, { node: one, offset: 0 })).toBeGreaterThan(0);
  });

  it("treats a container element's own position as before its descendants'", () => {
    document.body.innerHTML = "<p>hello</p>";
    const p = document.body.firstChild!;
    const text = p.firstChild!;

    expect(compareDomPositions({ node: p, offset: 0 }, { node: text, offset: 2 })).toBeLessThan(0);
  });
});

describe("findChunkAtScrollOffset", () => {
  function makeChunk(top: number, bottom: number, label: string): Chunk {
    return { top, bottom, breakBefore: { node: document.createTextNode(label), offset: 0 } };
  }

  it("finds the chunk overlapping the given scroll offset", () => {
    const chunks = [makeChunk(0, 50, "a"), makeChunk(50, 100, "b"), makeChunk(100, 150, "c")];

    expect(findChunkAtScrollOffset(chunks, 0)).toBe(chunks[0]);
    expect(findChunkAtScrollOffset(chunks, 60)).toBe(chunks[1]);
    expect(findChunkAtScrollOffset(chunks, 149)).toBe(chunks[2]);
  });

  it("returns the last chunk when scrollTop is past all measured content", () => {
    const chunks = [makeChunk(0, 50, "a"), makeChunk(50, 100, "b")];

    expect(findChunkAtScrollOffset(chunks, 1000)).toBe(chunks[1]);
  });

  it("returns undefined for an empty chunk list", () => {
    expect(findChunkAtScrollOffset([], 0)).toBeUndefined();
  });
});

describe("findChunkForPosition", () => {
  it("finds the last chunk whose breakBefore is at or before the target position", () => {
    document.body.innerHTML = "<p>one</p><p>two</p><p>three</p>";
    const [one, two, three] = Array.from(document.body.children).map((el) => el.firstChild!);
    const chunks: Chunk[] = [
      { top: 0, bottom: 50, breakBefore: { node: one!, offset: 0 } },
      { top: 50, bottom: 100, breakBefore: { node: two!, offset: 0 } },
      { top: 100, bottom: 150, breakBefore: { node: three!, offset: 0 } },
    ];

    // A position inside "two" should resolve to the "two" chunk, not the
    // first or third.
    expect(findChunkForPosition(chunks, two!, 2)).toBe(chunks[1]);
  });

  it("returns the first chunk when the position is before all of them", () => {
    document.body.innerHTML = "<p>one</p><p>two</p>";
    const [one, two] = Array.from(document.body.children).map((el) => el.firstChild!);
    const chunks: Chunk[] = [
      { top: 0, bottom: 50, breakBefore: { node: one!, offset: 0 } },
      { top: 50, bottom: 100, breakBefore: { node: two!, offset: 0 } },
    ];

    expect(findChunkForPosition(chunks, one!, 0)).toBe(chunks[0]);
  });

  it("returns the last chunk when the position is after all of them", () => {
    document.body.innerHTML = "<p>one</p><p>two</p>";
    const [one, two] = Array.from(document.body.children).map((el) => el.firstChild!);
    const chunks: Chunk[] = [
      { top: 0, bottom: 50, breakBefore: { node: one!, offset: 0 } },
      { top: 50, bottom: 100, breakBefore: { node: two!, offset: 0 } },
    ];

    expect(findChunkForPosition(chunks, two!, 3)).toBe(chunks[1]);
  });

  it("returns undefined for an empty chunk list", () => {
    document.body.innerHTML = "<p>one</p>";
    const one = document.body.firstChild!.firstChild!;

    expect(findChunkForPosition([], one, 0)).toBeUndefined();
  });
});
