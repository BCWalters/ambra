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
