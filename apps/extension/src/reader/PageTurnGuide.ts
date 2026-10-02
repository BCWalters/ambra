import type { HorizontalBounds } from "./PageMargins.js";

export interface PageTurnGuideGeometry {
  left: number;
  right: number;
  top: number;
  height: number;
  leftWidth: number;
  rightWidth: number;
}

/** Paint only true outer whitespace, not the larger whitespace-sensitive hit
 * region that overlaps publication text, nor the gutter between spread pages. */
export function pageTurnGuideGeometry(
  pane: Pick<DOMRect, "left" | "right" | "top" | "height">,
  pages: readonly HorizontalBounds[],
): PageTurnGuideGeometry | undefined {
  if (!pages.length || pane.height < 160) return undefined;
  const width = pane.right - pane.left;
  const leftWidth = Math.max(0, Math.min(width / 2, Math.min(...pages.map(p => p.left)) - pane.left));
  const rightWidth = Math.max(0, Math.min(width / 2, pane.right - Math.max(...pages.map(p => p.right))));
  return {
    left: pane.left, right: pane.right, top: pane.top + 80, height: pane.height - 160,
    leftWidth, rightWidth,
  };
}
