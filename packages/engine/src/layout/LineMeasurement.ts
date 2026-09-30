import {
  collectTextNodesOf,
  positionFromTextNodes,
  sumTextLength,
  totalTextLength,
} from "./DomTextWalker.js";
import { isReaderOwnedContent } from "../content/ReaderOwnedContent.js";
import { measureSimpleTableRows } from "./SimpleTable.js";

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
  /** Shared bounds of authored break-inside avoidance boxes containing this
   * chunk. Lines remain separate for oversized boxes and scroll tracking. */
  readonly avoidanceGroups?: readonly AvoidanceGroup[];
}

export interface AvoidanceGroup {
  readonly top: number;
  readonly bottom: number;
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
  return isBlockDisplay(getComputedStyle(element).display);
}

function isBlockDisplay(display: string): boolean {
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

function isAtomic(element: Element, pageHeight = Infinity): boolean {
  if (
    ATOMIC_TAG_NAMES.has(element.tagName.toLowerCase()) ||
    (element.localName === "details" && !element.hasAttribute("open")) ||
    totalTextLength(element) === 0
  ) return true;
  // Formatting whitespace must not hide a lone image behind an inline line box.
  // Preserve fragmentation of galleries, explicit breaks and preformatted runs.
  if (!Number.isFinite(pageHeight) || element.firstElementChild === null ||
    element.querySelectorAll("img, svg").length !== 1 || element.querySelector("br")) return false;
  const style = getComputedStyle(element);
  return (style.whiteSpace === "normal" || style.whiteSpace === "nowrap") &&
    (style.display === "inline" || isLeaf(element)) &&
    collectTextNodesOf(element).every(node => !node.textContent?.trim());
}

interface InlineRun {
  readonly root: Element;
  readonly start: number;
  readonly end: number;
}

type Leaf = Element | InlineRun;

interface MeasuredLeaf {
  readonly leaf: Leaf;
  readonly groups: readonly MutableAvoidanceGroup[];
}

interface MutableAvoidanceGroup {
  top: number;
  bottom: number;
}

function avoidanceGroups(
  element: Element,
  style: CSSStyleDeclaration,
  parents: readonly MutableAvoidanceGroup[],
): readonly MutableAvoidanceGroup[] {
  // Chromium normalizes legacy page-break-inside: avoid to break-inside.
  // Inline boxes and display:contents do not establish fragmentation boxes.
  if (
    (style.breakInside !== "avoid" && style.breakInside !== "avoid-page") ||
    style.display === "inline" || style.display === "contents" || style.display === "none"
  ) return parents;
  const rect = element.getBoundingClientRect();
  return [...parents, { top: rect.top, bottom: rect.bottom }];
}

/** Partition a container into non-overlapping block leaves and inline runs.
 * Keeping runs as DOM ranges preserves text around nested blocks without
 * wrapping/moving nodes or measuring a descendant twice. Atomic containers
 * (especially tables) must be recognized before descending into their blocks. */
function* collectLeaves(
  root: Element,
  groups: readonly MutableAvoidanceGroup[],
  pageHeight: number,
): Generator<MeasuredLeaf | undefined> {
  const nodes = Array.from(root.childNodes);
  let runStart = 0;
  const inlineRun = (end: number): MeasuredLeaf | undefined => {
    const run = nodes.slice(runStart, end);
    if (run.some((node) => node.nodeType === 1 || node.textContent?.trim())) {
      return { leaf: { root, start: runStart, end }, groups };
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
    const style = getComputedStyle(child);
    const display = style.display;
    if (
      display !== "contents" &&
      child.checkVisibility() &&
      !isBlockDisplay(display) &&
      !isAtomic(child, pageHeight) &&
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
        const childGroups = avoidanceGroups(child, style, groups);
        const summaryGroups = avoidanceGroups(summary, getComputedStyle(summary), childGroups);
        if (isLeaf(summary)) yield { leaf: summary, groups: summaryGroups };
        else yield* collectLeaves(summary, summaryGroups, pageHeight);
      } else if (child.checkVisibility()) {
        // The browser supplies a default summary outside the authored DOM.
        yield { leaf: child, groups: avoidanceGroups(child, style, groups) };
      }
    } else if (display === "contents") {
      yield* collectLeaves(child, groups, pageHeight);
    } else if (child.checkVisibility()) {
      const childGroups = avoidanceGroups(child, style, groups);
      if (isAtomic(child, pageHeight) || isLeaf(child)) yield { leaf: child, groups: childGroups };
      else yield* collectLeaves(child, childGroups, pageHeight);
    }
    runStart = index + 1;
  }
  yield inlineRun(nodes.length);
}

/** Measures a single atomic leaf as one unbreakable `Chunk`. */
function measureAtomicChunk(element: Element, rect: DOMRect): Chunk {
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

function atomicBounds(element: Element, pageHeight: number, viewportWidth: number): DOMRect {
  const rect = element.getBoundingClientRect();
  if (!Number.isFinite(pageHeight) || ATOMIC_TAG_NAMES.has(element.localName) ||
    !element.querySelector("img, svg") || getComputedStyle(element).display !== "inline") return rect;

  const hasBox = rect.width > 0 && paintsInViewport(rect, viewportWidth);
  let top = hasBox ? rect.top : Infinity;
  let bottom = hasBox ? rect.bottom : -Infinity;
  let left = hasBox ? rect.left : Infinity;
  let right = hasBox ? rect.right : -Infinity;
  const pending = Array.from(element.children);
  while (pending.length) {
    const child = pending.pop()!;
    const style = getComputedStyle(child);
    if (style.display === "contents") {
      for (const descendant of child.children) pending.push(descendant);
      continue;
    }
    if (!child.checkVisibility()) continue;
    const bounds = child.getBoundingClientRect();
    if (bounds.width > 0 && paintsInViewport(bounds, viewportWidth)) {
      top = Math.min(top, bounds.top);
      bottom = Math.max(bottom, bounds.bottom);
      left = Math.min(left, bounds.left);
      right = Math.max(right, bounds.right);
    }
    // Inline wrappers have line boxes, not bounds enclosing their images.
    // Other boxes keep their own bounds: descendants may be intentionally clipped.
    if (!ATOMIC_TAG_NAMES.has(child.localName) && style.display === "inline") {
      for (const descendant of child.children) pending.push(descendant);
    }
  }
  return Number.isFinite(top) ? new DOMRect(left, top, right - left, bottom - top) : rect;
}

/** The vertical tolerance (in CSS pixels) within which two rects are
 * considered "the same line" — accounts for sub-pixel layout rounding,
 * not a meaningful visual difference. */
const LINE_TOLERANCE_PX = 1;

function excludeOverlappingBreakRects(range: Range, rects: DOMRect[]): DOMRect[] {
  const key = (rect: DOMRect): string => `${rect.left}:${rect.top}:${rect.right}:${rect.bottom}`;
  const candidates = new Map<string, string>();
  let previous: DOMRect | undefined;
  for (const rect of rects) {
    if (rect.width > 0) previous = rect;
    else if (previous && rect.top >= previous.top && rect.top < previous.bottom &&
      rect.bottom > previous.bottom) candidates.set(key(rect), key(previous));
  }
  const root = range.commonAncestorContainer;
  if (candidates.size === 0 || root.nodeType !== 1) return rects;
  const images = new Set(Array.from((root as Element).querySelectorAll("img"))
    .filter(image => range.intersectsNode(image))
    .map(image => key(image.getBoundingClientRect())));
  for (const [rect, previous] of candidates) {
    if (!images.has(previous)) candidates.delete(rect);
  }
  if (candidates.size === 0) return rects;

  // An inline image's following BR can extend below its baseline while
  // overlapping the image. That empty box must not start a second image slice.
  const excluded = new Set<string>();
  for (const br of (root as Element).querySelectorAll("br")) {
    if (!range.intersectsNode(br)) continue;
    const rect = br.getBoundingClientRect();
    if (rect.width === 0 && candidates.has(key(rect))) excluded.add(key(rect));
  }
  return rects.filter(rect => rect.width !== 0 || !excluded.has(key(rect)));
}

/** Measures a text run's rendered lines (via `Range.getClientRects()`,
 * a real layout query — not an approximation) as one `Chunk` per visual
 * line, each with its exact DOM break position found by bisecting the
 * run's concatenated text content against further `Range` measurements. */
function* measureTextLeafChunks(
  fullRange: Range,
  textNodes: readonly Text[],
  viewportWidth: number,
  pageHeight: number,
): Generator<Chunk | undefined> {
  const rects = Array.from(fullRange.getClientRects()).filter((r) => paintsInViewport(r, viewportWidth));
  // Continuous-scroll tracking keeps its existing line geometry.
  const lineRects = Number.isFinite(pageHeight) ? excludeOverlappingBreakRects(fullRange, rects) : rects;

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
function* chunkMeasurements(bodyElement: Element, pageHeight: number): Generator<Chunk | undefined> {
  const ownerDocument = bodyElement.ownerDocument;
  const viewportWidth = ownerDocument.documentElement.clientWidth;

  const groups = avoidanceGroups(bodyElement, getComputedStyle(bodyElement), []);
  for (const measured of collectLeaves(bodyElement, groups, pageHeight)) {
    yield undefined;
    if (!measured) continue;
    const { leaf, groups } = measured;
    const withGroups = (chunk: Chunk): Chunk => {
      if (groups.length === 0) return chunk;
      // Propagate painted descendants' full boxes from inner to outer groups.
      // Shared group bounds are complete before either planner consumes them.
      let top = chunk.top;
      let bottom = chunk.bottom;
      for (let index = groups.length - 1; index >= 0; index--) {
        const group = groups[index]!;
        top = group.top = Math.min(group.top, top);
        bottom = group.bottom = Math.max(group.bottom, bottom);
      }
      return { ...chunk, avoidanceGroups: groups };
    };
    if (!("root" in leaf) && isAtomic(leaf, pageHeight)) {
      if (leaf.localName === "table") {
        const rows = measureSimpleTableRows(leaf as HTMLTableElement, pageHeight);
        if (rows) {
          // Keep fitting tables whole; the planner relaxes this group when oversized.
          const tableGroup = { top: rows[0]!.top, bottom: rows[rows.length - 1]!.bottom };
          for (const row of rows) {
            const chunk = withGroups({
              top: row.top, bottom: row.bottom,
              breakBefore: row === rows[0]
                ? { node: leaf.parentNode!, offset: Array.prototype.indexOf.call(leaf.parentNode!.childNodes, leaf) }
                : { node: row.element, offset: 0 },
            });
            yield { ...chunk, avoidanceGroups: [...(chunk.avoidanceGroups ?? []), tableGroup] };
          }
          continue;
        }
      }
      const bounds = atomicBounds(leaf, pageHeight, viewportWidth);
      if (paintsInViewport(bounds, viewportWidth)) {
        yield withGroups(measureAtomicChunk(leaf, bounds));
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
      for (const chunk of measureTextLeafChunks(range, textNodes, viewportWidth, pageHeight)) {
        yield chunk && withGroups(chunk);
      }
    }
  }
}

/** Horizontal clipping is visual only: offscreen semantic headings remain
 * untouched in the DOM/accessibility tree. Do not exclude positioned elements:
 * visible absolute content and descendants still need to contribute bounds. */
function paintsInViewport(rect: DOMRect, viewportWidth: number): boolean {
  return rect.height > 0 && (viewportWidth <= 0 || (rect.right > 0 && rect.left < viewportWidth));
}

/** A finite page budget retains the atomic fallback for tables with oversized
 * rows. Scroll tracking has no page-height limit. */
export function measureChunks(bodyElement: Element, pageHeight = Infinity): Chunk[] {
  const chunks: Chunk[] = [];
  for (const chunk of chunkMeasurements(bodyElement, pageHeight)) {
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
  pageHeight = Infinity,
): Promise<Chunk[]> {
  signal?.throwIfAborted();
  const chunks: Chunk[] = [];
  let deadline = performance.now() + Math.max(1, timeSliceMs);
  for (const chunk of chunkMeasurements(bodyElement, pageHeight)) {
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
