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
  private generation = 0;
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
  ) {
    this.pageCounts = new Array(spine.length).fill(undefined);
    this.pageStarts = new Array(spine.length).fill(undefined);
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
   * Any previously in-flight `run` is cancelled — its own remaining
   * measurements finish (an in-progress `PaginatedContentHost.open()`
   * can't be aborted mid-flight) but are discarded rather than
   * reported, since a newer call means something more current is now
   * wanted instead. */
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
      this.pageCounts = new Array(this.spine.length).fill(undefined);
      this.pageStarts = new Array(this.spine.length).fill(undefined);
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
      // Yields one real macrotask to the event loop *before* each spine
      // item's own measurement, not just relying on `measureSpineItem`'s
      // internal `await`s — those only yield at genuine async I/O
      // boundaries (loading the content document), not around the
      // synchronous pagination work itself, so a run of several large
      // chapters back to back (a real, confirmed problem on a MathML-
      // dense textbook, issue #102) could still starve pending user
      // input (a page turn, a click) for one item's whole measurement
      // time before this loop's own `await` ever got a chance to hand
      // control back. A zero-delay `setTimeout` is enough to let the
      // browser process anything already queued (input, rendering)
      // ahead of the next item — this is a background estimate a reader
      // never directly waits on, so pacing it more considerately costs
      // nothing but wall-clock time to finish scanning the whole book.
      await yieldToEventLoop();
      const measured = await this.measureSpineItem(
        spineItem,
        spineIndex,
        width,
        height,
        fontScale,
        fontFamily,
        lineSpacing,
        letterSpacing,
        contentWidthEm,
      );
      if (token !== this.generation) {
        // A newer `run` call has since started — this one's remaining
        // work is stale and should stop reporting (and stop consuming
        // resources measuring further items nobody wants anymore).
        return;
      }
      this.pageCounts[spineIndex] = measured.pageCount;
      this.pageStarts[spineIndex] = measured.pageStarts;
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
  ): Promise<MeasuredSpineItem> {
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
    try {
      await host.open(this.contentLoader, this.resolver, spineIndex, this.disclosures);
      const needsNonDefaultSettings =
        fontScale !== 1 ||
        fontFamily !== ReadingTheme.DEFAULT_FONT_FAMILY ||
        lineSpacing !== ReadingTheme.DEFAULT_LINE_SPACING ||
        letterSpacing !== ReadingTheme.DEFAULT_LETTER_SPACING ||
        contentWidthEm !== ReadingTheme.DEFAULT_CONTENT_WIDTH_EM;
      if (needsNonDefaultSettings) {
        const doc = host.element.contentDocument;
        if (doc) {
          ReadingTheme.applyFontScale(doc, fontScale);
          ReadingTheme.applyFontFamily(doc, fontFamily);
          ReadingTheme.applyLineSpacing(doc, lineSpacing);
          ReadingTheme.applyLetterSpacing(doc, letterSpacing);
          ReadingTheme.applyContentWidth(doc, contentWidthEm);
          host.relayout(width, height);
        }
      }
      // Retain only CFIs, never the measured document or its DOM ranges.
      const locatorResolver = this.locatorResolver;
      const pageStarts = locatorResolver
        ? Array.from({ length: host.pageCount }, (_, index) => {
            const start = host.pageStartPosition(index);
            if (!start) throw new Error(`Missing page ${index} in spine item ${spineIndex}.`);
            return locatorResolver.generate(spineIndex, start.node, start.offset).cfi;
          })
        : undefined;
      return { pageCount: host.pageCount, pageStarts };
    } finally {
      host.dispose();
      host.element.remove();
    }
  }

  /** The current `BookPosition` for `(currentSpineIndex, pageIndexInItem)`
   * given whatever measurements have completed so far — see
   * `aggregateBookPosition` for exactly when each field becomes defined. */
  public positionFor(currentSpineIndex: number, pageIndexInItem: number): BookPosition {
    return aggregateBookPosition(this.pageCounts, currentSpineIndex, pageIndexInItem);
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
    this.generation++;
    this.pageCounts[spineIndex] = undefined;
    this.pageStarts[spineIndex] = undefined;
  }

  /** Invalidates any in-flight `run` (its remaining work will finish but
   * won't report through `onProgress`) — call when the controller itself
   * is being torn down. */
  public dispose(): void {
    this.generation++;
  }
}
