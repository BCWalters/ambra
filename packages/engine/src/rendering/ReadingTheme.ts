/**
 * The reader's typographic theme: the "book-like" layer that sits on top
 * of `EPUB_CSS_RESET` (which is deliberately reset-only — see its own
 * doc comment) and turns a book's content into something that looks and
 * feels like a premium reading surface, not a raw web page. Applied to
 * reflowable spine items only (paginated and scroll mode both share it,
 * since both render the exact same linear DOM) — never to fixed-layout
 * spine items, whose own CSS defines an intentional, pixel-precise page
 * design that this theme must not interfere with. See
 * `ContentDocumentAssembler.assemble`'s `applyReadingTheme` option.
 *
 * Injected as a second `<style>` element immediately after the CSS reset
 * (same cascade position/reasoning: after the CSP `<meta>`, before the
 * book's own `<head>` content), so a book's own typography choices still
 * win the cascade wherever it makes deliberate ones — this is a set of
 * good defaults to read *unstyled* reflowable content beautifully, not a
 * forced override.
 *
 * Font size is expressed as `calc(1em * var(--pagina-font-scale, 1))` on
 * the root element rather than a fixed constant, so a reader-controlled
 * font-size setting (the `toolbar-redesign` work) can rescale text live —
 * via `ReadingTheme.applyFontScale` — without re-injecting or reloading
 * the stylesheet; the caller is still responsible for re-paginating/
 * re-measuring afterwards, since a font-size change reflows content the
 * same way a window resize does.
 */
export class ReadingTheme {
  /** The CSS custom property `applyFontScale` writes to and the theme's
   * own base font-size reads from. */
  public static readonly FONT_SCALE_PROPERTY = "--pagina-font-scale";

  public static readonly MIN_FONT_SCALE = 0.75;
  public static readonly MAX_FONT_SCALE = 2;
  public static readonly FONT_SCALE_STEP = 0.125;

  /** Vertical whitespace (in CSS px) reserved above and below the text on
   * every paginated page — see `PaginatedContentHost`, the only content
   * host that needs this as a JS-level value (scroll mode gets its
   * breathing room from normal document flow; a fixed-layout page has no
   * pagination at all). Kept here, next to the rest of the theme, so the
   * "how much air is around the text" decision lives in one place. */
  public static readonly PAGE_INSET_TOP = 56;
  public static readonly PAGE_INSET_BOTTOM = 40;

  /** Sets the current font-scale multiplier on a content document,
   * clamped to `[MIN_FONT_SCALE, MAX_FONT_SCALE]`. Purely a style change —
   * the caller must still re-paginate/re-measure afterwards (the same way
   * `PaginatedContentHost.relayout`/`ScrollContentHost.resize` already do
   * for a window resize), since changing font size reflows content. */
  public static applyFontScale(doc: Document, scale: number): void {
    const clamped = Math.min(ReadingTheme.MAX_FONT_SCALE, Math.max(ReadingTheme.MIN_FONT_SCALE, scale));
    doc.documentElement.style.setProperty(ReadingTheme.FONT_SCALE_PROPERTY, String(clamped));
  }

  /** Reads back the current font-scale multiplier previously set by
   * `applyFontScale`, defaulting to `1` if never set. */
  public static currentFontScale(doc: Document): number {
    const raw = doc.documentElement.style.getPropertyValue(ReadingTheme.FONT_SCALE_PROPERTY);
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  /**
   * The theme stylesheet itself. Deliberate choices, aiming for "Apple
   * Books, not a browser tab":
   * - A serif body typeface from a widely-available system stack (no
   *   embedded/web font — consistent with minimizing our footprint of
   *   anything that isn't ours, and this reads beautifully on every
   *   platform Chrome runs on without a network fetch).
   * - A restrained content measure (~34em, roughly 65-75 characters per
   *   line at the base size) centered in the available width, rather than
   *   letting text stretch edge-to-edge — the single highest-leverage
   *   change for making a page look like a book instead of a web page.
   * - A warm, slightly off-white page color instead of stark white, and a
   *   soft near-black ink color instead of pure black — easier on the
   *   eyes for long reading sessions, and closer to a physical page.
   * - Justified text with hyphenation, generous line-height, and real
   *   paragraph spacing.
   *
   * All of this is easily overridden by a book's own CSS (later in
   * source order), so a book that supplies deliberate typography of its
   * own is respected — this is what fills the very common gap of
   * reflowable content that supplies little or no typographic styling of
   * its own and would otherwise fall back to the browser's bare defaults.
   */
  public static readonly CSS = `
:root {
  ${ReadingTheme.FONT_SCALE_PROPERTY}: 1;
}

html {
  font-size: calc(1em * var(${ReadingTheme.FONT_SCALE_PROPERTY}, 1));
}

html, body {
  background: #faf7f1;
  color: #232019;
}

body {
  box-sizing: border-box;
  max-width: 34em;
  margin: 0 auto;
  padding: 0 1.5em;
  font-family: Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", serif;
  font-size: 1.125rem;
  line-height: 1.65;
  text-align: justify;
  -webkit-hyphens: auto;
  hyphens: auto;
}

p {
  margin: 0 0 1em;
  text-indent: 0;
}

h1, h2, h3, h4, h5, h6 {
  font-family: inherit;
  line-height: 1.3;
  font-weight: 600;
  text-align: start;
  -webkit-hyphens: none;
  hyphens: none;
}

blockquote {
  margin: 1em 1.5em;
  font-style: italic;
}

a {
  color: #2a5db0;
}
`.trim();
}
