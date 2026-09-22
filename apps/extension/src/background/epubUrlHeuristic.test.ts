import { describe, expect, it } from "vitest";
import { isLikelyEpubDownload } from "./epubUrlHeuristic.js";

describe("isLikelyEpubDownload", () => {
  it("matches the exact EPUB MIME type regardless of URL/filename", () => {
    expect(
      isLikelyEpubDownload({ url: "https://example.com/download", mime: "application/epub+zip" }),
    ).toBe(true);
  });

  it("matches a filename ending in .epub", () => {
    expect(isLikelyEpubDownload({ url: "https://example.com/x", filename: "book.epub" })).toBe(true);
    expect(isLikelyEpubDownload({ url: "https://example.com/x", filename: "book.EPUB" })).toBe(true);
  });

  it("matches a plain .epub URL path even with no filename/mime yet (onCreated timing)", () => {
    expect(isLikelyEpubDownload({ url: "https://example.com/books/book.epub" })).toBe(true);
  });

  it("matches Project Gutenberg's own non-.epub-suffixed direct download URLs", () => {
    expect(isLikelyEpubDownload({ url: "https://www.gutenberg.org/ebooks/84.epub3.images" })).toBe(true);
    expect(isLikelyEpubDownload({ url: "https://www.gutenberg.org/ebooks/84.epub.noimages" })).toBe(true);
  });

  it("does not match an unrelated file", () => {
    expect(isLikelyEpubDownload({ url: "https://example.com/report.pdf", filename: "report.pdf" })).toBe(false);
    expect(
      isLikelyEpubDownload({ url: "https://example.com/archive.zip", mime: "application/zip" }),
    ).toBe(false);
  });

  it("does not false-positive on a URL that merely contains 'epub' without a dot-boundary", () => {
    expect(isLikelyEpubDownload({ url: "https://example.com/myepublisher/report.pdf" })).toBe(false);
  });

  it("does not throw on a malformed URL, and treats it as not an EPUB", () => {
    expect(isLikelyEpubDownload({ url: "not a url" })).toBe(false);
  });
});
