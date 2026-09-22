import { HighlightTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";

/** One highlight's own style and resolved `Range`, as fed into
 * `computeHighlightRangeGroups` — the flattened, per-entry shape
 * `HighlightInteraction` resolves each saved `Highlight` into, as
 * opposed to `HighlightRenderer`'s previous "already grouped by style"
 * `Map`, which had nowhere to represent "this span belongs to *two*
 * overlapping styles at once" (issue #113). */
export interface HighlightRangeEntry {
  readonly style: HighlightStyle;
  readonly range: Range;
}

/** A single DOM position, comparable via a zero-length `Range` at that
 * position — see `comparePoints`. */
interface BoundaryPoint {
  readonly node: Node;
  readonly offset: number;
}

/** Orders two arbitrary DOM positions the same way `Range` boundaries
 * are ordered, by comparing a zero-length `Range` at `a` against `b`
 * (`Range.comparePoint`, already used elsewhere in this codebase for
 * the same "is this DOM position before/at/after this point" question
 * — see `packages/engine/src/layout/Page.ts`). Returns a normal
 * ascending-sort comparator result (negative if `a` is before `b`,
 * positive if after, `0` if the same position) — `Range.comparePoint`
 * itself returns the *opposite* sign convention (relative to the
 * range, not `a` first), hence the negation. Throws exactly when
 * `Range.comparePoint` would (positions in different documents/trees,
 * or an invalid offset) — callers here only ever compare boundary
 * points already pulled from real, currently-valid `Range`s in the same
 * document, so this is never expected to happen in practice. */
function comparePoints(doc: Document, a: BoundaryPoint, b: BoundaryPoint): number {
  const probe = doc.createRange();
  probe.setStart(a.node, a.offset);
  probe.setEnd(a.node, a.offset);
  return -probe.comparePoint(b.node, b.offset);
}

/** Whether `range` fully contains the closed interval `[start, end]` —
 * true exactly when both endpoints fall within (or exactly on) the
 * range's own boundaries. Used only against *elementary* intervals (see
 * `computeHighlightRangeGroups`) built from every input range's own
 * boundary points, so a `true` result here always means the *entire*
 * interval is inside `range`, never just one end of it: if `range`'s
 * own start or end fell strictly inside `[start, end]`, that boundary
 * would itself have produced a split point, and the interval checked
 * here would never straddle it. */
function rangeContainsInterval(range: Range, start: BoundaryPoint, end: BoundaryPoint): boolean {
  try {
    return range.comparePoint(start.node, start.offset) === 0 && range.comparePoint(end.node, end.offset) === 0;
  } catch {
    return false;
  }
}

/**
 * Splits `entries` into the named `::highlight()` groups
 * `HighlightRenderer.applyHighlightRanges` should register — the same
 * per-style groups as before everywhere a `range` belongs to only one
 * highlight, but wherever two or more *background-painting* highlights
 * (see `HighlightTheme.BACKGROUND_STYLES`) overlap the same text, that
 * overlapping span is carved out into its own precomputed blend group
 * instead (`HighlightTheme.blendHighlightName`, issue #113) — the CSS
 * Custom Highlight API itself has no notion of blending an overlap
 * (per spec, two highlights setting the same property in the same spot
 * is a plain "higher priority wins" conflict, not a composite of both),
 * so this resolves the overlap to a single already-blended color
 * *before* it ever reaches `CSS.highlights` instead.
 *
 * `"underline"` is deliberately excluded from blending: it's a
 * decoration, not a background fill, so it composes for free with
 * whatever background color (solo or blended) occupies the same span —
 * a span covered by both an underline and a colored highlight keeps its
 * own `underline` registration *in addition to* the background one,
 * rather than being folded into some "blend" that has nothing to
 * actually blend colors with.
 *
 * Implemented as a classic interval-overlay (scan-line) pass: collect
 * every input range's own start/end as a boundary point, sort and
 * dedupe them, then walk the resulting elementary intervals checking
 * which input ranges contain each one whole — never splitting a range
 * anywhere its *own* boundary didn't already require a split. */
export function computeHighlightRangeGroups(doc: Document, entries: readonly HighlightRangeEntry[]): Map<string, Range[]> {
  const groups = new Map<string, Range[]>();
  if (entries.length === 0) {
    return groups;
  }

  const points: BoundaryPoint[] = [];
  for (const { range } of entries) {
    points.push({ node: range.startContainer, offset: range.startOffset });
    points.push({ node: range.endContainer, offset: range.endOffset });
  }
  points.sort((a, b) => comparePoints(doc, a, b));
  const deduped: BoundaryPoint[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (!last || comparePoints(doc, last, point) !== 0) {
      deduped.push(point);
    }
  }

  const addRange = (name: string, start: BoundaryPoint, end: BoundaryPoint): void => {
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const existing = groups.get(name);
    if (existing) {
      existing.push(range);
    } else {
      groups.set(name, [range]);
    }
  };

  for (let i = 0; i < deduped.length - 1; i++) {
    const start = deduped[i]!;
    const end = deduped[i + 1]!;
    const covering = entries.filter((entry) => rangeContainsInterval(entry.range, start, end));
    if (covering.length === 0) {
      continue;
    }
    const hasUnderline = covering.some((entry) => entry.style === "underline");
    if (hasUnderline) {
      addRange(HighlightTheme.highlightName("underline"), start, end);
    }
    const backgroundStyles = [...new Set(covering.map((entry) => entry.style).filter((style) => style !== "underline"))] as Exclude<
      HighlightStyle,
      "underline"
    >[];
    if (backgroundStyles.length === 1) {
      addRange(HighlightTheme.highlightName(backgroundStyles[0]!), start, end);
    } else if (backgroundStyles.length > 1) {
      addRange(HighlightTheme.blendHighlightName(backgroundStyles), start, end);
    }
  }

  return groups;
}
