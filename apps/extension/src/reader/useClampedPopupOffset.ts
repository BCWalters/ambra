import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

const VIEWPORT_MARGIN_PX = 8;

export interface FloatingAnchor {
  left: number;
  top: number;
}

/** Clamps a fixed popup centered above its anchor. Untransformed dimensions
 * keep repeated measurements from compounding the previous offset. */
export function useClampedPopupOffset(
  ref: RefObject<HTMLElement | null>,
  anchor: FloatingAnchor | undefined,
  verticalGapPx: number,
  // Re-clamp known content changes before paint, as well as observing later resizes.
  sizeDeps: readonly unknown[],
): { x: number; y: number } {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) {
      setOffset({ x: 0, y: 0 });
      return;
    }
    const measure = (): void => {
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
      setOffset((previous) => previous.x === x && previous.y === y ? previous : { x, y });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, anchor?.left, anchor?.top, verticalGapPx, ...sizeDeps]);

  return offset;
}
