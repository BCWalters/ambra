import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { RenditionLayout, SpineItemRef } from "../container/PackageDocument.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";
import { ReadingTheme } from "../rendering/ReadingTheme.js";
import type { FontFamilyChoice } from "../rendering/ReadingTheme.js";
import {
  aggregateBookPosition,
  computePriorityOrder,
  resolveGlobalPage,
} from "./BookPagination.js";
import type { BookPosition } from "./BookPagination.js";
import type { DisclosureState } from "./DisclosureState.js";
import type { LocatorResolver } from "../locator/Locator.js";
import { EpubCfi } from "../locator/EpubCfi.js";

interface MeasuredSpineItem {
  pageCount: number;
  pageStarts?: readonly string[];
  fragmentPages?: ReadonlyMap<string, number>;
}

export type { BookPosition } from "./BookPagination.js";

/** Hands control back to the browser's event loop for one macrotask —
 * see the call site in `run` for why this matters between spine items. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Computes book-wide page numbers by background-paginating every
 * reflowable spine item at whatever single-column width the reader is
 * actually displaying — used when the book has no EPUB page-list nav
 * annotations to prefer instead (see `ReaderController`'s "book-wide
 * page numbers" preference). This is real, layout-dependent pagination
 * work (`PaginatedContentHost.pageCount` after a real `open()`), so it
 * always runs against a hidden-but-attached iframe: detached elements
 * never lay out in a real browser, but a visible one would flash
 * unrelated content into view, so the caller-supplied `hiddenContainer`
 * must be attached to the document while positioned/sized off-screen
 * (see `ReaderController`'s usage).
 *
 * Measures one spine item at a time, in `computePriorityOrder`'s
 * order (current item first, then forward, then backward) — never in
 * parallel, so a book with hundreds of chapters doesn't spawn hundreds
 * of concurrent iframes at once. `run` can be called again (e.g. after
 * a resize or font-size change changes the effective page width) and
 * cleanly cancels/discards any still-in-flight previous run via a
 * generation token, the same pattern `ReaderController.turnToken` uses
 * for the same reason.
 *
 * Fixed-layout spine items are never measured this way — a fixed-layout
 * page has no reflow/pagination concept of its own, so each one simply
 * counts as exactly one page. Non-linear spine items are, for now,
 * counted the same as any other spine item; excluding them from the
 * book-wide count is a reasonable future refinement, not implemented
 * here.
 */
export class BookPaginationEstimator {
  private pageCounts: (number | undefined)[];
  private pageStarts: (readonly string[] | undefined)[];
  private fragmentPages: (ReadonlyMap<string, number> | undefined)[];
  private generation = 0;
  private activeRun: AbortController | undefined;
  private lastWidth: number | undefined;
  private lastHeight: number | undefined;
  private lastFontScale: number | undefined;
  private lastFontFamily: FontFamilyChoice | undefined;
  private lastLineSpacing: number | undefined;
  private lastLetterSpacing: number | undefined;
  private lastContentWidthEm: number | undefined;

  public constructor(
    private readonly contentLoader: ContentLoader,
    private readonly resolver: ResourceUrlResolver,
    private readonly spine: readonly SpineItemRef[],
    private readonly packageDefaultLayout: RenditionLayout,
    private readonly hiddenContainer: HTMLElement,
    private readonly disclosures?: DisclosureState,
    private readonly locatorResolver?: LocatorResolver,
    private readonly fragments: ReadonlyMap<number, readonly string[]> = new Map(),
  ) {
    this.pageCounts = this.initialPageCounts();
    this.pageStarts = new Array(spine.length).fill(undefined);
    this.fragmentPages = new Array(spine.length).fill(undefined);
  }

  private initialPageCounts(): (number | undefined)[] {
    return this.spine.map(item =>
      item.resolveRenditionLayout(this.packageDefaultLayout) === "pre-paginated" ? 1 : undefined,
    );
  }

  /** (Re-)starts measuring spine items' page counts at `width`/`height`
   * and the reader's current `fontScale`/`fontFamily`/`lineSpacing`/
   * `letterSpacing`/`contentWidthEm` (all affect how much text fits per
   * page, exactly like a width/height change would), prioritized around
   * `currentSpineIndex`, invoking `onProgress` after every individual
   * item finishes (so the UI can show a book-wide page number as soon as
   * it's known, well before the whole book finishes measuring) — the
   * caller combines the latest counts with whatever position within the
   * current item it cares about via `positionFor`, since this class has
   * no opinion on that.
   *
   * Previously-measured counts are kept (not re-measured) when none of
   * `width`/`height`/`fontScale`/`fontFamily`/`lineSpacing`/
   * `letterSpacing`/`contentWidthEm` have changed since the last `run` —
   * plain chapter navigation calls this too, just to reprioritize around
   * the new current spine item, and would otherwise wastefully
   * re-measure the entire book on every chapter turn. A real change to
   * any of those seven invalidates every existing count, since they were
   * all measured against a now-stale layout.
   *
   * Any previous run is cancelled, its hidden host disposed immediately,
   * and its incremental measurement stops at the next work checkpoint. */
  public async run(
    currentSpineIndex: number,
    width: number,
    height: number,
    fontScale: number,
    fontFamily: FontFamilyChoice,
    lineSpacing: number,
    letterSpacing: number,
    contentWidthEm: number,
    onProgress: () => void,
  ): Promise<void> {
    this.activeRun?.abort();
    const controller = new AbortController();
    this.activeRun = controller;
    const { signal } = controller;
    const token = ++this.generation;
    if (
      width !== this.lastWidth ||
      height !== this.lastHeight ||
      fontScale !== this.lastFontScale ||
      fontFamily !== this.lastFontFamily ||
      lineSpacing !== this.lastLineSpacing ||
      letterSpacing !== this.lastLetterSpacing ||
      contentWidthEm !== this.lastContentWidthEm
    ) {
      this.pageCounts = this.initialPageCounts();
      this.pageStarts = new Array(this.spine.length).fill(undefined);
      this.fragmentPages = new Array(this.spine.length).fill(undefined);
      this.lastWidth = width;
      this.lastHeight = height;
      this.lastFontScale = fontScale;
      this.lastFontFamily = fontFamily;
      this.lastLineSpacing = lineSpacing;
      this.lastLetterSpacing = letterSpacing;
      this.lastContentWidthEm = contentWidthEm;
    }

    const order = computePriorityOrder(currentSpineIndex, this.spine.length);
    for (const spineIndex of order) {
      if (this.pageCounts[spineIndex] !== undefined) {
        // Already measured at this width/height/font — nothing to do.
        continue;
      }
      const spineItem = this.spine[spineIndex];
      if (!spineItem) {
        continue;
      }
      // Yield before chapter loading as well as at the incremental measurement
      // checkpoints, and stop superseded runs before allocating another host.
      await yieldToEventLoop();
      if (signal.aborted || token !== this.generation) return;
      let measured: MeasuredSpineItem;
      try {
        measured = await this.measureSpineItem(
          spineItem,
          spineIndex,
          width,
          height,
          fontScale,
          fontFamily,
          lineSpacing,
          letterSpacing,
          contentWidthEm,
          signal,
        );
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
      if (token !== this.generation) {
        // A newer `run` call has since started — this one's remaining
        // work is stale and should stop reporting (and stop consuming
        // resources measuring further items nobody wants anymore).
        return;
      }
      this.pageCounts[spineIndex] = measured.pageCount;
      this.pageStarts[spineIndex] = measured.pageStarts;
      this.fragmentPages[spineIndex] = measured.fragmentPages;
      onProgress();
    }
  }

  private async measureSpineItem(
    spineItem: SpineItemRef,
    spineIndex: number,
    width: number,
    height: number,
    fontScale: number,
    fontFamily: FontFamilyChoice,
    lineSpacing: number,
    letterSpacing: number,
    contentWidthEm: number,
    signal: AbortSignal,
  ): Promise<MeasuredSpineItem> {
    signal.throwIfAborted();
    if (spineItem.resolveRenditionLayout(this.packageDefaultLayout) === "pre-paginated") {
      // Fixed-layout content is never reflowed/paginated — it's always
      // exactly one page.
      return { pageCount: 1 };
    }

    const host = new PaginatedContentHost(
      width,
      height,
      this.hiddenContainer.ownerDocument ?? undefined,
    );
    this.hiddenContainer.appendChild(host.element);
    const disposeHost = (): void => {
      host.dispose();
      host.element.remove();
    };
    signal.addEventListener("abort", disposeHost, { once: true });
    try {
      await host.open(
        this.contentLoader, this.resolver, spineIndex, this.disclosures,
        (doc) => {
          ReadingTheme.applyFontScale(doc, fontScale);
          ReadingTheme.applyFontFamily(doc, fontFamily);
          ReadingTheme.applyLineSpacing(doc, lineSpacing);
          ReadingTheme.applyLetterSpacing(doc, letterSpacing);
          ReadingTheme.applyContentWidth(doc, contentWidthEm);
        },
        { signal },
      );
      signal.throwIfAborted();
      // Retain only CFIs, never the measured document or its DOM ranges.
      const locatorResolver = this.locatorResolver;
      const pageStarts: string[] | undefined = locatorResolver ? [] : undefined;
      if (locatorResolver && pageStarts) {
        let deadline = performance.now() + 8;
        for (let index = 0; index < host.pageCount; index++) {
          signal.throwIfAborted();
          const start = host.pageStartPosition(index);
          if (!start) throw new Error(`Missing page ${index} in spine item ${spineIndex}.`);
          pageStarts.push(locatorResolver.generateBoundary(spineIndex, start.node, start.offset).cfi);
          if (performance.now() >= deadline) {
            await yieldToEventLoop();
            signal.throwIfAborted();
            deadline = performance.now() + 8;
          }
        }
      }
      const fragmentPages = new Map<string, number>();
      for (const fragment of this.fragments.get(spineIndex) ?? []) {
        const target = host.element.contentDocument?.getElementById(fragment);
        const page = target ? host.pageIndexForPosition(target, 0) : undefined;
        if (page !== undefined) fragmentPages.set(fragment, page);
      }
      return { pageCount: host.pageCount, pageStarts, fragmentPages };
    } finally {
      signal.removeEventListener("abort", disposeHost);
      disposeHost();
    }
  }

  /** The current `BookPosition` for `(currentSpineIndex, pageIndexInItem)`
   * given whatever measurements have completed so far — see
   * `aggregateBookPosition` for exactly when each field becomes defined. */
  public positionFor(currentSpineIndex: number, pageIndexInItem: number): BookPosition {
    return aggregateBookPosition(this.pageCounts, currentSpineIndex, pageIndexInItem);
  }

  /** A measured page's portable start, also usable when the destination opens in scroll mode. */
  public pageStartCfi(spineIndex: number, pageIndex: number): string | undefined {
    return this.pageStarts[spineIndex]?.[pageIndex];
  }

  /** Unknown/missing anchors stay unknown rather than masquerading as the chapter's first page. */
  public pageIndexForFragment(spineIndex: number, fragment: string): number | undefined {
    if (this.spine[spineIndex]?.resolveRenditionLayout(this.packageDefaultLayout) === "pre-paginated") {
      return 0;
    }
    return this.fragmentPages[spineIndex]?.get(fragment);
  }

  /** Resolves a saved position without reloading a chapter or retaining its DOM. */
  public pageIndexForCfi(spineIndex: number, cfi: string): number | undefined {
    if (this.pageCounts[spineIndex] === 1 &&
      this.spine[spineIndex]?.resolveRenditionLayout(this.packageDefaultLayout) === "pre-paginated") {
      return 0;
    }
    const starts = this.pageStarts[spineIndex];
    if (!starts?.length) return undefined;
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (EpubCfi.compare(starts[middle]!, cfi) <= 0) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }

  /** The inverse of `positionFor`: given a target book-wide page number
   * (1-based), finds which spine item and local page index it falls
   * within — see `resolveGlobalPage`. Used by the reader's progress
   * scrubber to turn "the reader dragged to N% through the book" into
   * an actual navigable position. `undefined` if the book isn't fully
   * measured yet (a caller should fall back to coarser, spine-level
   * seeking in that case). */
  public resolveGlobalPage(
    globalPageOneBased: number,
  ): { spineIndex: number; pageIndexInItem: number } | undefined {
    return resolveGlobalPage(this.pageCounts, globalPageOneBased);
  }

  /** A native disclosure changes one chapter's measured layout, not its neighbors. */
  public invalidateSpineItem(spineIndex: number): void {
    this.cancelPendingMeasurement();
    this.pageCounts[spineIndex] =
      this.spine[spineIndex]?.resolveRenditionLayout(this.packageDefaultLayout) === "pre-paginated" ? 1 : undefined;
    this.pageStarts[spineIndex] = undefined;
    this.fragmentPages[spineIndex] = undefined;
  }

  /** Pauses pending work and releases its hidden host immediately, preserving
   * completed counts/CFIs and their layout key. Resume with `run`; unchanged
   * chapters are skipped. Intended for foreground work that needs exclusive
   * main-thread time, not every cheap in-place page turn. */
  public cancelPendingMeasurement(): void {
    this.activeRun?.abort();
    this.activeRun = undefined;
    this.generation++;
  }

  /** Stops background work and releases its hidden host immediately. */
  public dispose(): void {
    this.cancelPendingMeasurement();
  }
}
