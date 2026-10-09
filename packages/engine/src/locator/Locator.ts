import type { ContentLoader } from "../content/ContentLoader.js";
import type { PackageDocument } from "../container/PackageDocument.js";
import { isReaderOwnedContent } from "../content/ReaderOwnedContent.js";
import { CfiStep, EpubCfi, EpubCfiParseError } from "./EpubCfi.js";
import {
  childStepIndex,
  elementCfiSteps,
  resolveAssertedElementStep,
  resolveOffsetInRun,
  resolveTextRun,
  runCharacterOffset,
} from "./CfiTree.js";

// See CfiTree.ts for why this is a plain numeric literal rather than a
// reference to the global `Node.ELEMENT_NODE` constant.
const ELEMENT_NODE = 1;

/**
 * A `Locator` is an immutable value object wrapping an EPUB Canonical
 * Fragment Identifier (CFI) string that identifies a position within a
 * book.
 *
 * CFI/`Locator` is the central concept nearly every other subsystem depends
 * on: resume-reading, resize/font-size re-layout (the locator — not a page
 * number — is the source of truth), accessibility focus targets, deep
 * links, and (wave 2) annotations.
 */
export class Locator {
  public constructor(public readonly cfi: string) {}

  public toString(): string {
    return this.cfi;
  }
}

/** A `Locator` resolved back to a live DOM position. */
export interface ResolvedLocator {
  readonly spineIndex: number;
  readonly node: Node;
  /** Present when the locator addresses a specific character position
   * within `node` (a text-like node); absent when it addresses `node` as
   * a whole (an element with no character offset). */
  readonly characterOffset: number | undefined;
}

export interface ResolvedLocatorRange {
  readonly start: ResolvedLocator;
  readonly end: ResolvedLocator;
  readonly document: Document;
  readonly range: Range;
}

function normalizeAssertionText(text: string): string {
  return text.replace(/[ \t\r\n]+/g, " ");
}

function rawTextBoundary(text: string, normalizedOffset: number): number | undefined {
  if (normalizedOffset === 0) return 0;
  let offset = 0;
  for (let i = 0; i < text.length; i++) {
    if (/[ \t\r\n]/.test(text[i]!)) {
      while (i + 1 < text.length && /[ \t\r\n]/.test(text[i + 1]!)) i++;
    }
    if (++offset === normalizedOffset) return i + 1;
  }
  return undefined;
}

/** Thrown when a `Locator`'s CFI is well-formed but doesn't resolve to a
 * real position in the given publication (e.g. it names a spine item or
 * DOM path that no longer exists, or an ID assertion doesn't match). */
export class LocatorResolutionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocatorResolutionError";
  }
}

/**
 * Generates and resolves `Locator`s against a book's DOM. Deliberately
 * decoupled from pagination/scrolling concerns: this class only knows how
 * to translate between "a DOM position within a specific spine item's
 * content document" and "a CFI string" — it has no notion of pages,
 * pixels, or viewports. Pagination and scroll-view-mode both build on top
 * of this shared foundation rather than each reimplementing position
 * addressing.
 */
export class LocatorResolver {
  public constructor(
    private readonly pkg: PackageDocument,
    private readonly contentLoader: ContentLoader,
  ) {}

  /**
   * Generates a `Locator` for a position within `spineIndex`'s content
   * document: either a specific character offset within a text node
   * (`node` is a `Text`/CDATA node, `characterOffset` is required and
   * local to that node), or an element position as a whole (`node` is an
   * `Element`, `characterOffset` omitted).
   */
  public generate(spineIndex: number, node: Node, characterOffset?: number): Locator {
    const spineRef = this.requireSpineItem(spineIndex);
    const root = this.requireDocumentRoot(node);
    if (node === root) {
      // A bare spine itemref is a valid CFI for the whole page. An empty
      // path after "!" is not, nor is a character offset on an SVG root.
      return new Locator(new EpubCfi(spineRef.packageCfiSteps, []).toString());
    }

    let contentSteps: CfiStep[];
    let finalOffset: number | undefined;

    if (node.nodeType === ELEMENT_NODE) {
      contentSteps = elementCfiSteps(root, node as Element);
      finalOffset = characterOffset;
    } else {
      const parent = node.parentElement;
      if (!parent) {
        throw new LocatorResolutionError(
          "Cannot generate a Locator for a node with no parent element.",
        );
      }
      contentSteps = [...elementCfiSteps(root, parent), new CfiStep(childStepIndex(node))];
      finalOffset = runCharacterOffset(node, characterOffset ?? 0);
    }

    const cfi = new EpubCfi(spineRef.packageCfiSteps, contentSteps, finalOffset);
    return new Locator(cfi.toString());
  }

  /** Generates an orderable point for a DOM boundary. Element offsets are child
   * indices, not character offsets: `/body:80` would otherwise sort before
   * every descendant of body, even those preceding its eightieth child. */
  public generateBoundary(spineIndex: number, node: Node, offset = 0): Locator {
    if (node.nodeType !== ELEMENT_NODE || offset === 0) {
      return this.generate(spineIndex, node, node.nodeType === ELEMENT_NODE ? undefined : offset);
    }
    const nextAfter = (node: Node): Node | undefined => {
      let current: Node | null = node;
      while (current && !current.nextSibling) current = current.parentNode;
      return current?.nextSibling ?? undefined;
    };
    const addressable = (node: Node): boolean =>
      !isReaderOwnedContent(node) && (node.nodeType === ELEMENT_NODE || node.nodeType === 3 || node.nodeType === 4);
    let next: Node | undefined = node.childNodes[offset] ?? nextAfter(node);
    while (next && !addressable(next)) next = nextAfter(next);
    if (next) return this.generate(spineIndex, next, next.nodeType === ELEMENT_NODE ? undefined : 0);
    // At the document's end, use the final content leaf's end rather than a
    // parent offset that sorts before its own descendants.
    let last = node;
    for (;;) {
      let child = last.lastChild;
      while (child && !addressable(child)) child = child.previousSibling;
      if (!child) break;
      last = child;
    }
    return this.generate(spineIndex, last, last.nodeType === ELEMENT_NODE ? undefined : last.textContent?.length ?? 0);
  }

  /** Resolves `locator` to a live DOM position, loading (via this
   * resolver's `ContentLoader`) whichever spine item's content document it
   * points into. For resolving against a document that's already loaded/
   * rendered (e.g. during pagination), use `resolveInDocument` instead to
   * avoid a redundant reload. */
  public async resolve(locator: Locator): Promise<ResolvedLocator> {
    const cfi = this.parseCfi(locator);
    const spineIndex = this.requireSpineIndexForCfi(cfi);
    const spineRef = this.pkg.spine[spineIndex]!;

    const contentDocument = await this.contentLoader.loadContentDocument(spineRef.manifestItem);
    return this.resolveContentSteps(cfi, spineIndex, contentDocument.document);
  }

  /** Resolves two locators expected to point into the same spine item,
   * loading that item's content document only once so both resolve
   * against the same DOM tree. Needed by any caller that then builds a
   * `Range` spanning the pair (e.g. to re-extract a highlight's text): a
   * `Range`'s two boundary points must share a document, and calling
   * `resolve` twice would parse two independent documents, silently
   * collapsing such a `Range` instead of throwing. Throws if the two
   * locators don't actually resolve to the same spine index. */
  public async resolvePair(
    a: Locator,
    b: Locator,
  ): Promise<{ start: ResolvedLocator; end: ResolvedLocator; document: Document }> {
    const cfiA = this.parseCfi(a);
    const spineIndex = this.requireSpineIndexForCfi(cfiA);
    const spineRef = this.requireSpineItem(spineIndex);

    const contentDocument = await this.contentLoader.loadContentDocument(spineRef.manifestItem);
    const start = this.resolveContentSteps(cfiA, spineIndex, contentDocument.document);
    const end = this.resolveInDocument(b, spineIndex, contentDocument.document);
    return { start, end, document: contentDocument.document };
  }

  public async resolveRange(locator: Locator): Promise<ResolvedLocatorRange> {
    const { start, end } = this.parseRange(locator);
    const pair = await this.resolvePair(new Locator(start.toString()), new Locator(end.toString()));
    return { ...pair, range: this.createResolvedRange(pair.start, pair.end, pair.document) };
  }

  public resolveRangeInDocument(
    locator: Locator,
    spineIndex: number,
    document: Document,
  ): ResolvedLocatorRange {
    const points = this.parseRange(locator);
    const start = this.resolveInDocument(new Locator(points.start.toString()), spineIndex, document);
    const end = this.resolveInDocument(new Locator(points.end.toString()), spineIndex, document);
    return { start, end, document, range: this.createResolvedRange(start, end, document) };
  }

  private parseRange(locator: Locator): { start: EpubCfi; end: EpubCfi } {
    try {
      return EpubCfi.parseRange(locator.cfi);
    } catch (error) {
      if (error instanceof EpubCfiParseError) {
        throw new LocatorResolutionError(`Invalid range CFI "${locator.cfi}": ${error.message}`);
      }
      throw error;
    }
  }

  private createResolvedRange(start: ResolvedLocator, end: ResolvedLocator, document: Document): Range {
    for (const point of [start, end]) {
      if (point.node.nodeType === ELEMENT_NODE && point.characterOffset !== undefined &&
        point.characterOffset > point.node.childNodes.length) {
        throw new LocatorResolutionError("An element character offset cannot be represented as a DOM range boundary.");
      }
    }
    const first = document.createRange();
    const last = document.createRange();
    if (start.characterOffset === undefined) first.setStartBefore(start.node);
    else first.setStart(start.node, start.characterOffset);
    first.collapse(true);
    if (end.characterOffset === undefined) last.setEndAfter(end.node);
    else last.setEnd(end.node, end.characterOffset);
    last.collapse(false);
    if (first.compareBoundaryPoints(0, last) > 0) {
      throw new LocatorResolutionError("Range CFI endpoints are in reverse document order.");
    }
    first.setEnd(last.endContainer, last.endOffset);
    return first;
  }

  /** Resolves `locator` against an already-available `document` for
   * `spineIndex`, without loading anything — the caller is responsible for
   * ensuring `document` really is that spine item's content (e.g. because
   * it's the document currently rendered in the sandboxed content host). */
  public resolveInDocument(
    locator: Locator,
    spineIndex: number,
    document: Document,
  ): ResolvedLocator {
    const cfi = this.parseCfi(locator);
    const expectedSpineIndex = this.requireSpineIndexForCfi(cfi);
    if (expectedSpineIndex !== spineIndex) {
      throw new LocatorResolutionError(
        `Locator points to spine index ${expectedSpineIndex}, not the provided ${spineIndex}.`,
      );
    }
    return this.resolveContentSteps(cfi, spineIndex, document);
  }

  private resolveContentSteps(
    cfi: EpubCfi,
    spineIndex: number,
    document: Document,
  ): ResolvedLocator {
    const root = document.documentElement;
    if (cfi.contentSteps.length === 0) {
      return { spineIndex, node: root, characterOffset: undefined };
    }

    let current: Element = root;
    for (let i = 0; i < cfi.contentSteps.length - 1; i++) {
      const step = cfi.contentSteps[i]!;
      current = this.resolveElementStep(current, step, document);
    }

    const lastStep = cfi.contentSteps[cfi.contentSteps.length - 1]!;
    if (lastStep.index % 2 === 0) {
      const element = this.resolveElementStep(current, lastStep, document);
      if (cfi.textAssertion && (cfi.textAssertion.preceding || cfi.textAssertion.following)) {
        throw new LocatorResolutionError("Text assertions on element character offsets are not supported.");
      }
      return { spineIndex, node: element, characterOffset: cfi.characterOffset };
    }

    const run = resolveTextRun(current, lastStep.index);
    if (cfi.textAssertion && (cfi.textAssertion.preceding || cfi.textAssertion.following)) {
      return this.resolveAssertedText(cfi, spineIndex, document, run);
    }
    if (run.length === 0) {
      throw new LocatorResolutionError(
        `No text run found at final CFI step ${lastStep.index} under <${current.tagName}>.`,
      );
    }
    if (cfi.characterOffset === undefined) {
      return { spineIndex, node: run[0]!, characterOffset: 0 };
    }
    const resolved = resolveOffsetInRun(run, cfi.characterOffset, cfi.sideBias);
    if (!resolved) {
      throw new LocatorResolutionError(`Character offset ${cfi.characterOffset} out of range.`);
    }
    return { spineIndex, node: resolved.node, characterOffset: resolved.localOffset };
  }

  private resolveElementStep(parent: Element, step: CfiStep, document: Document): Element {
    if (step.index % 2 !== 0) {
      throw new LocatorResolutionError("A non-final CFI step must reference an element.");
    }
    const resolved = resolveAssertedElementStep(parent, step, document.documentElement);
    if (resolved) return resolved;
    if (step.idAssertion === undefined) {
      throw new LocatorResolutionError(`No element found at CFI step ${step.index} under <${parent.tagName}>.`);
    }
    throw new LocatorResolutionError(`Cannot recover CFI ID assertion "${step.idAssertion}": missing or ambiguous target.`);
  }

  private resolveAssertedText(
    cfi: EpubCfi,
    spineIndex: number,
    document: Document,
    run: readonly ChildNode[],
  ): ResolvedLocator {
    const assertion = cfi.textAssertion!;
    const preceding = normalizeAssertionText(assertion.preceding);
    const following = normalizeAssertionText(assertion.following ?? "");
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(document.documentElement, 12);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.nodeType === 3 || node.nodeType === 4) && !isReaderOwnedContent(node)) {
        nodes.push(node as Text);
      }
    }
    const raw = nodes.map(node => node.data).join("");
    const normalized = normalizeAssertionText(raw);
    let runStart: number | undefined;
    let offset = 0;
    for (const node of nodes) {
      if (node === run[0]) runStart = offset;
      offset += node.data.length;
    }
    const original = resolveOffsetInRun(run, cfi.characterOffset!, cfi.sideBias);
    if (original && runStart !== undefined) {
      const boundary = normalizeAssertionText(raw.slice(0, runStart + cfi.characterOffset!)).length;
      if (normalized.slice(0, boundary).endsWith(preceding) &&
        normalized.slice(boundary).startsWith(following)) {
        return { spineIndex, node: original.node, characterOffset: original.localOffset };
      }
    }
    const context = preceding + following;
    const match = normalized.indexOf(context);
    if (match === -1 || normalized.indexOf(context, match + 1) !== -1) {
      throw new LocatorResolutionError("Cannot recover CFI text assertion: missing or ambiguous context.");
    }
    const absolute = rawTextBoundary(raw, match + preceding.length);
    if (absolute === undefined) throw new LocatorResolutionError("Recovered CFI text offset is out of range.");
    const corrected = resolveOffsetInRun(nodes, absolute, cfi.sideBias);
    if (!corrected) throw new LocatorResolutionError("Recovered CFI text offset is out of range.");
    return { spineIndex, node: corrected.node, characterOffset: corrected.localOffset };
  }

  private parseCfi(locator: Locator): EpubCfi {
    try {
      return EpubCfi.parse(locator.cfi);
    } catch (error) {
      if (error instanceof EpubCfiParseError) {
        throw new LocatorResolutionError(`Invalid Locator CFI "${locator.cfi}": ${error.message}`);
      }
      throw error;
    }
  }

  private requireSpineIndexForCfi(cfi: EpubCfi): number {
    const spineIndex = this.pkg.findSpineIndexByPackageCfiSteps(cfi.packageSteps);
    if (spineIndex === undefined) {
      throw new LocatorResolutionError(
        `CFI package steps do not match any spine item: "${cfi.toString()}"`,
      );
    }
    return spineIndex;
  }

  private requireSpineItem(spineIndex: number) {
    const spineRef = this.pkg.spine[spineIndex];
    if (!spineRef) {
      throw new LocatorResolutionError(
        `Spine index ${spineIndex} is out of range (spine has ${this.pkg.spine.length} items).`,
      );
    }
    return spineRef;
  }

  private requireDocumentRoot(node: Node): Element {
    const root = node.ownerDocument?.documentElement;
    if (!root) {
      throw new LocatorResolutionError("Node has no owner document with a root element.");
    }
    return root;
  }
}
