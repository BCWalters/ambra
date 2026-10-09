// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { SmilDocument, SmilSeq } from "./SmilDocument.js";
import { SmilPlaybackTimeline } from "./SmilPlaybackTimeline.js";

const passage = (id: string, type = "", path = "chapter.xhtml") =>
  `<par id="${id}"${type ? ` epub:type="${type}"` : ""}><text src="${path}#${id}"/></par>`;
const document = (body: string, type = "") => SmilDocument.parse(
  `<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops">
    <body${type ? ` epub:type="${type}"` : ""}>${body}</body></smil>`,
  "EPUB/overlay.smil",
);

function setup() {
  const doc = document(`<seq epub:type="chapter">
    <par id="intro"><text src="chapter.xhtml#intro"/>
      <audio src="chapter.wav" clipBegin="0s" clipEnd="1s"/></par>
    <seq id="shared" epub:type="table figure">
      ${passage("row")}
      <seq id="shared" epub:type="list">
        ${passage("cell1")}
        ${passage("cell2", "", "next.xhtml")}
      </seq>
      ${passage("tableEnd")}
    </seq>
    ${passage("after")}
    <seq epub:type="footnote">${passage("note")}</seq>
    ${passage("page", "aside pagebreak")}
    ${passage("tail")}
  </seq>`, "bodymatter");
  return { doc, timeline: new SmilPlaybackTimeline(doc) };
}

describe("SmilPlaybackTimeline", () => {
  it("preserves the flat playback order and original par/text/audio identities", () => {
    const { doc, timeline } = setup();
    const pars = doc.flattenPars();
    expect(timeline.entries[0]!.par.audio).toBeDefined();
    expect(timeline.entries.map(entry => entry.par)).toEqual(pars);
    for (const [index, entry] of timeline.entries.entries()) {
      expect(entry.index).toBe(index);
      expect(entry.par).toBe(pars[index]);
      expect(entry.par.text).toBe(pars[index]!.text);
      expect(entry.par.audio).toBe(pars[index]!.audio);
    }
    expect(timeline.entries[3]!.par.text.path).toBe("EPUB/next.xhtml");
  });

  it("retains body and sequence semantics, identity and exclusive subtree boundaries", () => {
    const { doc, timeline } = setup();
    const entry = timeline.entries[2]!;
    expect(entry.semantics).toEqual(["bodymatter", "chapter", "table", "figure", "list"]);
    expect(entry.ancestors.map(range => [range.firstIndex, range.afterIndex]))
      .toEqual([[0, 9], [0, 9], [1, 5], [2, 4]]);
    expect(entry.ancestors[0]!.sequence).toBe(doc.body);
    expect(entry.ancestors[2]!.sequence.id).toBe("shared");
    expect(entry.ancestors[3]!.sequence.id).toBe("shared");
    expect(entry.ancestors[2]!.sequence).not.toBe(entry.ancestors[3]!.sequence);
  });

  it("skips every descendant of a matching sequence in either direction", () => {
    const { timeline } = setup();
    const skipped = new Set(["table"]);
    for (const index of [1, 2, 3, 4]) expect(timeline.isSkipped(index, skipped)).toBe(true);
    expect(timeline.isSkipped(0, skipped)).toBe(false);
    expect(timeline.isSkipped(5, skipped)).toBe(false);
    expect(timeline.findPlayableIndex(1, skipped)).toBe(5);
    expect(timeline.findPlayableIndex(4, skipped, -1)).toBe(0);
  });

  it("combines leaf and ancestor skip semantics without suppressing unrelated passages", () => {
    const { timeline } = setup();
    const skipped = new Set(["footnote", "pagebreak"]);
    expect(timeline.findPlayableIndex(6, skipped)).toBe(8);
    expect(timeline.findPlayableIndex(7, skipped, -1)).toBe(5);
    expect(timeline.findPlayableIndex(0, skipped)).toBe(0);
  });

  it("matches exact, case-sensitive tokens rather than substrings or unexpanded prefixes", () => {
    const timeline = new SmilPlaybackTimeline(document(
      `${passage("a", "notfootnote vendor:footnote Footnote")}${passage("b", "footnote footnote")}`,
    ));
    expect(timeline.isSkipped(0, new Set(["footnote"]))).toBe(false);
    expect(timeline.isSkipped(0, new Set(["vendor:footnote"]))).toBe(true);
    expect(timeline.entries[1]!.semantics).toEqual(["footnote"]);
  });

  it("tokenizes XML whitespace and preserves a non-XML separator inside its token", () => {
    const timeline = new SmilPlaybackTimeline(document(passage("a", "table&#x9;figure&#xA;list&#xD;aside note&#xA0;custom")));
    expect(timeline.entries[0]!.semantics).toEqual(["table", "figure", "list", "aside", "note\u00a0custom"]);
  });

  it("does not suppress anything when skipping is disabled", () => {
    const { timeline } = setup();
    for (const entry of timeline.entries) {
      expect(timeline.findPlayableIndex(entry.index, new Set())).toBe(entry.index);
    }
  });

  it("supports an explicitly skippable body and reports no remaining playable passage", () => {
    const { timeline } = setup();
    expect(timeline.findPlayableIndex(0, new Set(["bodymatter"]))).toBeUndefined();
    expect(timeline.findPlayableIndex(8, new Set(["bodymatter"]), -1)).toBeUndefined();
  });

  it("escapes the innermost nested structure even when authored IDs collide", () => {
    const { timeline } = setup();
    const destination = timeline.escapeAfter(2, new Set(["table", "list"]));
    expect(destination).toEqual({ structure: timeline.entries[2]!.ancestors[3]!.sequence, nextIndex: 4 });
    expect(timeline.escapeAfter(1, new Set(["table", "list"]))).toEqual({
      structure: timeline.entries[1]!.ancestors[2]!.sequence, nextIndex: 5,
    });
  });

  it("escapes an entire matching structure across content-document references", () => {
    const { timeline } = setup();
    expect(timeline.escapeAfter(2, new Set(["figure"]))?.nextIndex).toBe(5);
    expect(timeline.entries[3]!.par.text.path).not.toBe(timeline.entries[2]!.par.text.path);
  });

  it("can escape a leaf structure without leaving its surrounding sequence", () => {
    const { timeline } = setup();
    expect(timeline.escapeAfter(7, new Set(["aside"]))).toEqual({
      structure: timeline.entries[7]!.par, nextIndex: 8,
    });
  });

  it("distinguishes no escapable structure from escape at the timeline end", () => {
    const { timeline } = setup();
    expect(timeline.escapeAfter(0, new Set(["table", "list"]))).toBeUndefined();
    expect(timeline.escapeAfter(8, new Set(["bodymatter"]))).toEqual({
      structure: timeline.entries[8]!.ancestors[0]!.sequence, nextIndex: 9,
    });
  });

  it("does not merge anonymous sibling structures that share the same semantic", () => {
    const doc = document(`<seq epub:type="figure">${passage("a")}</seq>
      <seq epub:type="figure">${passage("b")}</seq>`);
    const timeline = new SmilPlaybackTimeline(doc);
    const first = doc.body.children[0];
    const second = doc.body.children[1];
    expect(first).toBeInstanceOf(SmilSeq);
    expect(timeline.escapeAfter(0, new Set(["figure"]))).toEqual({ structure: first, nextIndex: 1 });
    expect(timeline.escapeAfter(1, new Set(["figure"]))).toEqual({ structure: second, nextIndex: 2 });
  });

  it("retains text-only passages and ignores empty structures without changing flat order", () => {
    const doc = document(`<seq epub:type="footnote"/><seq>${passage("a")}</seq>`);
    const timeline = new SmilPlaybackTimeline(doc);
    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]!.par.audio).toBeUndefined();
    expect(timeline.isSkipped(0, new Set(["footnote"]))).toBe(false);
    expect(timeline.entries.map(entry => entry.par)).toEqual(doc.flattenPars());
  });

  it("handles empty timelines and explicit terminal boundaries", () => {
    const timeline = new SmilPlaybackTimeline(document(""));
    expect(timeline.entries).toEqual([]);
    expect(timeline.findPlayableIndex(0, new Set())).toBeUndefined();
    expect(timeline.findPlayableIndex(-1, new Set(), -1)).toBeUndefined();
    const full = setup().timeline;
    expect(full.findPlayableIndex(full.entries.length, new Set())).toBeUndefined();
    expect(full.findPlayableIndex(-1, new Set(), -1)).toBeUndefined();
  });

  it.each([-2, 10, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid search index %s", index => {
    expect(() => setup().timeline.findPlayableIndex(index, new Set())).toThrow(RangeError);
  });

  it.each([-1, 9, 0.5, Number.NaN])("rejects invalid passage index %s", index => {
    const { timeline } = setup();
    expect(() => timeline.isSkipped(index, new Set())).toThrow(RangeError);
    expect(() => timeline.escapeAfter(index, new Set())).toThrow(RangeError);
  });

  it("rejects an invalid runtime direction instead of looping or silently returning", () => {
    const { timeline } = setup();
    expect(() => Reflect.apply(timeline.findPlayableIndex, timeline, [0, new Set(), 0])).toThrow(RangeError);
  });
});
