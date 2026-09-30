import { isInteractiveContentTarget } from "@ambra/engine";

export interface HorizontalBounds {
  left: number;
  right: number;
}

/** The reader's reflowable measure includes body padding and auto margins,
 * not the whitespace within paragraphs, images, or short pages. */
export function reflowableContentBounds(doc: Document): HorizontalBounds {
  const body = doc.body;
  const rect = body.getBoundingClientRect();
  const style = doc.defaultView!.getComputedStyle(body);
  return {
    left: rect.left + parseFloat(style.borderLeftWidth || "0") + parseFloat(style.paddingLeft || "0"),
    right: rect.right - parseFloat(style.borderRightWidth || "0") - parseFloat(style.paddingRight || "0"),
  };
}

export function frameContentBounds(
  frame: HTMLIFrameElement,
  content?: HorizontalBounds,
): HorizontalBounds {
  const rect = frame.getBoundingClientRect();
  if (!content) return rect;
  const scale = rect.width / frame.clientWidth;
  return { left: rect.left + content.left * scale, right: rect.left + content.right * scale };
}

/** Only the two physical outer margins navigate; the entire space between
 * the measures (including a spread's gutter/blank companion) is inert. */
export function outerMarginSide(x: number, pages: readonly HorizontalBounds[]): -1 | 1 | undefined {
  if (!pages.length) return undefined;
  if (x < Math.min(...pages.map(page => page.left))) return -1;
  if (x > Math.max(...pages.map(page => page.right))) return 1;
  return undefined;
}

/** Extend only the two physical outer edges into 8% of the rendered page,
 * capped at 64 CSS pixels. Callers retain ownership of content interactions. */
export function outerEdgeSide(x: number, pages: readonly HorizontalBounds[], minimum = 0): -1 | 1 | undefined {
  return outerMarginSide(x, pages.map(page => {
    const width = page.right - page.left;
    const inset = Math.min(width / 2, Math.max(minimum, Math.min(width * 0.08, 64)));
    return { left: page.left + inset, right: page.right - inset };
  }));
}

/** Probe only the nearest text node, not the publication tree. Full line
 * rectangles protect ligatures and combining characters as well as words. */
export function isReflowableEdgeWhitespace(doc: Document, x: number, y: number): boolean {
  const target = doc.elementFromPoint(x, y);
  if (!target || isInteractiveContentTarget(target) ||
    target.closest("img, svg, math, canvas, video, audio, iframe, li")) return false;
  for (let element: Element | null = target; element; element = element.parentElement) {
    for (const pseudo of ["::before", "::after"]) {
      const content = doc.defaultView!.getComputedStyle(element, pseudo).content;
      if (content && !["none", "normal", '""', "''"].includes(content)) return false;
    }
  }
  const caretRangeFromPoint = (doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  }).caretRangeFromPoint;
  if (!caretRangeFromPoint) return false;
  const caret = caretRangeFromPoint.call(doc, x, y);
  if (!caret) return false;
  if (caret.startContainer.nodeType !== 3) return true;
  const line = doc.createRange();
  line.selectNodeContents(caret.startContainer);
  return !Array.from(line.getClientRects()).some(rect =>
    rect.width > 0 && rect.height > 0 &&
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}
