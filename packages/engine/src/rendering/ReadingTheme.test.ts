// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { ReadingTheme, defaultFontFamilyForPlatform } from "./ReadingTheme.js";

describe("defaultFontFamilyForPlatform", () => {
  it("picks Sitka for any Windows platform string", () => {
    expect(defaultFontFamilyForPlatform("Windows")).toBe("sitka");
    expect(defaultFontFamilyForPlatform("Win32")).toBe("sitka");
    expect(defaultFontFamilyForPlatform("Windows NT 10.0; Win64; x64")).toBe("sitka");
  });

  it("picks Palatino for macOS/iOS platform strings", () => {
    expect(defaultFontFamilyForPlatform("macOS")).toBe("palatino");
    expect(defaultFontFamilyForPlatform("MacIntel")).toBe("palatino");
    expect(defaultFontFamilyForPlatform("iPhone")).toBe("palatino");
  });

  it("picks Palatino for Android, Linux, ChromeOS, and unrecognized platforms", () => {
    expect(defaultFontFamilyForPlatform("Android")).toBe("palatino");
    expect(defaultFontFamilyForPlatform("Linux x86_64")).toBe("palatino");
    expect(defaultFontFamilyForPlatform("Chrome OS")).toBe("palatino");
    expect(defaultFontFamilyForPlatform("")).toBe("palatino");
    expect(defaultFontFamilyForPlatform("something entirely unexpected")).toBe("palatino");
  });
});

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
    expect(doc.documentElement.getAttribute(ReadingTheme.PAGE_THEME_ATTRIBUTE)).toBe("dark");
  });
});

describe("explicit reflowable page colors (#185)", () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.body.removeAttribute("class");
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute(ReadingTheme.PAGE_THEME_ATTRIBUTE);
  });

  function publication() {
    const doc = document;
    doc.head.innerHTML = `<style>${ReadingTheme.CSS}</style><style>
      body.tei.tei-text { color: black; background-color: white; }
      a:link, a:visited { color: blue; }
      .warning { color: red; background-color: yellow; }
    </style>`;
    doc.body.className = "tei tei-text";
    doc.body.innerHTML = `<p>Plain text <a href="#note">Reference</a></p>
      <p class="warning">Meaningful publisher colors</p>
      <svg xmlns="http://www.w3.org/2000/svg"><rect fill="green" width="10" height="10"/></svg>`;
    return doc;
  }

  it.each(["white", "sepia", "dark"] as const)("overrides publisher body resets with %s without rewriting publication styles", (theme) => {
    const doc = publication();
    const publisherCss = doc.head.lastElementChild!.textContent;
    ReadingTheme.applyPageTheme(doc, theme);
    const computed = (element: Element) => doc.defaultView!.getComputedStyle(element);
    const expected = ReadingTheme.PAGE_THEMES[theme];
    const probe = doc.createElement("span");
    probe.style.color = expected.foreground;
    probe.style.backgroundColor = expected.background;
    doc.body.appendChild(probe);
    expect(computed(doc.body).backgroundColor).toBe(computed(probe).backgroundColor);
    expect(computed(doc.body).color).toBe(computed(probe).color);
    expect(doc.querySelector("rect")?.getAttribute("fill")).toBe("green");
    expect(doc.head.lastElementChild?.textContent).toBe(publisherCss);
  });

  it("leaves the publisher cascade intact until a page palette is applied", () => {
    const doc = publication();
    expect(doc.documentElement.hasAttribute(ReadingTheme.PAGE_THEME_ATTRIBUTE)).toBe(false);
    expect(doc.defaultView!.getComputedStyle(doc.body).backgroundColor).toBe("white");
    expect(doc.defaultView!.getComputedStyle(doc.body).color).toBe("black");
  });

  it("switches back to White without changing the book-default font choice", () => {
    const doc = publication();
    ReadingTheme.applyFontFamily(doc, "book-default");
    ReadingTheme.applyPageTheme(doc, "dark");
    ReadingTheme.applyPageTheme(doc, "white");
    expect(doc.documentElement.getAttribute(ReadingTheme.PAGE_THEME_ATTRIBUTE)).toBe("white");
    expect(doc.documentElement.style.getPropertyValue(ReadingTheme.PAGE_BACKGROUND_PROPERTY)).toBe("#ffffff");
    expect(doc.documentElement.style.getPropertyValue(ReadingTheme.PAGE_FOREGROUND_PROPERTY)).toBe("#1a1a1a");
    expect(doc.documentElement.style.getPropertyValue(ReadingTheme.FONT_FAMILY_PROPERTY)).toBe("unset");
  });
});
