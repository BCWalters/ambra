import {
  AccessibilityController,
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
import type { NavPoint, PackageDocument } from "@pagina/engine";
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
  /** `true` when the current spine item is showing as a two-page spread
   * (see `SpreadPaginatedHost`) — the reader pane is wide enough and the
   * item is reflowable and in paginated mode. The shell shows "Pages
   * X–Y of Z" instead of "Page X of Y" when this is set. */
  isSpread: boolean;
  /** The companion page index shown alongside `pageIndex` in spread mode
   * — `undefined` outside spread mode, or if there's no companion page
   * (the chapter's last page has no facing page). */
  secondPageIndex: number | undefined;
  /** The current reader-controlled font-size multiplier (see
   * `ReadingTheme`) — `1` is the theme's own default size. Always `1` for
   * a fixed-layout spine item, which has no reader-adjustable typography. */
  fontScale: number;
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
  private readonly accessibility = new AccessibilityController();
  private announcement: string | undefined;
  private announcementId = 0;
  /** Detaches the current spine item's in-content link click listener —
   * see `setUpLinkInterception`. Re-created on every `openSpineItem` call
   * since each one gets a fresh iframe/document. */
  private linkClickCleanup: (() => void) | undefined;

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

      this.cachedSnapshot = {
        title: this.pkg.metadata.title,
        toc: this.navigation.toc.items,
        spineIndex: this.spineIndex,
        spineLength: this.pkg.spine.length,
        viewMode: this.viewMode,
        isFixedLayout: this.host instanceof FixedContentHost,
        pageIndex,
        pageCount,
        isSpread: this.host instanceof SpreadPaginatedHost,
        secondPageIndex: this.host instanceof SpreadPaginatedHost ? this.host.secondPageIndex : undefined,
        fontScale: this.host instanceof FixedContentHost ? 1 : this.fontScale,
        isLoading: this.isLoading,
        error: this.error,
        announcement: this.announcement,
        announcementId: this.announcementId,
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

  /** Sets the text the shell's `aria-live` region should announce next,
   * and bumps `announcementId` so a repeat of the same text still
   * triggers a fresh announcement (an `aria-live` region only reacts to
   * a DOM text *change*). */
  private announce(text: string): void {
    this.announcement = text;
    this.announcementId++;
  }

  /** A human-readable label for `spineIndex` — the matching Table of
   * Contents entry's label, if the current navigation has one pointing at
   * that spine item's path, falling back to "Chapter N" otherwise. Used
   * for live-region chapter-change announcements (e.g. "Rowing to a
   * generic 'Chapter 3'" is far less useful to a screen reader user than
   * the book's own chapter title, when it's available). */
  private chapterLabel(spineIndex: number): string {
    const path = this.pkg.spine[spineIndex]?.manifestItem.path;
    const match = path !== undefined ? ReaderController.findNavPointByPath(this.navigation.toc.items, path) : undefined;
    return match?.label ?? `Chapter ${spineIndex + 1}`;
  }

  private static findNavPointByPath(items: readonly NavPoint[], path: string): NavPoint | undefined {
    for (const item of items) {
      if (item.path === path) {
        return item;
      }
      const found = ReaderController.findNavPointByPath(item.children, path);
      if (found) {
        return found;
      }
    }
    return undefined;
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

  /** (Re-)attaches keyboard navigation to the current content host's
   * iframe document and moves focus into it — called every time a new
   * spine item is opened, since each one gets a fresh iframe/document.
   * "Next"/"previous" mean "turn a page" in paginated mode (there's no
   * page concept in scroll/fixed-layout mode, so they mean "go to the
   * next/previous chapter" there instead). */
  private setUpAccessibility(focusTarget?: Element): void {
    const title = `${this.pkg.metadata.title} — ${this.chapterLabel(this.spineIndex)}`;
    if (this.host instanceof SpreadPaginatedHost) {
      this.host.setTitle(title);
    } else if (this.host) {
      this.host.element.title = title;
    }

    const iframeDocument = this.primaryContentDocument();
    if (!iframeDocument) {
      return;
    }

    const isPaginated = this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost;
    this.accessibility.attach(iframeDocument, {
      onNext: () => void (isPaginated ? this.turnPage(1) : this.goToChapter(1)),
      onPrevious: () => void (isPaginated ? this.turnPage(-1) : this.goToChapter(-1)),
    });
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
    this.applyFontScaleToHost();
    this.notify();
    await this.saveProgress();
  }

  /** Writes `this.fontScale` onto every current content document as a CSS
   * custom property (see `ReadingTheme.applyFontScale`) and re-measures
   * at the current size — every spine item load applies the persisted
   * scale the same way (see `openSpineItem`), so a book opened
   * mid-session at a non-default scale looks correct immediately, not
   * just after the first explicit font-size change. No-op for
   * fixed-layout content, which never gets the reading theme at all. In
   * spread mode, both columns are independent documents and need the
   * property set individually before the shared relayout re-measures
   * them together. */
  private applyFontScaleToHost(): void {
    if (this.host instanceof FixedContentHost) {
      return;
    }
    const documents = this.allContentDocuments();
    if (documents.length === 0) {
      return;
    }
    for (const doc of documents) {
      ReadingTheme.applyFontScale(doc, this.fontScale);
    }
    if (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost) {
      this.host.relayout(this.width, this.height);
    } else if (this.host instanceof ScrollContentHost) {
      this.host.resize(this.width, this.height);
    }
  }

  /** Turns one page (or one spread, in spread mode) in paginated mode. In
   * scroll mode, this is a no-op — scrolling is continuous and has no
   * discrete "page" concept; use native scrolling within the content host
   * instead. Crossing the first/last page of the current spine item
   * advances to the adjacent chapter automatically. */
  public async turnPage(direction: 1 | -1): Promise<void> {
    let moved: boolean;
    let announcement: string;
    if (this.host instanceof SpreadPaginatedHost) {
      moved = direction === 1 ? this.host.nextSpread() : this.host.previousSpread();
      const second = this.host.secondPageIndex;
      announcement = second !== undefined
        ? `Pages ${this.host.pageIndex + 1}–${second + 1} of ${this.host.pageCount}`
        : `Page ${this.host.pageIndex + 1} of ${this.host.pageCount}`;
    } else if (this.host instanceof PaginatedContentHost) {
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
        if (this.fontScale !== 1) {
          this.applyFontScaleToHost();
        }
      } else {
        const host =
          this.viewMode === "paginated"
            ? new PaginatedContentHost(this.width, this.height)
            : new ScrollContentHost(this.width, this.height);
        this.containerEl.replaceChildren(host.element);
        await host.open(this.contentLoader, this.resolver, spineIndex);
        this.host = host;
        if (this.fontScale !== 1) {
          this.applyFontScaleToHost();
        }
      }

      this.spineIndex = spineIndex;
      this.appliedWidth = this.width;
      this.appliedHeight = this.height;
      this.setUpLinkInterception();

      if (options.bridgeCfi) {
        this.restoreCfi(options.bridgeCfi, spineIndex);
        this.setUpAccessibility();
      } else if (options.fragment) {
        const focusTarget = this.goToFragment(options.fragment);
        this.setUpAccessibility(focusTarget);
      } else {
        if (options.landOnLastPage && (this.host instanceof PaginatedContentHost || this.host instanceof SpreadPaginatedHost)) {
          this.host.goToLastPage();
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
    this.host?.dispose();
    this.resolver.dispose();
    this.library.close();
  }
}
