import { afterEach, describe, expect, it, vi } from "vitest";
import { httpImportOrigins } from "./epubImportHandoff.js";

describe("direct-import host patterns", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("checks schemes independently, deduplicates hosts, and excludes URL secrets and ports", () => {
    expect(httpImportOrigins([
      "https://example.com:8443/a.epub?secret=one", "https://example.com/b.epub",
      "http://example.com/c.epub", "https://cdn.example.org/d.epub",
    ])).toEqual(["https://example.com/*", "http://example.com/*", "https://cdn.example.org/*"]);
  });

  it.each(["blob:https://example.com/a", "file:///book.epub", "bad url", "https://user:password@example.com/a"])(
    "declines unsupported or credential-bearing URL %s", (url) => {
      expect(httpImportOrigins([url])).toBeUndefined();
    },
  );

  it("does not hide unexpected URL implementation errors", () => {
    const failure = new Error("Unexpected URL implementation failure");
    vi.stubGlobal("URL", class {
      constructor() { throw failure; }
    });
    expect(() => httpImportOrigins(["https://example.com/book.epub"])).toThrow(failure);
  });
});
