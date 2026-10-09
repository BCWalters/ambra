import { isReaderOwnedContent } from "../content/ReaderOwnedContent.js";
import type { DomBreakPoint } from "../layout/Page.js";
import { LocatorResolutionError, type ResolvedLocator } from "./Locator.js";

const REPLACED_ELEMENTS = new Set(["img", "svg", "math", "audio", "video", "object", "iframe", "embed", "input"]);
const NON_CONTENT_ELEMENTS = new Set(["head", "script", "style", "template"]);

function contentEdge(node: Node, direction: 1 | -1): DomBreakPoint | undefined {
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if (isReaderOwnedContent(current)) continue;
    if (current.nodeType === 3 || current.nodeType === 4) {
      const length = current.nodeValue?.length ?? 0;
      if (length) return { node: current, offset: direction === 1 ? 0 : length - 1 };
      continue;
    }
    if (current.nodeType !== 1) continue;
    const element = current as Element;
    if (NON_CONTENT_ELEMENTS.has(element.localName)) continue;
    if (REPLACED_ELEMENTS.has(element.localName)) return { node: current, offset: 0 };
    for (let child = direction === 1 ? current.lastChild : current.firstChild; child;
      child = direction === 1 ? child.previousSibling : child.nextSibling) {
      pending.push(child);
    }
  }
  return undefined;
}

/** A visual probe only: range/annotation endpoints retain the exact CFI boundary. */
export function readingPositionForLocator(point: ResolvedLocator): DomBreakPoint {
  const { node, sideBias } = point;
  const offset = point.characterOffset ?? 0;
  if (!sideBias || point.mediaOffsets || (point.alternativeTextOffset ?? 0) > 0) return { node, offset };
  if (!Number.isSafeInteger(offset)) throw new LocatorResolutionError("CFI reading offset is not a safe integer.");
  const direction = sideBias === "a" ? 1 : -1;
  if (node.nodeType === 3 || node.nodeType === 4) {
    const length = node.nodeValue?.length ?? 0;
    if (offset < 0 || offset > length) throw new LocatorResolutionError("CFI reading offset is out of range.");
    if (direction === -1 && offset > 0) return { node, offset: offset - 1 };
    if (direction === 1 && offset < length) return { node, offset };
  } else {
    if (offset < 0 || offset > node.childNodes.length) {
      throw new LocatorResolutionError("CFI reading child offset is out of range.");
    }
    if (direction === 1 && node.nodeType === 1 && REPLACED_ELEMENTS.has((node as Element).localName)) {
      return { node, offset };
    }
    for (let i = direction === 1 ? offset : offset - 1; i >= 0 && i < node.childNodes.length; i += direction) {
      const edge = contentEdge(node.childNodes[i]!, direction);
      if (edge) return edge;
    }
  }
  let current: Node | null = node;
  while (current) {
    if (current !== node && current.nodeType === 1 && REPLACED_ELEMENTS.has((current as Element).localName)) {
      return { node: current, offset: 0 };
    }
    for (let sibling = direction === 1 ? current.nextSibling : current.previousSibling; sibling;
      sibling = direction === 1 ? sibling.nextSibling : sibling.previousSibling) {
      const edge = contentEdge(sibling, direction);
      if (edge) return edge;
    }
    current = current.parentNode;
  }
  return { node, offset };
}
