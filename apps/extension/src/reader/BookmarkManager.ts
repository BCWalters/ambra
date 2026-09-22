import { Locator } from "@ambra/engine";
import type { DomBreakPoint, LocatorResolver, Page } from "@ambra/engine";
import type { Bookmark } from "../library/LibraryDatabase.js";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { StringCatalog } from "../i18n/locales/en.js";

/** What `BookmarkManager` needs from `ReaderController`. */
export interface BookmarkManagerContext {
  /** Current caret/scroll position, or `undefined` if nothing's
   * mounted or the content is fixed-layout. */
  currentPosition(): DomBreakPoint | undefined;
  /** The `{ page, document }` pair(s) on screen right now. */
  currentPagesAndDocuments(): Array<{ page: Page; document: Document; spineIndex?: number }>;
  /** Current page/column index, for the bookmark's saved label. */
  currentPageIndex(): number | undefined;
  spineIndex(): number;
  chapterLabel(spineIndex: number): string;
  announce(translationKey: keyof StringCatalog): void;
  /** Surfaces a failed save (e.g. a full storage quota) as a
   * non-blocking transient toast — see
   * `ReaderController.reportTransientError`. A bookmark the reader
   * explicitly asked for that silently never appears, with no
   * indication why, is exactly the kind of gap a dedicated error-
   * handling pass needs to close (previously this just swallowed the
   * error entirely). */
  reportError(err: unknown): void;
  notify(): void;
}

/** Owns the current book's bookmarks: the in-memory cache mirroring
 * `LibraryDatabase`'s persisted copy, and every read/write op the
 * reader UI needs. */
export class BookmarkManager {
  private cache: Bookmark[] = [];

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

  public list(): Promise<Bookmark[]> {
    return this.library.listBookmarksForBook(this.bookId);
  }

  public remove(id: string): Promise<void> {
    this.cache = this.cache.filter((bookmark) => bookmark.id !== id);
    this.ctx.notify();
    return this.library.removeBookmark(id);
  }

  /** Adds a bookmark at the current position, or removes every
   * bookmark on the current page if one's already there (issue #47). */
  public async toggle(): Promise<void> {
    const existing = this.onCurrentPage();
    if (existing.length === 0) {
      await this.add();
      return;
    }
    const removedIds = new Set(existing.map((bookmark) => bookmark.id));
    this.cache = this.cache.filter((bookmark) => !removedIds.has(bookmark.id));
    this.ctx.announce(
      existing.length > 1 ? "announcements.bookmarksRemoved" : "announcements.bookmarkRemoved",
    );
    this.ctx.notify();
    await Promise.all(existing.map((bookmark) => this.library.removeBookmark(bookmark.id)));
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
          const resolved = this.locatorResolver.resolveInDocument(locator, spineIndex ?? this.ctx.spineIndex(), document);
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
          const resolved = this.locatorResolver.resolveInDocument(locator, spineIndex ?? this.ctx.spineIndex(), document);
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
