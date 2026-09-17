import { globalTextOffsetToPosition, totalTextLength } from "./DomTextWalker.js";

/** A single indivisible unit of content for pagination purposes: either
 * one visual line of text within a "leaf" block element, or one whole
 * atomic (non-text, non-breakable) element such as an image or table.
 * Pagination never breaks in the middle of a `Chunk` — only between
 * chunks. */
export interface Chunk {
  /** Top edge, in the content document's own coordinate space (i.e.
   * `getBoundingClientRect()`-style values, with the document unscrolled
   * so they reflect true layout position, not current scroll offset). */
  readonly top: number;
  readonly bottom: number;
  /** The DOM position immediately before this chunk — where a page
   * boundary would fall if pagination breaks right before it. */
  readonly breakBefore: { node: Node; offset?: number };
}

/** Elements that are laid out as a block-level box but are never
 * meaningfully "block containers" for pagination purposes — even a
 * `<div>` with only inline children counts as a text leaf via the
 * general block/inline check below, so this list only needs the tags
 * that render as block-level boxes yet have no useful text content of
 * their own (measured as a single atomic unit instead). */
const ATOMIC_TAG_NAMES = new Set([
  "img",
  "svg",
  "video",
  "audio",
  "canvas",
  "iframe",
  "object",
  "table",
  "hr",
  "figure",
]);

function isBlockLevel(element: Element): boolean {
  const display = getComputedStyle(element).display;
  return (
    display === "block" ||
    display === "list-item" ||
    display === "table" ||
    display === "table-row" ||
    display === "table-cell" ||
    display === "flex" ||
    display === "grid"
  );
}

/** True if `element` has no block-level element children — i.e. it's a
 * leaf as far as pagination's block-structure walk is concerned, whether
 * it contains text (a "text leaf") or is atomic (an image, etc.). */
function isLeaf(element: Element): boolean {
  return !Array.from(element.children).some((child) => isBlockLevel(child));
}

function isAtomic(element: Element): boolean {
  return ATOMIC_TAG_NAMES.has(element.tagName.toLowerCase()) || totalTextLength(element) === 0;
}

/** Walks `root`'s block structure, collecting each block-level leaf
 * element in document order (skipping into non-leaf block containers,
 * e.g. a `<div>` wrapping several `<p>`s, without treating the container
 * itself as a leaf). Checks `isAtomic` *before* `isLeaf` — a real,
 * confirmed bug: a `<table>` (declared atomic via `ATOMIC_TAG_NAMES`,
 * specifically so pagination never breaks in the middle of one) has
 * `<tr>`/`<td>` children, both block-level per `isBlockLevel` (their
 * default `display` is `table-row`/`table-cell`), so `isLeaf` alone
 * says a table is *not* a leaf and this recursed straight into it,
 * extracting each `<td>` as its own ordinary text leaf — completely
 * bypassing the "atomic, never split" intent and letting a page break
 * land mid-table. Caught via a real book (a DocBook-generated EPUB
 * using a `<table>` to lay out a short poem/rhyme) where the poem
 * visibly split across a page boundary — the reported "pages can be
 * cut off" bug. The same reasoning applies to any other structurally
 * complex atomic tag (e.g. `<figure>` wrapping a captioned image). */
function collectLeaves(root: Element, out: Element[]): void {
  for (const child of Array.from(root.children)) {
    if (isAtomic(child) || isLeaf(child)) {
      out.push(child);
    } else {
      collectLeaves(child, out);
    }
  }
}

/** Measures a single atomic leaf as one unbreakable `Chunk`. */
function measureAtomicChunk(element: Element): Chunk {
  const rect = element.getBoundingClientRect();
  const parent = element.parentNode;
  if (!parent) {
    throw new Error("Atomic leaf element has no parent — cannot compute its break-before position.");
  }
  const index = Array.prototype.indexOf.call(parent.childNodes, element);
  return {
    top: rect.top,
    bottom: rect.bottom,
    breakBefore: { node: parent, offset: index },
  };
}

/** The vertical tolerance (in CSS pixels) within which two rects are
 * considered "the same line" — accounts for sub-pixel layout rounding,
 * not a meaningful visual difference. */
const LINE_TOLERANCE_PX = 1;

/** Measures a text leaf's rendered lines (via `Range.getClientRects()`,
 * a real layout query — not an approximation) as one `Chunk` per visual
 * line, each with its exact DOM break position found by bisecting the
 * leaf's concatenated text content against further `Range` measurements. */
function measureTextLeafChunks(element: Element, ownerDocument: Document): Chunk[] {
  const fullRange = ownerDocument.createRange();
  fullRange.selectNodeContents(element);
  const lineRects = Array.from(fullRange.getClientRects()).filter((r) => r.height > 0);

  if (lineRects.length === 0) {
    return [];
  }

  const totalLength = totalTextLength(element);
  const chunks: Chunk[] = [];

  // The first line always starts at the beginning of the leaf itself.
  chunks.push({
    top: lineRects[0]!.top,
    bottom: lineRects[0]!.bottom,
    breakBefore: { node: element, offset: 0 },
  });

  for (let lineIndex = 1; lineIndex < lineRects.length; lineIndex++) {
    const targetTop = lineRects[lineIndex]!.top;
    const offset = bisectLineStartOffset(element, ownerDocument, totalLength, targetTop);
    const position = globalTextOffsetToPosition(element, offset);
    if (!position) {
      continue;
    }
    chunks.push({
      top: lineRects[lineIndex]!.top,
      bottom: lineRects[lineIndex]!.bottom,
      breakBefore: { node: position.node, offset: position.offset },
    });
  }

  return chunks;
}

/** Binary-searches the smallest global text offset within `element` whose
 * rendered position has already reached `targetTop` — i.e. the character
 * offset where the line starting at `targetTop` begins. Relies purely on
 * `Range.getClientRects()`, a real layout measurement, evaluated at each
 * candidate offset. */
function bisectLineStartOffset(
  element: Element,
  ownerDocument: Document,
  totalLength: number,
  targetTop: number,
): number {
  let lo = 0;
  let hi = totalLength;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hasReachedLine(element, ownerDocument, mid, targetTop)) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}

function hasReachedLine(
  element: Element,
  ownerDocument: Document,
  globalOffset: number,
  targetTop: number,
): boolean {
  if (globalOffset === 0) {
    return false;
  }
  const position = globalTextOffsetToPosition(element, globalOffset);
  if (!position) {
    return false;
  }

  const range = ownerDocument.createRange();
  range.selectNodeContents(element);
  range.setEnd(position.node, position.offset);
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
  const lastRect = rects[rects.length - 1];
  return lastRect ? lastRect.top >= targetTop - LINE_TOLERANCE_PX : false;
}

/**
 * Measures `bodyElement`'s full rendered content as an ordered sequence
 * of `Chunk`s (one per visual line of text, or one per atomic element),
 * the fundamental unit `PageBreakPlanner` decides page breaks between.
 * Requires `bodyElement` to already be laid out in a real browser
 * rendering engine (its owner document unscrolled, so `getBoundingClientRect`/
 * `getClientRects` values reflect true layout position) — this cannot be
 * meaningfully exercised in a DOM-polyfill test environment like
 * happy-dom, which doesn't implement real layout.
 */
export function measureChunks(bodyElement: Element): Chunk[] {
  const ownerDocument = bodyElement.ownerDocument;
  const leaves: Element[] = [];
  collectLeaves(bodyElement, leaves);

  const chunks: Chunk[] = [];
  for (const leaf of leaves) {
    if (isAtomic(leaf)) {
      chunks.push(measureAtomicChunk(leaf));
    } else {
      chunks.push(...measureTextLeafChunks(leaf, ownerDocument));
    }
  }
  return chunks;
}

export { isBlockLevel, isLeaf, isAtomic };
