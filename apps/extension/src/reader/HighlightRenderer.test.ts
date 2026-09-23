import { afterEach, expect, it, vi } from "vitest";
import { HighlightTheme } from "@ambra/engine";
import { applyNavigationTargetRange, applySearchMatchRanges } from "./HighlightRenderer.js";

class TestHighlight extends Set<Range> {
  public priority = 0;
  public constructor(...ranges: Range[]) { super(ranges); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("keeps navigation spotlight ownership separate from search and saved annotations", () => {
  const highlights = new Map<string, TestHighlight>();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal("Highlight", TestHighlight);
  const paragraph = document.createElement("p");
  paragraph.textContent = "Destination";
  document.body.append(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const saved = new TestHighlight(range);
  highlights.set("ambra-highlight-yellow", saved);
  applySearchMatchRanges(document, [range]);
  applyNavigationTargetRange(document, range);
  expect(highlights.get(HighlightTheme.NAVIGATION_TARGET_HIGHLIGHT_NAME)?.has(range)).toBe(true);
  expect(highlights.get(HighlightTheme.NAVIGATION_TARGET_HIGHLIGHT_NAME)?.priority).toBe(1);
  applyNavigationTargetRange(document);
  expect(highlights.has(HighlightTheme.NAVIGATION_TARGET_HIGHLIGHT_NAME)).toBe(false);
  expect(highlights.get(HighlightTheme.SEARCH_MATCH_HIGHLIGHT_NAME)?.has(range)).toBe(true);
  expect(highlights.get("ambra-highlight-yellow")).toBe(saved);
  expect(HighlightTheme.CSS).toContain(
    `::highlight(${HighlightTheme.SEARCH_MATCH_HIGHLIGHT_NAME}), ::highlight(${HighlightTheme.NAVIGATION_TARGET_HIGHLIGHT_NAME})`,
  );
});
