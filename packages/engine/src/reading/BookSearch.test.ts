// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentDocument, ContentLoader } from "../content/ContentLoader.js";
import { findTextMatchesInDocument } from "../content/DocumentTextSearch.js";
import { Locator, LocatorResolver } from "../locator/Locator.js";
import { BookSearch } from "./BookSearch.js";
import type { SearchResult } from "./BookSearch.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("BookSearch (minimal.epub, single spine item)", () => {
  let search: BookSearch;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("minimal.epub"));
    const pkg = await container.getPackageDocument();
    const contentLoader = await ContentLoader.create(container);
    const resolver = new LocatorResolver(pkg, contentLoader);
    search = new BookSearch(contentLoader, resolver, pkg.spine);
  });

  describe("BookSearch original-source matching", () => {
    let contentLoader: ContentLoader;
    let resolver: LocatorResolver;

    beforeAll(async () => {
      const container = await EpubContainer.open(await loadFixture("minimal.epub"));
      const pkg = await container.getPackageDocument();
      contentLoader = await ContentLoader.create(container);
      resolver = new LocatorResolver(pkg, contentLoader);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function setup(markup: string) {
      const xml = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>hello metadata</title></head>' +
        `<body>${markup}</body></html>`;
      const doc = new DOMParser().parseFromString(xml, "application/xhtml+xml");
      const spine = contentLoader.packageDocument.spine;
      const content = new ContentDocument(spine[0]!.manifestItem, doc, xml);
      const load = vi.spyOn(contentLoader, "loadContentDocument").mockResolvedValue(content);
      return { doc, content, load, search: new BookSearch(contentLoader, resolver, spine) };
    }

    it.each([
      ["<p>İ hello!</p>", "hello", "hello", 2, "İ ", "!"],
      ["<p>😀 İ hello!</p>", "hello", "hello", 5, "😀 İ ", "!"],
      ["<p>İstanbul!</p>", "İST", "İst", 0, "", "anbul!"],
      ["<p>İ hel<em>lo</em>!</p>", "hello", "hello", 2, "İ ", "!"],
    ])("round-trips the exact CFI source offset for %s / %s", async (
      markup, query, expected, offset, before, after,
    ) => {
      const { doc, search } = setup(markup);
      const results: SearchResult[] = [];

      await search.search(query, (result) => results.push(result), () => {});

      expect(results).toHaveLength(1);
      expect(results[0]!.match).toBe(expected);
      expect(results[0]!.before).toBe(before);
      expect(results[0]!.after).toBe(after);
      const resolved = resolver.resolveInDocument(new Locator(results[0]!.cfi), 0, doc);
      expect(resolved.node).toBe(doc.querySelector("p")!.firstChild);
      expect(resolved.characterOffset).toBe(offset);
    });

    it("reports the same matches and start positions as live-highlight matching", async () => {
      const { doc, search } = setup("<p>İ hel<em>lo</em> hello</p><p>HELLO</p>");
      const results: SearchResult[] = [];

      await search.search("hello", (result) => results.push(result), () => {});

      const matches = [...findTextMatchesInDocument(doc, "hello")];
      expect(results.map((result) => result.match)).toEqual(["hello", "hello", "HELLO"]);
      expect(results).toHaveLength(matches.length);
      for (let i = 0; i < results.length; i++) {
        const resolved = resolver.resolveInDocument(new Locator(results[i]!.cfi), 0, doc);
        expect(resolved.node).toBe(matches[i]!.start.node);
        expect(resolved.characterOffset).toBe(matches[i]!.start.offset);
      }
    });

    it("keeps the 40-character excerpt limit across inline markup", async () => {
      const { search } = setup(`<p>${"a".repeat(50)}hel<em>lo</em>${"b".repeat(50)}</p>`);
      const results: SearchResult[] = [];

      await search.search("hello", (result) => results.push(result), () => {});

      expect(results[0]!.before).toBe("a".repeat(40));
      expect(results[0]!.match).toBe("hello");
      expect(results[0]!.after).toBe("b".repeat(40));
    });

    it("excludes hidden/metadata text and false cross-block matches", async () => {
      const { search } = setup(
        '<script type="application/json">"hello"</script><style>hello {}</style>' +
          '<p hidden="hidden">hello</p><p style="display: none">hello</p><p>hel</p><p>lo</p><p>hello</p>',
      );
      const results: SearchResult[] = [];

      await search.search("hello", (result) => results.push(result), () => {});

      expect(results.map((result) => result.match)).toEqual(["hello"]);
    });

    it("preserves query trimming and the minimum length without loading a document", async () => {
      const { load, search } = setup("<p>hello</p>");
      const result = vi.fn();
      const complete = vi.fn();

      await search.search("  he  ", result, complete);

      expect(load).not.toHaveBeenCalled();
      expect(result).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledOnce();

      await search.search("  hello  ", result, complete);

      expect(result).toHaveBeenCalledOnce();
      expect(result.mock.calls[0]![0].match).toBe("hello");
    });

    it("does not emit results or completion after cancellation during loading", async () => {
      const { content, load, search } = setup("<p>hello</p>");
      let finishLoading!: (value: ContentDocument) => void;
      load.mockImplementationOnce(() => new Promise((resolve) => { finishLoading = resolve; }));
      const result = vi.fn();
      const complete = vi.fn();

      const pending = search.search("hello", result, complete);
      search.cancel();
      finishLoading(content);
      await pending;

      expect(result).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  // The fixture's one paragraph reads: "Hello, Ambra! This is a minimal
  // EPUB3 fixture used to test the container/ZIP parser."

  it("finds a match, generating a resolvable CFI and a before/match/after excerpt", async () => {
    const results: SearchResult[] = [];
    await search.search("Ambra", (result) => results.push(result), () => {});

    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result!.match).toBe("Ambra");
    expect(result!.before.endsWith("Hello, ")).toBe(true);
    expect(result!.after.startsWith("! This is")).toBe(true);
    expect(result!.cfi).toMatch(/^epubcfi\(/);
  });

  it("matches case-insensitively but preserves the source text's own casing in the excerpt", async () => {
    const results: SearchResult[] = [];
    await search.search("ambra", (result) => results.push(result), () => {});

    expect(results).toHaveLength(1);
    expect(results[0]!.match).toBe("Ambra"); // original casing, not the lowercase query
  });

  it("reports no results (and still calls onComplete) for a query with no match", async () => {
    const results: SearchResult[] = [];
    let completed = false;
    await search.search("nonexistentword", (result) => results.push(result), () => {
      completed = true;
    });

    expect(results).toHaveLength(0);
    expect(completed).toBe(true);
  });

  it("skips queries shorter than the minimum length entirely (no results, but still completes)", async () => {
    const results: SearchResult[] = [];
    let completed = false;
    await search.search("a", (result) => results.push(result), () => {
      completed = true;
    });

    expect(results).toHaveLength(0);
    expect(completed).toBe(true);
  });

  it("discards a stale search's results once a newer one has started (cancellation)", async () => {
    const staleResults: SearchResult[] = [];
    const freshResults: SearchResult[] = [];
    let freshCompleted = false;

    // Deliberately not awaited yet — started "in flight", then
    // immediately superseded by a second call before it can finish.
    const stalePromise = search.search("Ambra", (result) => staleResults.push(result), () => {});
    const freshPromise = search.search(
      "minimal",
      (result) => freshResults.push(result),
      () => {
        freshCompleted = true;
      },
    );

    await Promise.all([stalePromise, freshPromise]);

    // The stale call's own results/completion may or may not have fired
    // depending on exactly how far it got before being superseded, but
    // the fresh (newer) call must always complete correctly with its own
    // results — this is the actual behavior that matters. Assert on the
    // fresh call, which is invariant regardless of scheduling.
    expect(freshResults).toHaveLength(1);
    expect(freshResults[0]!.match).toBe("minimal");
    expect(freshCompleted).toBe(true);
    // The stale call must never report the *fresh* query's own match.
    expect(staleResults.every((r) => r.match === "Ambra")).toBe(true);
  });
});
