import type { DomBreakPoint } from "./Page.js";
import {
  childStepIndex,
  elementStepsFromRoot,
  resolveElementSteps,
  resolveOffsetInRun,
  resolveTextRun,
  runCharacterOffset,
} from "../locator/CfiTree.js";

// See `CfiTree.ts` for why this is a plain numeric literal rather than a
// reference to the global `Node.ELEMENT_NODE` constant.
const ELEMENT_NODE = 1;

/**
 * Re-resolves `position` (a DOM position within `sourceRoot`'s own
 * document) to the structurally-equivalent position within a *different*
 * document rooted at `targetRoot` — for `SpreadPaginatedHost`, whose left
 * and right columns are two entirely separate `PaginatedContentHost`s,
 * each with its own independently-parsed copy of the exact same spine
 * item content (see that class's own doc comment). A DOM `Node` reference
 * from one column's document is meaningless passed directly to the
 * other's — `PaginationEngine.paginate`'s `anchor` parameter compares
 * positions via `Range`/`compareDocumentPosition`-style checks, which are
 * undefined across documents. This walks `sourceRoot`'s own CFI-style
 * step-numbering (`CfiTree`'s existing rule, already used for generating/
 * resolving real CFI strings — reused here purely for its "identical
 * structural path" property, with no CFI string ever produced) from
 * `position.node` up to `sourceRoot`, then re-descends that exact path
 * under `targetRoot` — reliable as long as both documents are
 * structurally identical parses of the same content, which
 * `SpreadPaginatedHost`'s two columns always are (both assembled from
 * the same resolved resource URLs — see its own constructor's doc
 * comment).
 *
 * Returns `undefined` if the mapping can't be resolved (e.g. `sourceRoot`
 * isn't actually an ancestor of `position.node`, or the two trees have
 * somehow diverged) rather than throwing — callers should treat that as
 * "no anchor to force," not a hard failure; pagination still works fine
 * without one, just without the "lands exactly at the top of its page"
 * guarantee an anchor gives.
 */
export function mapDomPositionToDocument(
  position: DomBreakPoint,
  sourceRoot: Element,
  targetRoot: Element,
): DomBreakPoint | undefined {
  try {
    const { node, offset } = position;
    if (node.nodeType === ELEMENT_NODE) {
      const steps = elementStepsFromRoot(sourceRoot, node as Element);
      return { node: resolveElementSteps(targetRoot, steps), offset };
    }
    const parent = node.parentElement;
    if (!parent) {
      return undefined;
    }
    const oddStepIndex = childStepIndex(node);
    const cfiOffset = runCharacterOffset(node, offset ?? 0);
    const steps = elementStepsFromRoot(sourceRoot, parent);
    const targetParent = resolveElementSteps(targetRoot, steps);
    const run = resolveTextRun(targetParent, oddStepIndex);
    const resolved = resolveOffsetInRun(run, cfiOffset);
    if (!resolved) {
      return undefined;
    }
    return { node: resolved.node, offset: resolved.localOffset };
  } catch {
    return undefined;
  }
}
