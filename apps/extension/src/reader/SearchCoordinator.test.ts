import { describe, expect, it, vi } from "vitest";
import type { ContentLoader, LocatorResolver, SpineItemRef } from "@ambra/engine";
import { SearchCoordinator, type SearchCoordinatorContext } from "./SearchCoordinator.js";

/** A `SpineItemRef[]` too short to ever be walked by `BookSearch` (empty),
 * so these tests exercise `SearchCoordinator`'s own orchestration state
 * (query/results/isSearching/highlight spotlight/panel-pinned) without
 * needing a real content document — `BookSearch`'s own text-matching
 * logic already has its own dedicated unit tests in `@ambra/engine`. */
const EMPTY_SPINE: readonly SpineItemRef[] = [];

/** A single spine item whose content never loads (see
 * `makeStalledContentLoader`) — used only by the one test that needs
 * `BookSearch`'s scan to still be in flight (not already synchronously
 * complete, as it is with `EMPTY_SPINE`) right after calling `search()`. */
const ONE_ITEM_SPINE: readonly SpineItemRef[] = [{ manifestItem: {} } as unknown as SpineItemRef];

function makeContentLoader(): ContentLoader {
  return {} as unknown as ContentLoader;
}

/** A `ContentLoader` whose `loadContentDocument` never settles during a
 * test (rejects, but only once awaited) — forces `BookSearch.search`'s
 * internal `await` to actually suspend instead of completing
 * synchronously, so `isSearching` can be observed still `true` right
 * after `search()` returns. */
function makeStalledContentLoader(): ContentLoader {
  return { loadContentDocument: vi.fn().mockRejectedValue(new Error("never resolves in this test")) } as unknown as ContentLoader;
}

function makeLocatorResolver(): LocatorResolver {
  return {} as unknown as LocatorResolver;
}

function makeContext(overrides: Partial<SearchCoordinatorContext> = {}): SearchCoordinatorContext {
  return {
    goToCfi: vi.fn().mockResolvedValue(undefined),
    chapterLabel: (spineIndex: number) => `Chapter ${spineIndex + 1}`,
    repaintHighlight: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  };
}

/** Flushes the microtask/timeout queue `BookSearch.search`'s internal
 * per-spine-item `setTimeout(resolve, 0)` yields need to settle, since
 * `SearchCoordinator.search` fires it off with `void` (fire-and-forget). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SearchCoordinator", () => {
  it("starts with no query, no results, and not searching", () => {
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, makeContext());

    expect(coordinator.snapshot).toEqual({ searchQuery: "", searchResults: [], isSearching: false });
    expect(coordinator.currentHighlightQuery).toBeUndefined();
  });

  it("search() records the query, marks isSearching, and repaints/notifies immediately", async () => {
    const ctx = makeContext();
    const coordinator = new SearchCoordinator(makeStalledContentLoader(), makeLocatorResolver(), ONE_ITEM_SPINE, ctx);

    coordinator.search("faun");

    expect(coordinator.snapshot.searchQuery).toBe("faun");
    expect(coordinator.snapshot.isSearching).toBe(true);
    expect(ctx.repaintHighlight).toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalled();
    await flush();
  });

  it("search() clears isSearching once the (empty-spine) scan completes", async () => {
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, makeContext());

    coordinator.search("faun");
    await flush();

    expect(coordinator.snapshot.isSearching).toBe(false);
  });

  it("search() below MIN_QUERY_LENGTH clears results but sets no highlight", () => {
    const ctx = makeContext();
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, ctx);

    coordinator.search("fa");

    expect(coordinator.snapshot.isSearching).toBe(false);
    expect(coordinator.currentHighlightQuery).toBeUndefined();
  });

  it("search() at/above MIN_QUERY_LENGTH arms the highlight spotlight", () => {
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, makeContext());

    coordinator.search("faun");

    expect(coordinator.currentHighlightQuery).toBe("faun");
  });

  it("a fresh search() replaces any still-in-flight previous results", () => {
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, makeContext());

    coordinator.search("faun");
    coordinator.search("lucy");

    expect(coordinator.snapshot.searchQuery).toBe("lucy");
    expect(coordinator.snapshot.searchResults).toEqual([]);
  });

  it("goToResult navigates via the context and re-arms the highlight spotlight", async () => {
    const ctx = makeContext();
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, ctx);
    coordinator.search("faun");
    vi.mocked(ctx.repaintHighlight).mockClear();

    await coordinator.goToResult("epubcfi(/6/4!/4/2/2/1:0)");

    expect(ctx.goToCfi).toHaveBeenCalledWith("epubcfi(/6/4!/4/2/2/1:0)");
    expect(coordinator.currentHighlightQuery).toBe("faun");
    expect(ctx.repaintHighlight).toHaveBeenCalled();
  });

  it("setPanelState(open) recomputes the highlight from the current query", () => {
    const ctx = makeContext();
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, ctx);
    coordinator.search("faun");
    coordinator.setPanelState(false, false);
    expect(coordinator.currentHighlightQuery).toBe("faun");

    coordinator.setPanelState(true, false);

    expect(coordinator.currentHighlightQuery).toBe("faun");
  });

  it("clearHighlightUnlessPinned clears an unpinned spotlight", () => {
    const ctx = makeContext();
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, ctx);
    coordinator.search("faun");

    coordinator.clearHighlightUnlessPinned();

    expect(coordinator.currentHighlightQuery).toBeUndefined();
  });

  it("clearHighlightUnlessPinned leaves a pinned spotlight alone", () => {
    const ctx = makeContext();
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, ctx);
    coordinator.search("faun");
    coordinator.setPanelState(true, true);

    coordinator.clearHighlightUnlessPinned();

    expect(coordinator.currentHighlightQuery).toBe("faun");
  });

  it("closing a previously-pinned panel clears the spotlight", () => {
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, makeContext());
    coordinator.search("faun");
    coordinator.setPanelState(true, true);

    coordinator.setPanelState(false, false);

    expect(coordinator.currentHighlightQuery).toBeUndefined();
  });

  it("closing a never-pinned panel leaves the spotlight alone", () => {
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, makeContext());
    coordinator.search("faun");
    coordinator.setPanelState(true, false);

    coordinator.setPanelState(false, false);

    expect(coordinator.currentHighlightQuery).toBe("faun");
  });

  it("dispose() cancels any in-flight search without throwing", () => {
    const coordinator = new SearchCoordinator(makeContentLoader(), makeLocatorResolver(), EMPTY_SPINE, makeContext());
    coordinator.search("faun");

    expect(() => coordinator.dispose()).not.toThrow();
  });
});
