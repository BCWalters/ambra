/**
 * Implements EPUB CFI's child-node step-numbering rule (CFI spec §3.1.1),
 * independent of any specific document (works identically for the OPF
 * package document and for content XHTML documents — both use the same
 * rule, just relative to a different root element).
 *
 * The rule, precisely: each **element** child is assigned an even index
 * (2, 4, 6, ...) in document order. Each **run** of consecutive non-element
 * "text-like" nodes (text, CDATA, entity references) before/between/after
 * elements is assigned an odd index, interleaved with the element indices
 * (a run before the first element is 1; a run between the Nth and
 * (N+1)th element is 2N+1; a run after the last element is
 * 2*elementCount+1). Comments and processing instructions are ignored
 * entirely — they never consume an index and are skipped when counting.
 *
 * This indexing is deliberately insensitive to how many separate DOM text
 * nodes happen to make up a run (a parser may or may not split adjacent
 * text into multiple `Text` nodes) — the whole run shares one index, and a
 * character offset within it is counted across the run's concatenated text.
 */

import { CfiStep } from "./EpubCfi.js";

// Standardized DOM Node.nodeType values, used as plain numeric literals
// (rather than referencing the global `ELEMENT_NODE` etc. constants)
// so this module has no dependency on a DOM global existing at all — it
// only needs objects that duck-type as DOM nodes (a `nodeType` number and
// sibling/child pointers), which keeps it usable from plain Node.js test
// code without pulling in happy-dom.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const ENTITY_REFERENCE_NODE = 5;

const TEXT_LIKE_NODE_TYPES = new Set<number>([
  TEXT_NODE,
  CDATA_SECTION_NODE,
  ENTITY_REFERENCE_NODE,
]);

function isTextLike(node: Node): boolean {
  return TEXT_LIKE_NODE_TYPES.has(node.nodeType);
}

/** Counts the element children of `parent` that precede `child` (or, if
 * `child` is itself a text-like node, the element children preceding its
 * run). Comments/PIs are skipped entirely, per spec. */
function countPrecedingElementSiblings(child: Node): number {
  let count = 0;
  let node: ChildNode | null = child.previousSibling;
  while (node) {
    if (node.nodeType === ELEMENT_NODE) {
      count++;
    }
    node = node.previousSibling;
  }
  return count;
}

/** The CFI step index for `child`, relative to its own parent. */
export function childStepIndex(child: Node): number {
  const precedingElements = countPrecedingElementSiblings(child);
  return child.nodeType === ELEMENT_NODE ? 2 * (precedingElements + 1) : 2 * precedingElements + 1;
}

/** Given a text-like node and a character offset local to it, returns the
 * CFI-level character offset counted from the start of its enclosing run
 * (the concatenation of all consecutive text-like siblings sharing the
 * same odd step index). */
export function runCharacterOffset(textNode: Node, localOffset: number): number {
  let offset = localOffset;
  let node: ChildNode | null = textNode.previousSibling;
  while (node && node.nodeType !== ELEMENT_NODE) {
    if (isTextLike(node)) {
      offset += node.textContent?.length ?? 0;
    }
    node = node.previousSibling;
  }
  return offset;
}

/** The ordered list of text-like nodes making up the run addressed by a
 * given odd step index under `parent` (i.e. every consecutive text-like
 * sibling between the same two elements, or before the first/after the
 * last). Comments/PIs are skipped over (they don't break a run). */
export function resolveTextRun(parent: Node, oddStepIndex: number): ChildNode[] {
  const targetPrecedingElementCount = (oddStepIndex - 1) / 2;

  let elementsSeen = 0;
  let node: ChildNode | null = parent.firstChild;

  // Advance past the `targetPrecedingElementCount`-th element (if any).
  while (node && elementsSeen < targetPrecedingElementCount) {
    if (node.nodeType === ELEMENT_NODE) {
      elementsSeen++;
    }
    node = node.nextSibling;
  }

  const run: ChildNode[] = [];
  while (node && node.nodeType !== ELEMENT_NODE) {
    if (isTextLike(node)) {
      run.push(node);
    }
    node = node.nextSibling;
  }
  return run;
}

/** The `elementIndex`-th (1-based) element child of `parent` — i.e. the
 * element addressed by CFI step index `2 * elementIndex`. */
export function resolveElementChild(parent: Node, elementIndex: number): Element | undefined {
  let elementsSeen = 0;
  let node: ChildNode | null = parent.firstChild;
  while (node) {
    if (node.nodeType === ELEMENT_NODE) {
      elementsSeen++;
      if (elementsSeen === elementIndex) {
        return node as Element;
      }
    }
    node = node.nextSibling;
  }
  return undefined;
}

/** Resolves a CFI-level character offset (counted across a whole text
 * run's concatenated content) back to a specific node + node-local offset
 * within that run. */
export function resolveOffsetInRun(
  run: readonly ChildNode[],
  cfiOffset: number,
): { node: ChildNode; localOffset: number } | undefined {
  let remaining = cfiOffset;
  for (const node of run) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      return { node, localOffset: remaining };
    }
    remaining -= length;
  }
  // Offset lands exactly at the end of the last node in the run (or the
  // run is empty and offset is 0) — spec allows an offset equal to the
  // total length, meaning "right after the last character".
  const last = run[run.length - 1];
  return last ? { node: last, localOffset: last.textContent?.length ?? 0 } : undefined;
}

/** Computes CFI steps (without character offset) from `root` down to
 * `target`, an element reachable from `root` by walking parentElement
 * links. Does not include a step for `root` itself. */
export function elementStepsFromRoot(root: Element, target: Element): number[] {
  const steps: number[] = [];
  let current: Element = target;
  while (current !== root) {
    const parent = current.parentElement;
    if (!parent) {
      throw new Error("Target element is not a descendant of root.");
    }
    steps.unshift(childStepIndex(current));
    current = parent;
  }
  return steps;
}

/** Resolves a sequence of element-level CFI steps (as produced by
 * `elementStepsFromRoot`) starting from `root`, down to the target
 * element. */
export function resolveElementSteps(root: Element, steps: readonly number[]): Element {
  let current: Element = root;
  for (const step of steps) {
    const next = resolveElementChild(current, step / 2);
    if (!next) {
      throw new Error(`No element found at CFI step ${step} under <${current.tagName}>.`);
    }
    current = next;
  }
  return current;
}

/** Like `elementStepsFromRoot`, but produces full `CfiStep`s including an
 * XML ID assertion for each step whose element has an `id` attribute —
 * the form actually used when generating a CFI (as opposed to
 * `elementStepsFromRoot`'s bare numbers, used internally for the
 * resolve-time round trip where id assertions are merely verified, not
 * generated). */
export function elementCfiSteps(root: Element, target: Element): CfiStep[] {
  const steps: CfiStep[] = [];
  let current: Element = target;
  while (current !== root) {
    const parent = current.parentElement;
    if (!parent) {
      throw new Error("Target element is not a descendant of root.");
    }
    steps.unshift(new CfiStep(childStepIndex(current), current.getAttribute("id") ?? undefined));
    current = parent;
  }
  return steps;
}
