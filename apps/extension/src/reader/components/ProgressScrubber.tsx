import { useRef, useState } from "react";
import type { FC, PointerEvent as ReactPointerEvent } from "react";
import { Caption1 } from "@fluentui/react-components";
import type { ReaderSnapshot } from "../ReaderController.js";
import { CHROME_BACKDROP_FILTER, CHROME_BACKGROUND, CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";

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
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragFraction, setDragFraction] = useState<number | undefined>(undefined);

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
  const preview = dragFraction !== undefined ? onPreview(dragFraction) : undefined;

  return (
    <div
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
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "100%",
            left: `${dragFraction! * 100}%`,
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
