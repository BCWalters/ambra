// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ReadingTheme } from "./ReadingTheme.js";

describe("ReadingTheme", () => {
  it("defaults to a font scale of 1 when never set", () => {
    const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    expect(ReadingTheme.currentFontScale(doc)).toBe(1);
  });

  it("round-trips a font scale within range", () => {
    const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    ReadingTheme.applyFontScale(doc, 1.25);
    expect(ReadingTheme.currentFontScale(doc)).toBe(1.25);
  });

  it("clamps a font scale below the minimum", () => {
    const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    ReadingTheme.applyFontScale(doc, 0.1);
    expect(ReadingTheme.currentFontScale(doc)).toBe(ReadingTheme.MIN_FONT_SCALE);
  });

  it("clamps a font scale above the maximum", () => {
    const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    ReadingTheme.applyFontScale(doc, 10);
    expect(ReadingTheme.currentFontScale(doc)).toBe(ReadingTheme.MAX_FONT_SCALE);
  });
});
