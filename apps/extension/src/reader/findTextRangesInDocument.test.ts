import { afterEach, describe, expect, it } from "vitest";
import { findTextMatchesInDocument } from "@ambra/engine";
import { findTextRangesInDocument } from "./findTextRangesInDocument.js";

function makeDocument(markup: string): Document {
  document.title = "hello metadata";
  document.body.innerHTML = markup;
  return document;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("findTextRangesInDocument", () => {
  it.each([
    ["<p>İ HELLO</p>", "hello", ["HELLO"]],
    ["<p>İstanbul</p>", "İST", ["İst"]],
    ["<p>hel<em>lo</em> hello</p>", "hello", ["hello", "hello"]],
    ["<p>hel</p><p>lo</p>", "hello", []],
    ["<p>hel<br/>lo</p>", "hello", []],
    ["<p>hello</p>", "", []],
    ["<p>hello</p>", "he", ["he"]],
  ])("creates exact original-source ranges for %s / %s", (markup, query, expected) => {
    const doc = makeDocument(markup);

    const ranges = findTextRangesInDocument(doc, query);

    expect(ranges.map((range) => range.toString())).toEqual(expected);
  });

  it("never highlights script/style or explicitly hidden text", () => {
    const doc = makeDocument(
      '<script type="application/json">"hello"</script><style>hello {}</style>' +
        '<p hidden>hello</p><p style="display: none">hello</p><p>hello</p>',
    );

    expect(findTextRangesInDocument(doc, "hello").map((range) => range.toString())).toEqual([
      "hello",
    ]);
  });

  it("uses exactly the engine matcher endpoints for every visible match", () => {
    const doc = makeDocument("<p>İ hel<em>lo</em> hello</p><p>hello</p>");
    const matches = [...findTextMatchesInDocument(doc, "hello")];
    const ranges = findTextRangesInDocument(doc, "hello");

    expect(ranges).toHaveLength(3);
    expect(ranges).toHaveLength(matches.length);
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i]!;
      const match = matches[i]!;
      expect(range.startContainer).toBe(match.start.node);
      expect(range.startOffset).toBe(match.start.offset);
      expect(range.endContainer).toBe(match.end.node);
      expect(range.endOffset).toBe(match.end.offset);
      expect(range.toString()).toBe(match.text.slice(match.startIndex, match.endIndex));
    }
  });
});
