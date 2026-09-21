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

/** `<math>` (MathML) is never treated as a source of *breakable* text,
 * even though it does have real descendant text nodes (one token per
 * `<mi>`/`<mn>`/`<mo>` etc.) — same reasoning as `ATOMIC_TAG_NAMES` in
 * `LineMeasurement.ts` for images/tables/figures: an equation should
 * never be split mid-formula. Unlike those tags, though, a `<math>`
 * element commonly sits *inline inside* an ordinary text leaf (a
 * paragraph), not as its own block-level leaf, so it can't be filtered
 * out at the leaf-collection level at all — it has to be recognized
 * here, where leaf text is actually walked.
 *
 * This isn't just correctness — it's a confirmed real-world performance
 * cliff (issue #102): a single MathML equation (e.g. a matrix) can
 * expand to tens of thousands of characters of deeply nested markup
 * with hundreds of small text nodes. Counting all of that as ordinary
 * "breakable text mass" made a paragraph containing even one such
 * equation cost `O(equationSize)` per bisection step, repeated up to
 * `log2(totalLength)` times per line — on a MathML-dense textbook
 * chapter, this was the difference between a page turn landing
 * instantly and the reader staring at a blank white screen for tens of
 * seconds. */
function isMathElement(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE && (node as Element).tagName.toLowerCase() === "math";
}

/** Collects the descendant text-like nodes of `root`, in document order,
 * via plain recursive child-node traversal (no `TreeWalker` dependency).
 * Never descends into a `<math>` subtree — see `isMathElement`. */
function collectTextNodes(root: Node, out: Text[]): void {
  for (const child of Array.from(root.childNodes)) {
    if (isTextLike(child)) {
      out.push(child);
    } else if (child.nodeType === ELEMENT_NODE && !isMathElement(child)) {
      collectTextNodes(child, out);
    }
  }
}

/** Collects `root`'s descendant text-like nodes into a plain array, in
 * document order — the one real DOM walk `globalTextOffsetToPosition`/
 * `totalTextLength` each did internally on *every single call*. Exposed
 * so a caller resolving many offsets against the same `root` (as
 * `LineMeasurement.ts`'s per-line bisection does, up to `log2(length)`
 * times per line) can walk the DOM exactly once per leaf and reuse the
 * resulting array via `positionFromTextNodes`/`sumTextLength` below,
 * instead of re-walking — for a leaf with hundreds of text nodes (e.g.
 * MathML-heavy content, one text node per token) and many lines, this
 * was a confirmed real-world performance cliff (issue #102: pagination
 * effectively hung on a MathML-dense textbook chapter). */
export function collectTextNodesOf(root: Node): Text[] {
  const out: Text[] = [];
  collectTextNodes(root, out);
  return out;
}

/** Same lookup as `globalTextOffsetToPosition`, but against an
 * already-collected `textNodes` array (see `collectTextNodesOf`) rather
 * than re-walking `root` — the shared implementation both that function
 * and `LineMeasurement.ts`'s bisection loop use. */
export function positionFromTextNodes(
  textNodes: readonly Text[],
  globalOffset: number,
): { node: Text; offset: number } | undefined {
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

/** Same sum as `totalTextLength`, but against an already-collected
 * `textNodes` array (see `collectTextNodesOf`). */
export function sumTextLength(textNodes: readonly Text[]): number {
  return textNodes.reduce((sum, node) => sum + node.data.length, 0);
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
  return positionFromTextNodes(collectTextNodesOf(root), globalOffset);
}

/** The total length of all descendant text nodes of `root`, concatenated
 * — the valid range for `globalTextOffsetToPosition`'s `globalOffset`. */
export function totalTextLength(root: Node): number {
  return sumTextLength(collectTextNodesOf(root));
}
