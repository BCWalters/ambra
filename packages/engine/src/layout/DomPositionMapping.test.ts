// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mapDomPositionToDocument } from "./DomPositionMapping.js";

function parseXhtmlFragment(html: string): Document {
  return new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml">${html}</html>`,
    "application/xhtml+xml",
  );
}

describe("mapDomPositionToDocument", () => {
  it("maps a text-node position to the equivalent node/offset in a structurally-identical document", () => {
    const html = "<body><p>First paragraph.</p><p>Second paragraph here.</p></body>";
    const sourceDoc = parseXhtmlFragment(html);
    const targetDoc = parseXhtmlFragment(html);
    const sourceRoot = sourceDoc.getElementsByTagName("body")[0]!;
    const targetRoot = targetDoc.getElementsByTagName("body")[0]!;

    // Position inside the second paragraph's text, offset 7 ("Second ").
    const sourceTextNode = sourceRoot.children[1]!.firstChild!;
    const mapped = mapDomPositionToDocument({ node: sourceTextNode, offset: 7 }, sourceRoot, targetRoot);

    expect(mapped).toBeDefined();
    const targetTextNode = targetRoot.children[1]!.firstChild!;
    expect(mapped!.node).toBe(targetTextNode);
    expect(mapped!.offset).toBe(7);
  });

  it("maps an element-node position (no character offset) directly", () => {
    const html = "<body><div><p>a</p><p>b</p></div></body>";
    const sourceDoc = parseXhtmlFragment(html);
    const targetDoc = parseXhtmlFragment(html);
    const sourceRoot = sourceDoc.getElementsByTagName("body")[0]!;
    const targetRoot = targetDoc.getElementsByTagName("body")[0]!;

    const sourceDiv = sourceRoot.children[0]!;
    const sourceSecondP = sourceDiv.children[1]!;
    const mapped = mapDomPositionToDocument({ node: sourceSecondP, offset: 0 }, sourceRoot, targetRoot);

    expect(mapped).toBeDefined();
    const targetDiv = targetRoot.children[0]!;
    const targetSecondP = targetDiv.children[1]!;
    expect(mapped!.node).toBe(targetSecondP);
    expect(mapped!.offset).toBe(0);
  });

  it("maps a position within a multi-node text run to the correct node and local offset", () => {
    // Two adjacent text nodes forming one CFI-level "run" (no element
    // between them) — the offset must be resolved across their combined
    // length, landing in whichever one actually contains it.
    const html = "<body><p>a</p><p>b</p></body>";
    const sourceDoc = parseXhtmlFragment(html);
    const targetDoc = parseXhtmlFragment(html);
    const sourceRoot = sourceDoc.getElementsByTagName("body")[0]!;
    const targetRoot = targetDoc.getElementsByTagName("body")[0]!;

    // Construct a multi-node text run manually: two text nodes inserted
    // back to back right after the last <p>, with no element between them.
    const sourceP2 = sourceRoot.children[1]!;
    const targetP2 = targetRoot.children[1]!;
    const firstRun = sourceDoc.createTextNode("hello ");
    const secondRun = sourceDoc.createTextNode("world");
    sourceP2.parentNode!.insertBefore(firstRun, sourceP2.nextSibling);
    sourceP2.parentNode!.insertBefore(secondRun, firstRun.nextSibling);
    const targetFirstRun = targetDoc.createTextNode("hello ");
    const targetSecondRun = targetDoc.createTextNode("world");
    targetP2.parentNode!.insertBefore(targetFirstRun, targetP2.nextSibling);
    targetP2.parentNode!.insertBefore(targetSecondRun, targetFirstRun.nextSibling);

    // Offset 2 within `secondRun` ("world") — should resolve to the same
    // node + offset in the target document.
    const mapped = mapDomPositionToDocument({ node: secondRun, offset: 2 }, sourceRoot, targetRoot);

    expect(mapped).toBeDefined();
    expect(mapped!.node).toBe(targetSecondRun);
    expect(mapped!.offset).toBe(2);
  });

  it("returns undefined when the source node isn't reachable from sourceRoot", () => {
    const sourceDoc = parseXhtmlFragment("<body><p>a</p></body>");
    const otherDoc = parseXhtmlFragment("<body><div><p>b</p></div></body>");
    const sourceRoot = sourceDoc.getElementsByTagName("body")[0]!;
    const targetRoot = otherDoc.getElementsByTagName("body")[0]!;
    // A node that isn't a descendant of `sourceRoot` at all.
    const unrelated = otherDoc.getElementsByTagName("p")[0]!;

    const mapped = mapDomPositionToDocument({ node: unrelated, offset: 0 }, sourceRoot, targetRoot);
    expect(mapped).toBeUndefined();
  });
});
