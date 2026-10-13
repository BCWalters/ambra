import { beforeEach, describe, expect, it } from "vitest";
import { Page, type ContentDocumentView } from "@ambra/engine";
import { annotationSelectionRange } from "./AnnotationSelection.js";

beforeEach(() => { document.body.innerHTML = "<p>before visible after</p>"; });

function setup() {
  const text = document.querySelector("p")!.firstChild!;
  const selected = document.createRange();
  selected.selectNodeContents(text);
  const page = new Page(1, { node: text, offset: 7 }, { node: text, offset: 14 }, 100, 200);
  const view: ContentDocumentView = { document, spineIndex: 2, physicalSide: "right", page };
  return { text, selected, view };
}

describe("new annotation page boundaries", () => {
  it("uses only the selecting document's page, not the adjacent spread page", () => {
    const { selected, view } = setup();
    const other = new DOMParser().parseFromString("<html><body>different chapter</body></html>", "text/html");
    expect(annotationSelectionRange(selected, [{ document: other, spineIndex: 1, physicalSide: "left" }, view])?.toString()).toBe("visible");
  });

  it("returns no intersection for entirely hidden text", () => {
    const { text, selected, view } = setup();
    selected.setStart(text, 0);
    selected.setEnd(text, 6);
    expect(annotationSelectionRange(selected, [view])).toBeUndefined();
  });

  it("preserves continuous-scroll selections and rejects stale visible-document ownership", () => {
    const { selected, view } = setup();
    expect(annotationSelectionRange(selected, [{ ...view, page: undefined }])?.toString()).toBe("before visible after");
    expect(() => annotationSelectionRange(selected, [])).toThrow("no longer belongs");
  });

  it("rejects disjoint visual membership instead of spanning hidden text with one stored CFI", () => {
    const { text, selected, view } = setup();
    const scope = { start: { node: text, offset: 0 }, end: { node: text, offset: 20 } };
    const page = new Page(1, scope.start, scope.end, 100, 200, [{ scope, ranges: [
      { start: { node: text, offset: 0 }, end: { node: text, offset: 6 } },
      { start: { node: text, offset: 15 }, end: { node: text, offset: 20 } },
    ] }]);
    expect(() => annotationSelectionRange(selected, [{ ...view, page }])).toThrow("one contiguous visible page range");
  });
});
