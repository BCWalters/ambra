import {
  collectTextNodesOf,
  positionFromTextNodes,
  sumTextLength,
  totalTextLength,
} from "./DomTextWalker.js";
import { isReaderOwnedContent } from "../content/ReaderOwnedContent.js";
import { measureSimpleTableRows } from "./SimpleTable.js";
import type { DomBreakPoint, DomPositionRange, PositionOverride } from "./Page.js";
import { compareDomPositions } from "./ScrollPositionTracker.js";

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
  /** The original-DOM reading anchor for this chunk's visual start.
   * Reordered figures provide explicit membership separately. */
  readonly breakBefore: { node: Node; offset?: number };
  /** Shared bounds of authored break-inside avoidance boxes containing this
   * chunk. Lines remain separate for oversized boxes and scroll tracking. */
  readonly avoidanceGroups?: readonly AvoidanceGroup[];
  readonly positionOverride?: PositionOverride;
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

interface ReorderedFigure {
  readonly figure: Element;
  readonly parts: readonly Element[];
  readonly illustration: Element;
}

type Leaf = Element | InlineRun | ReorderedFigure;

interface MeasuredLeaf {
  readonly leaf: Leaf;
  readonly groups: readonly MutableAvoidanceGroup[];
}

interface MutableAvoidanceGroup {
  top: number;
  bottom: number;
}

function oversizedFigureParts(element: Element, pageHeight: number): readonly Element[] | ReorderedFigure | undefined {
  if (element.localName !== "figure" || !Number.isFinite(pageHeight) ||
    element.parentElement?.closest("figure, table")) return;
  const children = Array.from(element.children).filter(child => !isReaderOwnedContent(child));
  const captions = children.filter(child => child.localName === "figcaption");
  const illustrations = children.filter(child => child.localName !== "figcaption");
  if (captions.length > 1 || illustrations.length !== 1) return;

  const normalFlow = (node: Element, allowScripts = false): boolean => {
    const style = getComputedStyle(node);
    const replaced = node.localName === "img" || node.localName === "svg";
    const script = allowScripts && (node.localName === "sub" || node.localName === "sup") &&
      [style.left, style.right].every(value => value === "auto" || value === "0px") &&
      [style.top, style.bottom].every(value => value === "auto" ||
        (value.endsWith("px") && Math.abs(Number.parseFloat(value)) <= Number.parseFloat(style.fontSize)));
    return (style.display === "block" || style.display === "inline" || style.display === "contents" ||
      (node === element && style.display === "table") ||
      (node.localName === "figcaption" && style.display === "table-caption")) &&
      (style.position === "static" || (style.position === "relative" &&
        (script || [style.top, style.right, style.bottom, style.left].every(value => value === "auto" || value === "0px")))) &&
      style.float === "none" && style.transform === "none" && style.writingMode === "horizontal-tb" &&
      (replaced || (style.overflowX === "visible" && style.overflowY === "visible" && style.clipPath === "none")) &&
      ["::before", "::after"].every(pseudo => {
        const content = getComputedStyle(node, pseudo).content;
        return content === "none" || content === "normal";
      });
  };
  const hasDirectText = (node: Element): boolean => Array.from(node.childNodes).some(child =>
    (child.nodeType === 3 || child.nodeType === 4) && !!child.textContent?.trim());
  if (!normalFlow(element) || hasDirectText(element)) return;
  let image = illustrations[0]!;
  while (image.localName !== "img" && image.localName !== "svg") {
    if (!["a", "span", "div", "p", "picture"].includes(image.localName) || !normalFlow(image) || hasDirectText(image)) return;
    const nested = Array.from(image.children).filter(child => !isReaderOwnedContent(child) &&
      !(image.localName === "picture" && child.localName === "source"));
    if (nested.length !== 1) return;
    image = nested[0]!;
  }
  if (!normalFlow(image) || !image.checkVisibility()) return;
  const caption = captions[0];
  const parts = children.map(child => child === caption ? child : image);
  const bounds = parts.map(part => part.getBoundingClientRect());
  const visualBounds = [...bounds].sort((a, b) => a.top - b.top);
  if (bounds.some(rect => rect.width <= 0 || rect.height <= 0) ||
    visualBounds.some((rect, index) => index > 0 && rect.top < visualBounds[index - 1]!.bottom) ||
    bounds[parts.indexOf(image)]!.height > pageHeight) return;
  const figure = element.getBoundingClientRect();
  if (Math.max(figure.bottom, visualBounds[visualBounds.length - 1]!.bottom) -
    Math.min(figure.top, visualBounds[0]!.top) <= pageHeight) return;
  const reordered = bounds[0] !== visualBounds[0];
  if (caption && [caption, ...caption.querySelectorAll("*")].some(node =>
    ATOMIC_TAG_NAMES.has(node.localName) || !normalFlow(node, reordered) ||
    (reordered && (getComputedStyle(node).columnWidth !== "auto" ||
      !["auto", "1"].includes(getComputedStyle(node).columnCount))))) return;
  if (reordered) return { figure: element, parts, illustration: illustrations[0]! };
  return parts;
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
      const figureParts = oversizedFigureParts(child, pageHeight);
      if (figureParts && "figure" in figureParts) {
        yield { leaf: figureParts, groups: childGroups };
      } else if (figureParts) {
        for (const part of figureParts) {
          const partGroups = avoidanceGroups(part, getComputedStyle(part), childGroups);
          if (isAtomic(part, pageHeight) || isLeaf(part)) yield { leaf: part, groups: partGroups };
          else yield* collectLeaves(part, partGroups, pageHeight);
        }
      } else if (isAtomic(child, pageHeight) || isLeaf(child)) yield { leaf: child, groups: childGroups };
      else yield* collectLeaves(child, childGroups, pageHeight);
    }
    runStart = index + 1;
  }
  yield inlineRun(nodes.length);
}

function positionBefore(element: Element): DomBreakPoint {
  const parent = element.parentNode;
  if (!parent) {
    throw new Error(
      "Atomic leaf element has no parent — cannot compute its break-before position.",
    );
  }
  const index = Array.prototype.indexOf.call(parent.childNodes, element);
  return { node: parent, offset: index };
}

/** Measures a single atomic leaf as one unbreakable `Chunk`. */
function measureAtomicChunk(element: Element, rect: DOMRect): Chunk {
  return { top: rect.top, bottom: rect.bottom, breakBefore: positionBefore(element) };
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

const BASELINE_INLINE_TEXT_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "del", "em", "i",
  "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strong",
  "sub", "sup", "time", "u", "var", "wbr",
]);

function* normalizeWrappingInlineRects(range: Range, rects: DOMRect[]): Generator<undefined, DOMRect[]> {
  if (!rects.some((rect, index) => index > 0 && rect.top < rects[index - 1]!.top - LINE_TOLERANCE_PX)) return rects;
  const root = range.commonAncestorContainer;
  if (root.nodeType !== 1) return rects;
  const rootStyle = getComputedStyle(root as Element);
  if (rootStyle.writingMode !== "horizontal-tb" || rootStyle.position !== "static" ||
    rootStyle.float !== "none" || rootStyle.transform !== "none") return rects;

  const seen = new Set<string>();
  const lines: DOMRect[] = [];
  for (let index = 0; index < rects.length; index++) {
    if (index % 64 === 0) yield undefined;
    const rect = rects[index]!;
    const key = `${rect.top}:${rect.bottom}`;
    if (seen.has(key)) continue;
    const previous = lines[lines.length - 1];
    if (previous && rect.top < previous.bottom - LINE_TOLERANCE_PX) return rects;
    seen.add(key);
    lines.push(rect);
  }

  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => isReaderOwnedContent(node) || !range.intersectsNode(node)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) {
    yield undefined;
    const element = walker.currentNode as Element;
    if (!BASELINE_INLINE_TEXT_TAGS.has(element.localName)) return rects;
    const style = getComputedStyle(element);
    if (style.display !== "inline" || style.verticalAlign !== "baseline" ||
      style.position !== "static" || style.float !== "none" ||
      style.transform !== "none" || style.writingMode !== "horizontal-tb") return rects;
  }
  // Chromium can report all lines of a wrapping inline element, then the same
  // lines again for its text. Keep the first occurrence only when the resulting
  // text bands are already ordered and disjoint; never sort mixed geometry.
  return lines;
}

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
  reorderedCaption = false,
): Generator<Chunk | undefined> {
  const rects = Array.from(fullRange.getClientRects()).filter((r) => paintsInViewport(r, viewportWidth));
  // Continuous-scroll tracking keeps its existing line geometry.
  const lineRects = reorderedCaption ? yield* captionLineBands(rects) : Number.isFinite(pageHeight)
    ? yield* normalizeWrappingInlineRects(fullRange, excludeOverlappingBreakRects(fullRange, rects))
    : rects;

  if (lineRects.length === 0) {
    return;
  }

  /** Only used inside already-validated normal-flow captions. Union each physical
   * line's inline boxes, including small raised/lowered scripts; DOM boundaries
   * are then measured afresh rather than sorted alongside these rectangles. */
  function* captionLineBands(rects: readonly DOMRect[]): Generator<undefined, DOMRect[]> {
    const lines: DOMRect[] = [];
    const ordered = [...rects].sort((a, b) => a.top - b.top);
    for (let index = 0; index < ordered.length; index++) {
      if (index % 64 === 0) yield undefined;
      const rect = ordered[index]!;
      const previous = lines.at(-1);
      if (previous && rect.top < previous.bottom) {
        const left = Math.min(previous.left, rect.left);
        lines[lines.length - 1] = new DOMRect(left, previous.top,
          Math.max(previous.right, rect.right) - left, Math.max(previous.bottom, rect.bottom) - previous.top);
      } else lines.push(rect);
    }
    return lines;
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
function* chunkMeasurements(
  bodyElement: Element, pageHeight: number, parents: readonly MutableAvoidanceGroup[] = [], includeRoot = false,
  reorderedCaption = false,
): Generator<Chunk | undefined> {
  const ownerDocument = bodyElement.ownerDocument;
  const viewportWidth = ownerDocument.documentElement.clientWidth;

  const groups = avoidanceGroups(bodyElement, getComputedStyle(bodyElement), parents);
  const leaves = includeRoot && (isAtomic(bodyElement, pageHeight) || isLeaf(bodyElement))
    ? [{ leaf: bodyElement, groups }] : collectLeaves(bodyElement, groups, pageHeight);
  for (const measured of leaves) {
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
    if ("figure" in leaf) {
      const parts: Chunk[][] = [];
      for (const part of leaf.parts) {
        const chunks: Chunk[] = [];
        for (const chunk of chunkMeasurements(part, pageHeight, groups, true, part.localName === "figcaption")) {
          yield undefined;
          if (!chunk) continue;
          let start = chunk.breakBefore;
          // Prefix bisection reaches a line after including its first glyph.
          // Explicit membership must include that glyph, not its trailing caret.
          if (start.node.nodeType === 3 && (start.offset ?? 0) > 0) {
            const range = ownerDocument.createRange();
            range.setStart(start.node, start.offset! - 1);
            range.setEnd(start.node, start.offset!);
            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.top >= chunk.top && rect.bottom <= chunk.bottom) {
              start = { node: start.node, offset: start.offset! - 1 };
            }
          }
          chunks.push({ ...chunk, breakBefore: start });
        }
        parts.push(chunks);
      }
      const orderedParts = [...parts].sort((a, b) => (a[0]?.top ?? 0) - (b[0]?.top ?? 0));
      if (orderedParts.some((chunks, index) => index > 0 &&
        chunks[0] && orderedParts[index - 1]!.at(-1) && chunks[0].top < orderedParts[index - 1]!.at(-1)!.bottom) ||
        parts.some(chunks => chunks.length === 0 || chunks.some((chunk, index) => index > 0 &&
        (chunk.top < chunks[index - 1]!.bottom ||
          compareDomPositions(chunk.breakBefore, chunks[index - 1]!.breakBefore) <= 0)))) {
        yield withGroups(measureAtomicChunk(leaf.figure, leaf.figure.getBoundingClientRect()));
        continue;
      }
      const visual = orderedParts.flat();
      const start = positionBefore(leaf.figure);
      const scope: DomPositionRange = { start, end: { node: start.node, offset: (start.offset ?? 0) + 1 } };
      const entries: { start: DomBreakPoint; chunk: Chunk }[] = [{ start, chunk: visual[0]! }];
      for (let index = 0; index < parts.length; index++) {
        const chunks = parts[index]!;
        const part = leaf.parts[index]!;
        const outer = part.localName === "figcaption" ? part : leaf.illustration;
        const boundary = positionBefore(outer);
        // The figure's own start targets its visually first part, not its first DOM child.
        if ((boundary.offset ?? 0) > 0) entries.push({ start: boundary, chunk: chunks[0]! });
        entries.push({ start: { node: outer, offset: 0 }, chunk: chunks[0]! });
        for (const chunk of chunks) {
          const previous = entries.at(-1)!;
          if (compareDomPositions(chunk.breakBefore, previous.start) >= 0) {
            entries.push({ start: chunk.breakBefore, chunk });
          }
        }
      }
      const ranges = new Map<Chunk, DomPositionRange[]>();
      for (let index = 0; index < entries.length; index++) {
        yield undefined;
        const entry = entries[index]!;
        const end = entries[index + 1]?.start ?? scope.end;
        if (compareDomPositions(entry.start, end) >= 0) continue;
        const owned = ranges.get(entry.chunk) ?? [];
        owned.push({ start: entry.start, end });
        ranges.set(entry.chunk, owned);
      }
      for (const chunk of visual) {
        yield {
          ...chunk,
          breakBefore: chunk === visual[0] ? start : chunk.breakBefore,
          positionOverride: { scope, ranges: ranges.get(chunk)! },
        };
      }
    } else if (!("root" in leaf) && isAtomic(leaf, pageHeight)) {
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
      for (const chunk of measureTextLeafChunks(range, textNodes, viewportWidth, pageHeight, reorderedCaption)) {
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
