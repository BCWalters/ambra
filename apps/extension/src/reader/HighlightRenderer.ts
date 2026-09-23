import { HighlightTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import { computeHighlightRangeGroups } from "./HighlightOverlap.js";
import type { HighlightRangeEntry } from "./HighlightOverlap.js";

/** TypeScript's DOM lib declares `CSS`/`Highlight` as bare ambient
 * globals (so a normal same-realm script can just write `CSS.highlights`
 * directly), but doesn't model `Window.CSS`/`Window.Highlight` as actual
 * properties of the `Window` interface — a real gap, not a design choice
 * on our end. Since every highlight here must be created against the
 * *content iframe's own* window (`CSS.highlights` is scoped per-document
 * — using the parent's own global would render into the wrong document
 * entirely, or nothing at all), accessing it through `doc.defaultView`
 * needs this narrow cast rather than the ambient globals working as-is. */
interface HighlightCapableWindow extends Window {
  readonly CSS: { readonly highlights: Map<string, InstanceType<typeof Highlight>> };
  readonly Highlight: new (...ranges: Range[]) => InstanceType<typeof Highlight>;
}

/** Every `::highlight()` name this renderer might ever need to set *or
 * clear* — every solo style, plus every precomputed overlap-blend
 * combination (issue #113) `HighlightTheme.BLEND_COMBINATIONS` defines
 * a color for. Computed once (not per call): the whole point is a
 * fixed, known set independent of any particular book's highlights. */
const ALL_HIGHLIGHT_NAMES: readonly string[] = [
  ...(Object.keys(HighlightTheme.STYLES) as HighlightStyle[]).map((style) => HighlightTheme.highlightName(style)),
  ...HighlightTheme.BLEND_COMBINATIONS.map((styles) => HighlightTheme.blendHighlightName(styles)),
];

/** Applies `entries` (this document's own highlights, each with its
 * style and resolved `Range`) to `doc`'s CSS Custom Highlight registry
 * — see `HighlightTheme`'s doc comment for why highlights render this
 * way (a pure CSSOM/rendering feature, no DOM mutation) rather than by
 * wrapping ranges in elements. Overlapping ranges of different
 * background-painting styles are resolved to a precomputed blended
 * color first (`computeHighlightRangeGroups`, issue #113) rather than
 * registered under their own original styles, since the CSS Custom
 * Highlight API has no notion of blending an overlap itself. Replaces
 * whatever this document's registry held before entirely (one call
 * covers every style *and* every blend combination at once), so a
 * removed highlight — or a stale blend from an overlap that no longer
 * exists — never lingers from a previous call. A no-op if `doc` has no
 * attached window (e.g. called against a detached/disposed document)
 * or the browser lacks Custom Highlight API support — silently
 * degrading to "no highlights visible" rather than throwing, since this
 * is a presentational nicety, not something that should ever be able
 * to break reading. */
export function applyHighlightRanges(doc: Document, entries: readonly HighlightRangeEntry[]): void {
  const win = doc.defaultView as HighlightCapableWindow | null;
  if (!win?.CSS?.highlights || !win.Highlight) {
    return;
  }
  const groups = computeHighlightRangeGroups(doc, entries);
  for (const name of ALL_HIGHLIGHT_NAMES) {
    const ranges = groups.get(name);
    if (ranges && ranges.length > 0) {
      win.CSS.highlights.set(name, new win.Highlight(...ranges));
    } else {
      win.CSS.highlights.delete(name);
    }
  }
}

/** The search-highlighting counterpart to `applyHighlightRanges` — one
 * dedicated `::highlight()` (`HighlightTheme.SEARCH_MATCH_HIGHLIGHT_NAME`)
 * rather than a whole `HighlightStyle`-keyed map, since there's only
 * ever one active search query at a time (see
 * `ReaderController.applySearchHighlightToCurrentHost`, issue #100). An
 * empty `ranges` clears the registry entry entirely rather than setting
 * an empty `Highlight`, exactly like `applyHighlightRanges`'s own
 * per-style handling above. */
export function applySearchMatchRanges(doc: Document, ranges: readonly Range[]): void {
  applySpotlightRanges(doc, HighlightTheme.SEARCH_MATCH_HIGHLIGHT_NAME, ranges);
}

export function applyNavigationTargetRange(doc: Document, range?: Range): void {
  applySpotlightRanges(doc, HighlightTheme.NAVIGATION_TARGET_HIGHLIGHT_NAME, range ? [range] : [], 1);
}

export function applyNarrationRange(doc: Document, range?: Range): void {
  applySpotlightRanges(doc, HighlightTheme.NARRATION_HIGHLIGHT_NAME, range ? [range] : [], 2);
}

function applySpotlightRanges(doc: Document, name: string, ranges: readonly Range[], priority = 0): void {
  const win = doc.defaultView as HighlightCapableWindow | null;
  if (!win?.CSS?.highlights || !win.Highlight) {
    return;
  }
  if (ranges.length > 0) {
    const highlight = new win.Highlight(...ranges);
    highlight.priority = priority;
    win.CSS.highlights.set(name, highlight);
  } else {
    win.CSS.highlights.delete(name);
  }
}

/** Every `::highlight()` name `applyActiveHighlightRange` might ever
 * need to set *or* clear — one per `HighlightStyle` (issue #113's
 * follow-up: the active emphasis is per-style, not a single shared
 * name, so it stays visibly related to whichever color the highlight
 * actually is). Computed once, not per call. */
const ALL_ACTIVE_HIGHLIGHT_NAMES: readonly string[] = (Object.keys(HighlightTheme.STYLES) as HighlightStyle[]).map(
  (style) => HighlightTheme.activeHighlightName(style),
);

/** How much higher `applyActiveHighlightRange`'s own registration
 * outranks every other highlight this renderer ever sets — an
 * arbitrarily large number rather than, say, `1`, so it stays the clear
 * winner even if a future highlight kind ever needs its own nonzero
 * priority for some unrelated reason. */
const ACTIVE_HIGHLIGHT_PRIORITY = 1000;

/** Marks `range` as "the highlight whose popup is currently open"
 * (issue #113's follow-up), styled as `style`'s own vivid variant
 * (`HighlightTheme.activeHighlightName`) — or clears every style's
 * active mark if `range` is `undefined` (no highlight is selected).
 * Given an explicit `priority` far above any other highlight this
 * renderer sets, so it always wins over whatever plain or blended
 * color already occupies the same span (issue #113's own overlap
 * blending) — "override the blend so it's unmistakable," as asked,
 * while still visibly relating to the highlight's own chosen color
 * rather than replacing it with something unrelated. Only ever one
 * style's name is set at a time; every other style's is explicitly
 * cleared alongside it so a highlight re-colored while its popup is
 * still open never leaves its *previous* color's active mark behind. */
export function applyActiveHighlightRange(doc: Document, range: Range | undefined, style?: HighlightStyle): void {
  const win = doc.defaultView as HighlightCapableWindow | null;
  if (!win?.CSS?.highlights || !win.Highlight) {
    return;
  }
  const activeName = range && style ? HighlightTheme.activeHighlightName(style) : undefined;
  for (const name of ALL_ACTIVE_HIGHLIGHT_NAMES) {
    if (name === activeName && range) {
      const highlight = new win.Highlight(range);
      highlight.priority = ACTIVE_HIGHLIGHT_PRIORITY;
      win.CSS.highlights.set(name, highlight);
    } else {
      win.CSS.highlights.delete(name);
    }
  }
}
