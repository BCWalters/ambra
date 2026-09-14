// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { globalTextOffsetToPosition, totalTextLength } from "./DomTextWalker.js";

function parseXhtmlFragment(html: string): Document {
  return new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml">${html}</html>`,
    "application/xhtml+xml",
  );
}

describe("totalTextLength", () => {
  it("sums text across nested inline elements", () => {
    const doc = parseXhtmlFragment("<body><p>Hello <em>world</em> today</p></body>");
    const p = doc.getElementsByTagName("p")[0]!;

    expect(totalTextLength(p)).toBe("Hello world today".length);
  });
});

describe("globalTextOffsetToPosition", () => {
  it("resolves an offset within the first text node", () => {
    const doc = parseXhtmlFragment("<body><p>Hello <em>world</em> today</p></body>");
    const p = doc.getElementsByTagName("p")[0]!;

    const result = globalTextOffsetToPosition(p, 3);
    expect(result?.node.data).toBe("Hello ");
    expect(result?.offset).toBe(3);
  });

  it("resolves an offset that falls within a nested inline element's text node", () => {
    const doc = parseXhtmlFragment("<body><p>Hello <em>world</em> today</p></body>");
    const p = doc.getElementsByTagName("p")[0]!;

    // "Hello " (6 chars) + 2 more chars into "world" = offset 8
    const result = globalTextOffsetToPosition(p, 8);
    expect(result?.node.data).toBe("world");
    expect(result?.offset).toBe(2);
  });

  it("resolves an offset that falls in the final text node", () => {
    const doc = parseXhtmlFragment("<body><p>Hello <em>world</em> today</p></body>");
    const p = doc.getElementsByTagName("p")[0]!;

    // "Hello " (6) + "world" (5) = 11, then " today" starts; offset 12 is 1 char into " today"
    const result = globalTextOffsetToPosition(p, 12);
    expect(result?.node.data).toBe(" today");
    expect(result?.offset).toBe(1);
  });

  it("clamps an offset equal to the total length to the end of the last text node", () => {
    const doc = parseXhtmlFragment("<body><p>Hello <em>world</em> today</p></body>");
    const p = doc.getElementsByTagName("p")[0]!;
    const total = totalTextLength(p);

    const result = globalTextOffsetToPosition(p, total);
    expect(result?.node.data).toBe(" today");
    expect(result?.offset).toBe(" today".length);
  });

  it("returns undefined for an empty element with no text nodes", () => {
    const doc = parseXhtmlFragment("<body><div></div></body>");
    const div = doc.getElementsByTagName("div")[0]!;

    expect(globalTextOffsetToPosition(div, 0)).toBeUndefined();
  });
});
