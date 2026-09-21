/**
 * The base stylesheet applied to every content document rendered into the
 * sandboxed content host, *before* the book's own CSS. It is injected as
 * the first `<style>` in `<head>` (immediately after the CSP `<meta>`), so
 * ordinary CSS cascade/source-order rules mean any rule the book's own
 * stylesheets declare for the same selector naturally wins — this is a
 * reset to build on, not a lock-in.
 *
 * Every rule here exists for one of two reasons:
 * 1. **Pagination correctness** — the custom pagination engine measures
 *    and fragments content assuming a predictable box model. Without
 *    this, book-authored `margin`/`padding`/`box-sizing` variance (or its
 *    absence) would make break-point math unreliable across books.
 * 2. **Baseline safety** — real-world EPUBs vary wildly in the CSS they
 *    do/don't include; a few defensive rules (image scaling, table
 *    overflow) keep a book from visually breaking out of its page/frame
 *    even when its own CSS doesn't anticipate our rendering surface.
 *
 * This is deliberately *not* a full typographic theme (font family, size,
 * line-height, color/background) — those are reader-controlled display
 * settings (wave 2: font/theme customization) applied at a different
 * layer, layered on top of this reset rather than baked into it.
 */
import { ReadingTheme } from "./ReadingTheme.js";

export const EPUB_CSS_RESET = `
/* Predictable box model: every element's declared width/height includes
   its padding and border, so layout measurement doesn't need to add them
   back in separately. */
*, *::before, *::after {
  box-sizing: border-box;
}

/* The root element must never scroll independently or add implicit
   margin — the pagination engine (and, for scroll mode, the browser's own
   scroll container) owns scrolling and box sizing for content, not the
   document's own html/body box. */
html, body {
  margin: 0;
  padding: 0;
}

/* Images/SVG must never overflow their container's width — a common
   real-world EPUB authoring gap for images with fixed pixel dimensions
   embedded in reflowable content. Height auto preserves aspect ratio.
   The max-height cap keeps a tall image (e.g. a full-bleed title-page
   illustration) from overflowing one paginated page's height too —
   the custom property is set by PaginatedContentHost to that exact
   budget before every pagination pass (see
   ReadingTheme.applyPageContentHeight), and simply falls back to
   "none" wherever it isn't relevant/set (scroll mode, fixed-layout). */
img, svg {
  max-width: 100%;
  height: auto;
  max-height: var(${ReadingTheme.PAGE_CONTENT_HEIGHT_PROPERTY}, none);
}

/* Long unbroken strings (URLs) and wide tables are the most common
   real-world causes of horizontal overflow in reflowable content; breaking
   them keeps pagination's column/page width assumptions intact. Applies to
   *inline* \`code\` spans (short tokens like a class or file name, where
   wrapping mid-line reads fine) but is deliberately overridden below for
   \`pre\` blocks specifically. Not \`!important\` — an inline code span's
   own wrapping is a cosmetic nicety a book's own CSS is free to override,
   unlike \`pre\`'s rule below, which guards actual pagination/overflow
   correctness. */
code {
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

/* \`pre\` blocks (multi-line code/markup samples) are a different case, and
   one of the very few rules in this whole reset that needs \`!important\`:
   real-world examples are typically indented several levels deep (nested
   XML/JSON/code), and naively word-wrapping a too-wide line the way plain
   prose or an inline \`code\` span does throws away that indentation for
   just the wrapped remainder, which lands flush at the block's left edge
   with no visual relationship to the line it continues — for a deeply
   nested example, this reads as scrambled rather than merely re-flowed
   (confirmed against a real book, an O'Reilly EPUB3 accessibility guide
   whose own nested \`<nav>\`/\`<a>\` markup samples exceed a narrow spread
   column's width). Real reading systems and code-hosting sites handle
   this the same way: preserve the example's own formatting exactly
   (\`white-space: pre\`, no wrapping at all) and let a too-wide line
   overflow into its own horizontally-scrollable region instead, which
   keeps every line's indentation intact and never pushes the *page's*
   own width/pagination math off (\`overflow-x\` clips to the block's own
   box, it doesn't grow it).

   \`!important\` is required here specifically because that same real
   book's own stylesheet declares \`pre { white-space: pre-wrap; }\`
   itself (a common, entirely reasonable thing for a book to author,
   presumably tested against reading systems that don't otherwise handle
   overflow) — under this file's usual "reset, not lock-in" cascade
   (see the top-of-file doc comment), that book rule would simply win,
   silently reintroducing the exact scrambled wrapping this rule exists
   to prevent. Unlike nearly everything else in this file, this one genuinely
   needs to always win, the same way the pagination engine's own box-model
   assumptions above always must. \`PaginatedContentHost\`/\`ScrollContentHost\`
   additionally make any \`pre\` that ends up actually overflowing
   keyboard-focusable (\`tabindex="0"\`, see \`PreOverflowFocusability\`) so a
   sighted keyboard user (unlike a screen reader, entirely unaffected
   either way — it reads the underlying text in DOM order regardless of
   visual wrapping) can still reach and scroll it. */
pre {
  white-space: pre !important;
  overflow-x: auto !important;
}

/* A \`<pre><code>\` pairing (the common "code block" authoring pattern) is
   one visual block, not two independently-wrapping ones — the inner
   \`code\` must inherit \`pre\`'s own no-wrap/scroll behavior above, not its
   own separate inline-wrapping rule. Same \`!important\` reasoning as
   \`pre\` itself: a book's own \`code\` rule (very plausibly present, given
   its \`pre\` rule above) would otherwise re-enable wrapping on exactly
   the element this is meant to stop it on. */
pre code {
  white-space: inherit !important;
  overflow-wrap: normal !important;
}

table {
  max-width: 100%;
}
`.trim();
