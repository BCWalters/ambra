import { BookSearch, MIN_QUERY_LENGTH } from "@ambra/engine";
import type { ContentLoader, LocatorResolver, SearchResult, SpineItemRef } from "@ambra/engine";

/** A `SearchResult` plus the chapter label its spine item resolves to. */
export interface SearchResultItem extends SearchResult {
  readonly chapterLabel: string;
}

/** What `SearchCoordinator` needs from `ReaderController`. */
export interface SearchCoordinatorContext {
  goToCfi(cfi: string): Promise<void>;
  chapterLabel(spineIndex: number): string;
  /** Repaints the live search spotlight, reading `highlightQuery` at
   * call time. */
  repaintHighlight(): void;
  notify(): void;
}

/** Owns book-wide full-text search and the live "highlight matches on
 * the current page" spotlight (issue #100). */
export class SearchCoordinator {
  private readonly bookSearch: BookSearch;
  private query = "";
  private results: SearchResultItem[] = [];
  private searching = false;
  /** The term currently painted via `repaintHighlight`, or `undefined`
   * for none — has its own lifetime, separate from `query` (see
   * `clearHighlightUnlessPinned`/`panelPinned`). */
  private highlightQuery: string | undefined;
  /** Mirrors the shell's `SearchPanel` pinned/docked state (issue
   * #100), kept in sync via `setPanelState`. */
  private panelPinned = false;

  public constructor(
    contentLoader: ContentLoader,
    locatorResolver: LocatorResolver,
    spine: readonly SpineItemRef[],
    private readonly ctx: SearchCoordinatorContext,
  ) {
    this.bookSearch = new BookSearch(contentLoader, locatorResolver, spine);
  }

  public get snapshot(): { searchQuery: string; searchResults: readonly SearchResultItem[]; isSearching: boolean } {
    return { searchQuery: this.query, searchResults: this.results, isSearching: this.searching };
  }

  public get currentHighlightQuery(): string | undefined {
    return this.highlightQuery;
  }

  /** Navigates to a search result's position, and re-arms
   * `highlightQuery` right after (issue #100), since the Search panel
   * typically auto-closes the instant a result's picked. */
  public async goToResult(cfi: string): Promise<void> {
    await this.ctx.goToCfi(cfi);
    const trimmed = this.query.trim();
    this.highlightQuery = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : undefined;
    this.ctx.repaintHighlight();
    this.ctx.notify();
  }

  /** (Re-)starts a book-wide search, replacing any previous (possibly
   * in-flight) results — see `BookSearch` for the progressive search
   * mechanism. Also drives issue #100's live "highlight matches on the
   * current page" spotlight. */
  public search(query: string): void {
    this.query = query;
    this.results = [];
    this.searching = query.trim().length > 0;
    const trimmed = query.trim();
    this.highlightQuery = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : undefined;
    this.ctx.repaintHighlight();
    this.ctx.notify();
    void this.bookSearch.search(
      query,
      (result) => {
        this.results = [...this.results, { ...result, chapterLabel: this.ctx.chapterLabel(result.spineIndex) }];
        this.ctx.notify();
      },
      () => {
        this.searching = false;
        this.ctx.notify();
      },
    );
  }

  /** Called by `ReaderApp` when the Search panel's open/pinned state
   * changes, to recompute `highlightQuery` on opening and to apply
   * issue #100's "spotlight survives until the panel is closed" rule
   * for a pinned panel. */
  public setPanelState(open: boolean, pinned: boolean): void {
    const wasPinned = this.panelPinned;
    this.panelPinned = pinned;
    if (open) {
      const trimmed = this.query.trim();
      this.highlightQuery = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : undefined;
    } else if (wasPinned) {
      this.highlightQuery = undefined;
    }
    this.ctx.repaintHighlight();
    this.ctx.notify();
  }

  /** Clears the live search spotlight on an ordinary navigation, unless
   * the Search panel is pinned (issue #100). */
  public clearHighlightUnlessPinned(): void {
    if (this.panelPinned || this.highlightQuery === undefined) {
      return;
    }
    this.highlightQuery = undefined;
    this.ctx.repaintHighlight();
  }

  public dispose(): void {
    this.bookSearch.cancel();
  }
}
