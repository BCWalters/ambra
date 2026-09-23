import { describe, expect, it, vi } from "vitest";
import type { LocatorResolver, Page } from "@ambra/engine";
import type { LibraryDatabase, Bookmark } from "../library/LibraryDatabase.js";
import { BookmarkManager, type BookmarkManagerContext } from "./BookmarkManager.js";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "bm-1",
    bookId: "book-1",
    cfi: "epubcfi(/6/4!/4/2/2/1:0)",
    label: "Chapter 1 — Page 1",
    createdAt: 0,
    ...overrides,
  };
}

/** A fake `Page` that reports every position as "contained" (or none, if
 * `contains: false`) — BookmarkManager only ever asks a page "does this
 * resolved position land on you?", so that's all a fake needs to answer. */
function makePage(contains: boolean): Page {
  return { containsPosition: () => contains } as unknown as Page;
}

function makeLocatorResolver(resolves: boolean): LocatorResolver {
  return {
    generate: vi.fn().mockReturnValue({ cfi: "epubcfi(/6/4!/4/2/2/1:0)" }),
    resolveInDocument: vi.fn().mockImplementation(() => {
      if (!resolves) {
        throw new Error("does not resolve against this document");
      }
      return { node: {} as Node, characterOffset: 0 };
    }),
  } as unknown as LocatorResolver;
}

function makeLibrary(initialBookmarks: Bookmark[] = []): LibraryDatabase {
  const stored = [...initialBookmarks];
  return {
    listBookmarksForBook: vi.fn().mockImplementation(async () => [...stored]),
    addBookmark: vi.fn().mockImplementation(async (bookId: string, cfi: string, label: string) => {
      const bookmark = makeBookmark({ id: `bm-${stored.length + 1}`, bookId, cfi, label });
      stored.push(bookmark);
      return bookmark;
    }),
    removeBookmarks: vi.fn().mockImplementation(async (ids: readonly string[]) => {
      for (const id of ids) {
        const index = stored.findIndex((b) => b.id === id);
        if (index !== -1) stored.splice(index, 1);
      }
    }),
  } as unknown as LibraryDatabase;
}

function makeContext(overrides: Partial<BookmarkManagerContext> = {}): BookmarkManagerContext {
  return {
    currentPosition: () => ({ node: {} as Node, offset: 0 }),
    currentPagesAndDocuments: () => [{ page: makePage(true), document: {} as Document, spineIndex: 2 }],
    currentPageIndex: () => 4,
    spineIndex: () => 2,
    chapterLabel: () => "Chapter 3",
    announce: vi.fn(),
    reportError: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  };
}

describe("BookmarkManager", () => {
  it("loads bookmarks from the library", async () => {
    const library = makeLibrary([makeBookmark()]);
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), makeContext());

    await manager.load();

    expect(manager.allSorted()).toHaveLength(1);
  });

  it("adds a bookmark at the current position, labeled with chapter + page", async () => {
    const library = makeLibrary();
    const ctx = makeContext();
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    const bookmark = await manager.add();

    expect(bookmark?.label).toBe("Chapter 3 — Page 5");
    expect(ctx.announce).toHaveBeenCalledWith("announcements.bookmarkAdded");
    expect(ctx.notify).toHaveBeenCalled();
  });

  it("labels a bookmark with just the chapter when there's no page index (scroll/fixed-layout)", async () => {
    const library = makeLibrary();
    const ctx = makeContext({ currentPageIndex: () => undefined });
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    const bookmark = await manager.add();

    expect(bookmark?.label).toBe("Chapter 3");
  });

  it("reports a failed save via reportError instead of silently doing nothing (issue: dedicated error-handling review)", async () => {
    const library = {
      listBookmarksForBook: vi.fn().mockResolvedValue([]),
      addBookmark: vi.fn().mockRejectedValue(new DOMException("quota", "QuotaExceededError")),
    } as unknown as LibraryDatabase;
    const ctx = makeContext();
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    const bookmark = await manager.add();

    expect(bookmark).toBeUndefined();
    expect(ctx.reportError).toHaveBeenCalledTimes(1);
    expect(ctx.announce).not.toHaveBeenCalledWith("announcements.bookmarkAdded");
  });

  it("returns undefined without touching the library when there's no current position", async () => {
    const library = makeLibrary();
    const ctx = makeContext({ currentPosition: () => undefined });
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    const bookmark = await manager.add();

    expect(bookmark).toBeUndefined();
    expect(library.addBookmark).not.toHaveBeenCalled();
  });

  it("removes a bookmark from both the cache and the library", async () => {
    const existing = makeBookmark({ id: "bm-1" });
    const library = makeLibrary([existing]);
    const ctx = makeContext();
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    await manager.remove("bm-1");

    expect(ctx.notify).toHaveBeenCalled();
    expect(library.removeBookmarks).toHaveBeenCalledWith(["bm-1"]);
  });

  it("keeps bookmark state visible until removal commits", async () => {
    const existing = makeBookmark();
    const library = makeLibrary([existing]);
    const ctx = makeContext();
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();
    let commit!: () => void;
    vi.mocked(library.removeBookmarks).mockImplementation(() => new Promise(resolve => { commit = resolve; }));

    const removal = manager.remove(existing.id);
    expect(manager.allSorted()).toEqual([existing]);
    expect(manager.onCurrentPage()).toEqual([existing]);
    expect(ctx.notify).not.toHaveBeenCalled();
    commit();
    await removal;
    expect(manager.allSorted()).toEqual([]);
    expect(ctx.notify).toHaveBeenCalledOnce();
  });

  it.each(["remove", "toggle"] as const)("failed %s preserves bookmarks and never announces success", async operation => {
    const existing = makeBookmark();
    const library = makeLibrary([existing]);
    const error = new DOMException("Aborted", "AbortError");
    vi.mocked(library.removeBookmarks).mockRejectedValue(error);
    const ctx = makeContext();
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    if (operation === "remove") await manager.remove(existing.id);
    else await manager.toggle();
    expect(manager.allSorted()).toEqual([existing]);
    expect(ctx.notify).not.toHaveBeenCalled();
    expect(ctx.announce).not.toHaveBeenCalled();
    expect(ctx.reportError).toHaveBeenCalledWith(error);
  });

  it("publishes refreshed bookmarks and sorts newly added entries by position", async () => {
    const later = makeBookmark({ id: "later", cfi: "epubcfi(/6/8!/4/2/2/1:0)" });
    const library = makeLibrary([later]);
    const ctx = makeContext();
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.refresh();
    await manager.add();
    expect(manager.allSorted().map(bookmark => bookmark.id)).toEqual(["bm-2", "later"]);
    expect(ctx.notify).toHaveBeenCalledTimes(2);
  });

  it("onCurrentPage finds bookmarks whose CFI resolves onto the visible page", async () => {
    const existing = makeBookmark({ id: "bm-1" });
    const library = makeLibrary([existing]);
    const ctx = makeContext();
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    expect(manager.onCurrentPage()).toEqual([existing]);
  });

  it("onCurrentPage silently skips bookmarks that fail to resolve against the current document", async () => {
    const existing = makeBookmark({ id: "bm-1" });
    const library = makeLibrary([existing]);
    const ctx = makeContext();
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(false), ctx);
    await manager.load();

    expect(manager.onCurrentPage()).toEqual([]);
  });

  it("onCurrentPage returns nothing in scroll/fixed-layout mode (no pages to check)", async () => {
    const existing = makeBookmark({ id: "bm-1" });
    const library = makeLibrary([existing]);
    const ctx = makeContext({ currentPagesAndDocuments: () => [] });
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    expect(manager.onCurrentPage()).toEqual([]);
  });

  it("flagsForCurrentPages reports one boolean per visible page", async () => {
    const existing = makeBookmark({ id: "bm-1" });
    const library = makeLibrary([existing]);
    const ctx = makeContext({
      currentPagesAndDocuments: () => [
        { page: makePage(false), document: {} as Document, spineIndex: 2 },
        { page: makePage(true), document: {} as Document, spineIndex: 3 },
      ],
    });
    const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
    await manager.load();

    expect(manager.flagsForCurrentPages()).toEqual([false, true]);
  });

  describe("toggle", () => {
    it("adds a bookmark when the current page has none", async () => {
      const library = makeLibrary();
      const ctx = makeContext();
      const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
      await manager.load();

      await manager.toggle();

      expect(manager.allSorted()).toHaveLength(1);
      expect(ctx.announce).toHaveBeenCalledWith("announcements.bookmarkAdded");
    });

    it("removes every bookmark on the current page when at least one exists, announcing the plural form", async () => {
      const existing1 = makeBookmark({ id: "bm-1" });
      const existing2 = makeBookmark({ id: "bm-2" });
      const library = makeLibrary([existing1, existing2]);
      const ctx = makeContext();
      const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
      await manager.load();

      await manager.toggle();

      expect(manager.allSorted()).toHaveLength(0);
      expect(ctx.announce).toHaveBeenCalledWith("announcements.bookmarksRemoved");
    });

    it("announces the singular form when removing exactly one bookmark", async () => {
      const existing = makeBookmark({ id: "bm-1" });
      const library = makeLibrary([existing]);
      const ctx = makeContext();
      const manager = new BookmarkManager(library, "book-1", makeLocatorResolver(true), ctx);
      await manager.load();

      await manager.toggle();

      expect(ctx.announce).toHaveBeenCalledWith("announcements.bookmarkRemoved");
    });
  });
});
