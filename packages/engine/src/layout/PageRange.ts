import type { DomBreakPoint, DomPositionRange, Page } from "./Page.js";
import { compareDomPositions } from "./ScrollPositionTracker.js";

function intersect(a: DomPositionRange, b: DomPositionRange): DomPositionRange | undefined {
  const start = compareDomPositions(a.start, b.start) >= 0 ? a.start : b.start;
  const end = compareDomPositions(a.end, b.end) <= 0 ? a.end : b.end;
  return compareDomPositions(start, end) < 0 ? { start, end } : undefined;
}

function subtract(bounds: DomPositionRange, scope: DomPositionRange): DomPositionRange[] {
  const overlap = intersect(bounds, scope);
  if (!overlap) return [bounds];
  const result: DomPositionRange[] = [];
  if (compareDomPositions(bounds.start, overlap.start) < 0) result.push({ start: bounds.start, end: overlap.start });
  if (compareDomPositions(overlap.end, bounds.end) < 0) result.push({ start: overlap.end, end: bounds.end });
  return result;
}

/** Intersects with canonical visual membership, never a DOM-order envelope
 * around CSS-reordered content. Disjoint membership remains disjoint. */
export function intersectPageRange(page: Page, selection: Range, document: Document): Range[] {
  const selected: DomPositionRange = {
    start: { node: selection.startContainer, offset: selection.startOffset },
    end: { node: selection.endContainer, offset: selection.endOffset },
  };
  const validate = (point: DomBreakPoint): void => {
    if (point.node.getRootNode() !== document) throw new Error("Page and selection boundaries must belong to the same live document.");
    const probe = document.createRange();
    probe.setStart(point.node, point.offset ?? 0);
  };
  for (const point of [selected.start, selected.end, page.startBreak, page.endBreak]) validate(point);
  let membership: DomPositionRange[] = compareDomPositions(page.startBreak, page.endBreak) < 0
    ? [{ start: page.startBreak, end: page.endBreak }] : [];
  const overrides = page.positionOverrides ?? [];
  for (const override of overrides) {
    validate(override.scope.start);
    validate(override.scope.end);
    membership = membership.flatMap(bounds => subtract(bounds, override.scope));
  }
  for (const [index, override] of overrides.entries()) {
    for (const bounds of override.ranges) {
      validate(bounds.start);
      validate(bounds.end);
      const inScope = intersect(bounds, override.scope);
      let ranges = inScope ? [inScope] : [];
      // containsPosition gives the first matching override precedence.
      for (const earlier of overrides.slice(0, index)) ranges = ranges.flatMap(range => subtract(range, earlier.scope));
      membership.push(...ranges);
    }
  }
  const intersections = membership.flatMap(bounds => {
    const overlap = intersect(bounds, selected);
    return overlap ? [overlap] : [];
  }).sort((a, b) => compareDomPositions(a.start, b.start));
  const merged: DomPositionRange[] = [];
  for (const bounds of intersections) {
    const previous = merged.at(-1);
    if (previous && compareDomPositions(bounds.start, previous.end) <= 0) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: compareDomPositions(previous.end, bounds.end) >= 0 ? previous.end : bounds.end,
      };
    } else {
      merged.push(bounds);
    }
  }
  return merged.map(bounds => {
    const range = document.createRange();
    range.setStart(bounds.start.node, bounds.start.offset ?? 0);
    range.setEnd(bounds.end.node, bounds.end.offset ?? 0);
    return range;
  });
}
