import type { Chunk } from "./LineMeasurement.js";
import { measureChunks } from "./LineMeasurement.js";
import type { DomBreakPoint } from "./Page.js";
import { Page } from "./Page.js";

/**
 * Plans page boundaries from an ordered list of measured `Chunk`s (one
 * per visual line of text, or one per atomic element — see
 * `LineMeasurement.measureChunks`). Deliberately a pure function over
 * already-measured data, with no dependency on real layout/rendering
 * itself, so the actual page-break *decision* logic (as opposed to line
 * measurement, which does need a real browser) is fully unit-testable.
 *
 * The rule: accumulate chunks onto the current page while they fit within
 * `pageHeight`; when the next chunk wouldn't fit, close the current page
 * and start a new one at that chunk — *unless* the current page is still
 * empty, in which case the chunk is placed anyway and allowed to
 * overflow (this is what gives an oversized atomic element, e.g. an
 * image taller than a full page, its own page rather than being
 * cropped/scaled — see the `pagination-engine` design discussion).
 */
export function planPageBreaks(
  chunks: readonly Chunk[],
  pageHeight: number,
  endOfDocument: DomBreakPoint,
): Page[] {
  if (chunks.length === 0) {
    return [];
  }

  const pages: Page[] = [];
  let pageStartTop = chunks[0]!.top;
  let pageStartBreak: DomBreakPoint = chunks[0]!.breakBefore;
  let pageBottom = chunks[0]!.top;
  let chunksOnCurrentPage = 0;

  for (const chunk of chunks) {
    const wouldBeHeight = chunk.bottom - pageStartTop;
    if (wouldBeHeight > pageHeight && chunksOnCurrentPage > 0) {
      pages.push(new Page(pages.length, pageStartBreak, chunk.breakBefore, pageStartTop, pageBottom));
      pageStartTop = chunk.top;
      pageStartBreak = chunk.breakBefore;
      chunksOnCurrentPage = 0;
    }
    pageBottom = chunk.bottom;
    chunksOnCurrentPage++;
  }

  pages.push(new Page(pages.length, pageStartBreak, endOfDocument, pageStartTop, pageBottom));
  return pages;
}

/**
 * Paginates a content document's `<body>` for reflowable content: measures
 * its rendered lines/atomic elements (`LineMeasurement.measureChunks`,
 * which requires `bodyElement` to already be laid out by a real browser
 * rendering engine) and plans page boundaries over them (`planPageBreaks`).
 * The underlying DOM is never modified — pagination is purely a
 * description of how to visually present the existing linear content (see
 * `Page.displayTranslateY`), consistent with keeping the DOM linear for
 * accessibility at all times.
 */
export class PaginationEngine {
  public static paginate(bodyElement: Element, pageHeight: number): Page[] {
    const chunks = measureChunks(bodyElement);
    const endOfDocument: DomBreakPoint = {
      node: bodyElement,
      offset: bodyElement.childNodes.length,
    };
    return planPageBreaks(chunks, pageHeight, endOfDocument);
  }

  /** Finds the page whose `[startBreak, endBreak)` range contains
   * `(node, offset)` — the core of the resize/font-change flow: re-run
   * `paginate` at the new dimensions, resolve the preserved `Locator` to a
   * DOM position via `LocatorResolver`, then call this to find which new
   * page to display. Returns the last page if no page's range contains
   * the position exactly (e.g. a position right at the very end of the
   * document), since a page's `endBreak` is an exclusive boundary. */
  public static findPageForPosition(
    pages: readonly Page[],
    node: Node,
    offset: number,
    ownerDocument: Document,
  ): Page | undefined {
    for (const page of pages) {
      if (page.containsPosition(node, offset, ownerDocument)) {
        return page;
      }
    }
    return pages[pages.length - 1];
  }
}
