import type {
  PageProgressionDirection,
  PageSpreadSide,
  RenditionLayout,
  RenditionSpread,
  SpineItemRef,
} from "../container/PackageDocument.js";

/** Below this, showing two fixed-layout pages side by side is cramped
 * enough that a single page at a time reads better regardless of what
 * `rendition:spread` asks for — the same "not worth it below some floor"
 * judgment `SpreadPaginatedHost.isEligible` already makes for reflowable
 * spread mode, just with its own (much simpler, since fixed-layout pages
 * have no reflow measure to protect) threshold. */
const MIN_SPREAD_TOTAL_WIDTH = 700;

/** One computed fixed-layout "spread" — either a single spine item shown
 * alone (centered), or two consecutive spine items shown side by side.
 * Deliberately doesn't carry page dimensions/scale — purely a pairing
 * decision; `ReaderController` is responsible for actually sizing and
 * loading whichever `FixedContentHost`(s) this names. */
export type FixedSpread =
  | { readonly kind: "single"; readonly spineIndex: number }
  | { readonly kind: "pair"; readonly leftSpineIndex: number; readonly rightSpineIndex: number };

/**
 * Pure (no DOM, no I/O) implementation of the EPUB3 fixed-layout
 * "synthetic spread" pairing algorithm — see the class's own methods for
 * the specific rules, each with its own spec citation. Deliberately kept
 * entirely separate from `FixedContentHost`/any future spread-rendering
 * host class: this is just the *decision* of which spine items belong in
 * which slot of which spread, fully testable without a DOM at all.
 *
 * Spec summary (EPUB 3.3 §Rendition Layout, `page-spread-*` properties):
 * a Reading system populates a synthetic spread by placing consecutive
 * spine items into "the next available unpopulated viewport," where the
 * default left/right assignment (absent an explicit `page-spread-left`/
 * `-right` override) alternates according to `page-progression-direction`.
 * Two adjacent items combine into one two-page spread only when that
 * resolves to a valid left+right (or, for `rtl`, right+left) pairing —
 * otherwise each renders alone, single-page (this engine follows
 * Readium's own resolved behavior here, not a literal spec algorithm:
 * the spec itself doesn't prescribe a "MUST insert a blank filler page"
 * rule for a same-side/mismatched pair — see this class's own research
 * notes in `openSpineItem`'s fixed-layout doc comment for the primary
 * sources). `page-spread-center` and reflowable content (mixed-layout
 * books are explicitly spec-legal — an item can override the package's
 * own default layout per itemref) always render alone, never paired,
 * and also never interrupt/reset which side an *unrelated* later run of
 * fixed-layout items defaults to (each run is evaluated independently,
 * starting fresh from its own first spread-eligible item).
 */
export class FixedLayoutSpreadPlanner {
  /** Whether `rendition:spread` even permits attempting synthetic
   * spreads at all for the *current* available viewport — a fixed-layout
   * counterpart to `SpreadPaginatedHost.isEligible`. `"none"` never
   * spreads; `"landscape"` (and `"auto"`, which this engine resolves the
   * same way, per `RenditionSpread`'s own doc comment on the spec
   * leaving `"auto"` to Reading System discretion) requires a landscape-
   * shaped viewport; `"both"` (which the deprecated `"portrait"` value
   * is folded into at parse time — see `PackageDocument
   * .parseRenditionSpreadMeta`) spreads regardless of orientation. Every
   * value still requires at least `MIN_SPREAD_TOTAL_WIDTH`, since a
   * viewport can be "landscape-shaped" (width > height) while still
   * being far too narrow to usefully show two pages side by side (e.g.
   * a phone in landscape). */
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
    // "landscape" and "auto" both key off the viewport's actual current
    // shape, not just its raw width — see `RenditionSpread`'s own doc
    // comment for why `"auto"` is resolved the same way as `"landscape"`
    // here (a reasonable, spec-permitted RS discretion call).
    return width > height;
  }

  /** The `FixedSpread` (single or paired) that spine index `spineIndex`
   * currently belongs to. Scans backward first to find the start of the
   * contiguous run of spread-eligible, non-center, pre-paginated spine
   * items `spineIndex` is part of (a reflowable item, a `page-spread-
   * center` item, or the very start of the spine all begin a fresh run —
   * see the class doc comment on why each run is independent), then
   * walks forward from there, greedily pairing according to
   * `canPair`, until it reaches (or passes) `spineIndex` — this
   * "resolve from the start of the run" approach is what makes the
   * result unambiguous: naively checking only `spineIndex`'s immediate
   * neighbors independently could otherwise validly pair it with *either*
   * neighbor for a long alternating run. */
  public static spreadContaining(
    spine: readonly SpineItemRef[],
    packageRenditionLayout: RenditionLayout,
    direction: PageProgressionDirection,
    spreadEligible: boolean,
    spineIndex: number,
  ): FixedSpread {
    if (!spreadEligible || !FixedLayoutSpreadPlanner.isSpreadCandidate(spine, packageRenditionLayout, spineIndex)) {
      return { kind: "single", spineIndex };
    }

    let runStart = spineIndex;
    while (
      runStart > 0 &&
      FixedLayoutSpreadPlanner.isSpreadCandidate(spine, packageRenditionLayout, runStart - 1)
    ) {
      runStart--;
    }

    let i = runStart;
    while (i < spine.length) {
      const isCandidate = FixedLayoutSpreadPlanner.isSpreadCandidate(spine, packageRenditionLayout, i);
      if (!isCandidate) {
        // The run ended before reaching spineIndex — shouldn't happen
        // given the backward scan above already stopped at the same
        // boundary, but guards against ever looping past the run.
        break;
      }
      const next = i + 1;
      const canPairWithNext =
        next < spine.length &&
        FixedLayoutSpreadPlanner.isSpreadCandidate(spine, packageRenditionLayout, next) &&
        FixedLayoutSpreadPlanner.canPair(spine[i]!, spine[next]!, direction);

      // A successful pair claims *both* `i` and `next` — checked first,
      // regardless of which one is `spineIndex`, so a failed attempt at
      // pairing `spineIndex` with its *predecessor* (`next === spineIndex`
      // here) falls through to try `spineIndex` again as the *first* of
      // a fresh pair with its own successor, rather than concluding
      // "single" one iteration too early — a real bug caught by this
      // module's own unit tests: `page-blanche.epub`'s exact spine
      // (right, left, right, left, ...) starts with a lone unpaired
      // `page-spread-right` cover, and the *next* item (`page-spread-
      // left`) needs to pair with *its own* successor, not be prematurely
      // called "single" just because it didn't pair with the cover
      // before it.
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
    spreadEligible: boolean,
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
      spreadEligible,
      nextIndex,
    );
  }

  /** The `FixedSpread` immediately before `current`, or `undefined` at
   * the start of the spine. */
  public static previousSpread(
    spine: readonly SpineItemRef[],
    packageRenditionLayout: RenditionLayout,
    direction: PageProgressionDirection,
    spreadEligible: boolean,
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
      spreadEligible,
      previousIndex,
    );
  }

  /** Whether spine item `index` could ever participate in a synthetic
   * spread at all — pre-paginated (its own effective layout, applying
   * any per-item `rendition:layout-*` override) and not marked
   * `page-spread-center` (spec: center always forces a single, centered
   * viewport, never paired — see `PageSpreadSide`'s own doc comment). */
  private static isSpreadCandidate(
    spine: readonly SpineItemRef[],
    packageRenditionLayout: RenditionLayout,
    index: number,
  ): boolean {
    const item = spine[index];
    if (!item) {
      return false;
    }
    if (item.resolveRenditionLayout(packageRenditionLayout) !== "pre-paginated") {
      return false;
    }
    return item.pageSpread !== "center";
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
