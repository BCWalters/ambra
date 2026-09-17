import type { FC } from "react";
import { Caption1 } from "@fluentui/react-components";
import { ReadingTheme, SpreadPaginatedHost } from "@pagina/engine";
import type { ReaderSnapshot } from "../ReaderController.js";

export interface PageFurnitureProps {
  snapshot: ReaderSnapshot;
}

/** How far below the top of the reserved header band (`PAGE_INSET_TOP`)
 * the running header's own text sits — deliberately near the *top* of
 * that band (not vertically centered within it) so the text sits well
 * within the toolbar's own footprint when it's shown, rather than
 * peeking out just below it. Paired with the toolbar's own height (see
 * `Toolbar.tsx`) — the two are tuned together so the toolbar always
 * fully covers this text, never partially, which previously read as an
 * awkward visual glitch when the two only barely overlapped. */
const HEADER_TEXT_TOP_OFFSET = 14;

/** Rounds a page position to a whole-number percentage, or `undefined`
 * if either input isn't known yet — never `0%`/`100%` by construction
 * error (a book with 1 total page and current page 1 correctly reads
 * 100%, not division-by-zero). */
function percent(current: number | undefined, total: number | undefined): number | undefined {
  if (current === undefined || total === undefined || total <= 0) {
    return undefined;
  }
  return Math.round((current / total) * 100);
}

/**
 * The classic "print page furniture" — book title and chapter title
 * running along the top of every page, page number (and how far through
 * the book that page is) running along the bottom — rendered as an
 * ordinary React overlay in the *parent* app, not injected into the
 * sandboxed content iframe.
 *
 * This placement is deliberate, not incidental: `PaginatedContentHost`
 * applies a CSS `transform: translateY(...)` directly to the content
 * document's `<body>` to show each page (see its `showCurrentPage`), and
 * per the CSS spec, a `transform` on an ancestor creates a new containing
 * block for any `position: fixed` descendant — so a "fixed" header
 * injected inside that body would incorrectly scroll/shift along with
 * the page instead of staying put. Positioning this overlay in the
 * parent, over the exact `PAGE_INSET_TOP`/`PAGE_INSET_BOTTOM` bands
 * `PaginatedContentHost` already reserves as blank space, sidesteps that
 * entirely.
 *
 * Sits *below* the toolbar in stacking order (a lower `zIndex`) so the
 * toolbar visually covers this header whenever it's shown — exactly the
 * classic print-reader behavior of transient chrome overlaying the
 * page's own running head, not fighting with it. Text color tracks the
 * active `ReadingTheme` page theme's own foreground color, so it reads
 * correctly against white, sepia, or dark pages alike, without needing
 * its own separate light/dark variants.
 *
 * Scoped to paginated/spread reflowable content only — the same scope
 * `pageIndex`/`pageCount`/`bookPageIndex`/`bookPageCount` already have in
 * `ReaderSnapshot` (scroll mode has no discrete "page" to attach this
 * furniture to; fixed-layout content has its own complete, intentional
 * page design this must never draw on top of).
 */
export const PageFurniture: FC<PageFurnitureProps> = ({ snapshot }) => {
  if (snapshot.isFixedLayout || snapshot.viewMode !== "paginated") {
    return null;
  }

  const foreground = ReadingTheme.PAGE_THEMES[snapshot.pageTheme].foreground;
  const textStyle = {
    color: foreground,
    opacity: 0.55,
    margin: 0,
  } as const;

  // A simple "Page N" per visible page — no running total, no
  // percentage (see the standalone percentage indicator below instead).
  // The companion (right) page in spread mode is always exactly one
  // page after the primary one (`SpreadPaginatedHost.secondPageIndex`
  // is defined as `left.currentPageIndex + 1`), so its own number is
  // just the primary's plus one — no separate book-wide/chapter-relative
  // branching needed for it.
  const primaryPageNumber = snapshot.bookPageIndex ?? (snapshot.pageCount > 0 ? snapshot.pageIndex + 1 : undefined);
  const secondaryPageNumber =
    snapshot.secondPageIndex !== undefined && primaryPageNumber !== undefined ? primaryPageNumber + 1 : undefined;
  const bookPercent = percent(snapshot.bookPageIndex, snapshot.bookPageCount);

  // In spread mode, each of the two visible pages gets its own header
  // and footer band — matching how a real printed book's running head
  // and folio (page number) each belong to the specific page they sit
  // on, not to the spread as a whole. Computed once from
  // `SpreadPaginatedHost`'s own column/gutter geometry (not guessed) so
  // every band lines up exactly with the page beneath it, and shared
  // between the header and footer below rather than recomputed twice.
  const columnWidth = snapshot.isSpread ? SpreadPaginatedHost.effectiveColumnWidth(snapshot.paneWidth) : undefined;
  const sideMargin =
    columnWidth !== undefined
      ? Math.max(0, (snapshot.paneWidth - (columnWidth * 2 + SpreadPaginatedHost.GUTTER_WIDTH)) / 2)
      : undefined;
  const columnBands: { left: number | string; right: number | string; width: number | string }[] =
    columnWidth !== undefined && sideMargin !== undefined
      ? [
          { left: sideMargin, right: "auto", width: columnWidth },
          { left: "auto", right: sideMargin, width: columnWidth },
        ]
      : [{ left: 0, right: 0, width: "auto" }];
  const headerTexts = columnBands.length > 1 ? [snapshot.title, snapshot.currentChapterLabel] : undefined;
  const footerNumbers = columnBands.length > 1 ? [primaryPageNumber, secondaryPageNumber] : [primaryPageNumber];

  return (
    <>
      {headerTexts ? (
        columnBands.map((band, index) => (
          <div
            key={index}
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: band.left,
              right: band.right,
              width: band.width,
              height: ReadingTheme.PAGE_INSET_TOP,
              zIndex: 5,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              padding: `${HEADER_TEXT_TOP_OFFSET}px 20px 0`,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            <Caption1 as="span" truncate wrap={false} style={{ ...textStyle, minWidth: 0, textAlign: "center" }}>
              {headerTexts[index]}
            </Caption1>
          </div>
        ))
      ) : (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: ReadingTheme.PAGE_INSET_TOP,
            zIndex: 5,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: `${HEADER_TEXT_TOP_OFFSET}px 20px 0`,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <Caption1 as="span" truncate wrap={false} style={{ ...textStyle, minWidth: 0 }}>
            {snapshot.title}
          </Caption1>
          <Caption1 as="span" truncate wrap={false} style={{ ...textStyle, textAlign: "right", minWidth: 0 }}>
            {snapshot.currentChapterLabel}
          </Caption1>
        </div>
      )}

      {columnBands.map((band, index) => {
        const pageNumber = footerNumbers[index];
        if (pageNumber === undefined) {
          return null;
        }
        return (
          <div
            key={index}
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: 0,
              left: band.left,
              right: band.right,
              width: band.width,
              height: ReadingTheme.PAGE_INSET_BOTTOM,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <Caption1 as="span" style={textStyle}>
              {`Page ${pageNumber}`}
            </Caption1>
          </div>
        );
      })}

      {/* A single "how far through the book" indicator, anchored to the
          bottom-left of the whole reader pane — deliberately not
          per-page (unlike the "Page N" folios above), since a percentage
          describes progress through the *book*, not either individual
          page on screen right now. */}
      {bookPercent !== undefined && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: ReadingTheme.PAGE_INSET_BOTTOM,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            pointerEvents: "none",
          }}
        >
          <Caption1 as="span" style={textStyle}>
            {`${bookPercent}%`}
          </Caption1>
        </div>
      )}
    </>
  );
};
