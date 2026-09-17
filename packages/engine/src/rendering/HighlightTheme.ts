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

  /** The `::highlight()` name for `style` — shared by the CSS this class
   * injects and whatever code populates `CSS.highlights` with that
   * style's ranges, so the two always agree without either hard-coding
   * the other's naming scheme. */
  public static highlightName(style: HighlightStyle): string {
    return `ambra-highlight-${style}`;
  }

  /** The stylesheet defining every style's `::highlight()` appearance —
   * injected once per reflowable content document (see
   * `ContentDocumentAssembler`), the same way `ReadingTheme.CSS` is.
   * Colors are deliberately soft/pastel backgrounds with normal text
   * color preserved (unlike a text selection's default inverted
   * colors), since these need to stay comfortably readable indefinitely,
   * not just for the moment of a transient selection. `underline` uses
   * no background at all, just a solid underline in a neutral ink color
   * — closer to a pencil annotation than a marker. */
  public static readonly CSS = (Object.keys(HighlightTheme.STYLES) as HighlightStyle[])
    .map((style) => {
      const name = HighlightTheme.highlightName(style);
      if (style === "underline") {
        return `::highlight(${name}) { text-decoration: underline; text-decoration-color: ${HighlightTheme.STYLES[style].swatch}; text-decoration-thickness: 2px; text-underline-offset: 3px; }`;
      }
      return `::highlight(${name}) { background-color: ${HighlightTheme.STYLES[style].swatch}; }`;
    })
    .join("\n");
}
