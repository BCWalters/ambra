import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

const VIEWPORT_MARGIN_PX = 8;

export interface FloatingAnchor {
  left: number;
  top: number;
}

/**
 * Keeps a `position: fixed` floating popup anchored via `transform:
 * translate(-50%, calc(-100% - <gap>px))` (see `SelectionToolbar`/
 * `HighlightActionPopup`, the two "inline note" popups this was built
 * for) fully on-screen — a highlight near the very top of the page, or
 * one hugging the left/right edge of a wide reader pane, would
 * otherwise render partly (or entirely) off the visible viewport, since
 * that transform alone has no notion of the viewport's own edges.
 *
 * Returns a small `{ x, y }` pixel nudge to add on top of the caller's
 * own `transform`; `{ 0, 0 }` once (or if) the popup is already fully
 * on-screen. Computed from the anchor point and the popup's own
 * *unshifted* rendered size (`offsetWidth`/`offsetHeight`, which —
 * unlike `getBoundingClientRect()` — ignore any `transform` already
 * applied, so this stays correct across repeated re-clamps instead of
 * compounding a stale offset into the next measurement) rather than
 * measured after the fact, so there's nothing to reset between renders.
 *
 * Deliberately a small, from-scratch measure-and-correct hook (matching
 * this project's "minimize third-party libraries" principle) rather
 * than pulling in a floating-UI-style positioning library — this only
 * ever needs simple axis-aligned clamping against the viewport's own
 * edges, not the full collision/flip/arrow-tracking logic those
 * libraries solve for arbitrary anchor elements.
 */
export function useClampedPopupOffset(
  ref: RefObject<HTMLElement | null>,
  anchor: FloatingAnchor | undefined,
  verticalGapPx: number,
  // Anything besides the anchor point itself that can change the
  // popup's own rendered size (e.g. opening its note editor, or its
  // color-swatch row) — a resize like that needs the same re-clamp an
  // anchor move does, even though the anchor didn't actually move.
  sizeDeps: readonly unknown[],
): { x: number; y: number } {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    const handleResize = (): void => setResizeTick((tick) => tick + 1);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) {
      setOffset({ x: 0, y: 0 });
      return;
    }
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const naturalLeft = anchor.left - width / 2;
    const naturalRight = anchor.left + width / 2;
    const naturalTop = anchor.top - height - verticalGapPx;
    const naturalBottom = anchor.top - verticalGapPx;

    let x = 0;
    if (naturalLeft < VIEWPORT_MARGIN_PX) {
      x = VIEWPORT_MARGIN_PX - naturalLeft;
    } else if (naturalRight > window.innerWidth - VIEWPORT_MARGIN_PX) {
      x = window.innerWidth - VIEWPORT_MARGIN_PX - naturalRight;
    }
    let y = 0;
    if (naturalTop < VIEWPORT_MARGIN_PX) {
      y = VIEWPORT_MARGIN_PX - naturalTop;
    } else if (naturalBottom > window.innerHeight - VIEWPORT_MARGIN_PX) {
      y = window.innerHeight - VIEWPORT_MARGIN_PX - naturalBottom;
    }
    setOffset({ x, y });
  }, [anchor?.left, anchor?.top, resizeTick, ...sizeDeps]);

  return offset;
}
