import type { FC } from "react";
import { Caption1 } from "@fluentui/react-components";
import { ReadingTheme, SpreadPaginatedHost } from "@pagina/engine";
import type { ReaderSnapshot } from "../ReaderController.js";

export interface PageFurnitureProps {
  snapshot: ReaderSnapshot;
}

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

  const displayPage = snapshot.bookPageIndex ?? (snapshot.pageCount > 0 ? snapshot.pageIndex + 1 : undefined);
  const displayTotal = snapshot.bookPageCount ?? (snapshot.pageCount > 0 ? snapshot.pageCount : undefined);
  const bookPercent = percent(snapshot.bookPageIndex, snapshot.bookPageCount);

  const footerLabel =
    displayPage !== undefined && displayTotal !== undefined
      ? `Page ${displayPage} of ${displayTotal}${bookPercent !== undefined ? ` · ${bookPercent}%` : ""}`
      : undefined;

  // In spread mode, each of the two visible pages gets its own centered
  // "Title — Chapter" header, matching how a real printed book's running
  // head reads the same on facing verso/recto pages — rather than one
  // header spanning both pages with the title pinned to the outer-left
  // edge and the chapter to the outer-right edge, which read as
  // disconnected from the page each was actually sitting on. Computed
  // from `SpreadPaginatedHost`'s own column/gutter geometry (not
  // guessed) so each band lines up exactly with the page beneath it.
  const columnWidth = snapshot.isSpread ? SpreadPaginatedHost.effectiveColumnWidth(snapshot.paneWidth) : undefined;
  const sideMargin =
    columnWidth !== undefined
      ? Math.max(0, (snapshot.paneWidth - (columnWidth * 2 + SpreadPaginatedHost.GUTTER_WIDTH)) / 2)
      : undefined;
  const headerBands: { left: number | string; right: number | string; width: number | string }[] =
    columnWidth !== undefined && sideMargin !== undefined
      ? [
          { left: sideMargin, right: "auto", width: columnWidth },
          { left: "auto", right: sideMargin, width: columnWidth },
        ]
      : [{ left: 0, right: 0, width: "auto" }];

  return (
    <>
      {headerBands.map((band, index) => (
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
            alignItems: "center",
            justifyContent: headerBands.length > 1 ? "center" : "space-between",
            padding: "0 20px",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          {headerBands.length > 1 ? (
            <Caption1 as="span" truncate wrap={false} style={{ ...textStyle, minWidth: 0, textAlign: "center" }}>
              {snapshot.title} — {snapshot.currentChapterLabel}
            </Caption1>
          ) : (
            <>
              <Caption1 as="span" truncate wrap={false} style={{ ...textStyle, minWidth: 0 }}>
                {snapshot.title}
              </Caption1>
              <Caption1 as="span" truncate wrap={false} style={{ ...textStyle, textAlign: "right", minWidth: 0 }}>
                {snapshot.currentChapterLabel}
              </Caption1>
            </>
          )}
        </div>
      ))}

      {footerLabel && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: ReadingTheme.PAGE_INSET_BOTTOM,
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Caption1 as="span" style={textStyle}>
            {footerLabel}
          </Caption1>
        </div>
      )}
    </>
  );
};
