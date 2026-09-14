// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { Page } from "./Page.js";

// Note: these tests deliberately build their DOM via the environment's
// global `document` (document.body.innerHTML = ...) rather than
// `new DOMParser().parseFromString(...)` (the pattern used elsewhere in
// this codebase), because happy-dom's `Range.comparePoint` has a bug
// where it throws "WrongDocumentError" for any document produced by
// DOMParser, even when comparing nodes that genuinely belong to that same
// document — it only works correctly against the environment's own
// global `document`. This is a happy-dom-only limitation: real content
// documents in production are always a live `iframe.contentDocument`
// (never a detached DOMParser result), where this doesn't apply.
beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Page", () => {
  it("computes height as the difference between bottomY and topY", () => {
    document.body.innerHTML = "<p>a</p>";
    const body = document.body;
    const page = new Page(0, { node: body, offset: 0 }, { node: body, offset: 1 }, 100, 350);

    expect(page.height).toBe(250);
  });

  it("computes displayTranslateY as the negation of topY", () => {
    document.body.innerHTML = "<p>a</p>";
    const body = document.body;
    const page = new Page(0, { node: body, offset: 0 }, { node: body, offset: 1 }, 500, 900);

    expect(page.displayTranslateY).toBe(-500);
  });

  describe("containsPosition", () => {
    it("returns true for a position strictly between start and end", () => {
      document.body.innerHTML = "<p>one</p><p>two</p><p>three</p>";
      const body = document.body;
      const two = body.children[1]!;
      const page = new Page(0, { node: body, offset: 0 }, { node: body, offset: 3 }, 0, 100);

      expect(page.containsPosition(two.firstChild!, 1, document)).toBe(true);
    });

    it("returns false for a position before the page's start", () => {
      document.body.innerHTML = "<p>one</p><p>two</p><p>three</p>";
      const body = document.body;
      const one = body.children[0]!;
      // Page starts at the 2nd child (index 1, "two"'s <p>).
      const page = new Page(0, { node: body, offset: 1 }, { node: body, offset: 3 }, 0, 100);

      expect(page.containsPosition(one.firstChild!, 0, document)).toBe(false);
    });

    it("returns false for a position at or after the page's exclusive end", () => {
      document.body.innerHTML = "<p>one</p><p>two</p><p>three</p>";
      const body = document.body;
      const three = body.children[2]!;
      // Page covers only the 1st child (index 0 to 1, i.e. just "one").
      const page = new Page(0, { node: body, offset: 0 }, { node: body, offset: 1 }, 0, 100);

      expect(page.containsPosition(three.firstChild!, 0, document)).toBe(false);
    });

    it("returns false (rather than throwing) for a node from a different document", () => {
      document.body.innerHTML = "<p>one</p>";
      const body = document.body;
      const otherDoc = new DOMParser().parseFromString(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>other</p></body></html>',
        "application/xhtml+xml",
      );
      const otherP = otherDoc.getElementsByTagName("p")[0]!;
      const page = new Page(0, { node: body, offset: 0 }, { node: body, offset: 1 }, 0, 100);

      expect(page.containsPosition(otherP.firstChild!, 0, document)).toBe(false);
    });
  });
});
