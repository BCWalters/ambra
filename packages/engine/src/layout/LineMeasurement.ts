import {
  collectTextNodesOf,
  positionFromTextNodes,
  sumTextLength,
  totalTextLength,
} from "./DomTextWalker.js";
import { isReaderOwnedContent } from "../content/ReaderOwnedContent.js";

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
  "math",
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
  return !Array.from(element.children).some((child) => !isReaderOwnedContent(child) && isBlockLevel(child));
}

function isAtomic(element: Element): boolean {
  return (
    ATOMIC_TAG_NAMES.has(element.tagName.toLowerCase()) ||
    (element.localName === "details" && !element.hasAttribute("open")) ||
    totalTextLength(element) === 0
  );
}

interface InlineRun {
  readonly root: Element;
  readonly start: number;
  readonly end: number;
}

type Leaf = Element | InlineRun;

/** Partition a container into non-overlapping block leaves and inline runs.
 * Keeping runs as DOM ranges preserves text around nested blocks without
 * wrapping/moving nodes or measuring a descendant twice. Atomic containers
 * (especially tables) must be recognized before descending into their blocks. */
function* collectLeaves(root: Element): Generator<Leaf | undefined> {
  const nodes = Array.from(root.childNodes);
  let runStart = 0;
  const inlineRun = (end: number): InlineRun | undefined => {
    const run = nodes.slice(runStart, end);
    if (run.some((node) => node.nodeType === 1 || node.textContent?.trim())) {
      return { root, start: runStart, end };
    }
  };
  for (let index = 0; index < nodes.length; index++) {
    yield undefined;
    const node = nodes[index]!;
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    if (isReaderOwnedContent(child)) {
      yield inlineRun(index);
      runStart = index + 1;
      continue;
    }
    const display = getComputedStyle(child).display;
    if (
      display !== "contents" &&
      child.checkVisibility() &&
      !isBlockLevel(child) &&
      !isAtomic(child) &&
      isLeaf(child)
    ) {
      continue;
    }
    yield inlineRun(index);
    // Closed disclosures can return nonzero descendant rectangles even though
    // those descendants are not rendered. Measuring them creates phantom pages.
    if (child.localName === "details" && !child.hasAttribute("open")) {
      const summary = Array.from(child.children).find((element) => element.localName === "summary");
      if (child.checkVisibility() && summary) {
        if (isLeaf(summary)) yield summary;
        else yield* collectLeaves(summary);
      } else if (child.checkVisibility()) {
        // The browser supplies a default summary outside the authored DOM.
        yield child;
      }
    } else if (display === "contents") {
      yield* collectLeaves(child);
    } else if (child.checkVisibility()) {
      if (isAtomic(child) || isLeaf(child)) yield child;
      else yield* collectLeaves(child);
    }
    runStart = index + 1;
  }
  yield inlineRun(nodes.length);
}

/** Measures a single atomic leaf as one unbreakable `Chunk`. */
function measureAtomicChunk(element: Element): Chunk {
  const rect = element.getBoundingClientRect();
  const parent = element.parentNode;
  if (!parent) {
    throw new Error(
      "Atomic leaf element has no parent — cannot compute its break-before position.",
    );
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

/** Measures a text run's rendered lines (via `Range.getClientRects()`,
 * a real layout query — not an approximation) as one `Chunk` per visual
 * line, each with its exact DOM break position found by bisecting the
 * run's concatenated text content against further `Range` measurements. */
function* measureTextLeafChunks(
  fullRange: Range,
  textNodes: readonly Text[],
  viewportWidth: number,
): Generator<Chunk | undefined> {
  const lineRects = Array.from(fullRange.getClientRects()).filter((r) => paintsInViewport(r, viewportWidth));

  if (lineRects.length === 0) {
    return;
  }

  // Reuse pre-collected text nodes during bisection rather than repeatedly
  // walking the subtree, especially around large MathML expressions (#102).
  const totalLength = sumTextLength(textNodes);
  const probeRange = fullRange.cloneRange();
  const lineOffsets = new Map<number, number>();
  // A lone text node has no intervening inline boxes or atomic content whose
  // rect could end a prefix. Probe its last character instead of remeasuring
  // every preceding line. Complex inline runs retain the prefix algorithm.
  const usePointProbe = textNodes.length === 1 &&
    fullRange.startContainer === fullRange.endContainer &&
    fullRange.endOffset === fullRange.startOffset + 1 &&
    fullRange.startContainer.childNodes[fullRange.startOffset] === textNodes[0] &&
    getComputedStyle(textNodes[0]!.parentElement!).writingMode === "horizontal-tb";

  // A partial run begins at its own child boundary, not the container's start.
  yield {
    top: lineRects[0]!.top,
    bottom: lineRects[0]!.bottom,
    breakBefore: { node: fullRange.startContainer, offset: fullRange.startOffset },
  };

  for (let lineIndex = 1; lineIndex < lineRects.length; lineIndex++) {
    const targetTop = lineRects[lineIndex]!.top;
    let offset = lineOffsets.get(targetTop);
    if (offset === undefined) {
      offset = yield* bisectLineStartOffset(fullRange, probeRange, textNodes, totalLength, targetTop, usePointProbe, viewportWidth);
      lineOffsets.set(targetTop, offset);
    }
    const position = positionFromTextNodes(textNodes, offset);
    if (!position) {
      continue;
    }
    yield {
      top: lineRects[lineIndex]!.top,
      bottom: lineRects[lineIndex]!.bottom,
      breakBefore: { node: position.node, offset: position.offset },
    };
  }

}

/** Binary-searches the smallest global text offset within `fullRange` whose
 * rendered position has already reached `targetTop` — i.e. the character
 * offset where the line starting at `targetTop` begins. Relies purely on
 * `Range.getClientRects()`, a real layout measurement, evaluated at each
 * candidate offset. `textNodes` contains only this range's text nodes,
 * collected once by the caller (see `measureTextLeafChunks`) rather than
 * re-walked on every bisection step. */
function* bisectLineStartOffset(
  fullRange: Range,
  probeRange: Range,
  textNodes: readonly Text[],
  totalLength: number,
  targetTop: number,
  usePointProbe: boolean,
  viewportWidth: number,
): Generator<undefined, number> {
  let lo = 0;
  let hi = totalLength;

  while (lo < hi) {
    yield undefined;
    const mid = (lo + hi) >> 1;
    if (hasReachedLine(fullRange, probeRange, textNodes, mid, targetTop, usePointProbe, viewportWidth)) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return lo;
}

function hasReachedLine(
  fullRange: Range,
  range: Range,
  textNodes: readonly Text[],
  globalOffset: number,
  targetTop: number,
  usePointProbe: boolean,
  viewportWidth: number,
): boolean {
  if (globalOffset === 0) {
    return false;
  }
  const position = positionFromTextNodes(textNodes, globalOffset);
  if (!position) {
    return false;
  }

  range.setStart(
    usePointProbe ? position.node : fullRange.startContainer,
    usePointProbe ? position.offset - 1 : fullRange.startOffset,
  );
  range.setEnd(position.node, position.offset);
  const rects = range.getClientRects();
  for (let index = rects.length - 1; index >= 0; index--) {
    const rect = rects[index]!;
    if (paintsInViewport(rect, viewportWidth)) {
      if (usePointProbe && rect.width === 0) break;
      return rect.top >= targetTop - LINE_TOLERANCE_PX;
    }
  }
  // Collapsed whitespace can have a zero-width rect on the next line even
  // when its prefix still ends on the previous one. Keep exact old boundaries.
  return usePointProbe
    ? hasReachedLine(fullRange, range, textNodes, globalOffset, targetTop, false, viewportWidth)
    : false;
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
function* chunkMeasurements(bodyElement: Element): Generator<Chunk | undefined> {
  const ownerDocument = bodyElement.ownerDocument;
  const viewportWidth = ownerDocument.documentElement.clientWidth;

  for (const leaf of collectLeaves(bodyElement)) {
    yield undefined;
    if (!leaf) continue;
    if (!("root" in leaf) && isAtomic(leaf)) {
      if (paintsInViewport(leaf.getBoundingClientRect(), viewportWidth)) {
        yield measureAtomicChunk(leaf);
      }
    } else {
      const range = ownerDocument.createRange();
      let textNodes: Text[];
      if ("root" in leaf) {
        range.setStart(leaf.root, leaf.start);
        range.setEnd(leaf.root, leaf.end);
        textNodes = [];
        for (let index = leaf.start; index < leaf.end; index++) {
          const node = leaf.root.childNodes[index]!;
          if (node.nodeType === 3 || node.nodeType === 4) textNodes.push(node as Text);
          else textNodes.push(...collectTextNodesOf(node));
        }
      } else {
        range.selectNodeContents(leaf);
        textNodes = collectTextNodesOf(leaf);
      }
      yield* measureTextLeafChunks(range, textNodes, viewportWidth);
    }
  }
}

/** Horizontal clipping is visual only: offscreen semantic headings remain
 * untouched in the DOM/accessibility tree. Do not exclude positioned elements:
 * visible absolute content and descendants still need to contribute bounds. */
function paintsInViewport(rect: DOMRect, viewportWidth: number): boolean {
  return rect.height > 0 && (viewportWidth <= 0 || (rect.right > 0 && rect.left < viewportWidth));
}

export function measureChunks(bodyElement: Element): Chunk[] {
  const chunks: Chunk[] = [];
  for (const chunk of chunkMeasurements(bodyElement)) {
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

export interface IncrementalMeasurementOptions {
  readonly signal?: AbortSignal;
  readonly timeSliceMs?: number;
}

/** Background-only measurement. The caller must keep this document's layout
 * stable until completion; foreground pagination deliberately remains atomic.
 * Checkpoints include each bisection, not just each (potentially huge) leaf. */
export async function measureChunksIncrementally(
  bodyElement: Element,
  { signal, timeSliceMs = 8 }: IncrementalMeasurementOptions = {},
): Promise<Chunk[]> {
  signal?.throwIfAborted();
  const chunks: Chunk[] = [];
  let deadline = performance.now() + Math.max(1, timeSliceMs);
  for (const chunk of chunkMeasurements(bodyElement)) {
    signal?.throwIfAborted();
    if (chunk) chunks.push(chunk);
    if (performance.now() >= deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      deadline = performance.now() + Math.max(1, timeSliceMs);
    }
  }
  return chunks;
}

export { isBlockLevel, isLeaf, isAtomic };
