/** A DOM boundary position: a node plus a child/character offset within
 * it, used to mark where a page begins or ends. */
export interface DomBreakPoint {
  readonly node: Node;
  readonly offset?: number;
}

export interface DomPositionRange {
  readonly start: DomBreakPoint;
  readonly end: DomBreakPoint;
}

/** Within a CSS-reordered figure, visual membership supersedes DOM order. */
export interface PositionOverride {
  readonly scope: DomPositionRange;
  readonly ranges: readonly DomPositionRange[];
}

export function containsDomPosition(
  bounds: DomPositionRange, node: Node, offset: number, ownerDocument: Document,
): boolean {
  const range = ownerDocument.createRange();
  try {
    range.setStart(bounds.start.node, bounds.start.offset ?? 0);
    range.setEnd(bounds.end.node, bounds.end.offset ?? 0);
    return range.comparePoint(node, offset) === 0 &&
      !(node === bounds.end.node && offset === (bounds.end.offset ?? 0));
  } catch {
    // Invalid or disconnected points cannot belong to this range.
    return false;
  }
}

/**
 * One paginated page: visual start/end anchors and a vertical paint interval.
 * Ordinarily membership is the linear `[startBreak, endBreak)` DOM range;
 * CSS-reordered figures supply explicit, potentially disjoint ranges.
 * The DOM itself is
 * never modified or fragmented to produce this — a `Page` is purely a
 * *description* of a slice of the existing, fully linear document; see
 * `PaginationEngine`.
 */
export class Page {
  public constructor(
    public readonly index: number,
    public readonly startBreak: DomBreakPoint,
    public readonly endBreak: DomBreakPoint,
    public readonly topY: number,
    public readonly bottomY: number,
    public readonly positionOverrides?: readonly PositionOverride[],
  ) {}

  public get height(): number {
    return this.bottomY - this.topY;
  }

  /** The CSS `translateY` (in px) that would show this page at the top of
   * a viewport clipped to `this.height` — the entire display mechanism
   * for paginated mode is this one transform plus `overflow: hidden`,
   * with the underlying DOM untouched.
   *
   * Important: the clip must be sized to *this page's* `height`, not to
   * the fixed `pageHeight` budget passed to `PaginationEngine.paginate`.
   * A page frequently uses less than the full budget (the next chunk
   * didn't fit and started a new page instead), and the DOM keeps
   * flowing normally past this page's end — clipping to a taller, fixed
   * window would let the next page's content visually bleed through the
   * unused space at the bottom instead of showing a clean edge. */
  public get displayTranslateY(): number {
    return -this.topY;
  }

  /** True if the DOM position `(node, offset)` belongs to this visual page.
   * All membership ranges are end-exclusive. `ownerDocument` must be the content
   * document both breakpoints and `node` belong to (needed to construct
   * the `Range` used for the comparison). */
  public containsPosition(node: Node, offset: number, ownerDocument: Document): boolean {
    for (const override of this.positionOverrides ?? []) {
      if (containsDomPosition(override.scope, node, offset, ownerDocument)) {
        return override.ranges.some(bounds => containsDomPosition(bounds, node, offset, ownerDocument));
      }
    }
    return containsDomPosition({ start: this.startBreak, end: this.endBreak }, node, offset, ownerDocument);
  }
}
