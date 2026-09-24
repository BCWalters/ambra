import { EpubCfi, EpubCfiParseError, Locator } from "@ambra/engine";
import type { BookPaginationEstimator, DomBreakPoint, LocatorResolver, Page } from "@ambra/engine";
import type { Bookmark } from "../library/LibraryDatabase.js";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { StringCatalog } from "../i18n/locales/en.js";

/** What `BookmarkManager` needs from `ReaderController`. */
export interface BookmarkManagerContext {
  /** Current caret/scroll position, or `undefined` if nothing's
   * mounted or the content is fixed-layout. */
  currentPosition(): DomBreakPoint | undefined;
  currentPagesAndDocuments(): Array<{ page: Page; document: Document; spineIndex: number }>;
  /** Current page/column index, for the bookmark's saved label. */
  currentPageIndex(): number | undefined;
  spineIndex(): number;
  spineIndexForCfi(cfi: EpubCfi): number | undefined;
  chapterLabel(spineIndex: number): string;
  announce(translationKey: keyof StringCatalog): void;
  reportError(err: unknown): void;
  notify(): void;
}

export interface BookmarkProgressMarker {
  readonly id: string;
  readonly fraction: number;
}

/** Owns the current book's bookmarks: the in-memory cache mirroring
 * `LibraryDatabase`'s persisted copy, and every read/write op the
 * reader UI needs. */
export class BookmarkManager {
  private cache: Bookmark[] = [];
  private readonly progressSpines = new WeakMap<Bookmark, number | null>();

  constructor(
    private readonly library: LibraryDatabase,
    private readonly bookId: string,
    private readonly locatorResolver: LocatorResolver,
    private readonly ctx: BookmarkManagerContext,
  ) {}

  public async load(): Promise<void> {
    this.cache = await this.library.listBookmarksForBook(this.bookId);
  }

  public async add(): Promise<Bookmark | undefined> {
    const position = this.ctx.currentPosition();
    if (!position) {
      return undefined;
    }
    try {
      const locator = this.locatorResolver.generate(this.ctx.spineIndex(), position.node, position.offset);
      const bookmark = await this.library.addBookmark(this.bookId, locator.cfi, this.label());
      this.cache.push(bookmark);
      this.ctx.announce("announcements.bookmarkAdded");
      this.ctx.notify();
      return bookmark;
    } catch (err) {
      this.ctx.reportError(err);
      return undefined;
    }
  }

  public allSorted(): Bookmark[] {
    return [...this.cache].sort((a, b) => {
      try {
        return EpubCfi.compare(a.cfi, b.cfi);
      } catch {
        return a.createdAt - b.createdAt;
      }
    });
  }

  public progressMarkers(
    pagination: Pick<BookPaginationEstimator, "positionFor" | "pageIndexForCfi">,
  ): BookmarkProgressMarker[] {
    const total = pagination.positionFor(0, 0).totalPages;
    if (!total) return [];
    const markers: BookmarkProgressMarker[] = [];
    for (const bookmark of this.cache) {
      if (!this.progressSpines.has(bookmark)) {
        try {
          const spineIndex = this.ctx.spineIndexForCfi(EpubCfi.parse(bookmark.cfi));
          if (spineIndex === undefined) {
            console.warn(`Cannot place bookmark ${bookmark.id}: its chapter is not in this book.`);
          }
          this.progressSpines.set(bookmark, spineIndex ?? null);
        } catch (error) {
          if (!(error instanceof EpubCfiParseError)) throw error;
          console.warn(`Cannot place bookmark ${bookmark.id} on the progress bar.`, error);
          this.progressSpines.set(bookmark, null);
        }
      }
      const spineIndex = this.progressSpines.get(bookmark);
      if (spineIndex === null || spineIndex === undefined) continue;
      const pageIndex = pagination.pageIndexForCfi(spineIndex, bookmark.cfi);
      if (pageIndex === undefined) continue;
      const position = pagination.positionFor(spineIndex, pageIndex);
      if (position.currentPage !== undefined) {
        markers.push({ id: bookmark.id, fraction: position.currentPage / total });
      }
    }
    return markers;
  }

  public async refresh(): Promise<void> {
    try {
      await this.load();
      this.ctx.notify();
    } catch (error) {
      this.ctx.reportError(error);
    }
  }

  public async remove(id: string): Promise<void> {
    await this.removeCommitted([id]);
  }

  private async removeCommitted(ids: readonly string[]): Promise<boolean> {
    try {
      await this.library.removeBookmarks(ids);
    } catch (error) {
      this.ctx.reportError(error);
      return false;
    }
    const removed = new Set(ids);
    this.cache = this.cache.filter(bookmark => !removed.has(bookmark.id));
    this.ctx.notify();
    return true;
  }

  /** Adds a bookmark at the current position, or removes every
   * bookmark on the current page if one's already there (issue #47). */
  public async toggle(): Promise<void> {
    const existing = this.onCurrentPage();
    if (existing.length === 0) {
      await this.add();
      return;
    }
    if (!await this.removeCommitted(existing.map(bookmark => bookmark.id))) return;
    this.ctx.announce(
      existing.length > 1 ? "announcements.bookmarksRemoved" : "announcements.bookmarkRemoved",
    );
  }

  /** Every saved bookmark on the current page(s). */
  public onCurrentPage(): Bookmark[] {
    const pagesAndDocuments = this.ctx.currentPagesAndDocuments();
    if (pagesAndDocuments.length === 0 || this.cache.length === 0) {
      return [];
    }
    const matches: Bookmark[] = [];
    for (const bookmark of this.cache) {
      const locator = new Locator(bookmark.cfi);
      for (const { page, document, spineIndex } of pagesAndDocuments) {
        try {
          const resolved = this.locatorResolver.resolveInDocument(locator, spineIndex, document);
          if (page.containsPosition(resolved.node, resolved.characterOffset ?? 0, document)) {
            matches.push(bookmark);
            break;
          }
        } catch {
          // Not on this page (wrong spine item, or unresolvable) — try
          // the next document/bookmark.
        }
      }
    }
    return matches;
  }

  /** Per-visible-page version of `onCurrentPage`, for
   * `ReaderSnapshot.bookmarkedPages`. */
  public flagsForCurrentPages(): boolean[] {
    const pagesAndDocuments = this.ctx.currentPagesAndDocuments();
    if (pagesAndDocuments.length === 0 || this.cache.length === 0) {
      return pagesAndDocuments.map(() => false);
    }
    return pagesAndDocuments.map(({ page, document, spineIndex }) => {
      for (const bookmark of this.cache) {
        const locator = new Locator(bookmark.cfi);
        try {
          const resolved = this.locatorResolver.resolveInDocument(locator, spineIndex, document);
          if (page.containsPosition(resolved.node, resolved.characterOffset ?? 0, document)) {
            return true;
          }
        } catch {
          // Not on this page — try the next bookmark.
        }
      }
      return false;
    });
  }

  /** "Chapter — Page N", or just the chapter for scroll/fixed-layout
   * content. */
  private label(): string {
    const chapter = this.ctx.chapterLabel(this.ctx.spineIndex());
    const pageIndex = this.ctx.currentPageIndex();
    return pageIndex === undefined ? chapter : `${chapter} — Page ${pageIndex + 1}`;
  }
}
