import { useLayoutEffect, useRef, useState } from "react";
import type { FC, PointerEvent as ReactPointerEvent } from "react";
import { Caption1 } from "@fluentui/react-components";
import type { ReaderSnapshot } from "../ReaderController.js";
import { CHROME_BACKDROP_FILTER, CHROME_BACKGROUND, CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";

/** Smallest gap the drag preview popup is ever allowed from the browser
 * window's left/right edges — purely cosmetic breathing room, not a
 * layout necessity. */
const POPUP_EDGE_MARGIN = 8;

export interface ProgressScrubberProps {
  snapshot: ReaderSnapshot;
  /** Whether the scrubber should currently be shown — tied to the same
   * `useAutoHideChrome` state the toolbar uses (see `ReaderApp`), so the
   * two fade in and out together as one unit of chrome. */
  visible: boolean;
  handlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  };
  /** A live, side-effect-free preview of where a drag at `fraction`
   * would land — see `ReaderController.previewSeek`. */
  onPreview: (fraction: number) => { label: string; chapterLabel: string };
  /** Commits a drag's final position — see `ReaderController.
   * seekToFraction`. Called once, on release. Returns a `Promise` (not
   * fire-and-forget) so `endDrag` can keep showing the drag's own
   * released position until the navigation actually lands — see its
   * doc comment for why that matters. */
  onSeek: (fraction: number) => Promise<void>;
}

/** The current reading position as a fraction (0 to 1) of the whole
 * book — prefers exact, book-wide page numbers once `BookPaginationEstimator`
 * has measured the whole book (see `bookPageIndex`/`bookPageCount`),
 * falling back to a coarser measure (current spine item, plus its own
 * in-chapter page fraction if known) while that's still in progress —
 * consistent with `ReaderController.previewSeek`/`seekToFraction`'s own
 * preference order, so the scrubber's resting position and a drag's
 * preview always agree on what a given fraction means. */
function currentFraction(snapshot: ReaderSnapshot): number {
  if (snapshot.bookPageIndex !== undefined && snapshot.bookPageCount !== undefined && snapshot.bookPageCount > 0) {
    return snapshot.bookPageIndex / snapshot.bookPageCount;
  }
  if (snapshot.spineLength > 0) {
    const chapterFraction = snapshot.pageCount > 0 ? snapshot.pageIndex / snapshot.pageCount : 0;
    return (snapshot.spineIndex + chapterFraction) / snapshot.spineLength;
  }
  return 0;
}

/**
 * A horizontal, scrubbable progress bar across the very bottom of the
 * reader pane — lets a reader "zoom through the book" by dragging,
 * rather than only turning one page/chapter at a time. Shares the
 * toolbar's own show/hide chrome state (see `ReaderApp`) so both fade
 * together, and shows a small popup above the thumb while dragging with
 * a live preview of where that position is (page number and chapter
 * name) — see `ReaderController.previewSeek`.
 *
 * Deliberately never claims more precision than the reader currently
 * has: `currentFraction`/`previewSeek` both prefer an exact book-wide
 * page number once it's known, but happily fall back to a coarser
 * chapter-level position while a large book's background pagination is
 * still catching up (see `BookPaginationEstimator`) — the scrubber
 * itself doesn't need to know or care which one it's showing, since
 * both are expressed as the same 0-to-1 fraction either way.
 *
 * Scoped to paginated/spread reflowable content only, matching
 * `PageFurniture`'s own scope — scroll mode's native scrollbar already
 * serves this purpose, and fixed-layout content has no meaningful
 * "page" position to scrub through page-by-page.
 */
export const ProgressScrubber: FC<ProgressScrubberProps> = ({ snapshot, visible, handlers, onPreview, onSeek }) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [dragFraction, setDragFraction] = useState<number | undefined>(undefined);
  // The popup's horizontal center, in pixels relative to the bar (`barRef`)
  // it's positioned within — clamped so it never runs past the browser
  // window's left/right edges, unlike naively centering it on the thumb
  // via a `left` percentage (which is exactly where thumb and popup are
  // the same thing, but breaks down near either end of the track, since
  // the popup itself has real width that a bare percentage doesn't
  // account for). Recomputed via `useLayoutEffect` below, since it
  // depends on the popup's own *rendered* width (its text content, and
  // thus width, changes as the drag moves across page/chapter numbers).
  const [popupCenterPx, setPopupCenterPx] = useState<number | undefined>(undefined);

  const preview = dragFraction !== undefined ? onPreview(dragFraction) : undefined;

  useLayoutEffect(() => {
    const bar = barRef.current;
    const track = trackRef.current;
    const popup = popupRef.current;
    if (!bar || !track || !popup || dragFraction === undefined) {
      return;
    }
    const barRect = bar.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const popupWidth = popup.getBoundingClientRect().width;
    const desiredCenterInViewport = trackRect.left + dragFraction * trackRect.width;
    const halfWidth = popupWidth / 2;
    const minCenter = POPUP_EDGE_MARGIN + halfWidth;
    const maxCenter = window.innerWidth - POPUP_EDGE_MARGIN - halfWidth;
    const clampedCenterInViewport = Math.min(maxCenter, Math.max(minCenter, desiredCenterInViewport));
    setPopupCenterPx(clampedCenterInViewport - barRect.left);
    // `preview.label`/`preview.chapterLabel` deliberately included: the
    // popup's rendered width changes as its text does (e.g. "Page 9 of
    // 12" vs "Page 100 of 120"), which can itself push it back into (or
    // out of) needing to be clamped, even without `dragFraction` moving.
  }, [dragFraction, preview?.label, preview?.chapterLabel]);

  if (snapshot.isFixedLayout || snapshot.viewMode !== "paginated") {
    return null;
  }

  const fractionAt = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) {
      return 0;
    }
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragFraction(fractionAt(event.clientX));
  };

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragFraction === undefined) {
      return;
    }
    setDragFraction(fractionAt(event.clientX));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragFraction === undefined) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    // Keep showing the released drag position (not falling back to
    // `currentFraction(snapshot)`, the *pre-seek* position) until the
    // async navigation this triggers actually lands and the real
    // snapshot catches up to match it — clearing `dragFraction`
    // immediately here was a real, reported bug: the thumb would jump
    // back to the old position for the async gap, then jump again to
    // the new one once it resolved, a jarring double-jump instead of
    // one smooth settle.
    const released = fractionAt(event.clientX);
    setDragFraction(released);
    void onSeek(released).finally(() => {
      setDragFraction(undefined);
    });
  };

  const displayFraction = dragFraction ?? currentFraction(snapshot);

  return (
    <div
      ref={barRef}
      onPointerEnter={handlers.onPointerEnter}
      onPointerLeave={handlers.onPointerLeave}
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        padding: "6px 14px",
        background: CHROME_BACKGROUND,
        backdropFilter: CHROME_BACKDROP_FILTER,
        WebkitBackdropFilter: CHROME_BACKDROP_FILTER,
        borderTop: `1px solid ${CHROME_BORDER}`,
        boxShadow: visible ? CHROME_SHADOW : "none",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 240ms ease, transform 240ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 240ms ease",
      }}
    >
      {preview && (
        <div
          ref={popupRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "100%",
            // Falls back to the un-clamped percentage-based center for
            // the very first paint before `useLayoutEffect` has had a
            // chance to measure the popup's real width — briefly
            // inaccurate only at the extreme edges, on the first frame
            // of a drag, never visibly clipped since the layout effect
            // runs before the browser actually paints.
            left: popupCenterPx ?? `${dragFraction! * 100}%`,
            // Without an explicit width, an absolutely positioned box
            // with only `left` set (no `right`) shrink-to-fits within
            // the space *remaining* to the containing block's edge —
            // which the `translateX(-50%)` centering below doesn't
            // factor into (transforms are purely a paint-time effect,
            // invisible to layout) — so near either edge the popup got
            // squeezed narrower than its own text and wrapped, even
            // though its clamped position had plenty of room to its
            // *other* side. `max-content` sizes it to its content's own
            // preferred width unconditionally, matching what
            // `white-space: nowrap` below already assumes.
            width: "max-content",
            transform: "translate(-50%, -8px)",
            background: CHROME_BACKGROUND,
            backdropFilter: CHROME_BACKDROP_FILTER,
            WebkitBackdropFilter: CHROME_BACKDROP_FILTER,
            border: `1px solid ${CHROME_BORDER}`,
            borderRadius: 8,
            boxShadow: CHROME_SHADOW,
            padding: "6px 12px",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          <Caption1 as="span" block style={{ fontWeight: 600 }}>
            {preview.label}
          </Caption1>
          <Caption1 as="span" block style={{ color: "var(--colorNeutralForeground2, #444)" }}>
            {preview.chapterLabel}
          </Caption1>
        </div>
      )}

      <div
        ref={trackRef}
        onPointerDown={beginDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="slider"
        aria-label="Position in book"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(displayFraction * 100)}
        style={{
          position: "relative",
          height: 16,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 4,
            borderRadius: 2,
            background: "var(--colorNeutralStroke2, rgba(0, 0, 0, 0.12))",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            width: `${displayFraction * 100}%`,
            height: 4,
            borderRadius: 2,
            background: "var(--colorBrandBackground, #0b57a4)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${displayFraction * 100}%`,
            width: 12,
            height: 12,
            borderRadius: "50%",
            transform: "translateX(-50%)",
            background: "var(--colorBrandBackground, #0b57a4)",
            boxShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
          }}
        />
      </div>
    </div>
  );
};
