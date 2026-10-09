import { describe, expect, it, vi } from "vitest";
import { classifyEpubReference, externalNavigationUrl } from "./EpubReference.js";

describe("shared EPUB URL classification", () => {
  it.each(["data:text/html,ignored", "java\nscript:void(0)", "https://"])(
    "ignores forbidden/invalid HTML base %s with a diagnostic rather than adopting a later base",
    base => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(classifyEpubReference("EPUB/chapter.xhtml", "image.png", base)).toEqual({
          kind: "package", path: "EPUB/image.png", fragment: undefined,
        });
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    },
  );

  it.each([
    ["../assets/", "image%23one.png", { kind: "package", path: "OEBPS/assets/image#one.png", fragment: undefined }],
    ["../assets/", "#target", { kind: "package", path: "OEBPS/assets/", fragment: "target" }],
    ["../next.xhtml", "#one%20two", { kind: "package", path: "OEBPS/next.xhtml", fragment: "one two" }],
    ["chapter.xhtml", "#local", { kind: "fragment", fragment: "local" }],
    ["https://base.invalid/assets/", "../image.png", { kind: "https", url: "https://base.invalid/image.png" }],
    ["https://base.invalid/assets/", "#target", { kind: "https", url: "https://base.invalid/assets/#target" }],
    ["file:///private/assets/", "image.png", { kind: "file", url: "file:///private/assets/image.png" }],
    ["//base.invalid/assets/", "image.png", { kind: "https", url: "https://base.invalid/assets/image.png" }],
    ["mailto:reader@example.test", "image.png", { kind: "unsupported", url: "mailto:reader@example.test" }],
    ["../assets/", "data:image/png;base64,AAAA", { kind: "data", url: "data:image/png;base64,AAAA" }],
  ])("resolves %s as the document base for %s without scheme aliasing", (base, href, expected) => {
    expect(classifyEpubReference("OEBPS/text/chapter.xhtml", href, base)).toEqual(expected);
  });

  it.each([
    ["../images/a%20b%23c%3Fd%25.png?version=1#view", "OEBPS/images/a b#c?d%.png", "view"],
    ["/images/root.png", "images/root.png", undefined],
    ["./chapter%3A1.xhtml#one%20two", "OEBPS/text/chapter:1.xhtml", "one two"],
    ["?version=2#self", "OEBPS/text/chapter.xhtml", "self"],
  ])("resolves package URL %s only after separating URL syntax", (href, path, fragment) => {
    expect(classifyEpubReference("OEBPS/text/chapter.xhtml", href)).toEqual({
      kind: "package",
      path,
      fragment,
    });
  });

  it.each([
    ["#local", "fragment"],
    ["", "fragment"],
    ["DATA:image/png;base64,AAAA", "data"],
    ["https://example.test/pic.png", "https"],
    ["http://example.test/pic.png", "http"],
    ["file:///tmp/pic.png", "file"],
    ["//example.test/pic.png", "protocol-relative"],
    ["\\\\example.test\\pic.png", "protocol-relative"],
    ["mailto:reader@example.test", "mailto"],
    ["javascript:void(0)", "unsupported"],
    ["blob:publisher-controlled", "unsupported"],
    ["custom:resource", "unsupported"],
    ["https://", "unsupported"],
    [" \tFi\nLe:\r///tmp/pic.png ", "file"],
    ["\u0000javascript:void(0)\u0000", "unsupported"],
  ])("classifies %s as %s before archive lookup", (href, kind) => {
    expect(classifyEpubReference("OEBPS/chapter.xhtml", href).kind).toBe(kind);
  });

  it.each([
    ["https://example.test/link#part", "https://example.test/link#part"],
    ["http://example.test/link", "http://example.test/link"],
    ["//example.test/link", "https://example.test/link"],
    ["mailto:reader@example.test", "mailto:reader@example.test"],
    ["file:///tmp/book", undefined],
    ["data:text/html,hello", undefined],
    ["javascript:void(0)", undefined],
    ["blob:external", undefined],
    ["chapter.xhtml", undefined],
  ])(
    "allows external navigation to %s only through the explicit affordance policy",
    (href, expected) => {
      expect(externalNavigationUrl(classifyEpubReference("chapter.xhtml", href))).toBe(expected);
    },
  );
});
