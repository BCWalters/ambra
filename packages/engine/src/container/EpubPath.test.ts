import { describe, expect, it } from "vitest";
import { resolveEpubPath, directoryOf } from "./EpubPath.js";

describe("resolveEpubPath", () => {
  it("resolves a plain sibling href relative to the referencing file's directory", () => {
    expect(resolveEpubPath("OEBPS/content.opf", "chapter1.xhtml")).toBe("OEBPS/chapter1.xhtml");
  });

  it("resolves a subdirectory href", () => {
    expect(resolveEpubPath("OEBPS/content.opf", "text/chapter1.xhtml")).toBe(
      "OEBPS/text/chapter1.xhtml",
    );
  });

  it("resolves a parent-directory-relative href", () => {
    expect(resolveEpubPath("OEBPS/text/chapter1.xhtml", "../styles/main.css")).toBe(
      "OEBPS/styles/main.css",
    );
  });

  it("resolves an href with no directory component in the referencing path", () => {
    expect(resolveEpubPath("content.opf", "chapter1.xhtml")).toBe("chapter1.xhtml");
  });

  it("decodes percent-encoded characters in the href", () => {
    expect(resolveEpubPath("OEBPS/content.opf", "chapter%201.xhtml")).toBe("OEBPS/chapter 1.xhtml");
  });

  it("strips a fragment identifier from the resolved path", () => {
    // Fragment resolution (the part after #) is the caller's concern for
    // things like nav.xhtml TOC entries; resolveEpubPath only resolves the
    // path portion since it's shared by manifest hrefs (which never have
    // fragments) and other consumers may want the fragment preserved
    // separately via their own handling.
    expect(resolveEpubPath("OEBPS/content.opf", "chapter1.xhtml#section2")).toBe(
      "OEBPS/chapter1.xhtml",
    );
  });
});

describe("directoryOf", () => {
  it("returns the directory portion of a nested path", () => {
    expect(directoryOf("OEBPS/text/chapter1.xhtml")).toBe("OEBPS/text");
  });

  it("returns an empty string for a path with no directory", () => {
    expect(directoryOf("mimetype")).toBe("");
  });
});
