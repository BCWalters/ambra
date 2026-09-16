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

  it("sets the font-family custom property to the chosen stack", () => {
    const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    ReadingTheme.applyFontFamily(doc, "times");
    expect(doc.documentElement.style.getPropertyValue(ReadingTheme.FONT_FAMILY_PROPERTY)).toBe(
      ReadingTheme.FONT_FAMILIES.times.stack,
    );
  });

  it("sets the font-family custom property to unset for book-default", () => {
    const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    ReadingTheme.applyFontFamily(doc, "book-default");
    expect(doc.documentElement.style.getPropertyValue(ReadingTheme.FONT_FAMILY_PROPERTY)).toBe("unset");
  });

  it("sets the page theme's background/foreground/link custom properties", () => {
    const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html");
    ReadingTheme.applyPageTheme(doc, "dark");
    const style = doc.documentElement.style;
    expect(style.getPropertyValue(ReadingTheme.PAGE_BACKGROUND_PROPERTY)).toBe(ReadingTheme.PAGE_THEMES.dark.background);
    expect(style.getPropertyValue(ReadingTheme.PAGE_FOREGROUND_PROPERTY)).toBe(ReadingTheme.PAGE_THEMES.dark.foreground);
    expect(style.getPropertyValue(ReadingTheme.LINK_COLOR_PROPERTY)).toBe(ReadingTheme.PAGE_THEMES.dark.linkColor);
  });
});
