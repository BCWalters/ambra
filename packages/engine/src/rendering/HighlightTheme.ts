/** The 5 pastel highlight colors plus underline a reader can apply to a
 * text selection (see the "highlight" reading feature) — a short,
 * curated set rather than a full color picker, matching the same
 * "curated over infinite choice" philosophy as `ReadingTheme`'s page
 * themes/font families. */
export type HighlightStyle = "yellow" | "green" | "blue" | "pink" | "purple" | "underline";

/** The subset of `HighlightStyle` that actually paints a background —
 * i.e. every style except `"underline"`, which only ever adds a
 * decoration on top of whatever background (if any) is already there.
 * `HighlightTheme.STYLE_ORDER` filtered to this at module load would
 * work too, but a literal tuple keeps `BACKGROUND_STYLES` a plain
 * compile-time-known list `blendCombinations` below can iterate over
 * without a runtime filter on every access. */
const BACKGROUND_STYLES: readonly Exclude<HighlightStyle, "underline">[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
];

/** Every combination of 2 or more `BACKGROUND_STYLES`, smallest first —
 * the full set of "more than one background-painting highlight overlaps
 * here" cases issue #113 asks to support, computed once at module load
 * rather than only handling the pairwise case: with just 5 curated
 * colors, all 26 combinations of 2 or more (`2^5 - 5 - 1`) is a small,
 * fixed set, so there's no reason to stop at "just 2" when covering
 * every combination costs the same fixed CSS/lookup-table size. */
function blendCombinations(): Exclude<HighlightStyle, "underline">[][] {
  const combos: Exclude<HighlightStyle, "underline">[][] = [];
  const n = BACKGROUND_STYLES.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const combo: Exclude<HighlightStyle, "underline">[] = [];
    for (let bit = 0; bit < n; bit++) {
      if (mask & (1 << bit)) {
        combo.push(BACKGROUND_STYLES[bit]!);
      }
    }
    if (combo.length >= 2) {
      combos.push(combo);
    }
  }
  return combos;
}

/** Averages a set of `#rrggbb` swatches channel-by-channel — deliberately
 * simple flat-average blending (not perceptual/gamma-correct color
 * mixing), matching issue #113's own "we don't have to be perfect": a
 * plain average of the constituent pastels reads clearly as "these
 * overlap" without needing a real color-science model for what's
 * ultimately just a visual hint, not a color-accurate rendering. */
function averageHexColors(hexes: readonly string[]): string {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const hex of hexes) {
    r += parseInt(hex.slice(1, 3), 16);
    g += parseInt(hex.slice(3, 5), 16);
    b += parseInt(hex.slice(5, 7), 16);
  }
  const n = hexes.length;
  const toHex = (channel: number): string =>
    Math.round(channel / n)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** The canonical, order-independent key for a set of overlapping
 * background styles — sorted so `["pink", "blue"]` and `["blue",
 * "pink"]` (the same overlap, discovered in either order) always agree
 * on the same key/highlight name. */
function blendKey(styles: readonly Exclude<HighlightStyle, "underline">[]): string {
  return [...styles].sort().join("-");
}

/** A bolder, more saturated version of `hex`, same hue — used for the
 * "this highlight's popup is open" active-selection emphasis (issue
 * #113's follow-up): the reader's own feedback was that a single fixed
 * unrelated color (the first attempt used a flat cyan for every style)
 * "loses the original color selection," so the active version of a
 * highlight needs to visibly relate to whichever color it actually is,
 * not replace it with something arbitrary. Converts to HSL, fixes
 * saturation/lightness at values chosen so every one of the 5 curated
 * swatches' vivid variant still clears WCAG AA's 4.5:1 contrast ratio
 * against the theme's own `#1a1a1a` ink text color (verified for all 5
 * — purple is the tightest at ~5.8:1), then converts back — a
 * programmatic transform rather than 5 hand-picked colors, so it can't
 * silently drift out of sync with `STYLES`' own swatches if those ever
 * change. */
function vividVariant(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case r:
        hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        hue = ((b - r) / d + 2) * 60;
        break;
      default:
        hue = ((r - g) / d + 4) * 60;
        break;
    }
  }
  const saturation = 0.65;
  const lightness = 0.7;
  const hueToRgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const hNorm = hue / 360;
  const toChannel = (channel: number): string =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toChannel(hueToRgb(p, q, hNorm + 1 / 3))}${toChannel(hueToRgb(p, q, hNorm))}${toChannel(hueToRgb(p, q, hNorm - 1 / 3))}`;
}

interface HighlightStyleOption {
  readonly label: string;
  /** The swatch color shown in the highlight-picker UI — always a solid
   * color, even for `"underline"` (shown as an underline-only swatch
   * there, not applied to text as a background). */
  readonly swatch: string;
}

/**
 * Renders a book's saved highlights via the CSS Custom Highlight API
 * (`CSS.highlights`/`::highlight()`) rather than by mutating the content
 * document's DOM (wrapping ranges in `<mark>` elements, adding classes,
 * etc.) — critical for this reader specifically, since the whole
 * pagination/CFI architecture depends on the content DOM staying exactly
 * as authored (see the pagination design notes: "DOM stays fully linear
 * underneath, visual pagination is a transform"). The Custom Highlight
 * API applies purely presentational styling to arbitrary `Range`s without
 * touching the DOM tree at all, so it composes cleanly with everything
 * else that already depends on an untouched content document.
 *
 * Each style gets its own named highlight (`ambra-highlight-<style>`) —
 * `ReaderController` groups a spine item's highlights by style and calls
 * `(iframeWindow).CSS.highlights.set(name, new Highlight(...ranges))` for
 * each group. This class only owns the *style definitions* (the CSS
 * `::highlight()` rules, injected into every reflowable content document
 * the same way `ReadingTheme.CSS` is) and the shared naming convention —
 * it has no DOM/Range-manipulation code of its own, since that's
 * necessarily called from wherever a `Document`/`Range` is actually
 * available (`ReaderController`).
 *
 * Where two or more differently-colored highlights overlap the same
 * text (issue #113), the CSS Custom Highlight API itself has no notion
 * of blending: per spec, an overlapping `background-color` is a plain
 * "highest-priority wins" conflict, not a composite of both — so
 * `HighlightOverlap` (in `apps/extension`, where the actual `Range`
 * overlap detection happens) resolves each overlapping combination to
 * one of `BLEND_COMBINATIONS`' own precomputed, *already-averaged*
 * flat colors instead, registered under `blendHighlightName`'s name —
 * an ordinary, non-overlapping highlight from the CSS/rendering side's
 * point of view, just with a color computed from more than one style.
 */
export class HighlightTheme {
  public static readonly STYLES: Record<HighlightStyle, HighlightStyleOption> = {
    yellow: { label: "Yellow", swatch: "#fdf1a8" },
    green: { label: "Green", swatch: "#c8ecc9" },
    blue: { label: "Blue", swatch: "#c3e2f7" },
    pink: { label: "Pink", swatch: "#f9d3e3" },
    purple: { label: "Purple", swatch: "#e3d5f5" },
    underline: { label: "Underline", swatch: "#8a8a8a" },
  };

  /** The fixed display order every color-swatch picker shows these
   * styles in — both the "new selection" picker (`SelectionToolbar`)
   * and the "change an existing highlight's color" one
   * (`HighlightActionPopup`, issue #79) share this single order rather
   * than each hard-coding their own copy, so the two pickers can never
   * silently drift out of sync with each other. */
  public static readonly STYLE_ORDER: readonly HighlightStyle[] = [
    "yellow",
    "green",
    "blue",
    "pink",
    "purple",
    "underline",
  ];

  /** The `::highlight()` name for `style` — shared by the CSS this class
   * injects and whatever code populates `CSS.highlights` with that
   * style's ranges, so the two always agree without either hard-coding
   * the other's naming scheme. */
  public static highlightName(style: HighlightStyle): string {
    return `ambra-highlight-${style}`;
  }

  /** The subset of `HighlightStyle` that actually paints a background —
   * every style except `"underline"` — for a caller (`HighlightOverlap`,
   * issue #113) that needs to know which overlapping styles are even
   * eligible to blend together, as opposed to `"underline"`, which
   * composes with any background instead of conflicting with it. */
  public static readonly BACKGROUND_STYLES: readonly Exclude<HighlightStyle, "underline">[] = BACKGROUND_STYLES;

  /** Every combination of 2+ background styles this theme has a
   * precomputed blended color/highlight name for (issue #113) — sorted
   * smallest-combination-first purely for a stable, readable `CSS`
   * output order; `HighlightOverlap`'s own lookup doesn't depend on
   * this order, only on `blendKey`/`blendHighlightName` agreeing with
   * each other for the same style set. */
  public static readonly BLEND_COMBINATIONS: readonly (readonly Exclude<HighlightStyle, "underline">[])[] =
    blendCombinations().sort((a, b) => a.length - b.length || blendKey(a).localeCompare(blendKey(b)));

  /** The `::highlight()` name for a specific *combination* of 2+
   * overlapping background styles (issue #113) — order-independent
   * (see `blendKey`), so a caller doesn't need to have discovered an
   * overlap's constituent styles in any particular order. Only
   * meaningful for combinations `BLEND_COMBINATIONS` actually has a
   * precomputed color for (2–5 of the 5 background styles); passing
   * anything else is a caller bug, not a runtime condition to handle
   * gracefully. */
  public static blendHighlightName(styles: readonly Exclude<HighlightStyle, "underline">[]): string {
    return `ambra-highlight-blend-${blendKey(styles)}`;
  }

  /** The `::highlight()` name for the live "you searched for this"
   * on-screen spotlight (`ReaderController.applySearchHighlightToCurrentHost`,
   * issue #100) — deliberately not one of the reader-selectable
   * `HighlightStyle`s above (nothing painted under this name is ever
   * saved; it's a transient, in-session visual aid recomputed from
   * whatever the Search panel's query currently is), but registered
   * through this same CSS Custom Highlight mechanism since it's applied
   * to a document identically (`CSS.highlights.set`/`.delete`). */
  public static readonly SEARCH_MATCH_HIGHLIGHT_NAME = "ambra-search-match";

  /** The `::highlight()` name for "this is the specific highlight whose
   * popup is currently open," for `style` specifically (issue #113's
   * follow-up: clicking a highlight — especially one that's part of a
   * blended overlap — gave no visual indication of *which* one was
   * selected; a first attempt used one single fixed cyan for every
   * style, which lost the highlight's own original color entirely).
   * Like `SEARCH_MATCH_HIGHLIGHT_NAME`, never saved — recomputed from
   * whichever highlight `ReaderController.activeHighlight` currently
   * points at, using *that highlight's own* style, and cleared the
   * instant its popup closes. Per-style (not one shared name) so the
   * emphasis stays visibly related to the color the reader actually
   * chose for it — see `CSS` for how each style's own vivid variant is
   * derived. */
  public static activeHighlightName(style: HighlightStyle): string {
    return `ambra-highlight-active-${style}`;
  }

  /** A soft glow/halo around each glyph — two stacked, *blurred*
   * `text-shadow` layers (a tight, brighter inner glow plus a softer,
   * wider outer fade), in a light, near-white tone rather than dark
   * ink: a shadow anywhere close to the text's own `#1a1a1a` color sits
   * right at each glyph's anti-aliased edge and reads as the letters
   * themselves gone soft/blurry, not a separate outline around them —
   * a light color against the vivid (but not pure-white) backgrounds
   * below reads as a distinct halo instead, leaving the actual black
   * glyph fill visually untouched. `::highlight()` supports no
   * `border`/`outline`/`box-shadow` at all (only `color`,
   * `background-color`, `text-decoration`, `text-shadow`, and the
   * `-webkit-text-stroke-*` trio, which — like `text-decoration` — also
   * changes the glyph's own rendered shape, not just its surroundings),
   * so a blurred `text-shadow` halo is the closest approximation
   * available to "a light box around the text" rather than a true
   * rectangular border. Shared by every one of `activeHighlightName`'s
   * per-style rules as a second, non-color cue for which highlight is
   * currently selected (issue #113's follow-up) — a colorblind reader
   * who can't reliably distinguish a highlight's vivid "active" shade
   * from its own ordinary one still sees this shape-based halo
   * regardless. */
  private static readonly ACTIVE_HIGHLIGHT_OUTLINE =
    "0 0 1.5px rgba(255, 255, 255, 0.9), 0 0 4px rgba(255, 255, 255, 0.6)";

  /** The stylesheet defining every style's `::highlight()` appearance —
   * injected once per reflowable content document (see
   * `ContentDocumentAssembler`), the same way `ReadingTheme.CSS` is.
   * Colors are deliberately soft/pastel backgrounds, with a fixed dark
   * ink `color` applied on top (not "normal text color preserved" — see
   * below for why that changed) — closer to a marker over already-
   * printed text than an inverted text-selection highlight, since these
   * need to stay comfortably readable indefinitely, not just for the
   * moment of a transient selection. `underline` uses no background at
   * all, just a solid underline in a neutral ink color — closer to a
   * pencil annotation than a marker, and so leaves the theme's own text
   * color untouched (there's no background here for any fixed color to
   * protect against).
   *
   * The fixed `color: #1a1a1a` on the background styles is a deliberate
   * fix, not the original design: these swatches are always a *light*
   * pastel regardless of the reader's current page theme (see
   * `ReadingTheme.PAGE_THEMES`), but "Dark" theme's own foreground text
   * color is a *light* off-white (`#e8e6e1`) — leaving that as-is over a
   * light-yellow/green/etc. background measured at roughly 1:1 contrast,
   * i.e. essentially invisible, nowhere near WCAG AA's 4.5:1 minimum.
   * `#1a1a1a` (the same ink "White" theme already uses) comfortably
   * clears 12:1+ against every one of these swatches, so a highlighted
   * passage stays legible no matter which page theme is active.
   *
   * The trailing `BLEND_COMBINATIONS` rules (issue #113) follow the same
   * `color: #1a1a1a` treatment, using `averageHexColors` to precompute
   * each combination's own flat-averaged background at module load
   * rather than at render time — a fixed, small (26-rule) addition to
   * this stylesheet, not a per-book/per-highlight-set cost.
   *
   * The `SEARCH_MATCH_HIGHLIGHT_NAME` rule uses a saturated amber rather
   * than any of the soft pastels above — deliberately, so "here's what
   * you searched for" never gets mistaken for one of the reader's own
   * saved highlights sharing the same page.
   *
   * The trailing `activeHighlightName` rules (issue #113's follow-up)
   * give each style its own bolder, more saturated `vividVariant` of
   * its *own* swatch, plus `ACTIVE_HIGHLIGHT_OUTLINE`'s light boxy
   * outline as a second, non-color cue — so "the one you clicked" stays
   * visibly related to the color the reader actually chose, rather
   * than replaced by some unrelated marker color, while still reading
   * clearly as emphasized (via the outline, plus a background/
   * decoration bold enough to stand out from an ordinary or blended
   * highlight) even for a reader who can't reliably tell the two shades
   * of the same hue apart. `"underline"` has no background to
   * intensify, so its own active variant instead thickens the
   * underline itself (bold ink, not a brightened swatch — there's
   * nothing to brighten) and relies on the outline for the rest.
   * Whoever applies one of these (`HighlightRenderer`) is responsible
   * for giving its `Highlight.priority` the highest value in play, so
   * it always wins over whatever plain or blended color already
   * occupies the same span — the whole point is to override that, not
   * compete with it on equal footing. */
  public static readonly CSS =
    (Object.keys(HighlightTheme.STYLES) as HighlightStyle[])
      .map((style) => {
        const name = HighlightTheme.highlightName(style);
        if (style === "underline") {
          return `::highlight(${name}) { text-decoration: underline; text-decoration-color: ${HighlightTheme.STYLES[style].swatch}; text-decoration-thickness: 2px; text-underline-offset: 3px; }`;
        }
        return `::highlight(${name}) { background-color: ${HighlightTheme.STYLES[style].swatch}; color: #1a1a1a; }`;
      })
      .join("\n") +
    "\n" +
    HighlightTheme.BLEND_COMBINATIONS.map((styles) => {
      const name = HighlightTheme.blendHighlightName(styles);
      const color = averageHexColors(styles.map((style) => HighlightTheme.STYLES[style].swatch));
      return `::highlight(${name}) { background-color: ${color}; color: #1a1a1a; }`;
    }).join("\n") +
    `\n::highlight(${HighlightTheme.SEARCH_MATCH_HIGHLIGHT_NAME}) { background-color: #ffb020; color: #1a1a1a; }` +
    "\n" +
    (Object.keys(HighlightTheme.STYLES) as HighlightStyle[])
      .map((style) => {
        const name = HighlightTheme.activeHighlightName(style);
        if (style === "underline") {
          return `::highlight(${name}) { text-decoration: underline; text-decoration-color: #1a1a1a; text-decoration-thickness: 4px; text-underline-offset: 3px; text-shadow: ${HighlightTheme.ACTIVE_HIGHLIGHT_OUTLINE}; }`;
        }
        const vivid = vividVariant(HighlightTheme.STYLES[style].swatch);
        return `::highlight(${name}) { background-color: ${vivid}; color: #1a1a1a; text-shadow: ${HighlightTheme.ACTIVE_HIGHLIGHT_OUTLINE}; }`;
      })
      .join("\n");
}

