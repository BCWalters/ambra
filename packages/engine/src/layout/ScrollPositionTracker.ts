import type { Chunk } from "./LineMeasurement.js";
import type { DomBreakPoint } from "./Page.js";

/**
 * Orders two DOM boundary points. Returns a negative number if `a` comes
 * before `b` in document order, positive if after, and `0` if they're the
 * same position. Ancestor offsets are child boundaries, not merely the
 * ancestor node's position. Uses DOM structure, not layout queries, so, unlike
 * `LineMeasurement.ts`, this is fully testable without a real browser
 * rendering engine.
 */
export function compareDomPositions(a: DomBreakPoint, b: DomBreakPoint): number {
  if (a.node === b.node) {
    return (a.offset ?? 0) - (b.offset ?? 0);
  }

  const relation = a.node.compareDocumentPosition(b.node);
  if (relation & Node.DOCUMENT_POSITION_DISCONNECTED) {
    throw new DOMException("Cannot compare positions in disconnected trees.", "WrongDocumentError");
  }
  if (relation & Node.DOCUMENT_POSITION_CONTAINED_BY) {
    return compareAncestorPosition(a, b.node);
  }
  if (relation & Node.DOCUMENT_POSITION_CONTAINS) {
    return -compareAncestorPosition(b, a.node);
  }
  if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
    return -1;
  }
  if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
    return 1;
  }
  return 0;
}

function compareAncestorPosition(ancestor: DomBreakPoint, descendant: Node): number {
  let child = descendant;
  while (child.parentNode !== ancestor.node) {
    child = child.parentNode!;
  }
  const childIndex = Array.prototype.indexOf.call(ancestor.node.childNodes, child);
  return (ancestor.offset ?? 0) <= childIndex ? -1 : 1;
}

/**
 * Finds the `Chunk` that overlaps `scrollTop` — i.e. the one sitting at
 * (or straddling) the top edge of the viewport for a container scrolled
 * to that offset. This is "the current position" for continuous-scroll
 * mode, the scroll-mode analogue of `PaginationEngine`'s page concept.
 *
 * Pure: operates purely on already-measured `Chunk`s and a plain number,
 * with no DOM dependency at all — `chunks` must come from
 * `LineMeasurement.measureChunks`, called once while the content is still
 * unscrolled, so each chunk's `top`/`bottom` are stable document-relative
 * coordinates that line up with a scroll container's `scrollTop`.
 */
export function findChunkAtScrollOffset(chunks: readonly Chunk[], scrollTop: number): Chunk | undefined {
  for (const chunk of chunks) {
    if (chunk.bottom > scrollTop) {
      return chunk;
    }
  }
  return chunks[chunks.length - 1];
}

/**
 * Finds the last `Chunk` whose `breakBefore` position is at or before
 * `(node, offset)` in document order — the chunk to scroll to the top of
 * the viewport when restoring a previously-saved position (e.g. a
 * resolved `Locator`/CFI). The inverse of `findChunkAtScrollOffset`.
 */
export function findChunkForPosition(chunks: readonly Chunk[], node: Node, offset: number): Chunk | undefined {
  if (chunks[0]?.breakBefore.node.getRootNode() !== node.getRootNode()) {
    return undefined;
  }
  let result: Chunk | undefined;
  for (const chunk of chunks) {
    if (compareDomPositions(chunk.breakBefore, { node, offset }) <= 0) {
      result = chunk;
    } else {
      // Chunks are in document order, so once we've passed the target
      // position, no later chunk can be a better (later) match.
      break;
    }
  }
  return result ?? chunks[0];
}
