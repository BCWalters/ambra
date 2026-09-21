/** The 5 pastel highlight colors plus underline a reader can apply to a
 * text selection (see the "highlight" reading feature) — a short,
 * curated set rather than a full color picker, matching the same
 * "curated over infinite choice" philosophy as `ReadingTheme`'s page
 * themes/font families. */
export type HighlightStyle = "yellow" | "green" | "blue" | "pink" | "purple" | "underline";

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

  /** The `::highlight()` name for the live "you searched for this"
   * on-screen spotlight (`ReaderController.applySearchHighlightToCurrentHost`,
   * issue #100) — deliberately not one of the reader-selectable
   * `HighlightStyle`s above (nothing painted under this name is ever
   * saved; it's a transient, in-session visual aid recomputed from
   * whatever the Search panel's query currently is), but registered
   * through this same CSS Custom Highlight mechanism since it's applied
   * to a document identically (`CSS.highlights.set`/`.delete`). */
  public static readonly SEARCH_MATCH_HIGHLIGHT_NAME = "ambra-search-match";

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
   * The trailing `SEARCH_MATCH_HIGHLIGHT_NAME` rule uses a saturated
   * amber rather than any of the soft pastels above — deliberately, so
   * "here's what you searched for" never gets mistaken for one of the
   * reader's own saved highlights sharing the same page. */
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
    `\n::highlight(${HighlightTheme.SEARCH_MATCH_HIGHLIGHT_NAME}) { background-color: #ffb020; color: #1a1a1a; }`;
}
