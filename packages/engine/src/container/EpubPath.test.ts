import { describe, expect, it, vi } from "vitest";
import { resolveEpubPath, directoryOf, splitHrefFragment } from "./EpubPath.js";

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

  it.each([
    ["ch%23one.xhtml", "ch#one.xhtml"],
    ["ch%3Fone.xhtml", "ch?one.xhtml"],
    ["100%25.xhtml", "100%.xhtml"],
    ["ch%2520one.xhtml", "ch%20one.xhtml"],
    ["caf%C3%A9.xhtml", "café.xhtml"],
    ["100%.xhtml", "100%.xhtml"],
  ])("decodes %s exactly once after URL resolution", (href, fileName) => {
    expect(resolveEpubPath("OEBPS/content.opf", href)).toBe(`OEBPS/${fileName}`);
  });

  it.each(["part#one", "part?one", "part%20one", "part one"])(
    "treats the referencing directory %s as an archive path, not a URL",
    (directory) => {
      expect(resolveEpubPath(`OEBPS/${directory}/content.opf`, "./chapter.xhtml")).toBe(
        `OEBPS/${directory}/chapter.xhtml`,
      );
    },
  );

  it("resolves fragment-only references to the unchanged archive filename", () => {
    expect(resolveEpubPath("OEBPS/ch#one%.xhtml", "#section")).toBe("OEBPS/ch#one%.xhtml");
  });

  it("keeps encoded delimiters in the filename while removing a real query and fragment", () => {
    expect(resolveEpubPath("OEBPS/content.opf", "ch%3Fone%23two.xhtml?version=1#section")).toBe(
      "OEBPS/ch?one#two.xhtml",
    );
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

describe("splitHrefFragment", () => {
  it.each([
    ["chapter.xhtml", "chapter.xhtml", undefined],
    ["chapter.xhtml#", "chapter.xhtml", ""],
    ["#section", "", "section"],
    ["chapter.xhtml#arrivée", "chapter.xhtml", "arrivée"],
    ["chapter.xhtml#arriv%C3%A9e", "chapter.xhtml", "arrivée"],
    ["chapter.xhtml#%E7%AF%80-%D9%85%D9%84%D8%A7%D8%AD%D8%B8%D8%A9", "chapter.xhtml", "節-ملاحظة"],
    ["chapter.xhtml#a%23b%3Fc%2Fd%25", "chapter.xhtml", "a#b?c/d%"],
    ["chapter.xhtml#a+b%2Bc", "chapter.xhtml", "a+b+c"],
    ["chapter.xhtml#literal%2520id", "chapter.xhtml", "literal%20id"],
    ["chapter.xhtml#literal%25C3%25A9", "chapter.xhtml", "literal%C3%A9"],
    ["chapter.xhtml#one#two", "chapter.xhtml", "one#two"],
    ["ch%23one.xhtml?edition=2#arriv%C3%A9e", "ch%23one.xhtml?edition=2", "arrivée"],
  ])("splits %s before decoding only its fragment once", (href, path, fragment) => {
    expect(splitHrefFragment(href)).toEqual({ path, fragment });
  });

  it.each(["100%", "bad%2", "bad%GG", "%C3%28", "%FF"])(
    "retains a malformed publisher fragment %s with a warning",
    (fragment) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(splitHrefFragment(`chapter.xhtml#${fragment}`)).toEqual({
          path: "chapter.xhtml",
          fragment,
        });
        expect(warn).toHaveBeenCalledOnce();
      } finally {
        warn.mockRestore();
      }
    },
  );
});
