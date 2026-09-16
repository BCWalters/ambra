/**
 * Pure, DOM-free arithmetic for book-wide page numbering — deliberately
 * separated from `BookPaginationEstimator` (which does the actual, real-
 * layout-dependent measuring) the same way `PaginationEngine.planPageBreaks`
 * is separated from the line-measurement it consumes: the *decisions* here
 * (what order to measure spine items in, how to turn per-item page counts
 * into "page 42 of 350") have no layout dependency at all and are fully
 * unit-testable on their own.
 */

/** The order in which to measure each spine item's page count: the
 * item the reader is *currently in* first (so "page X of Y" for the
 * current position becomes available as soon as possible), then
 * forward through the rest of the book (the direction a reader is
 * about to go), then backward through everything before the current
 * item (needed for the running total, but far less urgent — a reader
 * essentially never needs "page 12,000 of the whole book" before they
 * need "page 3 of this chapter, but which chapter am I on"). */
export function computePriorityOrder(currentSpineIndex: number, spineLength: number): number[] {
  if (spineLength <= 0) {
    return [];
  }
  const clampedCurrent = Math.max(0, Math.min(spineLength - 1, currentSpineIndex));
  const order: number[] = [clampedCurrent];
  for (let i = clampedCurrent + 1; i < spineLength; i++) {
    order.push(i);
  }
  for (let i = clampedCurrent - 1; i >= 0; i--) {
    order.push(i);
  }
  return order;
}

/** A book-wide position derived from per-spine-item page counts —
 * either or both fields are `undefined` when the measurements needed to
 * compute them haven't finished yet (see `computePriorityOrder`: the
 * current page number only needs items up to and including the current
 * one; the total needs literally every item in the book). */
export interface BookPosition {
  readonly currentPage: number | undefined;
  readonly totalPages: number | undefined;
}

/** Combines per-spine-item page counts (`pageCounts[i]` is spine item
 * `i`'s page count, or `undefined` if not yet measured) with the
 * reader's current position (`currentSpineIndex` and its zero-based
 * `pageIndexInItem`) into a book-wide page position. `currentPage` is
 * only defined once every item from `0` through `currentSpineIndex` has
 * a known count (so the running total up to "here" is exact, not a
 * guess); `totalPages` is only defined once every item in the book does. */
export function aggregateBookPosition(
  pageCounts: readonly (number | undefined)[],
  currentSpineIndex: number,
  pageIndexInItem: number,
): BookPosition {
  let currentPage: number | undefined = 0;
  for (let i = 0; i <= currentSpineIndex; i++) {
    const count = pageCounts[i];
    if (i < currentSpineIndex) {
      if (count === undefined) {
        currentPage = undefined;
        break;
      }
      currentPage += count;
    } else {
      // The current item itself only needs to have been reached, not
      // fully counted — its own in-progress page index is what matters.
      currentPage += pageIndexInItem + 1;
    }
  }

  let totalPages: number | undefined = 0;
  for (const count of pageCounts) {
    if (count === undefined) {
      totalPages = undefined;
      break;
    }
    totalPages += count;
  }

  return { currentPage, totalPages };
}

/** The inverse of `aggregateBookPosition`: given every spine item's page
 * count and a target *book-wide* page number (1-based), finds which
 * spine item that page falls within and its zero-based page index
 * inside that item — the calculation the progress scrubber needs to
 * turn "the reader dragged to 61% through the book" into an actual
 * navigable position. Returns `undefined` if any spine item up to and
 * including the one containing the target page hasn't been measured
 * yet (an imprecise, partially-measured book can't be seeked into
 * exactly — the caller should fall back to coarser, spine-level
 * seeking in that case; see `ReaderController.seekToFraction`).
 * `globalPageOneBased` is clamped into range rather than ever failing
 * on an out-of-bounds value, since it's normally derived from a
 * continuous drag fraction that can easily overshoot by a fraction of
 * a page at either end. */
export function resolveGlobalPage(
  pageCounts: readonly (number | undefined)[],
  globalPageOneBased: number,
): { spineIndex: number; pageIndexInItem: number } | undefined {
  if (pageCounts.length === 0) {
    return undefined;
  }
  const clampedTarget = Math.max(1, Math.round(globalPageOneBased));
  let remaining = clampedTarget;
  for (let i = 0; i < pageCounts.length; i++) {
    const count = pageCounts[i];
    if (count === undefined) {
      return undefined;
    }
    if (remaining <= count) {
      return { spineIndex: i, pageIndexInItem: Math.max(0, remaining - 1) };
    }
    remaining -= count;
  }
  // The target was at or past the very end of the book — clamp to the
  // last page of the last spine item rather than treating it as
  // unresolved (a drag to the far right edge of the scrubber should
  // always land somewhere, not silently do nothing).
  const lastIndex = pageCounts.length - 1;
  const lastCount = pageCounts[lastIndex];
  if (lastCount === undefined) {
    return undefined;
  }
  return { spineIndex: lastIndex, pageIndexInItem: Math.max(0, lastCount - 1) };
}
