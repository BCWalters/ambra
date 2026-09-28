import { NavPoint } from "@ambra/engine";
import { describe, expect, it } from "vitest";
import { resolveProgressMarkers, selectProgressMarkers } from "./ProgressMarkers.js";

const point = (id: string, children: NavPoint[] = [], types: string[] = []) =>
  new NavPoint(id, "book.xhtml", id, children, types);
const pages = (entries: [string, number][]) =>
  new Map(entries.map(([id, page]) => [`book.xhtml#${id}`, page]));

describe("progress marker resolution", () => {
  it("waits for measured totals and uses exact page fractions, including same-document fragments", () => {
    const toc = [point("one"), point("two"), point("three")];
    const map = pages([["one", 1], ["two", 21], ["three", 71]]);
    expect(resolveProgressMarkers(toc, [], map, undefined).ready).toBe(false);
    expect(resolveProgressMarkers(toc, [], map, 100).chapters.map(item => item.fraction)).toEqual([0, 0.2, 0.7]);
    expect(resolveProgressMarkers(toc, [], pages([["one", 1]]), 100).chapters).toEqual([]);
  });

  it("does not infer reading landmarks from titles or file ends", () => {
    const data = resolveProgressMarkers([point("Start of reading"), point("Epilogue")], [], new Map(), 100);
    expect(data.landmarks).toEqual([]);
  });

  it("uses explicit bodymatter and infers the end only from a later backmatter landmark", () => {
    const landmarks = [point("start", [], ["bodymatter"]), point("back", [], ["backmatter"])];
    expect(resolveProgressMarkers([], landmarks, pages([["start", 11], ["back", 91]]), 100).landmarks)
      .toEqual([{ kind: "start", fraction: 0.1 }, { kind: "end", fraction: 0.9 }]);
    expect(resolveProgressMarkers([], landmarks, pages([["start", 11], ["back", 1]]), 100).landmarks)
      .toEqual([{ kind: "start", fraction: 0.1 }]);
    expect(resolveProgressMarkers([], landmarks, pages([["start", 11]]), 100).landmarks)
      .toEqual([{ kind: "start", fraction: 0.1 }]);
  });

  it("suppresses ambiguous landmark targets but permits duplicate references", () => {
    const landmarks = [point("a", [], ["bodymatter"]), point("b", [], ["bodymatter"])];
    expect(resolveProgressMarkers([], landmarks, pages([["a", 1], ["b", 40]]), 100).landmarks).toEqual([]);
    expect(resolveProgressMarkers([], [landmarks[0]!, landmarks[0]!], pages([["a", 1]]), 100).landmarks)
      .toEqual([{ kind: "start", fraction: 0 }]);
  });
});

describe("adaptive progress marker density", () => {
  const toc = Array.from({ length: 250 }, (_, index) => point(`c${index}`));
  const map = pages(toc.map((p, index) => [p.fragment!, index + 1]));

  it("keeps sparse chapters and their unequal lengths at the actual measured locations", () => {
    const data = resolveProgressMarkers([point("a"), point("b"), point("c")], [],
      pages([["a", 1], ["b", 31], ["c", 81]]), 100);
    const selected = selectProgressMarkers(data, 1000);
    expect(selected.detail).toBe("chapters");
    expect(selected.chapters.map(item => item.fraction)).toEqual([0, 0.3, 0.8]);
  });

  it("rejects a crowded flat TOC without sampling it", () => {
    const data = resolveProgressMarkers(toc, [], map, 250);
    expect(selectProgressMarkers(data, 2000)).toMatchObject({ detail: "none", chapters: [] });
  });

  it("falls back to unlinked top-level groups in a dense nested TOC", () => {
    const groups = Array.from({ length: 5 }, (_, index) =>
      new NavPoint(`Part ${index}`, undefined, undefined, toc.slice(index * 50, (index + 1) * 50)));
    const wrapper = [new NavPoint("Contents", undefined, undefined, groups)];
    const selected = selectProgressMarkers(resolveProgressMarkers(wrapper, [], map, 250), 1000);
    expect(selected.detail).toBe("sections");
    expect(selected.chapters.map(item => item.fraction)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it("retains every boundary for short first, interior and final chapters even on narrow tracks", () => {
    const data = resolveProgressMarkers([point("a"), point("b"), point("c"), point("d"), point("e")], [],
      pages([["a", 2], ["b", 31], ["c", 32], ["d", 71], ["e", 100]]), 100);
    for (const width of [200, 1000]) {
      const selected = selectProgressMarkers(data, width);
      expect(selected.detail).toBe("chapters");
      expect(selected.chapters.map(marker => marker.fraction)).toEqual([0.01, 0.3, 0.31, 0.7, 0.99]);
      expect(selected.bandBoundaries).toEqual([0.01, 0.3, 0.31, 0.7, 0.99]);
    }
  });

  it("deduplicates identical targets and allows distinct chapter ticks to overlap on one page", () => {
    const duplicated = resolveProgressMarkers([point("a", [point("a")]), point("b")], [], pages([["a", 1], ["b", 51]]), 100);
    expect(duplicated.chapters).toHaveLength(2);
    const samePage = resolveProgressMarkers([point("a"), point("b")], [], pages([["a", 1], ["b", 1]]), 100);
    expect(selectProgressMarkers(samePage, 1000)).toMatchObject({ detail: "chapters", chapters: samePage.chapters });
  });

  it("allows exactly 100 targets and rejects 101 or backwards navigation without sampling", () => {
    const data = resolveProgressMarkers(toc.slice(0, 100), [], map, 250);
    expect(selectProgressMarkers(data, 200).chapters).toHaveLength(100);
    const tooMany = resolveProgressMarkers(toc.slice(0, 101), [], map, 250);
    expect(selectProgressMarkers(tooMany, 2000).detail).toBe("none");
    const backwards = resolveProgressMarkers([point("a"), point("b")], [], pages([["a", 71], ["b", 31]]), 100);
    expect(selectProgressMarkers(backwards, 1000).detail).toBe("none");
  });

  it("keeps landmarks for a dense TOC and removes chapter ticks next to landmarks", () => {
    const landmarks = [point("start", [], ["bodymatter"]), point("back", [], ["backmatter"])];
    const data = resolveProgressMarkers(toc, landmarks, new Map([...map, ...pages([["start", 1], ["back", 251]])]), 300);
    expect(selectProgressMarkers(data, 600)).toMatchObject({ detail: "landmarks", chapters: [], landmarks: data.landmarks });
    const sparse = resolveProgressMarkers([point("start"), point("c50"), point("back")], landmarks,
      new Map([...map, ...pages([["start", 1], ["back", 91]])]), 100);
    expect(selectProgressMarkers(sparse, 1000).chapters.map(item => item.label)).toEqual(["c50"]);
    expect(selectProgressMarkers(sparse, 1000).bandBoundaries).toEqual([0, 0.5]);
  });

  it("shows all twelve Alice-like chapters despite closely packed front matter and a linked book heading", () => {
    const chapterPages = [9, 23, 39, 56, 75, 94, 115, 133, 152, 170, 186, 200];
    const chapters = chapterPages.map((_, index) => point(`chapter${index}`));
    const toc = [point("title"), point("frontispiece"), point("work", chapters), point("afterword"), point("license")];
    const map = pages([
      ["title", 1], ["frontispiece", 7], ["work", 8], ["afterword", 220], ["license", 222],
      ...chapterPages.map((page, index): [string, number] => [`chapter${index}`, page]),
    ]);
    const landmarks = [point("work", [], ["bodymatter"]), point("afterword", [], ["backmatter"])];
    const data = resolveProgressMarkers(toc, landmarks, map, 230);
    expect(data.chapters.map(marker => marker.label)).toEqual(chapters.map(chapter => chapter.label));
    const selected = selectProgressMarkers(data, 1300);
    expect(selected.detail).toBe("chapters");
    expect(selected.bandBoundaries).toHaveLength(12);
    expect(selected.chapters.map(marker => marker.label)).toEqual(chapters.slice(1).map(chapter => chapter.label));
    expect(selected.landmarks).toHaveLength(2);
    expect(selectProgressMarkers(data, 320).detail).toBe("chapters");
  });

  it("assesses child chapters without counting their linked parent as another chapter", () => {
    const data = resolveProgressMarkers([point("work", [point("a"), point("b"), point("c")])], [],
      pages([["work", 1], ["a", 2], ["b", 31], ["c", 71]]), 100);
    expect(data.chapters.map(marker => marker.label)).toEqual(["a", "b", "c"]);
    expect(selectProgressMarkers(data, 4000).detail).toBe("chapters");
  });

  it("allows close main-text chapters after semantic trimming but still rejects unresolved chapters", () => {
    const landmarks = [point("start", [], ["bodymatter"]), point("back", [], ["backmatter"])];
    const map = pages([["front", 1], ["start", 10], ["a", 11], ["b", 12], ["back", 90]]);
    const data = resolveProgressMarkers([point("front"), point("start", [point("a"), point("b")]), point("back")],
      landmarks, map, 100);
    expect(selectProgressMarkers(data, 1000).detail).toBe("chapters");
    const missing = resolveProgressMarkers([point("start", [point("a"), point("missing")])], landmarks, map, 100);
    expect(missing.chapters).toEqual([]);
    expect(selectProgressMarkers(missing, 1000).detail).toBe("landmarks");
  });

  it("keeps the start rather than overlapping reading-boundary symbols at narrow widths", () => {
    const data = resolveProgressMarkers([], [point("start", [], ["bodymatter"]), point("back", [], ["backmatter"])],
      pages([["start", 11], ["back", 12]]), 100);
    expect(selectProgressMarkers(data, 300).landmarks).toEqual([{ kind: "start", fraction: 0.1 }]);
    expect(selectProgressMarkers(data, 2000).landmarks).toHaveLength(2);
  });
});
