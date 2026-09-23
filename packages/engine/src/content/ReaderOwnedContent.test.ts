// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isReaderOwnedContent, markReaderOwnedContent } from "./ReaderOwnedContent.js";
import { findTextMatchesInDocument } from "./DocumentTextSearch.js";
import { collectTextNodesOf, totalTextLength } from "../layout/DomTextWalker.js";
import {
  childStepIndex, elementCfiSteps, resolveElementChild, resolveTextRun, runCharacterOffset,
} from "../locator/CfiTree.js";

describe("reader-owned content", () => {
  it("cannot be forged by a publication attribute and includes shadow descendants", () => {
    const host = document.createElement("div");
    host.dataset.ambraBoundary = "";
    expect(isReaderOwnedContent(host)).toBe(false);
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    shadow.append(button);
    markReaderOwnedContent(host);
    expect(isReaderOwnedContent(host)).toBe(true);
    expect(isReaderOwnedContent(button)).toBe(true);
    expect(isReaderOwnedContent(document.body)).toBe(false);
  });

  it("excludes reader text and nodes from text walks, searches and CFI numbering", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = "<p>One</p>before<p>Two</p>";
    const second = doc.body.lastElementChild!;
    const before = second.previousSibling!;
    const steps = elementCfiSteps(doc.documentElement, second);
    const reader = doc.createElement("div");
    reader.textContent = "Next section";
    markReaderOwnedContent(reader);
    doc.body.insertBefore(reader, second);
    const after = doc.createTextNode("after");
    doc.body.insertBefore(after, second);
    expect(collectTextNodesOf(doc.body).map(node => node.data)).toEqual(["One", "before", "after", "Two"]);
    expect(totalTextLength(doc.body)).toBe(17);
    expect([...findTextMatchesInDocument(doc, "Next")]).toEqual([]);
    expect(elementCfiSteps(doc.documentElement, second)).toEqual(steps);
    expect(resolveElementChild(doc.body, 2)).toBe(second);
    expect(resolveElementChild(doc.body, 3)).toBeUndefined();
    expect(childStepIndex(after)).toBe(3);
    expect(runCharacterOffset(after, 2)).toBe(8);
    expect(resolveTextRun(doc.body, 3)).toEqual([before, after]);
    expect(() => childStepIndex(reader)).toThrow("no publication CFI");
    expect(() => childStepIndex(reader.firstChild!)).toThrow("no publication CFI");
  });
});
