import type {
  PageProgressionDirection,
  PageSpreadSide,
  RenditionLayout,
  RenditionSpread,
  SpineItemRef,
} from "../container/PackageDocument.js";

/** Below this width, readability takes priority over the author's spread hint. */
const MIN_SPREAD_TOTAL_WIDTH = 700;

/** Publication pairing and physical placement, independent of rendering geometry. */
export type FixedSpread =
  | { readonly kind: "single"; readonly spineIndex: number }
  | { readonly kind: "pair"; readonly leftSpineIndex: number; readonly rightSpineIndex: number };

export interface FixedSpreadViewport {
  readonly width: number;
  readonly height: number;
  readonly packageRenditionSpread: RenditionSpread;
}

/** Pairs consecutive eligible FXL items, respecting direction and explicit sides.
 * Ineligible items break runs. Mismatched sides render singly rather than adding
 * blank filler pages, following Readium's convention where EPUB leaves discretion. */
export class FixedLayoutSpreadPlanner {
  /** Resolves the author's spread hint against the available viewport. */
  public static isSpreadModeEligible(renditionSpread: RenditionSpread, width: number, height: number): boolean {
    if (renditionSpread === "none") {
      return false;
    }
    if (width < MIN_SPREAD_TOTAL_WIDTH) {
      return false;
    }
    if (renditionSpread === "both") {
      return true;
    }
    // EPUB leaves "auto" to the reader; Ambra uses landscape eligibility.
    return width > height;
  }

  /** Resolve from the eligible run's beginning so adjacent items agree on pairing. */
  public static spreadContaining(
    spine: readonly SpineItemRef[],
    packageRenditionLayout: RenditionLayout,
    direction: PageProgressionDirection,
    viewport: FixedSpreadViewport,
    spineIndex: number,
  ): FixedSpread {
    if (!FixedLayoutSpreadPlanner.isSpreadCandidate(spine, packageRenditionLayout, viewport, spineIndex)) {
      return { kind: "single", spineIndex };
    }

    let runStart = spineIndex;
    while (
      runStart > 0 &&
      FixedLayoutSpreadPlanner.isSpreadCandidate(spine, packageRenditionLayout, viewport, runStart - 1)
    ) {
      runStart--;
    }

    let i = runStart;
    while (i < spine.length) {
      const isCandidate = FixedLayoutSpreadPlanner.isSpreadCandidate(spine, packageRenditionLayout, viewport, i);
      if (!isCandidate) {
        // The run ended before reaching spineIndex — shouldn't happen
        // given the backward scan above already stopped at the same
        // boundary, but guards against ever looping past the run.
        break;
      }
      const next = i + 1;
      const canPairWithNext =
        next < spine.length &&
        FixedLayoutSpreadPlanner.isSpreadCandidate(spine, packageRenditionLayout, viewport, next) &&
        FixedLayoutSpreadPlanner.canPair(spine[i]!, spine[next]!, direction);

      // Failure to pair with a predecessor must still allow pairing with a successor.
      if (canPairWithNext && (i === spineIndex || next === spineIndex)) {
        return direction === "rtl"
          ? { kind: "pair", leftSpineIndex: next, rightSpineIndex: i }
          : { kind: "pair", leftSpineIndex: i, rightSpineIndex: next };
      }
      if (!canPairWithNext && i === spineIndex) {
        return { kind: "single", spineIndex };
      }

      i = canPairWithNext ? i + 2 : i + 1;
    }

    // Fell through without ever covering spineIndex (only reachable if
    // spineIndex isn't actually a spread candidate, already handled
    // above) — a single page is always a safe, correct fallback.
    return { kind: "single", spineIndex };
  }

  /** The next `FixedSpread` after `current`, or `undefined` at the end
   * of the spine. */
  public static nextSpread(
    spine: readonly SpineItemRef[],
    packageRenditionLayout: RenditionLayout,
    direction: PageProgressionDirection,
    viewport: FixedSpreadViewport,
    current: FixedSpread,
  ): FixedSpread | undefined {
    const lastIndex = current.kind === "single" ? current.spineIndex : Math.max(current.leftSpineIndex, current.rightSpineIndex);
    const nextIndex = lastIndex + 1;
    if (nextIndex >= spine.length) {
      return undefined;
    }
    return FixedLayoutSpreadPlanner.spreadContaining(
      spine,
      packageRenditionLayout,
      direction,
      viewport,
      nextIndex,
    );
  }

  /** The `FixedSpread` immediately before `current`, or `undefined` at
   * the start of the spine. */
  public static previousSpread(
    spine: readonly SpineItemRef[],
    packageRenditionLayout: RenditionLayout,
    direction: PageProgressionDirection,
    viewport: FixedSpreadViewport,
    current: FixedSpread,
  ): FixedSpread | undefined {
    const firstIndex = current.kind === "single" ? current.spineIndex : Math.min(current.leftSpineIndex, current.rightSpineIndex);
    const previousIndex = firstIndex - 1;
    if (previousIndex < 0) {
      return undefined;
    }
    return FixedLayoutSpreadPlanner.spreadContaining(
      spine,
      packageRenditionLayout,
      direction,
      viewport,
      previousIndex,
    );
  }

  private static isSpreadCandidate(
    spine: readonly SpineItemRef[],
    packageRenditionLayout: RenditionLayout,
    viewport: FixedSpreadViewport,
    index: number,
  ): boolean {
    const item = spine[index];
    if (!item) {
      return false;
    }
    if (item.resolveRenditionLayout(packageRenditionLayout) !== "pre-paginated") {
      return false;
    }
    return item.pageSpread !== "center" && FixedLayoutSpreadPlanner.isSpreadModeEligible(
      item.resolveRenditionSpread(viewport.packageRenditionSpread),
      viewport.width,
      viewport.height,
    );
  }

  /** Whether `first` (earlier in reading order) and `second`
   * (immediately following it) resolve to a valid left+right (or, for
   * `rtl`, right+left) pairing — an explicit `page-spread-left`/`-right`
   * on either always wins; a side left unspecified defaults per
   * `defaultSide`. Mirrors Readium's own `EPUBSpread.areConsecutive`
   * (see this module's class doc comment for the citation) — the
   * closest thing to a settled, cross-implementation answer for this
   * exact question, which the prose spec itself leaves a strict
   * algorithm for. */
  private static canPair(first: SpineItemRef, second: SpineItemRef, direction: PageProgressionDirection): boolean {
    const firstSide = first.pageSpread ?? FixedLayoutSpreadPlanner.defaultSide("first", direction);
    const secondSide = second.pageSpread ?? FixedLayoutSpreadPlanner.defaultSide("second", direction);
    if (direction === "rtl") {
      return firstSide === "right" && secondSide === "left";
    }
    return firstSide === "left" && secondSide === "right";
  }

  /** The side a spine item defaults to when it declares no explicit
   * `page-spread-*` property of its own, based purely on its position
   * (`"first"`/`"second"`) within the *pair currently being evaluated*
   * — not a running count across the whole spine/run (see the class doc
   * comment's citation of the historical FXL working draft's RTL manga
   * example: "each spread is created by first using the right page and
   * then the left page," i.e. reading-order position within the pair,
   * mirrored for `rtl`). */
  private static defaultSide(position: "first" | "second", direction: PageProgressionDirection): PageSpreadSide {
    if (direction === "rtl") {
      return position === "first" ? "right" : "left";
    }
    return position === "first" ? "left" : "right";
  }
}
