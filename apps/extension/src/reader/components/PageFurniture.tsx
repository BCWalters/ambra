import type { FC } from "react";
import { Caption1 } from "@fluentui/react-components";
import { BookmarkFilled } from "@fluentui/react-icons";
import { ReadingTheme, SpreadPaginatedHost } from "@ambra/engine";
import type { ReaderSnapshot } from "../ReaderController.js";
import { HEADER_TEXT_TOP_OFFSET } from "../furnitureLayout.js";
import { useTranslation } from "../../i18n/LocaleContext.js";

export interface PageFurnitureProps {
  snapshot: ReaderSnapshot;
  /** Whether the toolbar chrome is currently shown — see `ReaderApp`'s
   * `useAutoHideChrome`. The bookmark ribbon (issue #64) is hidden
   * outright while this is `true`, rather than relying on the toolbar's
   * own (translucent, blurred) background to visually cover it the way
   * the rest of this component's running header/footer text already
   * does — that partial-opacity background still let the ribbon's
   * solid, drop-shadowed shape show through as a faint smear, which was
   * fine for small gray header text but not for something this visually
   * prominent. */
  chromeVisible: boolean;
}

/** The ribbon's own width/height (a small square icon box) — used both
 * to size it and to inset it from a page's right edge so it reads as
 * "hanging off this specific page's corner," not the reader pane's. */
const BOOKMARK_RIBBON_SIZE = 22;

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
 * The per-page header/footer bands (but not the book-wide percentage
 * indicator below) are suppressed entirely while
 * `snapshot.isAnimatingPageTurn` is set — during that window,
 * `ReaderController` is animating its own imperative "turn furniture"
 * overlay (built fresh per turn, positioned to exactly match whichever
 * content element is actually moving) in lockstep with the real
 * page-turn transform, so this static, declarative version would
 * otherwise render on top of it, unmoving, for the whole transition.
 *
 * Scoped to paginated/spread reflowable content only — the same scope
 * `pageIndex`/`pageCount`/`bookPageIndex`/`bookPageCount` already have in
 * `ReaderSnapshot` (scroll mode has no discrete "page" to attach this
 * furniture to; fixed-layout content has its own complete, intentional
 * page design this must never draw on top of).
 */
export const PageFurniture: FC<PageFurnitureProps> = ({ snapshot, chromeVisible }) => {
  const t = useTranslation();
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
  // branching needed for it — *except* while `isPrimaryPageMergedTail`
  // (issue #90/#92): there, `bookPageIndex`/`pageIndex` already describe
  // the *right* column's page (this chapter's own real page 0, not the
  // left column's borrowed previous-chapter content), so "primary plus
  // one" would double-count it, and the left column has no correct
  // number available here to show at all (it belongs to a different
  // spine item's own book-wide count) — better to show no number there
  // than a confidently wrong one.
  const primaryPageNumber = snapshot.bookPageIndex ?? (snapshot.pageCount > 0 ? snapshot.pageIndex + 1 : undefined);
  const secondaryPageNumber =
    snapshot.secondPageIndex !== undefined && primaryPageNumber !== undefined && !snapshot.isPrimaryPageMergedTail
      ? primaryPageNumber + 1
      : undefined;
  const bookPercent = percent(snapshot.bookPageIndex, snapshot.bookPageCount);

  // In spread mode, each of the two visible pages gets its own header
  // and footer band — matching how a real printed book's running head
  // and folio (page number) each belong to the specific page they sit
  // on, not to the spread as a whole. Computed once from
  // `SpreadPaginatedHost`'s own column/gutter geometry (not guessed) so
  // every band lines up exactly with the page beneath it, and shared
  // between the header and footer below rather than recomputed twice.
  //
  // Each band's header div below sets `boxSizing: "border-box"` so its
  // `width` (this exact column's own true width) plus its horizontal
  // padding never together exceed that width — a real, subtle bug
  // otherwise: with the default `content-box` sizing, the div's actual
  // rendered box became `width + 40px` (the header's 20px-per-side
  // padding added *outside* the intended width), silently centering
  // each column's title ~20px off from that column's own true center,
  // toward the gutter — most visible as a "jump" the instant an
  // animated page turn (whose imperative overlay, `buildTurnFurnitureOverlay`,
  // got this right from the start) settled and handed back to this
  // static rendering.
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
  const footerNumbers =
    columnBands.length > 1
      ? snapshot.isPrimaryPageMergedTail
        ? [undefined, primaryPageNumber]
        : [primaryPageNumber, secondaryPageNumber]
      : [primaryPageNumber];

  // Where each band's own *right* edge sits, for the bookmark ribbon
  // (issue #51) — deliberately not reusing `band.left`/`band.right`
  // directly, since those describe the far side used to *center* header
  // text within the band, not necessarily this page's own right corner:
  // the left column of a spread has its right edge at `left + width`,
  // not at `right` (which is `"auto"` for that column).
  const columnRightEdges: { left?: number; right?: number | string }[] = columnBands.map((band) =>
    typeof band.left === "number" && typeof band.width === "number"
      ? { left: band.left + band.width - BOOKMARK_RIBBON_SIZE }
      : { right: band.right === "auto" ? 0 : band.right },
  );

  return (
    <>
      {!snapshot.isAnimatingPageTurn && (
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
                  boxSizing: "border-box",
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
                boxSizing: "border-box",
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
                  {t("pageFurniture.pageNumber", { number: pageNumber })}
                </Caption1>
              </div>
            );
          })}

          {/* A small bookmark ribbon in a page's own top-right corner
              (issue #51) whenever a saved bookmark resolves onto that
              specific page — nothing drawn at all otherwise, per the
              same "silence is the no-bookmark state" convention the
              toolbar's own bookmark toggle already uses. One per visible
              page (see `columnRightEdges`/`ReaderSnapshot.bookmarkedPages`),
              so a spread with a bookmark on only one of its two pages
              draws the ribbon on just that one, not both.

              Suppressed outright while `chromeVisible` (issue #64): an
              earlier version relied on the toolbar's own translucent,
              blurred background to visually cover this the same way it
              covers the header/footer text below — but that ~90%-opaque
              background still let the ribbon's solid, drop-shadowed
              shape show through as a faint smear, fine for small gray
              text but not for something this visually prominent. Hiding
              it outright while the toolbar's shown is simpler and fully
              reliable. */}
          {!chromeVisible &&
            columnBands.map((_band, index) => {
              if (!snapshot.bookmarkedPages[index]) {
                return null;
              }
              const edge = columnRightEdges[index];
              return (
                <BookmarkFilled
                  key={index}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 0,
                    ...edge,
                    width: BOOKMARK_RIBBON_SIZE,
                    height: BOOKMARK_RIBBON_SIZE,
                    zIndex: 5,
                    color: "#dc3d3d",
                    filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35))",
                    pointerEvents: "none",
                  }}
                />
              );
            })}
        </>
      )}

      {/* A single "how far through the book" indicator, anchored to the
          bottom-right of the whole reader pane — deliberately not
          per-page (unlike the "Page N" folios above), since a percentage
          describes progress through the *book*, not either individual
          page on screen right now. */}
      {bookPercent !== undefined && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
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
