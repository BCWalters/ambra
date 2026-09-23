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

  it("orders an ancestor's child offsets on either side of a nested descendant", () => {
    document.body.innerHTML = "<p><em>before</em></p><img/><p>after</p>";
    const text = document.querySelector("em")!.firstChild!;
    for (const offset of [0, 1, 2, 3]) {
      const ancestor = { node: document.body, offset };
      const descendant = { node: text, offset: 2 };
      const expected = offset === 0 ? -1 : 1;
      expect(compareDomPositions(ancestor, descendant)).toBe(expected);
      expect(compareDomPositions(descendant, ancestor)).toBe(-expected);
    }
  });

  it("rejects disconnected trees instead of assigning an arbitrary document order", () => {
    expect(() => compareDomPositions(
      { node: document.createTextNode("one"), offset: 0 },
      { node: document.createTextNode("two"), offset: 0 },
    )).toThrow("disconnected");
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

  it("does not restore preceding text to a later atomic image's ancestor boundary", () => {
    document.body.innerHTML = "<p>before</p><img/><p>after</p>";
    const before = document.body.firstChild!;
    const after = document.body.lastChild!;
    const chunks: Chunk[] = [
      { top: 0, bottom: 20, breakBefore: { node: before, offset: 0 } },
      { top: 30, bottom: 130, breakBefore: { node: document.body, offset: 1 } },
      { top: 140, bottom: 160, breakBefore: { node: after, offset: 0 } },
    ];
    expect(findChunkForPosition(chunks, before.firstChild!, 2)).toBe(chunks[0]);
    expect(findChunkForPosition(chunks, document.body, 1)).toBe(chunks[1]);
    expect(findChunkForPosition(chunks, after.firstChild!, 2)).toBe(chunks[2]);
    expect(findChunkForPosition(chunks, document.body, 3)).toBe(chunks[2]);
  });

  it("returns no chunk for a position from a different document or detached tree", () => {
    document.body.innerHTML = "<p>before</p>";
    const chunks: Chunk[] = [
      { top: 0, bottom: 20, breakBefore: { node: document.body.firstChild!, offset: 0 } },
    ];
    const other = document.implementation.createHTMLDocument();
    expect(findChunkForPosition(chunks, other.body, 0)).toBeUndefined();
    expect(findChunkForPosition(chunks, document.createTextNode("detached"), 0)).toBeUndefined();
  });
});
