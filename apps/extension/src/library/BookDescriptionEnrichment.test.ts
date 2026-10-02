import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichBookDescription } from "./BookDescriptionEnrichment.js";
import type { BookMetadata, LibraryDatabase } from "./LibraryDatabase.js";

describe("shared Library/reader description enrichment", () => {
  let book: BookMetadata | undefined;
  const getBookMetadata = vi.fn<LibraryDatabase["getBookMetadata"]>();
  const recordDescriptionFetchResult = vi.fn<LibraryDatabase["recordDescriptionFetchResult"]>();
  const library = { getBookMetadata, recordDescriptionFetchResult };
  const fetch = vi.fn<typeof globalThis.fetch>();

  beforeEach(() => {
    book = {
      id: "book", title: "An original test book", creator: "Test Author", identifier: "test",
      addedAt: 0, fileName: "book.epub", description: undefined, fetchedDescription: undefined,
      fetchedDescriptionSourceName: undefined, fetchedDescriptionSourceUrl: undefined,
      descriptionFetchAttempts: undefined, publisher: undefined, rights: undefined,
      identifiers: [], accessibility: undefined,
    };
    getBookMetadata.mockReset().mockImplementation(async () => book);
    recordDescriptionFetchResult.mockReset().mockImplementation(async (_id, result) => {
      if (book) book = { ...book, fetchedDescription: result?.description,
        descriptionFetchAttempts: (book.descriptionFetchAttempts ?? 0) + (result ? 0 : 1) };
    });
    fetch.mockReset().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const held = new Set<string>();
    vi.stubGlobal("navigator", { locks: {
      request: async (name: string, options: LockOptions, action: (lock: Lock | null) => Promise<void>) => {
        expect(options.ifAvailable).toBe(true);
        if (held.has(name)) return action(null);
        held.add(name);
        try { await action({ name, mode: "exclusive" }); }
        finally { held.delete(name); }
      },
    } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["own", "fetched", "exhausted", "removed"] as const)("does not search when %s", async state => {
    if (state === "removed") book = undefined;
    else book = { ...book!,
      description: state === "own" ? "Publisher description" : undefined,
      fetchedDescription: state === "fetched" ? "Saved description" : undefined,
      descriptionFetchAttempts: state === "exhausted" ? 3 : undefined };
    await enrichBookDescription(library, "book", () => true);
    expect(fetch).not.toHaveBeenCalled();
    expect(recordDescriptionFetchResult).not.toHaveBeenCalled();
  });

  it("uses stored ISBN metadata and persists the description with attribution", async () => {
    book = { ...book!, identifiers: [{ scheme: "ISBN", value: "978-0-123456-78-9" }] };
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ description: "An original fallback." })));
    await enrichBookDescription(library, "book", () => true);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://openlibrary.org/isbn/9780123456789.json");
    expect(recordDescriptionFetchResult).toHaveBeenCalledExactlyOnceWith("book", {
      description: "An original fallback.", sourceName: "Open Library",
      sourceUrl: "https://openlibrary.org/isbn/9780123456789",
    });
    await enrichBookDescription(library, "book", () => true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("limits misses to three attempts across repeated detail and reader opens", async () => {
    fetch.mockImplementation(async () => new Response("{}"));
    for (let i = 0; i < 5; i++) await enrichBookDescription(library, "book", () => true);
    expect(recordDescriptionFetchResult).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(book?.descriptionFetchAttempts).toBe(3);
  });

  it("does not launch a second lookup while another surface owns it", async () => {
    let finish!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const first = enrichBookDescription(library, "book", () => true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await enrichBookDescription(library, "book", () => true);
    expect(getBookMetadata).toHaveBeenCalledOnce();
    finish(new Response("{}"));
    await first;
    expect(recordDescriptionFetchResult).toHaveBeenCalledOnce();
  });

  it("does not read or write a disposed owner's database", async () => {
    await enrichBookDescription(library, "book", () => false);
    expect(getBookMetadata).not.toHaveBeenCalled();
    let active = true;
    fetch.mockImplementation(async () => { active = false; return new Response("{}"); });
    await enrichBookDescription(library, "book", () => active);
    expect(recordDescriptionFetchResult).not.toHaveBeenCalled();
  });

  it("propagates storage failures to the caller's existing error surface", async () => {
    getBookMetadata.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(enrichBookDescription(library, "book", () => true)).rejects.toThrow("Storage unavailable");
  });
});
