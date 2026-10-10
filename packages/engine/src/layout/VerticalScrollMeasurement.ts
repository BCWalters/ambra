import { isReaderOwnedContent } from "../content/ReaderOwnedContent.js";
import type { Chunk } from "./LineMeasurement.js";

const ATOMIC_ELEMENTS = new Set(["img", "svg", "video", "audio", "canvas", "iframe", "object", "math"]);

/** Measure native vertical columns without changing the publication's layout. */
export function measureVerticalScrollChunks(root: Element, rightToLeft: boolean): Chunk[] {
  const document = root.ownerDocument;
  const width = document.documentElement.clientWidth;
  const scrollLeft = (document.scrollingElement ?? document.documentElement).scrollLeft;
  const chunks: Chunk[] = [];
  const bounds = (rect: DOMRect): { top: number; bottom: number } => rightToLeft
    ? { top: width - rect.right - scrollLeft, bottom: width - rect.left - scrollLeft }
    : { top: rect.left + scrollLeft, bottom: rect.right + scrollLeft };
  const visit = (node: Node): void => {
    if (isReaderOwnedContent(node)) return;
    if (node.nodeType === 1) {
      const element = node as Element;
      if (["script", "style", "rt", "rp"].includes(element.localName)) return;
      if (ATOMIC_ELEMENTS.has(element.localName)) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) chunks.push({ ...bounds(rect), breakBefore: { node } });
        return;
      }
    }
    if (node.nodeType === 3 || node.nodeType === 4) {
      const text = node as Text;
      if (!text.length) return;
      const range = document.createRange();
      range.selectNodeContents(text);
      const columns = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
      for (const rect of columns) {
        const column = bounds(rect);
        let low = 0;
        let high = text.length;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          range.setStart(text, middle);
          range.setEnd(text, middle + 1);
          const character = range.getBoundingClientRect();
          if (bounds(character).bottom <= column.top + 0.5) low = middle + 1;
          else high = middle;
        }
        if (low < text.length) chunks.push({ ...column, breakBefore: { node: text, offset: low } });
      }
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(root);
  return chunks;
}
