import {
  ContentLoader,
  EpubContainer,
  Locator,
  LocatorResolver,
  NavigationDocument,
  PaginatedContentHost,
  ResourceUrlResolver,
  ScrollContentHost,
} from "@pagina/engine";
import type { NavPoint, PackageDocument } from "@pagina/engine";

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
 * and relaying window resizes into the active host. React never touches
 * `PaginatedContentHost`/`ScrollContentHost`/`LocatorResolver` etc.
 * directly — it reads `snapshot()` and calls methods here, then is
 * notified (`subscribe`) to re-render.
 */
export class ReaderController {
  private host: PaginatedContentHost | ScrollContentHost | undefined;
  private viewMode: ViewMode = "paginated";
  private spineIndex = 0;
  private width = 0;
  private height = 0;
  private isLoading = false;
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
  ) {}

  public static async open(file: File): Promise<ReaderController> {
    const buffer = await file.arrayBuffer();
    const container = await EpubContainer.open(buffer);
    const contentLoader = await ContentLoader.create(container);
    const resolver = new ResourceUrlResolver(contentLoader);
    const pkg = contentLoader.packageDocument;
    const navigation = await NavigationDocument.load(container);
    const locatorResolver = new LocatorResolver(pkg, contentLoader);

    return new ReaderController(contentLoader, resolver, locatorResolver, pkg, navigation);
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
   * opens spine item 0. Call once, after the container div is available. */
  public async mount(containerEl: HTMLDivElement, width: number, height: number): Promise<void> {
    this.containerEl = containerEl;
    this.width = width;
    this.height = height;
    await this.openSpineItem(0);
  }

  /** Relays a resize (e.g. the reader pane changing size, or the user
   * changing font size in a future settings panel) into the active
   * content host, which preserves reading position across the relayout —
   * see `PaginatedContentHost.relayout`/`ScrollContentHost.resize`. */
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
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

      if (options.bridgeCfi) {
        this.restoreCfi(options.bridgeCfi, spineIndex);
      } else if (options.fragment) {
        this.goToFragment(options.fragment);
      } else if (options.landOnLastPage && this.host instanceof PaginatedContentHost) {
        this.host.goToLastPage();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.isLoading = false;
      this.notify();
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
  }
}
