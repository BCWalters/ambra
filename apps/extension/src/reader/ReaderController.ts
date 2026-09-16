import {
  AccessibilityController,
  BookPaginationEstimator,
  ContentLoader,
  EpubCfi,
  EpubContainer,
  FixedContentHost,
  Locator,
  LocatorResolver,
  NavigationDocument,
  PaginatedContentHost,
  ReadingTheme,
  ResourceUrlResolver,
  resolveEpubPath,
  ScrollContentHost,
  splitHrefFragment,
  SpreadPaginatedHost,
} from "@pagina/engine";
import type { FontFamilyChoice, NavPoint, PackageDocument, PageTheme } from "@pagina/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { ViewMode } from "./ViewMode.js";

export type { ViewMode } from "./ViewMode.js";

/** A plain-data snapshot of `ReaderController`'s current state, the shape
 * React components actually read (via `useReaderController`) — they never
 * touch the controller's engine objects directly. */
export interface ReaderSnapshot {
  title: string;
  toc: readonly NavPoint[];
  spineIndex: number;
  spineLength: number;
  /** Archive-relative manifest path of the *current* spine item — lets
   * the shell (the TOC panel, specifically) highlight whichever entry
   * points at the chapter currently open, by comparing against each
   * `NavPoint.path`. `undefined` only if the current spine item somehow
   * has no manifest entry (shouldn't happen for a valid EPUB). */
  currentSpinePath: string | undefined;
  /** Archive-relative manifest path of the book's very first spine item
   * — lets the shell (`TocPanel`) detect whether the navigation
   * document's own first entry skips ahead of some unlisted front
   * matter (a cover, title page, copyright page), and if so, offer a
   * synthetic "Start of Book" entry that actually reaches it. */
  firstSpinePath: string | undefined;
  /** The TOC entry path the shell should actually highlight as
   * "current" (see `ReaderController.tocHighlightPath`) — not always
   * the same as `currentSpinePath`, since the open spine item may have
   * no TOC entry of its own at all. */
  highlightedTocPath: string | undefined;
  /** A human-readable label for the current chapter — the matching TOC
   * entry's own label when the navigation has one, else a generic
   * "Chapter N" (see `chapterLabel`). Used for the running header (see
   * `PageFurniture`) and live-region chapter-change announcements. */
  currentChapterLabel: string;
  viewMode: ViewMode;
  /** True when the *current* spine item resolves to fixed-layout
   * rendering (see `SpineItemRef.resolveRenditionLayout`) — independent
   * of `viewMode`, since EPUB3 allows mixing reflowable and fixed-layout
   * spine items within one book. The reader UI hides page/scroll-mode
   * controls for such items, since a fixed-layout page has no sub-page
   * position or reflow to navigate within. */
  isFixedLayout: boolean;
  pageIndex: number;
  pageCount: number;
  /** The reader's position expressed as a page number across the *whole
   * book*, not just the current chapter — see `BookPaginationEstimator`.
   * Both fields are `undefined` until enough background measurement has
   * completed to know them (see `aggregateBookPosition`): `bookPageIndex`
   * needs every spine item up to and including the current one measured,
   * `bookPageCount` needs the entire book. The shell falls back to the
   * per-chapter `pageIndex`/`pageCount` above while these are still
   * unknown, so the page number is never blank, just coarser at first. */
  bookPageIndex: number | undefined;
  bookPageCount: number | undefined;
  /** `true` when the current spine item is showing as a two-page spread
   * (see `SpreadPaginatedHost`) — the reader pane is wide enough and the
   * item is reflowable and in paginated mode. The shell shows "Pages
   * X–Y of Z" instead of "Page X of Y" when this is set. */
  isSpread: boolean;
  /** The companion page index shown alongside `pageIndex` in spread mode
   * — `undefined` outside spread mode, or if there's no companion page
   * (the chapter's last page has no facing page). */
  secondPageIndex: number | undefined;
  /** The reader pane's current width in CSS pixels — lets `PageFurniture`
   * replicate `SpreadPaginatedHost`'s own column/gutter geometry exactly
   * (via `SpreadPaginatedHost.effectiveColumnWidth`/`GUTTER_WIDTH`) so its
   * running header can center itself on each visible page in spread
   * mode, rather than guessing at where the two columns actually sit. */
  paneWidth: number;
  /** The current reader-controlled font-size multiplier (see
   * `ReadingTheme`) — `1` is the theme's own default size. Always `1` for
   * a fixed-layout spine item, which has no reader-adjustable typography. */
  fontScale: number;
  /** The current reader-controlled font family and page color theme —
   * see `ReadingTheme`. */
  fontFamily: FontFamilyChoice;
  pageTheme: PageTheme;
  isLoading: boolean;
  error: string | undefined;
  /** Text for the shell's `aria-live` region to announce (page turns,
   * chapter changes, view-mode switches) — see `announce`. `undefined`
   * before the first navigation event. */
  announcement: string | undefined;
  /** Increments on every `announce` call, including ones with identical
   * text to the last — `aria-live` regions only announce on a DOM text
   * *change*, so the shell's `LiveRegion` keys off this to force a
   * re-announcement even when, e.g., two consecutive page turns happen
   * to produce the same "Page 3 of 12" text (impossible in practice for
   * that exact case, but real for repeated chapter-boundary turns). */
  announcementId: number;
  /** Increments on every pointerdown inside the content — see
   * `ReaderController.contentPointerActivityId`'s doc comment. The
   * shell's `Toolbar` watches this to hide itself immediately on a
   * click into the book, rather than waiting for the usual auto-hide
   * timeout. */
  contentPointerActivityId: number;
}

/**
 * Owns one reading session's state — which book, spine item, and view
 * mode are active — and orchestrates the engine on the React reader UI's
 * behalf: opening/switching spine items, turning pages, switching between
 * paginated and scroll mode (bridging position across the switch via a
 * CFI, since the two modes render into separate content hosts/documents),
 * relaying window resizes into the active host, persisting/restoring
 * reading position (see `resume-reading`) via the same CFI-bridging
 * mechanism, and accessibility: keyboard navigation and managed focus
 * (via `AccessibilityController`, re-attached to whichever content host's
 * iframe document is current) plus live-region announcements (via
 * `announce`, surfaced through `snapshot()` for the shell's `LiveRegion`
 * to render — this class has no DOM of its own outside the content
 * hosts' iframes). React never touches `PaginatedContentHost`/
 * `ScrollContentHost`/`LocatorResolver` etc. directly — it reads
 * `snapshot()` and calls methods here, then is notified (`subscribe`) to
 * re-render.
 */
export class ReaderController {
  private host: PaginatedContentHost | ScrollContentHost | FixedContentHost | SpreadPaginatedHost | undefined;
  /** Defaults to "paginated", but `open` overwrites this from the saved
   * `view-mode-preference` (if any) before the controller is ever used. */
  private viewMode: ViewMode = "paginated";
  /** Defaults to `1` (the theme's own default), but `open` overwrites
   * this from the saved font-scale preference (if any) — see
   * `ReadingTheme`, `setFontScale`. */
  private fontScale = 1;
  /** Defaults to `ReadingTheme.DEFAULT_FONT_FAMILY`, but `open` overwrites
   * this from the saved preference (if any) — see `setFontFamily`. */
  private fontFamily: FontFamilyChoice = ReadingTheme.DEFAULT_FONT_FAMILY;
  /** Defaults to `ReadingTheme.DEFAULT_PAGE_THEME`, but `open` overwrites
   * this from the saved preference (if any) — see `setPageTheme`. */
  private pageTheme: PageTheme = ReadingTheme.DEFAULT_PAGE_THEME;
  private spineIndex = 0;
  /** The most recently requested reader-pane size. */
  private width = 0;
  private height = 0;
  /** The size the *current* content host was actually last laid out at —
   * distinct from `width`/`height` above, which record the latest
   * request even while it's still deferred (see `pendingResize`). Lets
   * `resize` recognize a no-op (the deferred resize turning out to match
   * what `openSpineItem` already laid out the fresh host at) and skip a
   * pointless second re-pagination that would otherwise risk introducing
   * its own drift into the just-restored position. */
  private appliedWidth = 0;
  private appliedHeight = 0;
  private isLoading = false;
  /** Guards against overlapping `turnPage` calls — a real bug caught via
   * Chromium testing: rapid repeated clicks/keypresses could start a
   * second animated page turn (see `animatePageTurn`) while a first was
   * still mid-flight, each building its own new host from whatever
   * `this.host`/`this.width`/`this.height` happened to be at that moment,
   * racing to swap `this.host` and corrupting pagination state (page
   * counts changing nonsensically was the symptom). `turnPage` simply
   * ignores a call that arrives while one is already in progress, rather
   * than queuing it — consistent with how physical book pages can't be
   * turned faster than one at a time anyway. */
  private isTurningPage = false;
  /** Incremented every time a new page-turn gesture (click or drag)
   * begins, and captured by that gesture's own async operations. Before
   * any turn actually commits (mutates `this.host`), it checks its
   * captured token against the current one — a mismatch means a *newer*
   * turn has since started and finished (possible if an old drag's
   * incoming-page load is unusually slow and a fresh interaction starts
   * once `isTurningPage` clears), so the stale turn discards its own
   * work instead of clobbering newer state. A second, independent
   * safety net beyond `isTurningPage` for this same class of race. */
  private turnToken = 0;
  /** A resize that arrived while an `openSpineItem` was already in
   * flight (e.g. `ResizeObserver`'s spec-mandated initial callback racing
   * with `mount`'s async load) — applying it immediately would relayout
   * a host that's mid-open, against stale or not-yet-loaded content.
   * Recorded here and applied once the in-flight open settles instead. */
  private pendingResize: { width: number; height: number } | undefined;
  private error: string | undefined;
  private containerEl: HTMLDivElement | undefined;
  private readonly accessibility = new AccessibilityController();
  private announcement: string | undefined;
  private announcementId = 0;
  /** Increments on every pointerdown inside the content (any content
   * host's iframe document) — the shell's `Toolbar` watches this via
   * `snapshot()` to hide itself immediately the instant the reader
   * clicks into the book, rather than waiting for the usual auto-hide
   * timeout (see `useAutoHideChrome`). Deliberately *every* pointerdown,
   * not just ones that turn out to be a page-turn tap — a click that
   * lands on a link, or one that starts a text-selection drag, should
   * still dismiss the toolbar just as immediately. */
  private contentPointerActivityId = 0;
  /** Detaches the current spine item's in-content link click listener —
   * see `setUpLinkInterception`. Re-created on every `openSpineItem` call
   * since each one gets a fresh iframe/document. */
  private linkClickCleanup: (() => void) | undefined;
  /** Detaches the current drag-page-turn `pointerdown` listener — see
   * `setUpDragPageTurn`. Re-created every time the primary content
   * document changes, same lifecycle as `linkClickCleanup`. */
  private dragCleanup: (() => void) | undefined;
  /** Background-paginates the whole book to derive book-wide page
   * numbers (see `BookPaginationEstimator`) — `undefined` until `mount`
   * creates it (it needs `hiddenMeasureContainer` to exist first). */
  private bookPagination: BookPaginationEstimator | undefined;
  /** An offscreen, zero-size-but-attached container `bookPagination`
   * mounts its measurement iframes into — real browsers don't lay out a
   * detached element, so this can't simply be left unattached, but it
   * also must never let its children become visible or affect this
   * page's own scroll extents. Created once in `mount` and torn down in
   * `dispose`. */
  private hiddenMeasureContainer: HTMLDivElement | undefined;

  private readonly listeners = new Set<() => void>();
  private cachedSnapshot: ReaderSnapshot | undefined;

  private constructor(
    private readonly contentLoader: ContentLoader,
    private readonly resolver: ResourceUrlResolver,
    private readonly locatorResolver: LocatorResolver,
    public readonly pkg: PackageDocument,
    public readonly navigation: NavigationDocument,
    private readonly bookId: string,
    private readonly library: LibraryDatabase,
  ) {}

  /** Opens a book from its raw bytes — from a `File` (e.g. `await
   * file.arrayBuffer()`) or, in the normal case, the book `Blob` read
   * back out of `LibraryDatabase` for whichever `bookId` the reader page
   * was opened with. `bookId`/`library` are used to persist and restore
   * reading position — see `mount`/`saveProgress`. */
  public static async open(buffer: ArrayBuffer, bookId: string, library: LibraryDatabase): Promise<ReaderController> {
    const container = await EpubContainer.open(buffer);
    const contentLoader = await ContentLoader.create(container);
    const resolver = new ResourceUrlResolver(contentLoader);
    const pkg = contentLoader.packageDocument;
    const navigation = await NavigationDocument.load(container);
    const locatorResolver = new LocatorResolver(pkg, contentLoader);

    const controller = new ReaderController(contentLoader, resolver, locatorResolver, pkg, navigation, bookId, library);
    controller.viewMode = (await library.getDefaultViewMode()) ?? "paginated";
    controller.fontScale = (await library.getDefaultFontScale()) ?? 1;
    controller.fontFamily = (await library.getDefaultFontFamily()) ?? ReadingTheme.DEFAULT_FONT_FAMILY;
    controller.pageTheme = (await library.getDefaultPageTheme()) ?? ReadingTheme.DEFAULT_PAGE_THEME;
    return controller;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public snapshot(): ReaderSnapshot {
    if (!this.cachedSnapshot) {
      let pageIndex = 0;
      let pageCount = 0;
      if (this.host instanceof PaginatedContentHost) {
        pageIndex = this.host.currentPageIndex;
        pageCount = this.host.pageCount;
      } else if (this.host instanceof SpreadPaginatedHost) {
        pageIndex = this.host.pageIndex;
        pageCount = this.host.pageCount;
      }

      // Book-wide numbers only make sense in paginated/spread mode — the
      // same reason `pageIndex`/`pageCount` above stay `0` in scroll
      // mode, which has no discrete "page" concept of its own to place
      // within a book-wide count either.
      let bookPageIndex: number | undefined;
      let bookPageCount: number | undefined;
      if (this.bookPagination && (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost)) {
        const position = this.bookPagination.positionFor(this.spineIndex, pageIndex);
        bookPageIndex = position.currentPage;
        bookPageCount = position.totalPages;
      }

      this.cachedSnapshot = {
        title: this.pkg.metadata.title,
        toc: this.navigation.toc.items,
        spineIndex: this.spineIndex,
        spineLength: this.pkg.spine.length,
        currentSpinePath: this.pkg.spine[this.spineIndex]?.manifestItem.path,
        firstSpinePath: this.pkg.spine[0]?.manifestItem.path,
        highlightedTocPath: this.tocHighlightPath(),
        currentChapterLabel: this.chapterLabel(this.spineIndex),
        viewMode: this.viewMode,
        isFixedLayout: this.host instanceof FixedContentHost,
        pageIndex,
        pageCount,
        bookPageIndex,
        bookPageCount,
        isSpread: this.host instanceof SpreadPaginatedHost,
        secondPageIndex: this.host instanceof SpreadPaginatedHost ? this.host.secondPageIndex : undefined,
        paneWidth: this.width,
        fontScale: this.host instanceof FixedContentHost ? 1 : this.fontScale,
        fontFamily: this.fontFamily,
        pageTheme: this.pageTheme,
        isLoading: this.isLoading,
        error: this.error,
        announcement: this.announcement,
        announcementId: this.announcementId,
        contentPointerActivityId: this.contentPointerActivityId,
      };
    }
    return this.cachedSnapshot;
  }

  private notify(): void {
    this.cachedSnapshot = undefined;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Bumps `contentPointerActivityId` and notifies — see that field's
   * doc comment. */
  private bumpContentActivity(): void {
    this.contentPointerActivityId++;
    this.notify();
  }

  /** Mounts the current view mode's content host into `containerEl` and
   * opens either a previously-saved reading position for this book (see
   * `saveProgress`) or spine item 0 if there is none. Call once, after
   * the container div is available. */
  public async mount(containerEl: HTMLDivElement, width: number, height: number): Promise<void> {
    this.containerEl = containerEl;
    this.width = width;
    this.height = height;
    this.setUpBookPagination(containerEl.ownerDocument);

    // Guard against a resize (e.g. `ResizeObserver`'s spec-mandated
    // initial callback) racing with the async progress lookup below —
    // `openSpineItem` sets/clears this same flag, but there's a window
    // between calling `mount` and actually reaching `openSpineItem`
    // (while `getProgress` is in flight) where it otherwise wouldn't be
    // set yet, letting a resize slip through against a not-yet-created
    // host. This exact race was caught via real-Chromium testing.
    this.isLoading = true;
    this.notify();

    const resumed = await this.tryResume();
    if (!resumed) {
      await this.openSpineItem(0);
    }
  }

  /** Creates the offscreen container `BookPaginationEstimator` mounts its
   * measurement iframes into, and the estimator itself. `position: fixed`
   * plus zero size and `overflow: hidden` keeps it (and every iframe
   * temporarily mounted inside it, each of which sizes itself explicitly
   * regardless of this wrapper's own size) completely invisible and
   * without affecting this page's own scroll extents — `display: none`
   * would be simpler but real browsers don't lay out `display: none`
   * content at all, which is exactly the real layout measurement this
   * exists to get. */
  private setUpBookPagination(ownerDocument: Document): void {
    const container = ownerDocument.createElement("div");
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "0";
    container.style.height = "0";
    container.style.overflow = "hidden";
    container.setAttribute("aria-hidden", "true");
    ownerDocument.body.appendChild(container);
    this.hiddenMeasureContainer = container;
    this.bookPagination = new BookPaginationEstimator(
      this.contentLoader,
      this.resolver,
      this.pkg.spine,
      this.pkg.metadata.renditionLayout,
      container,
    );
  }

  /** (Re-)starts `bookPagination` at the current width/height/font
   * settings, prioritized around the current spine item, notifying
   * subscribers (so the shell's book-wide page number updates) as each
   * spine item's count becomes known. Safe to call liberally — chapter
   * navigation calls this just to reprioritize (cheap: see
   * `BookPaginationEstimator.run`'s doc comment), while a real width/
   * height/font change triggers the fuller re-measurement. Measures at
   * the *effective single-column* width — in spread mode that's each
   * column's own (narrower) width, not the whole reader pane's — so a
   * book-wide page number always agrees with what's actually on screen. */
  private refreshBookPagination(): void {
    if (!this.bookPagination || this.host instanceof FixedContentHost) {
      return;
    }
    const measureWidth =
      this.host instanceof SpreadPaginatedHost ? SpreadPaginatedHost.effectiveColumnWidth(this.width) : this.width;
    void this.bookPagination.run(this.spineIndex, measureWidth, this.height, this.fontScale, this.fontFamily, () => {
      this.notify();
    });
  }

  /** Looks up a saved CFI for this book and, if one resolves to a valid
   * spine item, opens directly there instead of the beginning. Returns
   * `false` (having done nothing) if there's no saved progress or it
   * can't be resolved — e.g. corrupted data, or a CFI from a differently-
   * structured version of the same book — so the caller falls back to
   * starting from the beginning rather than getting stuck. */
  private async tryResume(): Promise<boolean> {
    try {
      const progress = await this.library.getProgress(this.bookId);
      if (!progress) {
        return false;
      }
      const cfi = EpubCfi.parse(progress.cfi);
      const spineIndex = this.pkg.findSpineIndexByPackageCfiSteps(cfi.packageSteps);
      if (spineIndex === undefined) {
        return false;
      }
      await this.openSpineItem(spineIndex, { bridgeCfi: progress.cfi });
      return true;
    } catch {
      return false;
    }
  }

  /** Resolves the currently-displayed position to a CFI and persists it
   * as this book's reading progress. Called after every navigation action
   * settles (page turn, chapter change, TOC jump, view-mode switch); also
   * exposed as `flushProgress` for the reader page to call on
   * visibility/unload, which is the only reliable checkpoint for
   * continuous-scroll mode's position drifting between explicit actions. */
  private async saveProgress(): Promise<void> {
    const position = this.host?.currentPosition();
    if (!position) {
      return;
    }
    try {
      const locator = this.locatorResolver.generate(this.spineIndex, position.node, position.offset);
      await this.library.saveProgress(this.bookId, locator.cfi);
    } catch {
      // Best-effort: resume-reading is a convenience, not something that
      // should ever surface an error to the reader mid-navigation.
    }
  }

  /** See `saveProgress`. Public so the reader page can flush the current
   * position on `visibilitychange`/`pagehide`. */
  public flushProgress(): Promise<void> {
    return this.saveProgress();
  }

  /** Sets the text the shell's `aria-live` region should announce next,
   * and bumps `announcementId` so a repeat of the same text still
   * triggers a fresh announcement (an `aria-live` region only reacts to
   * a DOM text *change*). */
  private announce(text: string): void {
    this.announcement = text;
    this.announcementId++;
  }

  /** A human-readable label for `spineIndex` — the label of the *last*
   * TOC entry (by actual resolved spine order, not TOC listing order)
   * whose target is at or before `spineIndex` (see
   * `nearestPrecedingNavPoint`), so a spine item with no TOC entry of
   * its own (an epigraph, an unlisted section between two listed
   * chapters) still gets a meaningful label — the chapter it's actually
   * part of — rather than a generic, spine-index-derived "Chapter N"
   * that routinely doesn't match the book's own numbering at all. Used
   * for the running header (see `PageFurniture`), live-region
   * chapter-change announcements, and the progress scrubber's drag
   * preview.
   *
   * Falls back to "Start of Book" specifically when the book *has* a
   * TOC but `spineIndex` is before its first real entry (a cover, title
   * page, etc. — the same section `TocPanel`'s synthetic "Start of
   * Book" entry reaches, see `tocHighlightPath`) — this was a real bug:
   * the progress scrubber previously showed "Chapter 1" for this
   * section, disagreeing with what the TOC panel itself highlighted
   * there. Only falls back further to a generic "Chapter N" when the
   * book has no TOC at all, since calling literally every page "Start
   * of Book" for such a book would be actively misleading. */
  private chapterLabel(spineIndex: number): string {
    const nearest = this.nearestPrecedingNavPoint(spineIndex);
    if (nearest) {
      return nearest.label;
    }
    const hasAnyToc = ReaderController.flattenLinkedNavPoints(this.navigation.toc.items).length > 0;
    return hasAnyToc ? "Start of Book" : `Chapter ${spineIndex + 1}`;
  }

  /** Flattens every *linked* entry out of a TOC tree, in document order
   * — a helper for `nearestPrecedingNavPoint`, which needs to consider
   * every entry as a candidate regardless of nesting depth. */
  private static flattenLinkedNavPoints(items: readonly NavPoint[]): NavPoint[] {
    const result: NavPoint[] = [];
    for (const item of items) {
      if (item.isLinked && item.path !== undefined) {
        result.push(item);
      }
      result.push(...ReaderController.flattenLinkedNavPoints(item.children));
    }
    return result;
  }

  /** The TOC entry (by actual resolved spine order, not TOC listing
   * order) whose target is the *last* one at or before `spineIndex` —
   * shared by `chapterLabel` and `tocHighlightPath`, both of which need
   * to treat a spine item with no TOC entry of its own as "part of
   * whichever listed chapter precedes it," not unlabeled. Returns
   * `undefined` if there's no such entry — either the book's TOC is
   * empty, or `spineIndex` is before its first real entry — callers
   * distinguish those two cases themselves, since they mean different
   * things (a generic "Chapter N" vs. "Start of Book"). */
  private nearestPrecedingNavPoint(spineIndex: number): NavPoint | undefined {
    let best: NavPoint | undefined;
    let bestSpineIndex = -1;

    for (const candidate of ReaderController.flattenLinkedNavPoints(this.navigation.toc.items)) {
      const candidateIndex = this.pkg.spine.findIndex((ref) => ref.manifestItem.path === candidate.path);
      if (candidateIndex === -1 || candidateIndex > spineIndex) {
        continue;
      }
      if (candidateIndex >= bestSpineIndex) {
        best = candidate;
        bestSpineIndex = candidateIndex;
      }
    }

    return best;
  }

  /** The TOC entry the shell should highlight as "current" — not
   * necessarily the entry whose path exactly matches the open spine
   * item (see `currentSpinePath`), since real books routinely have
   * spine items with no TOC entry of their own at all (an epigraph, a
   * dedication, an unlisted section between two listed chapters).
   * Falls back to the book's very first spine item — i.e. the
   * synthetic "Start of Book" entry `TocPanel` shows when the TOC's own
   * first entry skips ahead of it — if the reader is somewhere before
   * the first real TOC entry's target (a cover, title page, etc. that
   * isn't listed at all). Without this fallback-to-nearest-preceding-
   * entry logic, a reader on such an unlisted spine item would see
   * *nothing* at all highlighted in the TOC, a real bug reported
   * directly. */
  private tocHighlightPath(): string | undefined {
    return this.nearestPrecedingNavPoint(this.spineIndex)?.path ?? this.pkg.spine[0]?.manifestItem.path;
  }

  /** The content document accessibility (keyboard navigation, focus
   * management) and CFI/fragment resolution key off — the *only* document
   * for every host type except `SpreadPaginatedHost`, where it's
   * specifically the primary (left) column; see that class's doc comment
   * for why the right column is deliberately excluded. */
  private primaryContentDocument(): Document | undefined {
    if (this.host instanceof SpreadPaginatedHost) {
      return this.host.primaryContentDocument();
    }
    return this.host?.element.contentDocument ?? undefined;
  }

  /** Every content document the reader might receive a click in — one for
   * every host type except `SpreadPaginatedHost`, which has two (both
   * columns get working in-content links, even though only the left one
   * participates in keyboard/focus accessibility). */
  private allContentDocuments(): Document[] {
    if (this.host instanceof SpreadPaginatedHost) {
      return this.host.contentDocuments();
    }
    const doc = this.host?.element.contentDocument;
    return doc ? [doc] : [];
  }

  /** Updates the current content host's iframe title(s) to reflect the
   * current chapter — split out so an animated page turn (see
   * `animatePageTurn`), which swaps in a brand-new host without going
   * through the full `setUpAccessibility` flow, can keep it in sync too. */
  private updateContentTitle(): void {
    const title = `${this.pkg.metadata.title} — ${this.chapterLabel(this.spineIndex)}`;
    if (this.host instanceof SpreadPaginatedHost) {
      this.host.setTitle(title);
    } else if (this.host) {
      this.host.element.title = title;
    }
  }

  /** (Re-)attaches `ArrowLeft`/`ArrowRight` keyboard navigation to the
   * current content host's primary iframe document, *without* moving
   * focus — split out from `setUpAccessibility` so a plain in-chapter
   * page turn (including an animated one — see `animatePageTurn`, which
   * swaps in a brand-new host/document each turn) can re-arm keyboard
   * navigation for that new document without stealing focus away from
   * wherever the reader currently has it, consistent with page turns
   * never forcing focus (only chapter changes/TOC jumps/fragment
   * navigation do — see `setUpAccessibility`). */
  private reattachKeyboardNav(): void {
    const iframeDocument = this.primaryContentDocument();
    if (!iframeDocument) {
      return;
    }
    const isPaginated = this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost;
    this.accessibility.attach(iframeDocument, {
      onNext: () => void (isPaginated ? this.turnPage(1) : this.goToChapter(1)),
      onPrevious: () => void (isPaginated ? this.turnPage(-1) : this.goToChapter(-1)),
    });
  }

  /** Re-arms keyboard navigation and the click/drag page-turn gesture on
   * the current content document, and restores focus into the content if
   * nothing else in the parent app is deliberately holding it — call
   * whenever the browser window regains OS-level focus (see the reader
   * page's own `window.addEventListener("focus", ...)`).
   *
   * The concrete, reproducible cause this guards against: a plain page
   * turn deliberately never moves focus (see `reattachKeyboardNav`'s doc
   * comment), so if the reader's last interaction before switching away
   * landed focus somewhere in the parent shell (a toolbar button, or
   * simply nowhere in particular after a click on non-focusable chrome),
   * keyboard arrow-key page-turning silently stops working — not because
   * any listener broke, but because the browser correctly delivers
   * keydown events to whatever currently has focus, which is no longer
   * inside the content iframe at all. The previously-reported symptom
   * ("page turning stops working entirely after alt-tabbing away and
   * back, until navigating via the TOC") is exactly this: TOC navigation
   * incidentally "fixes" it only because `setUpAccessibility` explicitly
   * refocuses the content as part of opening a spine item, not because
   * of anything specific to rebuilding the host.
   *
   * Refocuses content whenever the window regains focus *unless* a
   * toolbar menu/popup is currently open (Fluent UI menus manage their
   * own focus trapping — forcibly moving focus away mid-interaction
   * would be actively disruptive, not helpful). A plain toolbar button
   * merely *having* focus (the common case: the reader's last action
   * before switching away was clicking something, or simply clicking
   * back into the window landed on the toolbar's chrome rather than the
   * page itself) is deliberately *not* treated as "leave it alone" —
   * reading is this app's primary activity, so restoring keyboard
   * page-turning takes priority over a transient, non-input control
   * happening to still show a focus ring.
   *
   * Also re-arms the click/drag page-turn gesture (`setUpDragPageTurn`)
   * as a cheap additional safety net — it's already safe to call
   * repeatedly on a still-alive document (it cleans up its own previous
   * listener first), so there's no real cost to re-running it here even
   * if it turns out not to be needed for this particular regression. */
  public handleWindowRefocus(): void {
    this.reattachKeyboardNav();
    this.setUpDragPageTurn();

    const iframeDocument = this.primaryContentDocument();
    const topDocument = this.containerEl?.ownerDocument;
    const menuOpen = topDocument?.querySelector('[role="menu"], [role="dialog"], [role="listbox"]') != null;
    if (iframeDocument && topDocument && !menuOpen) {
      this.accessibility.focusContent(iframeDocument);
    }
  }

  /** (Re-)attaches keyboard navigation to the current content host's
   * iframe document and moves focus into it — called every time a new
   * spine item is opened, since each one gets a fresh iframe/document.
   * "Next"/"previous" mean "turn a page" in paginated mode (there's no
   * page concept in scroll/fixed-layout mode, so they mean "go to the
   * next/previous chapter" there instead). */
  private setUpAccessibility(focusTarget?: Element): void {
    this.updateContentTitle();
    this.reattachKeyboardNav();

    const iframeDocument = this.primaryContentDocument();
    if (!iframeDocument) {
      return;
    }
    this.accessibility.focusContent(iframeDocument, focusTarget);
  }

  /**
   * Intercepts clicks on in-content `<a href>` links (footnotes, cross-
   * references, "see chapter N" links — extremely common in real books)
   * and routes them through the reader's own navigation instead of
   * letting the browser attempt to navigate the sandboxed iframe itself.
   * Without this, real-Chromium testing showed Chrome silently blocks the
   * navigation (the sandbox has no `allow-top-navigation` token, nor
   * could it safely be given one — that would let untrusted book content
   * navigate the whole extension tab) but *also* discards the iframe's
   * current content in the process, leaving a blank page — arguably
   * worse than doing nothing. An absolute-URI link (`http:`, `mailto:`,
   * etc.) opens in a new top-level browser tab instead, the standard
   * behavior real readers use for links that lead outside the book.
   *
   * Attached to every document `allContentDocuments()` returns — in
   * spread mode, that's both columns, so a link on the companion (right)
   * page works exactly like one on the primary (left) page, even though
   * only the left page participates in keyboard/focus accessibility.
   */
  private setUpLinkInterception(): void {
    const currentPath = this.pkg.spine[this.spineIndex]?.manifestItem.path;
    const documents = this.allContentDocuments();
    if (documents.length === 0 || !currentPath) {
      return;
    }

    const focusDocument = this.primaryContentDocument();
    const cleanups: Array<() => void> = [];

    for (const iframeDocument of documents) {
      const clickHandler = (event: MouseEvent): void => {
        const anchor = (event.target as Element | null)?.closest?.("a[href]");
        const href = anchor?.getAttribute("href");
        if (!href) {
          return;
        }
        event.preventDefault();

        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          // An absolute URI (http:, https:, mailto:, ...) — not a path
          // within this book at all.
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }

        const { fragment } = splitHrefFragment(href);
        const targetPath = resolveEpubPath(currentPath, href);
        const targetSpineIndex = this.pkg.spine.findIndex((ref) => ref.manifestItem.path === targetPath);
        if (targetSpineIndex === -1) {
          // Points at something that isn't a spine item (e.g. a resource
          // the manifest declares but the spine doesn't include) — nothing
          // sensible to navigate to; already prevented default above.
          return;
        }

        if (targetSpineIndex === this.spineIndex) {
          if (fragment) {
            const focusTarget = this.goToFragment(fragment);
            if (focusDocument) {
              this.accessibility.focusContent(focusDocument, focusTarget);
            }
          }
          return;
        }
        void this.openSpineItem(targetSpineIndex, { fragment });
      };

      iframeDocument.addEventListener("click", clickHandler);
      cleanups.push(() => iframeDocument.removeEventListener("click", clickHandler));

      // Hides the toolbar immediately on any click into the content —
      // see `contentPointerActivityId`'s doc comment. Attached here
      // (rather than only alongside the paginated/spread click-to-
      // navigate listeners) so this also covers scroll mode and fixed-
      // layout content, which have no page-turn gesture of their own but
      // should still dismiss the toolbar the instant the reader clicks
      // into the page.
      const pointerDownHandler = (): void => {
        this.bumpContentActivity();
      };
      iframeDocument.addEventListener("pointerdown", pointerDownHandler);
      cleanups.push(() => iframeDocument.removeEventListener("pointerdown", pointerDownHandler));
    }

    this.linkClickCleanup = () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  /** Relays a resize (e.g. the reader pane changing size, or the user
   * changing font size in a future settings panel) into the active
   * content host, which preserves reading position across the relayout —
   * see `PaginatedContentHost.relayout`/`ScrollContentHost.resize`. A
   * no-op if the size hasn't actually changed (e.g. a deferred resize —
   * see `pendingResize` — turns out to match what was already used),
   * avoiding pointless re-pagination that could otherwise introduce its
   * own drift in the restored position. Crossing the two-page-spread
   * width threshold (see `shouldSwitchSpreadMode`) is handled as a full
   * host swap rather than a plain relayout, since a spread is
   * architecturally two iframes, not one. */
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    if (this.isLoading) {
      this.pendingResize = { width, height };
      return;
    }

    if (width === this.appliedWidth && height === this.appliedHeight) {
      return;
    }

    if (this.shouldSwitchSpreadMode(width)) {
      void this.reopenForCurrentSize();
      return;
    }

    this.appliedWidth = width;
    this.appliedHeight = height;

    if (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost) {
      this.host.relayout(width, height);
    } else if (this.host instanceof ScrollContentHost || this.host instanceof FixedContentHost) {
      this.host.resize(width, height);
    }
    this.refreshBookPagination();
    this.notify();
  }

  /** `true` if the reader pane just crossed the two-page-spread width
   * threshold (`SpreadPaginatedHost.isEligible`) while in paginated mode
   * on a reflowable spine item. Fixed-layout content and scroll mode
   * never use a spread — see `SpreadPaginatedHost`'s doc comment. */
  private shouldSwitchSpreadMode(width: number): boolean {
    if (this.viewMode !== "paginated" || this.host instanceof FixedContentHost) {
      return false;
    }
    return SpreadPaginatedHost.isEligible(width) !== (this.host instanceof SpreadPaginatedHost);
  }

  /** Bridges the current reading position via CFI and reopens the
   * current spine item at the (already-updated) `width`/`height` — used
   * when a resize crosses the spread-mode width threshold, the same
   * CFI-bridging `setViewMode` uses for the paginated/scroll switch. */
  private async reopenForCurrentSize(): Promise<void> {
    const position = this.host?.currentPosition();
    const bridgeCfi = position
      ? this.locatorResolver.generate(this.spineIndex, position.node, position.offset).cfi
      : undefined;
    await this.openSpineItem(this.spineIndex, { bridgeCfi });
  }

  public async setViewMode(mode: ViewMode): Promise<void> {
    if (mode === this.viewMode || !this.containerEl) {
      return;
    }

    // Bridge position across the switch: the two modes render into
    // separate content hosts (separate iframes/documents), so a raw DOM
    // position from the old one is meaningless in the new one — resolve
    // it through a CFI instead, exactly the scenario CFI exists for.
    const position = this.host?.currentPosition();
    const bridgeCfi = position
      ? this.locatorResolver.generate(this.spineIndex, position.node, position.offset).cfi
      : undefined;

    this.viewMode = mode;
    await this.library.setDefaultViewMode(mode);
    await this.openSpineItem(this.spineIndex, { bridgeCfi });
    this.announce(mode === "paginated" ? "Paginated view" : "Scroll view");
    this.notify();
  }

  /** Sets the reader-controlled font-size multiplier (clamped to
   * `ReadingTheme`'s supported range), persists it as the new default for
   * future chapters/sessions, and re-measures the current content host at
   * the new size — the same relayout path a window resize uses, so
   * reading position is preserved across the font-size change exactly the
   * way it is across a resize (see `PaginatedContentHost.relayout`/
   * `ScrollContentHost.resize`). A no-op for a fixed-layout spine item,
   * which has no reader-adjustable typography. */
  public async setFontScale(scale: number): Promise<void> {
    const clamped = Math.min(ReadingTheme.MAX_FONT_SCALE, Math.max(ReadingTheme.MIN_FONT_SCALE, scale));
    if (clamped === this.fontScale || this.host instanceof FixedContentHost) {
      return;
    }
    this.fontScale = clamped;
    await this.library.setDefaultFontScale(clamped);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    this.notify();
    await this.saveProgress();
  }

  /** Sets the reader-controlled font family, persists it, and re-measures
   * the current content host — a different typeface has different
   * metrics, so this reflows content the same way a font-scale change
   * does. A no-op for a fixed-layout spine item. */
  public async setFontFamily(family: FontFamilyChoice): Promise<void> {
    if (family === this.fontFamily || this.host instanceof FixedContentHost) {
      return;
    }
    this.fontFamily = family;
    await this.library.setDefaultFontFamily(family);
    this.applyDisplaySettingsToHost({ relayout: true });
    this.refreshBookPagination();
    this.notify();
    await this.saveProgress();
  }

  /** Sets the reader-controlled page color theme and persists it. Unlike
   * font scale/family, this never needs a relayout — colors don't affect
   * line-wrapping. A no-op for a fixed-layout spine item. */
  public async setPageTheme(theme: PageTheme): Promise<void> {
    if (theme === this.pageTheme || this.host instanceof FixedContentHost) {
      return;
    }
    this.pageTheme = theme;
    await this.library.setDefaultPageTheme(theme);
    this.applyDisplaySettingsToHost({ relayout: false });
    this.notify();
  }

  /** Writes the current font scale/family and page theme onto every
   * current content document as CSS custom properties (see
   * `ReadingTheme.applyFontScale`/`applyFontFamily`/`applyPageTheme`) and,
   * if `relayout` is set, re-measures at the current size — every spine
   * item load applies all three the same way (see `openSpineItem`), so a
   * book opened mid-session at non-default settings looks correct
   * immediately, not just after the first explicit change. No-op for
   * fixed-layout content, which never gets the reading theme at all. In
   * spread mode, both columns are independent documents and need the
   * properties set individually before the shared relayout re-measures
   * them together. */
  private applyDisplaySettingsToHost(options: { relayout: boolean }): void {
    if (this.host instanceof FixedContentHost) {
      return;
    }
    const documents = this.allContentDocuments();
    if (documents.length === 0) {
      return;
    }
    for (const doc of documents) {
      ReadingTheme.applyFontScale(doc, this.fontScale);
      ReadingTheme.applyFontFamily(doc, this.fontFamily);
      ReadingTheme.applyPageTheme(doc, this.pageTheme);
    }
    if (!options.relayout) {
      return;
    }
    if (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost) {
      this.host.relayout(this.width, this.height);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.resize(this.width, this.height);
    }
  }

  /** Applies the persisted font scale/family/page theme to a freshly-
   * opened host (see `openSpineItem`) — every spine item load needs this,
   * not just explicit in-session changes, so a book opened mid-session at
   * non-default settings looks correct immediately. Skips the (fairly
   * expensive) relayout pass entirely when every setting is already at
   * its theme-default value, since the freshly-opened host was already
   * paginated at those defaults by its own `open()` call. */
  private applyPersistedDisplaySettingsToFreshHost(): void {
    const needsRelayout = this.fontScale !== 1 || this.fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY;
    if (needsRelayout || this.pageTheme !== ReadingTheme.DEFAULT_PAGE_THEME) {
      this.applyDisplaySettingsToHost({ relayout: needsRelayout });
    }
  }

  /** Turns one page (or one spread, in spread mode) in paginated mode. In
   * scroll mode, this is a no-op — scrolling is continuous and has no
   * discrete "page" concept; use native scrolling within the content host
   * instead. Crossing the first/last page of the current spine item
   * advances to the adjacent chapter automatically. A single-column
   * paginated turn plays a book-like flip animation (see
   * `animatePageTurn`); spread turns and chapter-boundary turns are
   * instant for now. Ignored entirely if a turn is already in progress —
   * see `isTurningPage`. */
  public async turnPage(direction: 1 | -1): Promise<void> {
    if (this.isTurningPage) {
      return;
    }
    this.isTurningPage = true;
    const token = ++this.turnToken;
    try {
      await this.turnPageInternal(direction, token);
    } finally {
      this.isTurningPage = false;
    }
  }

  private async turnPageInternal(direction: 1 | -1, token: number): Promise<void> {
    let moved: boolean;
    let announcement: string;
    if (this.host instanceof SpreadPaginatedHost) {
      moved = direction === 1 ? this.host.nextSpread() : this.host.previousSpread();
      const second = this.host.secondPageIndex;
      announcement = second !== undefined
        ? `Pages ${this.host.pageIndex + 1}–${second + 1} of ${this.host.pageCount}`
        : `Page ${this.host.pageIndex + 1} of ${this.host.pageCount}`;
    } else if (this.host instanceof PaginatedContentHost) {
      const animatedHost = await this.animatePageTurn(this.host, direction);
      if (animatedHost) {
        if (token !== this.turnToken) {
          // A newer turn (click or drag) has since started and finished
          // while this one's incoming page was loading/animating —
          // discard this stale result instead of clobbering the newer
          // state (see `turnToken`).
          animatedHost.dispose();
          return;
        }
        this.linkClickCleanup?.();
        this.linkClickCleanup = undefined;
        this.dragCleanup?.();
        this.dragCleanup = undefined;
        this.host = animatedHost;
        this.updateContentTitle();
        this.reattachKeyboardNav();
        this.setUpLinkInterception();
        this.setUpDragPageTurn();
        this.announce(`Page ${animatedHost.currentPageIndex + 1} of ${animatedHost.pageCount}`);
        this.notify();
        await this.saveProgress();
        return;
      }
      moved = direction === 1 ? this.host.nextPage() : this.host.previousPage();
      announcement = `Page ${this.host.currentPageIndex + 1} of ${this.host.pageCount}`;
    } else {
      return;
    }

    if (moved) {
      this.announce(announcement);
      this.notify();
      await this.saveProgress();
      return;
    }

    const nextSpineIndex = this.spineIndex + direction;
    if (nextSpineIndex < 0 || nextSpineIndex >= this.pkg.spine.length) {
      return;
    }
    await this.openSpineItem(nextSpineIndex, { landOnLastPage: direction === -1 });
  }

  /** Plays a book-like page-turn flip and returns the fully-paginated
   * *new* host to swap in as `this.host` — or `undefined` if `direction`
   * would cross a chapter boundary (the caller falls back to its normal
   * chapter-advance handling; this pass doesn't animate that case).
   *
   * Real book feel requires the outgoing and incoming pages to be visible
   * *simultaneously* mid-turn, which a single iframe fundamentally can't
   * do (it only ever shows one page at a time) — so this builds the
   * incoming page in a brand-new, independent `PaginatedContentHost` (see
   * `prepareIncomingPage`), stacks it *underneath* the outgoing page, and
   * animates only the outgoing page rotating away — `backface-visibility:
   * hidden` makes it disappear past 90°, revealing the already-fully-
   * rendered incoming page beneath it without that page needing any
   * animation of its own.
   *
   * Skips the animation (an instant page swap) when
   * `prefers-reduced-motion` is set, consistent with the rest of the
   * reader respecting it. See `beginDragPageTurn` for the interactive,
   * pointer-driven version of this same underlying mechanism.
   */
  private async animatePageTurn(
    oldHost: PaginatedContentHost,
    direction: 1 | -1,
  ): Promise<PaginatedContentHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    const newHost = await this.prepareIncomingPage(oldHost, direction);
    if (!newHost) {
      return undefined;
    }
    const containerEl = this.containerEl;
    const newEl = newHost.element;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!reduceMotion) {
      const oldEl = oldHost.element;
      this.stagePageTurn(oldHost, direction);

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          oldEl.removeEventListener("transitionend", onTransitionEnd);
          resolve();
        };
        const onTransitionEnd = (event: TransitionEvent): void => {
          if (event.target === oldEl && event.propertyName === "transform") {
            finish();
          }
        };
        oldEl.addEventListener("transitionend", onTransitionEnd);
        oldEl.style.transition = "transform 380ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 380ms ease";
        // Rotating slightly past 90° (rather than stopping exactly at
        // it) reads as a page continuing its motion out of view rather
        // than freezing edge-on to the viewer.
        requestAnimationFrame(() => {
          this.setPageTurnRotation(oldEl, direction === 1 ? -100 : 100, 1);
        });
        // A safety net in case `transitionend` never fires (e.g. the
        // element was removed mid-transition by a rapid subsequent
        // action) — never leave the turn hung indefinitely.
        setTimeout(finish, 600);
      });
      containerEl.style.perspective = "";
    }

    // `oldHost.dispose()` removes its iframe from `containerEl`, leaving
    // `newEl` as the sole remaining child — reset its temporary
    // positioning so it behaves like any other freshly-mounted host for
    // every subsequent operation (relayout, resize, etc.).
    oldHost.dispose();
    newEl.style.position = "";
    newEl.style.top = "";
    newEl.style.left = "";
    newEl.style.transform = "";
    newEl.style.zIndex = "";
    return newHost;
  }

  /** Builds and returns the incoming page for a turn away from
   * `oldHost`'s current page, positioned to sit exactly beneath
   * `oldHost.element` (which stays a normal, flex-centered in-flow child,
   * left completely undisturbed) without needing any wrapper elements —
   * `containerEl` is already `position: absolute` (see `ReaderApp`), so
   * it's a valid containing block for this on its own. Returns
   * `undefined` if `direction` would cross a chapter boundary.
   *
   * `newHost.element` is attached to the live document *before*
   * `open()` is called on it — an iframe generally won't start loading
   * its `src` at all while detached from the document, a real bug this
   * comment exists specifically to prevent regressing (caught via
   * Chromium verification: the load hung until it hit
   * `RenderingSurfaceError`'s timeout). Likewise, `oldHost.element` is
   * never reparented here or anywhere else in the page-turn machinery:
   * most browsers reload an iframe that's ever disconnected and
   * reattached to the document, even synchronously.
   */
  private async prepareIncomingPage(
    oldHost: PaginatedContentHost,
    direction: 1 | -1,
  ): Promise<PaginatedContentHost | undefined> {
    if (!this.containerEl) {
      return undefined;
    }
    const targetIndex = oldHost.currentPageIndex + direction;
    if (targetIndex < 0 || targetIndex >= oldHost.pageCount) {
      return undefined;
    }

    const containerEl = this.containerEl;
    const newHost = new PaginatedContentHost(this.width, this.height);
    const newEl = newHost.element;
    newEl.style.position = "absolute";
    newEl.style.top = "0";
    newEl.style.left = "50%";
    newEl.style.transform = "translateX(-50%)";
    newEl.style.zIndex = "1";
    containerEl.appendChild(newEl);

    await newHost.open(this.contentLoader, this.resolver, this.spineIndex);
    const newDoc = newHost.element.contentDocument;
    if (newDoc) {
      ReadingTheme.applyPageTheme(newDoc, this.pageTheme);
      if (this.fontScale !== 1 || this.fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY) {
        ReadingTheme.applyFontScale(newDoc, this.fontScale);
        ReadingTheme.applyFontFamily(newDoc, this.fontFamily);
        newHost.relayout(this.width, this.height);
      }
    }
    newHost.goToPageIndex(targetIndex);
    newEl.title = oldHost.element.title;
    return newHost;
  }

  /** Puts `oldHost.element` into "ready to rotate" state (perspective on
   * the container, the correct hinge edge for `direction`, hidden
   * backface) without yet touching its `transform` — shared setup
   * between the click-triggered (`animatePageTurn`) and drag-driven
   * (`beginDragPageTurn`) turn mechanics. */
  private stagePageTurn(oldHost: PaginatedContentHost, direction: 1 | -1): void {
    if (!this.containerEl) {
      return;
    }
    const oldEl = oldHost.element;
    this.containerEl.style.perspective = "2200px";
    oldEl.style.position = "relative";
    oldEl.style.zIndex = "2";
    oldEl.style.backfaceVisibility = "hidden";
    // The hinge is the spine edge the page turns away from: the right
    // edge turning forward (as if lifting toward the next page), the
    // left edge turning back.
    oldEl.style.transformOrigin = `${direction === 1 ? "right" : "left"} center`;
  }

  /** Sets `oldEl`'s rotation directly (no transition) — `fraction` (0 to
   * 1) scales a deepening drop shadow alongside the rotation, so a
   * partial drag reads as the page physically lifting, not just tilting
   * in place. */
  private setPageTurnRotation(oldEl: HTMLIFrameElement, degrees: number, fraction: number): void {
    oldEl.style.transform = `rotateY(${degrees}deg)`;
    oldEl.style.boxShadow = `0 12px 40px rgba(0, 0, 0, ${(0.35 * fraction).toFixed(3)})`;
  }

  /** Fraction of the reader pane's width a drag must cross before
   * releasing completes the turn rather than reverting it — a book page
   * lifted less than halfway falls back closed; lifted further, it
   * carries on over. */
  private static readonly DRAG_COMMIT_THRESHOLD = 0.4;

  /** (Re-)attaches the pointer-driven page-turn gesture(s) to the current
   * content host. Single-column paginated mode gets the full draggable,
   * animated flip (see `beginDragPageTurn`); spread mode gets click-to-
   * navigate only, on each column independently (see
   * `setUpSpreadClickToNavigate`) — a drag/flip animation across two
   * independent side-by-side iframes is a substantially harder visual
   * problem, deliberately out of scope for this pass, same as
   * chapter-crossing drags. Attached directly to each iframe's own
   * document for the same reason `AccessibilityController` attaches its
   * keyboard listener there: pointer events started inside an iframe
   * don't bubble out to the parent window. */
  private setUpDragPageTurn(): void {
    this.dragCleanup?.();
    this.dragCleanup = undefined;

    if (this.host instanceof SpreadPaginatedHost) {
      this.dragCleanup = this.setUpSpreadClickToNavigate(this.host);
      return;
    }

    if (!(this.host instanceof PaginatedContentHost)) {
      return;
    }
    const iframeDocument = this.host.element.contentDocument;
    if (!iframeDocument) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      this.beginDragPageTurn(event, iframeDocument);
    };
    iframeDocument.addEventListener("pointerdown", onPointerDown);
    this.dragCleanup = () => iframeDocument.removeEventListener("pointerdown", onPointerDown);
  }

  /** Click-to-navigate for spread mode: no drag/flip animation (see
   * `setUpDragPageTurn`'s doc comment), just tap detection independently
   * on each column — reuses `handleContentClick`'s tap-vs-drag/selection/
   * link guards, but with *that column's own width* as the left/right-
   * third reference (via `SpreadPaginatedHost.effectiveColumnWidth`) so
   * "tapping near this page's edge" means the same thing regardless of
   * which of the two side-by-side columns it lands in. Attached to both
   * columns (not just the primary/left one accessibility uses), matching
   * `setUpLinkInterception`'s existing scope: mouse interaction works on
   * both pages of a spread, even though only the left one participates
   * in keyboard/focus accessibility.
   *
   * Also attaches a *third* listener directly to `host.element` (the
   * parent-side container both iframes sit inside, not a cross-document
   * boundary) for the blank-companion-page case: `SpreadPaginatedHost`
   * hides the right column with `visibility: hidden` when there's no
   * next page to show it (see `syncRight`), and a `visibility: hidden`
   * element is never hit-tested at all — a click there passes straight
   * through to whatever's behind it in the *same* document, which is
   * this container, not the (invisible) iframe. Without this, tapping
   * that blank facing page silently did nothing, a real bug caught via
   * real-Chromium interaction: there was simply no listener anywhere
   * that a click landing there could ever reach. Any tap this container-
   * level listener catches — the blank page, or the narrow gutter
   * divider between columns — reasonably means "continue forward", so
   * it always turns the page ahead rather than bucketing into thirds
   * (there's no content there to reference thirds against).
   *
   * Returns a single cleanup function for all three listeners, for
   * `setUpDragPageTurn`'s `dragCleanup` to call as one unit. */
  private setUpSpreadClickToNavigate(host: SpreadPaginatedHost): () => void {
    const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(this.width);
    const cleanups: Array<() => void> = [];

    for (const doc of host.contentDocuments()) {
      let startX = 0;
      let startY = 0;
      const onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        startX = event.clientX;
        startY = event.clientY;
      };
      const onPointerUp = (event: PointerEvent): void => {
        this.handleContentClick(event, startX, startY, columnWidth);
      };
      doc.addEventListener("pointerdown", onPointerDown);
      doc.addEventListener("pointerup", onPointerUp);
      cleanups.push(() => {
        doc.removeEventListener("pointerdown", onPointerDown);
        doc.removeEventListener("pointerup", onPointerUp);
      });
    }

    const containerEl = host.element;
    let containerStartX = 0;
    let containerStartY = 0;
    const onContainerPointerDown = (event: PointerEvent): void => {
      this.bumpContentActivity();
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      containerStartX = event.clientX;
      containerStartY = event.clientY;
    };
    const onContainerPointerUp = (event: PointerEvent): void => {
      const deltaX = Math.abs(event.clientX - containerStartX);
      const deltaY = Math.abs(event.clientY - containerStartY);
      if (deltaX > ReaderController.CLICK_MOVEMENT_TOLERANCE || deltaY > ReaderController.CLICK_MOVEMENT_TOLERANCE) {
        return;
      }
      void this.turnPage(1);
    };
    containerEl.addEventListener("pointerdown", onContainerPointerDown);
    containerEl.addEventListener("pointerup", onContainerPointerUp);
    cleanups.push(() => {
      containerEl.removeEventListener("pointerdown", onContainerPointerDown);
      containerEl.removeEventListener("pointerup", onContainerPointerUp);
    });

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  /** Tracks one pointer gesture from `pointerdown` through release,
   * turning the page interactively: the outgoing page rotates in direct
   * proportion to how far the pointer has moved (see
   * `setPageTurnRotation`) rather than on a fixed timer, so the reader
   * can see exactly how far "through" the turn they are and change their
   * mind mid-gesture. Direction (forward/back) locks in on the first
   * movement past a small dead zone (so an ordinary tap/click is never
   * misread as a drag), at which point the incoming page begins loading
   * (see `prepareIncomingPage`) — if the pointer is released before that
   * finishes, `settleDragPageTurn` is invoked as soon as it does, using
   * whatever fraction was last recorded. */
  private beginDragPageTurn(startEvent: PointerEvent, doc: Document): void {
    if (this.isTurningPage || !(this.host instanceof PaginatedContentHost)) {
      return;
    }
    const oldHost = this.host;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const containerWidth = Math.max(1, this.width);

    let direction: 1 | -1 | undefined;
    let newHost: PaginatedContentHost | undefined;
    let preparing = false;
    let released = false;
    let latestFraction = 0;
    let capturedToken: number | undefined;

    const cleanupListeners = (): void => {
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerup", onPointerUp);
      doc.removeEventListener("pointercancel", onPointerUp);
    };

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaX = moveEvent.clientX - startX;

      if (direction === undefined) {
        if (Math.abs(deltaX) < 12) {
          return;
        }
        const lockedDirection: 1 | -1 = deltaX < 0 ? 1 : -1;
        direction = lockedDirection;
        this.isTurningPage = true;
        const token = ++this.turnToken;
        capturedToken = token;
        preparing = true;
        void this.prepareIncomingPage(oldHost, lockedDirection).then((prepared) => {
          preparing = false;
          newHost = prepared;
          if (released) {
            void this.settleDragPageTurn(oldHost, prepared, lockedDirection, latestFraction, token);
            return;
          }
          if (prepared) {
            this.stagePageTurn(oldHost, lockedDirection);
            this.setPageTurnRotation(oldHost.element, lockedDirection * -90 * latestFraction, latestFraction);
          } else {
            // A chapter boundary — nothing to drag into in this pass.
            this.isTurningPage = false;
          }
        });
      }

      moveEvent.preventDefault();
      const fraction = Math.max(0, Math.min(1, Math.abs(deltaX) / containerWidth));
      latestFraction = fraction;
      if (newHost && direction !== undefined) {
        this.setPageTurnRotation(oldHost.element, direction * -90 * fraction, fraction);
      }
    };

    const onPointerUp = (upEvent: PointerEvent): void => {
      cleanupListeners();
      if (direction === undefined || capturedToken === undefined) {
        // Never moved past the dead zone — an ordinary tap/click, not a
        // drag. Treat it as click-to-navigate (see `handleContentClick`)
        // rather than as nothing, but only for a genuine release, not a
        // cancelled gesture (e.g. the pointer leaving the window).
        if (upEvent.type === "pointerup") {
          this.handleContentClick(upEvent, startX, startY, containerWidth);
        }
        return;
      }
      released = true;
      if (preparing) {
        // `onPointerMove`'s promise continuation settles this once the
        // incoming page finishes loading.
        return;
      }
      void this.settleDragPageTurn(oldHost, newHost, direction, latestFraction, capturedToken);
    };

    doc.addEventListener("pointermove", onPointerMove);
    doc.addEventListener("pointerup", onPointerUp);
    doc.addEventListener("pointercancel", onPointerUp);
  }

  /** Maximum total pointer movement (in either axis, px) between
   * `pointerdown` and `pointerup` for a gesture to still count as a tap
   * rather than an aborted drag/selection — deliberately generous enough
   * to absorb ordinary hand tremor, but small enough that a real text
   * selection drag (which usually moves well past this before the
   * pointer is released) never gets misread as a page-turn tap. */
  private static readonly CLICK_MOVEMENT_TOLERANCE = 10;

  /** Click-to-navigate: turns the page when a tap/click lands in the
   * left or right third of the reading pane, and does nothing in the
   * middle third (reserved for a future "show/hide chrome" tap target,
   * and simply safe to leave inert for now). Only reachable when
   * `beginDragPageTurn`'s pointer gesture never crossed its drag
   * dead-zone, so this never fires alongside an actual page-turn drag.
   * Two additional guards keep it from misfiring: an active text
   * selection (the user was dragging to select, not tapping) and a click
   * that landed on an `<a href>` (already handled, and already
   * navigated, by `setUpLinkInterception`'s own click listener — turning
   * the page *as well* would be a confusing double-navigation). */
  private handleContentClick(upEvent: PointerEvent, startX: number, startY: number, containerWidth: number): void {
    const deltaX = Math.abs(upEvent.clientX - startX);
    const deltaY = Math.abs(upEvent.clientY - startY);
    if (
      deltaX > ReaderController.CLICK_MOVEMENT_TOLERANCE ||
      deltaY > ReaderController.CLICK_MOVEMENT_TOLERANCE
    ) {
      return;
    }

    const selection = upEvent.target instanceof Node ? upEvent.target.ownerDocument?.getSelection() : undefined;
    if (selection && !selection.isCollapsed) {
      return;
    }

    if ((upEvent.target as Element | null)?.closest?.("a[href]")) {
      return;
    }

    const thirdWidth = containerWidth / 3;
    if (startX < thirdWidth) {
      void this.turnPage(-1);
    } else if (startX > containerWidth - thirdWidth) {
      void this.turnPage(1);
    }
    // Middle third: no-op for now.
  }

  /** Resolves a drag gesture once released (and, if it was still loading,
   * once the incoming page finishes preparing): animates the rest of the
   * way to completion if the drag crossed `DRAG_COMMIT_THRESHOLD`, or back
   * to closed otherwise, then either swaps in the new host (committed —
   * the same finalization `animatePageTurn`'s caller does: re-attach
   * link/keyboard/drag handling, announce, persist progress) or disposes
   * it unused (cancelled). `newHost` is `undefined` if the drag crossed a
   * chapter boundary, in which case there's nothing to animate or commit —
   * this pass doesn't support dragging across a chapter. `token` is
   * this gesture's `turnToken`, checked before committing — see
   * `turnToken`'s doc comment. */
  private async settleDragPageTurn(
    oldHost: PaginatedContentHost,
    newHost: PaginatedContentHost | undefined,
    direction: 1 | -1,
    fraction: number,
    token: number,
  ): Promise<void> {
    if (!newHost) {
      this.isTurningPage = false;
      return;
    }

    const oldEl = oldHost.element;
    const commit = fraction >= ReaderController.DRAG_COMMIT_THRESHOLD;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    if (!reduceMotion) {
      const remainingFraction = commit ? 1 - fraction : fraction;
      const duration = Math.max(80, Math.round(remainingFraction * 260));
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          oldEl.removeEventListener("transitionend", onTransitionEnd);
          resolve();
        };
        const onTransitionEnd = (event: TransitionEvent): void => {
          if (event.target === oldEl && event.propertyName === "transform") {
            finish();
          }
        };
        oldEl.addEventListener("transitionend", onTransitionEnd);
        oldEl.style.transition = `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow ${duration}ms ease`;
        requestAnimationFrame(() => {
          if (commit) {
            this.setPageTurnRotation(oldEl, direction === 1 ? -100 : 100, 1);
          } else {
            this.setPageTurnRotation(oldEl, 0, 0);
          }
        });
        setTimeout(finish, duration + 250);
      });
    }

    if (this.containerEl) {
      this.containerEl.style.perspective = "";
    }

    if (token !== this.turnToken) {
      // A newer turn started and finished while this one's completion
      // animation was still running — discard this stale result instead
      // of clobbering the newer state (see `turnToken`).
      newHost.dispose();
      if (!commit) {
        oldEl.style.position = "";
        oldEl.style.zIndex = "";
        oldEl.style.backfaceVisibility = "";
        oldEl.style.transformOrigin = "";
        oldEl.style.transition = "";
        oldEl.style.transform = "";
        oldEl.style.boxShadow = "";
      }
      this.isTurningPage = false;
      return;
    }

    if (commit) {
      oldHost.dispose();
      const newEl = newHost.element;
      newEl.style.position = "";
      newEl.style.top = "";
      newEl.style.left = "";
      newEl.style.transform = "";
      newEl.style.zIndex = "";

      this.linkClickCleanup?.();
      this.linkClickCleanup = undefined;
      this.dragCleanup?.();
      this.dragCleanup = undefined;
      this.host = newHost;
      this.updateContentTitle();
      this.reattachKeyboardNav();
      this.setUpLinkInterception();
      this.setUpDragPageTurn();
      this.announce(`Page ${newHost.currentPageIndex + 1} of ${newHost.pageCount}`);
      this.notify();
      await this.saveProgress();
    } else {
      oldEl.style.position = "";
      oldEl.style.zIndex = "";
      oldEl.style.backfaceVisibility = "";
      oldEl.style.transformOrigin = "";
      oldEl.style.transition = "";
      oldEl.style.transform = "";
      oldEl.style.boxShadow = "";
      newHost.dispose();
    }
    this.isTurningPage = false;
  }

  /** Loads the adjacent chapter directly (both view modes) — the
   * "previous/next chapter" toolbar actions, as distinct from `turnPage`
   * which only steps by one page within paginated mode. */
  public async goToChapter(direction: 1 | -1): Promise<void> {
    const nextSpineIndex = this.spineIndex + direction;
    if (nextSpineIndex < 0 || nextSpineIndex >= this.pkg.spine.length) {
      return;
    }
    await this.openSpineItem(nextSpineIndex);
  }

  /** A live, side-effect-free preview of where a progress-scrubber drag
   * at `fraction` (0 to 1 across the whole book) would land, for the
   * scrubber to show in its drag popup without actually navigating
   * there on every pointer move — only `seekToFraction` (called once,
   * on release) actually commits it. Prefers an exact, book-wide page
   * number when `bookPagination` has fully measured the book; falls
   * back to a coarser chapter-level preview otherwise (see
   * `seekToFraction`'s doc comment for why). */
  public previewSeek(fraction: number): { label: string; chapterLabel: string } {
    const clamped = Math.max(0, Math.min(1, fraction));
    const totalPages = this.bookPagination?.positionFor(0, 0).totalPages;
    if (totalPages !== undefined && totalPages > 0) {
      const targetGlobalPage = Math.max(1, Math.round(clamped * totalPages));
      const resolved = this.bookPagination?.resolveGlobalPage(targetGlobalPage);
      if (resolved) {
        return {
          label: `Page ${targetGlobalPage} of ${totalPages}`,
          chapterLabel: this.chapterLabel(resolved.spineIndex),
        };
      }
    }
    const { spineIndex: targetSpineIndex } = this.resolveSpineFraction(clamped);
    return {
      label: `Chapter ${targetSpineIndex + 1} of ${this.pkg.spine.length}`,
      chapterLabel: this.chapterLabel(targetSpineIndex),
    };
  }

  /** Jumps to `fraction` (0 to 1) of the way through the whole book —
   * the progress scrubber's "drop" action, once a drag settles.
   * Prefers exact, book-wide page-level seeking when `bookPagination`
   * has fully measured every spine item (via `resolveGlobalPage`,
   * landing on the precise page); falls back to coarser spine-level
   * seeking (landing *partway through* whichever chapter the fraction
   * points at, via `resolveSpineFraction` — not always its very first
   * page, which was a real bug: a chapter spanning many pages made the
   * scrubber feel like it always undershot wherever the reader actually
   * released it) when the book isn't fully measured yet — a very large
   * book's background pagination can take a while, and the scrubber
   * should still be usable in the meantime, just less precisely. */
  public async seekToFraction(fraction: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, fraction));
    const totalPages = this.bookPagination?.positionFor(0, 0).totalPages;
    if (totalPages !== undefined && totalPages > 0) {
      const targetGlobalPage = Math.max(1, Math.round(clamped * totalPages));
      const resolved = this.bookPagination?.resolveGlobalPage(targetGlobalPage);
      if (resolved) {
        await this.openSpineItem(resolved.spineIndex, { landOnPageIndex: resolved.pageIndexInItem });
        return;
      }
    }
    const { spineIndex: targetSpineIndex, localFraction } = this.resolveSpineFraction(clamped);
    await this.openSpineItem(targetSpineIndex, { landOnFractionInItem: localFraction });
  }

  /** Picks a spine item and a 0-to-1 fraction within it for a coarse,
   * spine-level seek — shared by `previewSeek`'s label and
   * `seekToFraction`'s actual navigation when `bookPagination` hasn't
   * fully measured the book yet. Treats the whole book as
   * `spine.length` equal-width slots (a simplifying assumption — real
   * chapters vary widely in length — but the best available one without
   * full measurement, and far better than treating every chapter as a
   * single point): `fraction` selects both which slot it falls in and
   * how far through that slot, so a drag partway through a long
   * chapter's share of the book lands partway through that chapter, not
   * always at its very first page. */
  private resolveSpineFraction(clamped: number): { spineIndex: number; localFraction: number } {
    const spineLength = this.pkg.spine.length;
    if (spineLength <= 0) {
      return { spineIndex: 0, localFraction: 0 };
    }
    const scaled = clamped * spineLength;
    const spineIndex = Math.max(0, Math.min(spineLength - 1, Math.floor(scaled)));
    const localFraction = Math.max(0, Math.min(1, scaled - spineIndex));
    return { spineIndex, localFraction };
  }

  /** Navigates to a Table of Contents entry: loads its target spine item
   * (if not already open) and jumps to its fragment, if any. */
  public async goToNavPoint(navPoint: NavPoint): Promise<void> {
    if (!navPoint.path) {
      return;
    }
    const spineIndex = this.pkg.spine.findIndex((ref) => ref.manifestItem.path === navPoint.path);
    if (spineIndex === -1) {
      return;
    }
    await this.openSpineItem(spineIndex, { fragment: navPoint.fragment });
  }

  private async openSpineItem(
    spineIndex: number,
    options: {
      fragment?: string;
      bridgeCfi?: string;
      landOnLastPage?: boolean;
      landOnPageIndex?: number;
      landOnFractionInItem?: number;
    } = {},
  ): Promise<void> {
    if (!this.containerEl) {
      return;
    }

    this.isLoading = true;
    this.error = undefined;
    this.notify();

    try {
      this.accessibility.detach();
      this.linkClickCleanup?.();
      this.linkClickCleanup = undefined;
      this.host?.dispose();

      const resolvedLayout = this.pkg.spine[spineIndex]?.resolveRenditionLayout(this.pkg.metadata.renditionLayout);
      if (resolvedLayout === "pre-paginated") {
        const fixedHost = new FixedContentHost(this.width, this.height);
        this.containerEl.replaceChildren(fixedHost.element);
        await fixedHost.open(this.contentLoader, this.resolver, spineIndex, this.pkg.metadata.renditionViewport);
        this.host = fixedHost;
      } else if (this.viewMode === "paginated" && SpreadPaginatedHost.isEligible(this.width)) {
        const host = new SpreadPaginatedHost(this.width, this.height);
        this.containerEl.replaceChildren(host.element);
        await host.open(this.contentLoader, this.resolver, spineIndex);
        this.host = host;
        this.applyPersistedDisplaySettingsToFreshHost();
      } else {
        const host =
          this.viewMode === "paginated"
            ? new PaginatedContentHost(this.width, this.height)
            : new ScrollContentHost(this.width, this.height);
        this.containerEl.replaceChildren(host.element);
        await host.open(this.contentLoader, this.resolver, spineIndex);
        this.host = host;
        this.applyPersistedDisplaySettingsToFreshHost();
      }

      this.spineIndex = spineIndex;
      this.appliedWidth = this.width;
      this.appliedHeight = this.height;
      this.setUpLinkInterception();
      this.setUpDragPageTurn();
      this.refreshBookPagination();

      if (options.bridgeCfi) {
        this.restoreCfi(options.bridgeCfi, spineIndex);
        this.setUpAccessibility();
      } else if (options.fragment) {
        const focusTarget = this.goToFragment(options.fragment);
        this.setUpAccessibility(focusTarget);
      } else {
        if (options.landOnLastPage && (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost)) {
          this.host.goToLastPage();
        } else if (options.landOnPageIndex !== undefined && this.host instanceof PaginatedContentHost) {
          // Spread mode has no exact-page-index API of its own (see
          // `SpreadPaginatedHost`) — landing on the chapter's first page
          // there instead is a reasonable, functional fallback rather
          // than a hard requirement for the progress scrubber to work.
          this.host.goToPageIndex(options.landOnPageIndex);
        } else if (options.landOnFractionInItem !== undefined && this.host instanceof PaginatedContentHost) {
          // The coarse, spine-level progress-scrubber fallback (see
          // `resolveSpineFraction`) only knows a 0-to-1 fraction through
          // this chapter, not an exact page index, until *after* the
          // chapter is open and its real page count is known — unlike
          // `landOnPageIndex`, which already has an exact index computed
          // from a fully-measured book. Same spread-mode limitation as
          // `landOnPageIndex` above.
          const targetIndex = Math.round(options.landOnFractionInItem * Math.max(0, this.host.pageCount - 1));
          this.host.goToPageIndex(targetIndex);
        }
        this.setUpAccessibility();
      }
      this.announce(this.chapterLabel(spineIndex));
      await this.saveProgress();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.isLoading = false;
      this.notify();

      if (this.pendingResize) {
        const { width, height } = this.pendingResize;
        this.pendingResize = undefined;
        this.resize(width, height);
      }
    }
  }

  private restoreCfi(cfi: string, spineIndex: number): void {
    const iframeDocument = this.primaryContentDocument();
    if (!iframeDocument) {
      return;
    }
    const resolved = this.locatorResolver.resolveInDocument(new Locator(cfi), spineIndex, iframeDocument);
    const offset = resolved.characterOffset ?? 0;
    if (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost) {
      this.host.goToPosition(resolved.node, offset);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.restorePosition(resolved.node, offset);
    }
  }

  private goToFragment(fragment: string): Element | undefined {
    const iframeDocument = this.primaryContentDocument();
    const target = iframeDocument?.getElementById(fragment);
    if (!target) {
      return undefined;
    }
    if (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost) {
      this.host.goToPosition(target, 0);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.restorePosition(target, 0);
    }
    return target;
  }

  public dispose(): void {
    this.accessibility.detach();
    this.linkClickCleanup?.();
    this.dragCleanup?.();
    this.host?.dispose();
    this.bookPagination?.dispose();
    this.hiddenMeasureContainer?.remove();
    this.resolver.dispose();
    this.library.close();
  }
}
