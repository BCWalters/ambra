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

/* Long unbroken strings (URLs, code) and wide tables are the most common
   real-world causes of horizontal overflow in reflowable content; breaking
   them keeps pagination's column/page width assumptions intact. */
pre, code {
  white-space: pre-wrap;
  word-break: break-word;
}

table {
  max-width: 100%;
}
`.trim();
