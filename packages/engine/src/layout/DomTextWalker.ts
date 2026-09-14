// See CfiTree.ts for why these are plain numeric literals rather than
// references to the global `Node.*` constants — this module, like that
// one, only needs objects that duck-type as DOM nodes (childNodes,
// nodeType), so it has no dependency on a full DOM environment.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

function isTextLike(node: Node): node is Text {
  return node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE;
}

/** Collects the descendant text-like nodes of `root`, in document order,
 * via plain recursive child-node traversal (no `TreeWalker` dependency). */
function collectTextNodes(root: Node, out: Text[]): void {
  for (const child of Array.from(root.childNodes)) {
    if (isTextLike(child)) {
      out.push(child);
    } else if (child.nodeType === ELEMENT_NODE) {
      collectTextNodes(child, out);
    }
  }
}

/**
 * Walks the descendant text nodes of `root` in document order, treating
 * them as one concatenated string, and finds the (node, local offset)
 * position corresponding to `globalOffset` characters into that
 * concatenation. Used to translate a bisection result (a character
 * position within a whole leaf block's text, found via layout
 * measurement in `LineMeasurement.ts`) back into a real DOM position.
 *
 * Deliberately independent of real layout/rendering — it only walks the
 * DOM tree — so it can be tested without a real browser layout engine,
 * unlike the line-measurement code that calls `Range.getClientRects()`.
 */
export function globalTextOffsetToPosition(
  root: Node,
  globalOffset: number,
): { node: Text; offset: number } | undefined {
  const textNodes: Text[] = [];
  collectTextNodes(root, textNodes);

  let remaining = globalOffset;
  for (const node of textNodes) {
    const length = node.data.length;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
  }

  const last = textNodes[textNodes.length - 1];
  return last ? { node: last, offset: last.data.length } : undefined;
}

/** The total length of all descendant text nodes of `root`, concatenated
 * — the valid range for `globalTextOffsetToPosition`'s `globalOffset`. */
export function totalTextLength(root: Node): number {
  const textNodes: Text[] = [];
  collectTextNodes(root, textNodes);
  return textNodes.reduce((sum, node) => sum + node.data.length, 0);
}
