import {
  ContentLoader,
  EpubCfi,
  EpubContainer,
  Locator,
  LocatorResolver,
  NavigationDocument,
  PaginatedContentHost,
  ResourceUrlResolver,
  ScrollContentHost,
} from "@pagina/engine";
import type { NavPoint, PackageDocument } from "@pagina/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";

export type ViewMode = "paginated" | "scroll";

/** A plain-data snapshot of `ReaderController`'s current state, the shape
 * React components actually read (via `useReaderController`) — they never
 * touch the controller's engine objects directly. */
export interface ReaderSnapshot {
  title: string;
  toc: readonly NavPoint[];
  spineIndex: number;
  spineLength: number;
  viewMode: ViewMode;
  pageIndex: number;
  pageCount: number;
  isLoading: boolean;
  error: string | undefined;
}

/**
 * Owns one reading session's state — which book, spine item, and view
 * mode are active — and orchestrates the engine on the React reader UI's
 * behalf: opening/switching spine items, turning pages, switching between
 * paginated and scroll mode (bridging position across the switch via a
 * CFI, since the two modes render into separate content hosts/documents),
 * relaying window resizes into the active host, and persisting/restoring
 * reading position (see `resume-reading`) via the same CFI-bridging
 * mechanism — resuming a book is conceptually identical to switching view
 * modes: resolve a saved CFI in whichever content host is now active.
 * React never touches `PaginatedContentHost`/`ScrollContentHost`/
 * `LocatorResolver` etc. directly — it reads `snapshot()` and calls
 * methods here, then is notified (`subscribe`) to re-render.
 */
export class ReaderController {
  private host: PaginatedContentHost | ScrollContentHost | undefined;
  private viewMode: ViewMode = "paginated";
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
  /** A resize that arrived while an `openSpineItem` was already in
   * flight (e.g. `ResizeObserver`'s spec-mandated initial callback racing
   * with `mount`'s async load) — applying it immediately would relayout
   * a host that's mid-open, against stale or not-yet-loaded content.
   * Recorded here and applied once the in-flight open settles instead. */
  private pendingResize: { width: number; height: number } | undefined;
  private error: string | undefined;
  private containerEl: HTMLDivElement | undefined;

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

    return new ReaderController(contentLoader, resolver, locatorResolver, pkg, navigation, bookId, library);
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public snapshot(): ReaderSnapshot {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        title: this.pkg.metadata.title,
        toc: this.navigation.toc.items,
        spineIndex: this.spineIndex,
        spineLength: this.pkg.spine.length,
        viewMode: this.viewMode,
        pageIndex: this.host instanceof PaginatedContentHost ? this.host.currentPageIndex : 0,
        pageCount: this.host instanceof PaginatedContentHost ? this.host.pageCount : 0,
        isLoading: this.isLoading,
        error: this.error,
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

  /** Mounts the current view mode's content host into `containerEl` and
   * opens either a previously-saved reading position for this book (see
   * `saveProgress`) or spine item 0 if there is none. Call once, after
   * the container div is available. */
  public async mount(containerEl: HTMLDivElement, width: number, height: number): Promise<void> {
    this.containerEl = containerEl;
    this.width = width;
    this.height = height;

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

  /** Relays a resize (e.g. the reader pane changing size, or the user
   * changing font size in a future settings panel) into the active
   * content host, which preserves reading position across the relayout —
   * see `PaginatedContentHost.relayout`/`ScrollContentHost.resize`. A
   * no-op if the size hasn't actually changed (e.g. a deferred resize —
   * see `pendingResize` — turns out to match what was already used),
   * avoiding pointless re-pagination that could otherwise introduce its
   * own drift in the restored position. */
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
    this.appliedWidth = width;
    this.appliedHeight = height;

    if (this.host instanceof PaginatedContentHost) {
      this.host.relayout(width, height);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.resize(width, height);
    }
    this.notify();
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
    await this.openSpineItem(this.spineIndex, { bridgeCfi });
  }

  /** Turns one page in paginated mode. In scroll mode, this is a no-op —
   * scrolling is continuous and has no discrete "page" concept; use
   * native scrolling within the content host instead. Crossing the first/
   * last page of the current spine item advances to the adjacent chapter
   * automatically. */
  public async turnPage(direction: 1 | -1): Promise<void> {
    if (!(this.host instanceof PaginatedContentHost)) {
      return;
    }

    const moved = direction === 1 ? this.host.nextPage() : this.host.previousPage();
    if (moved) {
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
    options: { fragment?: string; bridgeCfi?: string; landOnLastPage?: boolean } = {},
  ): Promise<void> {
    if (!this.containerEl) {
      return;
    }

    this.isLoading = true;
    this.error = undefined;
    this.notify();

    try {
      this.host?.dispose();
      this.host =
        this.viewMode === "paginated"
          ? new PaginatedContentHost(this.width, this.height)
          : new ScrollContentHost(this.width, this.height);
      this.containerEl.replaceChildren(this.host.element);

      await this.host.open(this.contentLoader, this.resolver, spineIndex);
      this.spineIndex = spineIndex;
      this.appliedWidth = this.width;
      this.appliedHeight = this.height;

      if (options.bridgeCfi) {
        this.restoreCfi(options.bridgeCfi, spineIndex);
      } else if (options.fragment) {
        this.goToFragment(options.fragment);
      } else if (options.landOnLastPage && this.host instanceof PaginatedContentHost) {
        this.host.goToLastPage();
      }
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
    const iframeDocument = this.host?.element.contentDocument;
    if (!iframeDocument) {
      return;
    }
    const resolved = this.locatorResolver.resolveInDocument(new Locator(cfi), spineIndex, iframeDocument);
    const offset = resolved.characterOffset ?? 0;
    if (this.host instanceof PaginatedContentHost) {
      this.host.goToPosition(resolved.node, offset);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.restorePosition(resolved.node, offset);
    }
  }

  private goToFragment(fragment: string): void {
    const iframeDocument = this.host?.element.contentDocument;
    const target = iframeDocument?.getElementById(fragment);
    if (!target) {
      return;
    }
    if (this.host instanceof PaginatedContentHost) {
      this.host.goToPosition(target, 0);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.restorePosition(target, 0);
    }
  }

  public dispose(): void {
    this.host?.dispose();
    this.resolver.dispose();
    this.library.close();
  }
}
