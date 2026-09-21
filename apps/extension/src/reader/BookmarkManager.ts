import { Locator } from "@ambra/engine";
import type { DomBreakPoint, LocatorResolver, Page } from "@ambra/engine";
import type { Bookmark } from "../library/LibraryDatabase.js";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { StringCatalog } from "../i18n/locales/en.js";

/** Everything `BookmarkManager` needs to read from/call back into
 * `ReaderController` — deliberately narrow (no `host`/pagination/
 * animation concerns leak through, beyond the couple of small facts
 * about the current view it can't derive on its own) so this stays
 * testable without a real `ReaderController` or a live iframe/document. */
export interface BookmarkManagerContext {
  /** The primary content document's current caret/scroll position, or
   * `undefined` if there's nothing sensible to bookmark right now
   * (nothing mounted yet, non-reflowable fixed-layout content, etc). */
  currentPosition(): DomBreakPoint | undefined;
  /** The `{ page, document }` pair(s) actually on screen right now —
   * both columns of a two-page spread, or just the primary one, or
   * empty for scroll mode/fixed-layout content (no discrete "page" to
   * speak of — bookmarking is simply inert there). */
  currentPagesAndDocuments(): Array<{ page: Page; document: Document }>;
  /** The current page-turn host's own 0-based page/column index within
   * its spine item, or `undefined` for scroll mode/fixed-layout content
   * (no single "page number" of its own) — used only to build a
   * bookmark's saved label ("Chapter — Page N"). */
  currentPageIndex(): number | undefined;
  /** The currently-open spine item's index — a method, not a plain
   * value, since it changes as the reader navigates and this context is
   * only ever constructed once. */
  spineIndex(): number;
  /** "Chapter N" / "Start of Book" / a real TOC entry's own label — see
   * `ReaderController.chapterLabel`. */
  chapterLabel(spineIndex: number): string;
  /** Takes an i18n translation key (e.g. `"announcements.bookmarkAdded"`)
   * and both translates *and* announces it — kept as a single callback
   * (rather than exposing `translate` separately) so this module never
   * needs to touch the current UI locale itself. */
  announce(translationKey: keyof StringCatalog): void;
  notify(): void;
}

/** Owns the current book's bookmarks: the in-memory cache mirroring
 * `LibraryDatabase`'s persisted copy, and every read/write operation the
 * reader UI needs against it. Extracted out of `ReaderController` (see
 * the architecture review's "decompose the god object" finding) as the
 * first, most self-contained slice — bookmarks have no dependency on
 * the page-turn/animation machinery, unlike almost everything else in
 * that file. */
export class BookmarkManager {
  private cache: Bookmark[] = [];

  constructor(
    private readonly library: LibraryDatabase,
    private readonly bookId: string,
    private readonly locatorResolver: LocatorResolver,
    private readonly ctx: BookmarkManagerContext,
  ) {}

  /** Loads every saved bookmark for this book from `LibraryDatabase` —
   * called once, right after a book opens (replaces the old
   * `controller.bookmarksCache = await library.listBookmarksForBook(...)`
   * line in `ReaderController.open`). */
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
    } catch {
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

  /** The toolbar's single bookmark button, per explicit product
   * direction (issue #47): if none of the currently-visible page(s)
   * already have a bookmark, adds one at the current position (exactly
   * like `add`); if one or more already do, removes *all* of them
   * instead (a reader could in principle have created more than one
   * very close together) — either way, the button's own pressed state
   * reflects the *result*, not the state beforehand. */
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

  /** Every saved bookmark whose CFI resolves onto whichever page(s) are
   * actually on screen right now — the shared basis for both "is this
   * page bookmarked?" (just "is this list non-empty?") and `toggle`'s
   * "remove every bookmark on this page" behavior. A bookmark whose CFI
   * belongs to a different spine item, or otherwise fails to resolve
   * (corrupted data, or content that's changed since it was created),
   * is silently treated as "not on this page" rather than failing the
   * whole scan — same "one bad entry shouldn't break everything else"
   * reasoning as `ReaderController.applyHighlightsToDocument`. */
  public onCurrentPage(): Bookmark[] {
    const pagesAndDocuments = this.ctx.currentPagesAndDocuments();
    if (pagesAndDocuments.length === 0 || this.cache.length === 0) {
      return [];
    }
    const matches: Bookmark[] = [];
    for (const bookmark of this.cache) {
      const locator = new Locator(bookmark.cfi);
      for (const { page, document } of pagesAndDocuments) {
        try {
          const resolved = this.locatorResolver.resolveInDocument(locator, this.ctx.spineIndex(), document);
          if (page.containsPosition(resolved.node, resolved.characterOffset ?? 0, document)) {
            matches.push(bookmark);
            break;
          }
        } catch {
          // Different spine item, or otherwise unresolvable against this
          // document — not on this page; try the next document (spread
          // mode) or just move on to the next bookmark.
        }
      }
    }
    return matches;
  }

  /** Per-visible-page version of `onCurrentPage` — one boolean per entry
   * in `currentPagesAndDocuments()` (so, in the same primary-then-
   * secondary order `PageFurniture`'s own `columnBands` uses), rather
   * than one aggregate "is any of them bookmarked" answer. Backs
   * `ReaderSnapshot.bookmarkedPages`, which `PageFurniture` uses to draw
   * a bookmark ribbon on exactly the page(s) that actually have one —
   * in a two-page spread, a bookmark on the left page shouldn't paint a
   * ribbon on the right page too. */
  public flagsForCurrentPages(): boolean[] {
    const pagesAndDocuments = this.ctx.currentPagesAndDocuments();
    if (pagesAndDocuments.length === 0 || this.cache.length === 0) {
      return pagesAndDocuments.map(() => false);
    }
    return pagesAndDocuments.map(({ page, document }) => {
      for (const bookmark of this.cache) {
        const locator = new Locator(bookmark.cfi);
        try {
          const resolved = this.locatorResolver.resolveInDocument(locator, this.ctx.spineIndex(), document);
          if (page.containsPosition(resolved.node, resolved.characterOffset ?? 0, document)) {
            return true;
          }
        } catch {
          // Different spine item, or otherwise unresolvable against
          // this page's document — not on this page; try the next
          // bookmark.
        }
      }
      return false;
    });
  }

  /** "Chapter — Page N" for paginated/spread mode (matching what the
   * running footer/toolbar already show), or just the chapter for
   * scroll/fixed-layout content, which has no single "page number" of
   * its own. */
  private label(): string {
    const chapter = this.ctx.chapterLabel(this.ctx.spineIndex());
    const pageIndex = this.ctx.currentPageIndex();
    return pageIndex === undefined ? chapter : `${chapter} — Page ${pageIndex + 1}`;
  }
}
