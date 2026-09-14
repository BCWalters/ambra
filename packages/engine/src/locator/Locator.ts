import type { ContentLoader } from "../content/ContentLoader.js";
import type { PackageDocument } from "../container/PackageDocument.js";
import { CfiStep, EpubCfi, EpubCfiParseError } from "./EpubCfi.js";
import {
  childStepIndex,
  elementCfiSteps,
  resolveElementChild,
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
      throw new LocatorResolutionError("CFI has no content steps to resolve.");
    }

    let current: Element = root;
    for (let i = 0; i < cfi.contentSteps.length - 1; i++) {
      const step = cfi.contentSteps[i]!;
      const next = resolveElementChild(current, step.index / 2);
      if (!next) {
        throw new LocatorResolutionError(
          `No element found at CFI step ${step.index} under <${current.tagName}>.`,
        );
      }
      this.verifyIdAssertion(next, step.idAssertion);
      current = next;
    }

    const lastStep = cfi.contentSteps[cfi.contentSteps.length - 1]!;
    if (lastStep.index % 2 === 0) {
      const element = resolveElementChild(current, lastStep.index / 2);
      if (!element) {
        throw new LocatorResolutionError(
          `No element found at final CFI step ${lastStep.index} under <${current.tagName}>.`,
        );
      }
      this.verifyIdAssertion(element, lastStep.idAssertion);
      return { spineIndex, node: element, characterOffset: cfi.characterOffset };
    }

    const run = resolveTextRun(current, lastStep.index);
    if (run.length === 0) {
      throw new LocatorResolutionError(
        `No text run found at final CFI step ${lastStep.index} under <${current.tagName}>.`,
      );
    }
    if (cfi.characterOffset === undefined) {
      return { spineIndex, node: run[0]!, characterOffset: 0 };
    }
    const resolved = resolveOffsetInRun(run, cfi.characterOffset);
    if (!resolved) {
      throw new LocatorResolutionError(`Character offset ${cfi.characterOffset} out of range.`);
    }
    return { spineIndex, node: resolved.node, characterOffset: resolved.localOffset };
  }

  /** Verifies a step's XML ID assertion against the resolved element, when
   * present. Mismatches throw rather than silently continue — self-healing
   * resolution (searching the document for the asserted ID as a fallback,
   * per the CFI spec's "Intended Target Location Correction") is a
   * documented future enhancement, not implemented in Wave 1. */
  private verifyIdAssertion(element: Element, idAssertion: string | undefined): void {
    if (idAssertion !== undefined && element.getAttribute("id") !== idAssertion) {
      throw new LocatorResolutionError(
        `CFI id assertion "${idAssertion}" does not match resolved element's id "${element.getAttribute("id")}".`,
      );
    }
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
