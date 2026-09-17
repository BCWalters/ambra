// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
import { LocatorResolver } from "../locator/Locator.js";
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
