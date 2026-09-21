import { BookSearch, MIN_QUERY_LENGTH } from "@ambra/engine";
import type { ContentLoader, LocatorResolver, SearchResult, SpineItemRef } from "@ambra/engine";

/** See `ReaderSnapshot.searchResults` — a `SearchResult` (see the engine)
 * plus the chapter label its spine item resolves to, computed once when
 * the result is found (see `SearchCoordinator.search`) rather than by
 * the shell re-deriving it from `spineIndex` on every render. */
export interface SearchResultItem extends SearchResult {
  readonly chapterLabel: string;
}

/** Everything `SearchCoordinator` needs to call back into
 * `ReaderController` — deliberately narrow, same reasoning as
 * `BookmarkManagerContext`: no `host`/pagination internals leak through,
 * just the handful of things the coordinator can't derive on its own. */
export interface SearchCoordinatorContext {
  /** Parses a CFI, finds the spine item it targets, and opens it with the
   * CFI as a bridging position — see `ReaderController.goToCfi`. */
  goToCfi(cfi: string): Promise<void>;
  /** "Chapter N" / "Start of Book" / a real TOC entry's own label — see
   * `ReaderController.chapterLabel`. */
  chapterLabel(spineIndex: number): string;
  /** Repaints the live search spotlight on whatever's currently on
   * screen, reading the coordinator's own `highlightQuery` at call time
   * (see `ReaderController.applySearchHighlightToCurrentHost`) — kept as
   * a callback rather than the coordinator touching any host/document
   * itself, since that rendering plumbing belongs to `ReaderController`. */
  repaintHighlight(): void;
  notify(): void;
}

/** Owns book-wide full-text search and the live "highlight matches on the
 * current page" spotlight (issue #100) — both the search state a
 * `SearchPanel` renders (`query`/`results`/`isSearching`) and the small
 * bit of state that decides whether the spotlight survives an ordinary
 * page turn (`highlightQuery`/`panelPinned`). Extracted out of
 * `ReaderController` as part of the god-object decomposition (see
 * `BookmarkManager`'s doc comment for the overall rationale) — search has
 * no dependency on the page-turn/animation machinery beyond needing to
 * *trigger* a navigation and a repaint, both handled through
 * `SearchCoordinatorContext`. */
export class SearchCoordinator {
  private readonly bookSearch: BookSearch;
  private query = "";
  private results: SearchResultItem[] = [];
  private searching = false;
  /** The term currently painted via `repaintHighlight` (issue #100) —
   * `undefined` whenever nothing should be highlighted. Deliberately its
   * own field, not derived from `query` on every read: it has a longer/
   * different lifetime than the query text itself (see
   * `clearHighlightUnlessPinned` and `panelPinned` below) — e.g. it
   * outlives the Search panel auto-closing right after `goToResult`, and
   * it's cleared by an ordinary page turn even while the query text
   * itself is left untouched in the search box. */
  private highlightQuery: string | undefined;
  /** Mirrors the shell's `SearchPanel`'s own pinned/docked state (kept in
   * sync via `setPanelState`, called from `ReaderApp`) — the only thing
   * that decides whether `highlightQuery` survives an ordinary page turn
   * (issue #100: "...unless the search panel is pinned, in which case
   * keep highlighting until the panel is closed"). */
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

  /** The term `ReaderController.applySearchHighlightToDocument` should
   * currently paint, or `undefined` for none. */
  public get currentHighlightQuery(): string | undefined {
    return this.highlightQuery;
  }

  /** Navigates to a search result's position — see
   * `ReaderController.goToBookmark`'s doc comment; a search result's CFI
   * is just another "previously generated position" like a bookmark or
   * highlight's. Unlike those, though, this one re-arms `highlightQuery`
   * right after navigating (issue #100) — the whole point of picking a
   * result is to see the term highlighted on the page it landed on, even
   * though the Search panel typically auto-closes the instant a result's
   * picked well before any `setPanelState(false, ...)` call could
   * otherwise be mistaken for "the reader's done searching, stop
   * highlighting". */
  public async goToResult(cfi: string): Promise<void> {
    await this.ctx.goToCfi(cfi);
    const trimmed = this.query.trim();
    this.highlightQuery = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : undefined;
    this.ctx.repaintHighlight();
    this.ctx.notify();
  }

  /** (Re-)starts a book-wide search for `query`, replacing any previous
   * (possibly still in-flight) search's results — see `BookSearch` for
   * the actual progressive, non-indexed search mechanism and its
   * cancellation semantics. Results accumulate as they stream in, each
   * one triggering `notify()` so the shell's results list grows live
   * rather than waiting for the whole book to finish. An empty/too-short
   * `query` clears any existing results immediately rather than running
   * a pointless (or, for a 1-2 character query, book-wide-and-meaningless)
   * search.
   *
   * Also drives issue #100's "highlight instances of the term in the
   * visible spread" live, independent of `bookSearch`'s own book-wide,
   * progressively-streamed results: the reader's actually-visible content
   * document(s) are already right here, so there's no reason to wait for
   * the (possibly still-scanning) rest of the book before showing what's
   * already on screen. */
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

  /** Called by `ReaderApp` whenever the Search panel's own `open`/
   * `pinned` state changes — the coordinator has no independent way to
   * observe either, since both live as plain React state in `ReaderApp`
   * (see `SearchPanel`'s own doc comment on why only Search, of the
   * flyout panels, supports pinning). Needed for two things:
   *
   * 1. Recomputing `highlightQuery` on *opening* — reopening the panel
   *    without retyping anything never re-triggers `search()` itself
   *    (its debounce effect only fires when the input's own text
   *    actually changes), so without this, re-showing a previously
   *    closed panel with the same lingering query would leave whatever
   *    page the reader's now on unhighlighted until they typed a single
   *    character.
   * 2. Issue #100's pinned "...until the panel is closed" rule: only a
   *    panel that *was* pinned clears the spotlight the moment it
   *    closes; an ordinary (never-pinned) close deliberately leaves it
   *    alone, to persist until the next real page turn instead (see
   *    `clearHighlightUnlessPinned`) — by the time `open` goes false,
   *    `pinned` has always already been forced false too (it's derived
   *    from `open && pinnedToggle` in `ReaderApp`), so only the
   *    *previous* pinned state, captured here before it's overwritten,
   *    can actually distinguish the two. */
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

  /** Issue #100: clears the live search spotlight (`highlightQuery`) on
   * an ordinary "leave this page behind" navigation — a page turn, a
   * chapter jump, a bookmark/highlight jump, a TOC jump, or a scrubber
   * drag — unless the Search panel is currently pinned, in which case it
   * deliberately survives (the whole point of pinning: keep browsing
   * naturally with the spotlight following whatever's now on screen, only
   * actually going away once the panel itself is closed — see
   * `setPanelState`). A no-op (skips the otherwise-harmless extra
   * repaint) when nothing's currently highlighted to begin with. */
  public clearHighlightUnlessPinned(): void {
    if (this.panelPinned || this.highlightQuery === undefined) {
      return;
    }
    this.highlightQuery = undefined;
    this.ctx.repaintHighlight();
  }

  /** Cancels any in-flight `BookSearch` scan — called from
   * `ReaderController.dispose`. */
  public dispose(): void {
    this.bookSearch.cancel();
  }
}
