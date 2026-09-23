// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { findTextMatchesInDocument } from "./DocumentTextSearch.js";
import type { DocumentTextMatch } from "./DocumentTextSearch.js";

function makeDocument(markup: string): Document {
  document.title = "Metadata hello";
  document.body.innerHTML = markup;
  return document;
}

afterEach(() => {
  document.body.replaceChildren();
});

function selectedText(match: DocumentTextMatch): string {
  const range = match.start.node.ownerDocument.createRange();
  range.setStart(match.start.node, match.start.offset);
  range.setEnd(match.end.node, match.end.offset);
  return range.toString();
}

describe("findTextMatchesInDocument", () => {
  it("matches across inline elements and preserves original source text", () => {
    const doc = makeDocument("<p>Before hel<em>lo <strong>WOR</strong></em>LD after.</p>");
    const [match] = [...findTextMatchesInDocument(doc, "hello world")];

    expect(match).toBeDefined();
    expect(selectedText(match!)).toBe("hello WORLD");
    expect(match!.text.slice(match!.startIndex, match!.endIndex)).toBe("hello WORLD");
    expect(match!.start.node.data).toBe("Before hel");
    expect(match!.start.offset).toBe(7);
    expect(match!.end.node.data).toBe("LD after.");
    expect(match!.end.offset).toBe(2);
  });

  it("assigns endpoints on text-node boundaries to the matched nodes", () => {
    const doc = makeDocument("<p>before <em>hello</em> after</p>");
    const [match] = [...findTextMatchesInDocument(doc, "hello")];
    const text = doc.querySelector("em")!.firstChild;

    expect(match!.start).toEqual({ node: text, offset: 0 });
    expect(match!.end).toEqual({ node: text, offset: 5 });
  });

  it.each([
    ["İ HELLO", "hello", "HELLO", 2, 7],
    ["😀 İ HELLO", "hello", "HELLO", 5, 10],
    ["İstanbul", "İST", "İst", 0, 3],
    ["İ", "i", "İ", 0, 1],
    ["ΟΣ", "ΟΣ", "ΟΣ", 0, 2],
    ["a𐐀bc", "𐐨B", "𐐀b", 1, 4],
  ])("maps %s / %s to original UTF-16 offsets", (text, query, expected, start, end) => {
    const doc = makeDocument(`<p>${text}</p>`);
    const matches = [...findTextMatchesInDocument(doc, query)];

    expect(matches).toHaveLength(1);
    expect(matches[0]!.start.offset).toBe(start);
    expect(matches[0]!.end.offset).toBe(end);
    expect(selectedText(matches[0]!)).toBe(expected);
    expect(matches[0]!.text.slice(matches[0]!.startIndex, matches[0]!.endIndex)).toBe(expected);
  });

  it("keeps contextual lowercase behavior across inline elements", () => {
    const doc = makeDocument("<p>Ο<em>Σ</em></p>");

    expect([...findTextMatchesInDocument(doc, "ΟΣ")].map(selectedText)).toEqual(["ΟΣ"]);
  });

  it("finds repeated non-overlapping matches in document order", () => {
    const doc = makeDocument("<p>banana</p><p>ban<em>ana</em></p>");

    expect([...findTextMatchesInDocument(doc, "ana")].map(selectedText)).toEqual(["ana", "ana"]);
  });

  it.each([
    "<p>hel</p><p>lo</p>",
    "<div>hel<div>lo</div></div>",
    "<ul><li>hel</li><li>lo</li></ul>",
    "<table><tbody><tr><td>hel</td><td>lo</td></tr></tbody></table>",
    "<p>hel<br/>lo</p>",
    "<p>hel<img/>lo</p>",
    '<p>hel<span style="display: block">lo</span></p>',
    "<div>hel<p></p>lo</div>",
  ])("does not join text across a structural boundary: %s", (markup) => {
    expect([...findTextMatchesInDocument(makeDocument(markup), "hello")]).toEqual([]);
  });

  it("ends a nested block's run before returning to its parent", () => {
    const doc = makeDocument("<div><p>hel</p>lo</div>");

    expect([...findTextMatchesInDocument(doc, "hello")]).toEqual([]);
    expect([...findTextMatchesInDocument(doc, "lo")].map(selectedText)).toEqual(["lo"]);
  });

  it("excludes metadata, script/style content, and explicitly hidden subtrees", () => {
    const doc = makeDocument(`
      <script type="application/json">"hello"</script>
      <style>hello { color: red; }</style>
      <template><p>hello</p></template>
      <div hidden><p>hello</p></div>
      <span aria-hidden="true">hello</span>
      <span style="display: none">hello</span>
      <span style="visibility: hidden">hello</span>
      <span style="visibility: collapse">hello</span>
      <p>visible hello</p>
    `);

    const matches = [...findTextMatchesInDocument(doc, "hello")];

    expect(matches.map(selectedText)).toEqual(["hello"]);
    expect(matches[0]!.text).toBe("visible hello");
  });

  it("does not form a match across excluded source text", () => {
    const doc = makeDocument("<p>hel<span hidden>ignored</span>lo</p>");

    expect([...findTextMatchesInDocument(doc, "hello")]).toEqual([]);
  });

  it("ignores comments without losing adjacent text-node positions", () => {
    const doc = makeDocument("<p>hel<!--comment-->lo</p>");

    expect([...findTextMatchesInDocument(doc, "hello")].map(selectedText)).toEqual(["hello"]);
  });

  it("uses the same structural policy in an unloaded XHTML document", () => {
    const doc = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>hello</title></head><body>' +
        '<p>hel<em>lo</em></p><p hidden="hidden">hello</p><style>hello {}</style>' +
        "</body></html>",
      "application/xhtml+xml",
    );
    const matches = [...findTextMatchesInDocument(doc, "hello")];

    expect(matches).toHaveLength(1);
    expect(matches[0]!.start.node.data).toBe("hel");
    expect(matches[0]!.end.node.data).toBe("lo");
    expect(matches[0]!.end.offset).toBe(2);
  });

  it("searches SVG text but not SVG metadata or adjacent text elements as one word", () => {
    const doc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><title>hello</title><desc>hello</desc>' +
        "<defs><text>hello</text></defs><text>hel<tspan>lo</tspan></text>" +
        "<text>hel</text><text>lo</text></svg>",
      "image/svg+xml",
    );
    const matches = [...findTextMatchesInDocument(doc, "hello")];

    expect(matches).toHaveLength(1);
    expect(matches[0]!.text).toBe("hello");
  });

  it("preserves whitespace and leaves query trimming and length limits to callers", () => {
    const doc = makeDocument("<p>he  llo</p>");

    expect([...findTextMatchesInDocument(doc, "")]).toEqual([]);
    expect([...findTextMatchesInDocument(doc, "hello")]).toEqual([]);
    expect([...findTextMatchesInDocument(doc, "he")].map(selectedText)).toEqual(["he"]);
    expect([...findTextMatchesInDocument(doc, "  ")].map(selectedText)).toEqual(["  "]);
  });
});
