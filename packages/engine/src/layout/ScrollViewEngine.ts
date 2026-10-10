import type { Chunk } from "./LineMeasurement.js";
import { measureChunks } from "./LineMeasurement.js";
import type { DomBreakPoint } from "./Page.js";
import { findChunkAtScrollOffset, findChunkForPosition } from "./ScrollPositionTracker.js";
import { measureVerticalScrollChunks } from "./VerticalScrollMeasurement.js";

/**
 * Continuous-scroll presentation of reflowable content: shares the exact
 * same linear DOM with horizontal line or native vertical-column
 * measurement, but instead of
 * clipping and transforming that measurement into discrete pages, it lets
 * the content document scroll natively and derives "current position"
 * from scroll offset (see `ScrollPositionTracker.ts` for the pure lookup
 * logic this wraps).
 *
 * Unlike pagination mode, which explicitly disables the content host
 * iframe's own scrolling (`overflow: hidden`) in favor of custom paging,
 * scroll mode deliberately does *not* touch overflow at all: a normal
 * iframe already scrolls natively once its content exceeds its box size,
 * so there's nothing extra to wire up beyond position tracking.
 */
export class ScrollViewEngine {
  private constructor(
    private readonly chunks: readonly Chunk[],
    private readonly scrollingElement: Element,
    private readonly writingMode: string,
  ) {}

  /**
   * Measures `bodyElement` — the same real-layout-dependent measurement
   * `PaginationEngine.paginate` uses — and prepares position tracking
   * against its owner document's native scroll container.
   *
   * Must be called once, before the reader has scrolled: the measured
   * chunk positions are document-relative coordinates (as produced by
   * `getBoundingClientRect`/`getClientRects` while unscrolled), and they
   * only line up with the native `scrollTop` values this class reads and
   * writes if that baseline holds.
   */
  public static prepare(bodyElement: Element): ScrollViewEngine {
    const ownerDocument = bodyElement.ownerDocument;
    const scrollingElement = ownerDocument.scrollingElement ?? ownerDocument.documentElement;
    const writingMode = ownerDocument.defaultView!.getComputedStyle(bodyElement).writingMode;
    const chunks = writingMode === "vertical-rl" || writingMode === "vertical-lr"
      ? measureVerticalScrollChunks(bodyElement, writingMode === "vertical-rl")
      : measureChunks(bodyElement);
    return new ScrollViewEngine(chunks, scrollingElement, writingMode);
  }

  /** The measured chunks this instance was prepared with — exposed so a
   * caller can, e.g., recompute a `Locator` via `LocatorResolver` from
   * `currentPosition()`, or diagnose/test position tracking directly. */
  public get measuredChunks(): readonly Chunk[] {
    return this.chunks;
  }

  private get scrollOffset(): number {
    return this.writingMode === "vertical-rl" ? -this.scrollingElement.scrollLeft
      : this.writingMode === "vertical-lr" ? this.scrollingElement.scrollLeft : this.scrollingElement.scrollTop;
  }

  public get isAtStart(): boolean {
    return this.scrollOffset <= (this.writingMode === "vertical-rl" || this.writingMode === "vertical-lr" ? 1 : 0);
  }

  public get isAtEnd(): boolean {
    return this.writingMode === "vertical-rl" || this.writingMode === "vertical-lr"
      ? this.scrollOffset + this.scrollingElement.clientWidth >= this.scrollingElement.scrollWidth - 1
      : this.scrollOffset + this.scrollingElement.clientHeight >= this.scrollingElement.scrollHeight - 1;
  }

  /** The DOM position currently at (or straddling) the top edge of the
   * viewport (leading column in vertical writing) — the position to resolve into a `Locator`/CFI and persist
   * as this view's current reading position. `undefined` only if there's
   * no content to track a position within. */
  public currentPosition(): DomBreakPoint | undefined {
    return findChunkAtScrollOffset(this.chunks, this.scrollOffset)?.breakBefore;
  }

  /** Scrolls so that `(node, offset)` — typically a DOM position resolved
   * from a previously-saved `Locator`/CFI — sits at the top of the
   * viewport. A no-op if there's no content to scroll to. */
  public restorePosition(node: Node, offset: number): void {
    const chunk = findChunkForPosition(this.chunks, node, offset);
    if (chunk) {
      if (this.writingMode === "vertical-rl") this.scrollingElement.scrollLeft = -chunk.top;
      else if (this.writingMode === "vertical-lr") this.scrollingElement.scrollLeft = chunk.top;
      else this.scrollingElement.scrollTop = chunk.top;
    }
  }
}
