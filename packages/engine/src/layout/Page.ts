/** A DOM boundary position: a node plus a child/character offset within
 * it, used to mark where a page begins or ends. */
export interface DomBreakPoint {
  readonly node: Node;
  readonly offset?: number;
}

/**
 * One paginated page: a `[startBreak, endBreak)` range over the content
 * document's linear DOM, plus the vertical extent (`topY`/`bottomY`) that
 * range occupies in the unpaginated single-column flow. The DOM itself is
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

  /** True if the DOM position `(node, offset)` falls within this page's
   * `[startBreak, endBreak)` range. `ownerDocument` must be the content
   * document both breakpoints and `node` belong to (needed to construct
   * the `Range` used for the comparison). */
  public containsPosition(node: Node, offset: number, ownerDocument: Document): boolean {
    const range = ownerDocument.createRange();
    try {
      range.setStart(this.startBreak.node, this.startBreak.offset ?? 0);
      range.setEnd(this.endBreak.node, this.endBreak.offset ?? 0);
      return range.comparePoint(node, offset) === 0;
    } catch {
      // comparePoint throws if `node` isn't in the same document/tree as
      // the range's boundaries, or if the boundary points are invalid —
      // in either case, this position isn't meaningfully "in" this page.
      return false;
    }
  }
}
