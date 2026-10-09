import { outerEdgeBounds, type HorizontalBounds } from "./PageMargins.js";

export interface PageTurnGuideGeometry {
  left: number;
  right: number;
  top: number;
  height: number;
  leftWidth: number;
  rightWidth: number;
}

/** Prefer outer whitespace; fixed artwork can use its existing bounded edge
 * turn band when flush with the viewport. Never paint the spread gutter. */
export function pageTurnGuideGeometry(
  pane: Pick<DOMRect, "left" | "right" | "top" | "height">,
  pages: readonly HorizontalBounds[],
  fixedArtworkEdges = false,
): PageTurnGuideGeometry | undefined {
  if (!pages.length || pane.height <= 0) return undefined;
  const width = pane.right - pane.left;
  let leftWidth = Math.max(0, Math.min(width / 2, Math.min(...pages.map(p => p.left)) - pane.left));
  let rightWidth = Math.max(0, Math.min(width / 2, pane.right - Math.max(...pages.map(p => p.right))));
  if (fixedArtworkEdges) {
    const edges = outerEdgeBounds(pages);
    if (!leftWidth) leftWidth = Math.max(0, Math.min(width / 2, Math.min(...edges.map(p => p.left)) - pane.left));
    if (!rightWidth) rightWidth = Math.max(0, Math.min(width / 2, pane.right - Math.max(...edges.map(p => p.right))));
  }
  return {
    left: pane.left, right: pane.right, top: pane.top, height: pane.height,
    leftWidth, rightWidth,
  };
}
