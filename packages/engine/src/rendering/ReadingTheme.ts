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
 * Font size, font family, and page color theme are all expressed as CSS
 * custom properties rather than fixed values, so reader-controlled
 * settings (font scale, font family, page theme) can be applied live —
 * via `ReadingTheme.applyFontScale`/`applyFontFamily`/`applyPageTheme` —
 * without re-injecting or reloading the stylesheet. Font scale/family
 * changes reflow content (the caller must re-paginate/re-measure
 * afterwards, the same way a window resize does); a page theme change
 * never does, since colors don't affect line-wrapping.
 */
/** The three page color themes the reader can choose between (see
 * `ReadingTheme.applyPageTheme`) — deliberately a short, curated list
 * rather than a full color picker: a plain white default (the least
 * "designed-feeling" choice, and the most neutral starting point), the
 * original warm sepia this reader shipped with, and a low-contrast dark
 * theme for reading in low light. */
export type PageTheme = "white" | "sepia" | "dark";

interface PageThemeColors {
  readonly label: string;
  readonly background: string;
  readonly foreground: string;
  readonly linkColor: string;
}

/** The curated, widely-available system font stacks the reader can
 * choose between (see `ReadingTheme.applyFontFamily`), plus `"book-default"`
 * — which doesn't merely pick a *different* stack, it removes our
 * font-family override entirely (`unset`, which for an inherited property
 * like `font-family` falls through to the browser's own default), so a
 * book that supplies no typography of its own reads in the platform's
 * bare default font instead of any of our choices. Deliberately all
 * locally-installed system fonts, never a web font — the CSP this reader
 * injects (see `ContentDocumentAssembler`) only allows `font-src blob:`,
 * so a remotely-hosted font couldn't load even if we wanted one, and
 * bundling font files would cut against minimizing what we ship and own
 * ourselves. */
export type FontFamilyChoice = "georgia" | "palatino" | "times" | "sans" | "sitka" | "book-default";

interface FontFamilyOption {
  readonly label: string;
  /** The CSS `font-family` value, or `undefined` for `"book-default"`,
   * which sets the custom property to the literal keyword `unset`
   * instead of a stack (see `applyFontFamily`). */
  readonly stack: string | undefined;
}

/** Picks the best default reading font for `platformString` (typically
 * `navigator.userAgentData.platform`, falling back to `navigator.platform`/
 * `navigator.userAgent` — see `detectPlatformString`, kept separate from
 * this pure decision so the decision itself is unit-testable without a
 * real `navigator`). Real Palatino ships with macOS/iOS; Windows doesn't
 * have it, but does ship Sitka — Microsoft's own purpose-built reading
 * serif, a meaningfully better default there than "Palatino Linotype"
 * (an older, lower-quality Palatino-alike Windows also happens to have,
 * and which the `palatino` stack below already falls back to on its own
 * if a reader picks it manually anyway). Every other platform (Android,
 * Linux, ChromeOS, or detection failing outright) defaults to Palatino
 * too, per explicit instruction — its own stack already degrades
 * gracefully to a generic serif everywhere it isn't actually installed. */
export function defaultFontFamilyForPlatform(platformString: string): FontFamilyChoice {
  return /win/i.test(platformString) ? "sitka" : "palatino";
}

/** A minimal shape for the User-Agent Client Hints API's `platform`
 * field (`navigator.userAgentData`) — not yet in TypeScript's built-in
 * DOM lib, and only ever present in Chrome (which is this reader's only
 * target), so declared locally rather than pulling in a whole extra
 * `@types` package for one field. */
interface NavigatorUserAgentData {
  readonly platform: string;
}

/** Reads whatever OS-identifying string is available from `navigator` —
 * User-Agent Client Hints' own `platform` first (the modern, most
 * direct signal, Chrome-only but that's this reader's whole target),
 * falling back to the older, deprecated-but-still-populated
 * `navigator.platform`, then `navigator.userAgent` itself as a last
 * resort. Returns `""` outside a browser (e.g. this module loading in a
 * Node-based test) rather than throwing — `defaultFontFamilyForPlatform`
 * already treats an unrecognized string as "default to Palatino." */
function detectPlatformString(): string {
  if (typeof navigator === "undefined") {
    return "";
  }
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUserAgentData }).userAgentData;
  return uaData?.platform || navigator.platform || navigator.userAgent || "";
}

export class ReadingTheme {
  /** The CSS custom property `applyFontScale` writes to and the theme's
   * own base font-size reads from. */
  public static readonly FONT_SCALE_PROPERTY = "--ambra-font-scale";
  public static readonly FONT_FAMILY_PROPERTY = "--ambra-font-family";
  public static readonly PAGE_BACKGROUND_PROPERTY = "--ambra-page-bg";
  public static readonly PAGE_FOREGROUND_PROPERTY = "--ambra-page-fg";
  public static readonly LINK_COLOR_PROPERTY = "--ambra-link-color";
  /** The vertical budget (in CSS px) available for one paginated page's
   * content — see `EPUB_CSS_RESET`'s `img, svg` rule, which caps images
   * to this height (falling back to `none` when unset, e.g. in scroll or
   * fixed-layout modes, where no single "page height" exists/applies).
   * Set by `PaginatedContentHost` before every pagination pass, from the
   * exact same budget it passes to `PaginationEngine.paginate` — so an
   * oversized image is scaled down to actually fit a page *before*
   * pagination ever measures it, rather than pagination giving it an
   * oversized page of its own to avoid cropping it (which is still the
   * fallback for other, non-image atomic content too tall to shrink,
   * e.g. a giant table). */
  public static readonly PAGE_CONTENT_HEIGHT_PROPERTY = "--ambra-page-content-height";

  public static readonly MIN_FONT_SCALE = 0.75;
  public static readonly MAX_FONT_SCALE = 2;
  public static readonly FONT_SCALE_STEP = 0.125;

  public static readonly DEFAULT_PAGE_THEME: PageTheme = "white";
  /** The reading font a brand-new reader (or a book with no saved font
   * preference) starts with — OS-appropriate rather than one fixed
   * choice for everyone, see `defaultFontFamilyForPlatform`. */
  public static readonly DEFAULT_FONT_FAMILY: FontFamilyChoice = defaultFontFamilyForPlatform(detectPlatformString());

  public static readonly PAGE_THEMES: Readonly<Record<PageTheme, PageThemeColors>> = {
    white: { label: "White", background: "#ffffff", foreground: "#1a1a1a", linkColor: "#0b57a4" },
    sepia: { label: "Sepia", background: "#faf7f1", foreground: "#232019", linkColor: "#2a5db0" },
    dark: { label: "Dark", background: "#232323", foreground: "#e8e6e1", linkColor: "#8ab4f8" },
  };

  public static readonly FONT_FAMILIES: Readonly<Record<FontFamilyChoice, FontFamilyOption>> = {
    georgia: {
      label: "Georgia",
      stack: `Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", serif`,
    },
    palatino: {
      label: "Palatino",
      stack: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`,
    },
    times: {
      label: "Times",
      stack: `"Times New Roman", Times, Georgia, serif`,
    },
    sitka: {
      label: "Sitka",
      stack: `"Sitka Text", "Sitka Small", Cambria, Georgia, serif`,
    },
    sans: {
      label: "Sans-Serif",
      stack: `"Avenir Next", "Century Gothic", "Segoe UI", "Helvetica Neue", Arial, sans-serif`,
    },
    "book-default": {
      label: "Book Default",
      stack: undefined,
    },
  };

  /** Vertical whitespace (in CSS px) reserved above and below the text on
   * every paginated page — see `PaginatedContentHost`, the only content
   * host that needs this as a JS-level value (scroll mode gets its
   * breathing room from normal document flow; a fixed-layout page has no
   * pagination at all). The top inset must always be tall enough that
   * the toolbar overlay (see `Toolbar`/`chromeTheme`, typically ~41px
   * tall) never covers the first line of text even while visible — only
   * the running header (book/chapter title — see `PageFurniture`) is
   * meant to sit underneath the toolbar and get covered by it. The
   * bottom inset needs enough room that the running footer (page number/
   * percent) reads as clearly *below* the last line of text, not
   * crowding it. Kept here, next to the rest of the theme, so the "how
   * much air is around the text" decision lives in one place. */
  public static readonly PAGE_INSET_TOP = 88;
  public static readonly PAGE_INSET_BOTTOM = 76;

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

  /** Sets the current font family on a content document. Like
   * `applyFontScale`, this reflows content (a different typeface has
   * different metrics), so the caller must re-paginate/re-measure
   * afterwards. `"book-default"` sets the property to the literal
   * keyword `unset` rather than a stack — for an inherited property like
   * `font-family`, that falls through to whatever the browser's own
   * default is, letting a book that declares no typography of its own
   * render in the platform default instead of any of our choices. */
  public static applyFontFamily(doc: Document, choice: FontFamilyChoice): void {
    const option = ReadingTheme.FONT_FAMILIES[choice];
    doc.documentElement.style.setProperty(ReadingTheme.FONT_FAMILY_PROPERTY, option.stack ?? "unset");
  }

  /** Sets the current page color theme (background/foreground/link
   * colors) on a content document. Unlike font scale/family, this never
   * needs a re-paginate/re-measure — colors don't affect line-wrapping. */
  public static applyPageTheme(doc: Document, theme: PageTheme): void {
    const colors = ReadingTheme.PAGE_THEMES[theme];
    const style = doc.documentElement.style;
    style.setProperty(ReadingTheme.PAGE_BACKGROUND_PROPERTY, colors.background);
    style.setProperty(ReadingTheme.PAGE_FOREGROUND_PROPERTY, colors.foreground);
    style.setProperty(ReadingTheme.LINK_COLOR_PROPERTY, colors.linkColor);
  }

  /** Sets the vertical budget available for one paginated page's content
   * on a content document, so `EPUB_CSS_RESET`'s `img, svg` rule can cap
   * oversized images to actually fit a page — see
   * `PAGE_CONTENT_HEIGHT_PROPERTY`'s doc comment. Must be called (with
   * the same `pageHeight` about to be passed to
   * `PaginationEngine.paginate`) *before* that pagination pass, not
   * after, so an oversized image is already shrunk by the time
   * measurement sees it. `undefined` clears the property (setting it
   * back to unset/`none`) — for content hosts that don't paginate at
   * all (scroll mode, fixed-layout). */
  public static applyPageContentHeight(doc: Document, pageHeight: number | undefined): void {
    if (pageHeight === undefined) {
      doc.documentElement.style.removeProperty(ReadingTheme.PAGE_CONTENT_HEIGHT_PROPERTY);
      return;
    }
    doc.documentElement.style.setProperty(ReadingTheme.PAGE_CONTENT_HEIGHT_PROPERTY, `${pageHeight}px`);
  }

  /**
   * The theme stylesheet itself. Deliberate choices, aiming for "Apple
   * Books, not a browser tab":
   * - A serif body typeface from a widely-available system stack (no
   *   embedded/web font — consistent with minimizing our footprint of
   *   anything that isn't ours, and this reads beautifully on every
   *   platform Chrome runs on without a network fetch) — reader-
   *   selectable, see `FontFamilyChoice`.
   * - A restrained content measure (~34em, roughly 65-75 characters per
   *   line at the base size) centered in the available width, rather than
   *   letting text stretch edge-to-edge — the single highest-leverage
   *   change for making a page look like a book instead of a web page.
   * - A plain white page by default, with reader-selectable warm-sepia
   *   and low-light dark alternatives — see `PageTheme`.
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
  ${ReadingTheme.FONT_FAMILY_PROPERTY}: ${ReadingTheme.FONT_FAMILIES[ReadingTheme.DEFAULT_FONT_FAMILY].stack};
  ${ReadingTheme.PAGE_BACKGROUND_PROPERTY}: ${ReadingTheme.PAGE_THEMES[ReadingTheme.DEFAULT_PAGE_THEME].background};
  ${ReadingTheme.PAGE_FOREGROUND_PROPERTY}: ${ReadingTheme.PAGE_THEMES[ReadingTheme.DEFAULT_PAGE_THEME].foreground};
  ${ReadingTheme.LINK_COLOR_PROPERTY}: ${ReadingTheme.PAGE_THEMES[ReadingTheme.DEFAULT_PAGE_THEME].linkColor};
}

html {
  font-size: calc(1em * var(${ReadingTheme.FONT_SCALE_PROPERTY}, 1));
}

html, body {
  background: var(${ReadingTheme.PAGE_BACKGROUND_PROPERTY});
  color: var(${ReadingTheme.PAGE_FOREGROUND_PROPERTY});
}

body {
  box-sizing: border-box;
  max-width: 34em;
  margin: 0 auto;
  padding: 0 1.5em;
  font-family: var(${ReadingTheme.FONT_FAMILY_PROPERTY});
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
  color: var(${ReadingTheme.LINK_COLOR_PROPERTY});
}
`.trim();
}
