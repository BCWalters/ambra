import { classifyEpubReference } from "../container/EpubReference.js";
import type { PackageDocument } from "../container/PackageDocument.js";
import { getFirstDescendantElementByNS } from "../container/Xml.js";
import { EpubCfi, EpubCfiParseError } from "../locator/EpubCfi.js";
import { Locator, LocatorResolver, LocatorResolutionError, requireDomRangeBoundary } from "../locator/Locator.js";
import type { AnnotationSelector } from "./EpubAnnotation.js";

export interface AnnotationSelection {
  readonly spineIndex: number;
  readonly startCfi: string;
  readonly endCfi?: string;
  readonly text?: string;
}

export class AnnotationSelectorResolutionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AnnotationSelectorResolutionError";
  }
}

/** Commas inside ID assertions do not make a point CFI a range. */
export function parseAnnotationCfi(value: string): { start: EpubCfi; end?: EpubCfi } {
  try {
    return { start: EpubCfi.parse(value) };
  } catch (error) {
    if (!(error instanceof EpubCfiParseError)) throw error;
    return EpubCfi.parseRange(value);
  }
}

export class AnnotationSelectorResolver {
  private readonly documents = new Map<number, Promise<Document>>();

  public constructor(
    private readonly pkg: PackageDocument,
    private readonly locators: LocatorResolver,
    private readonly allowPackageFallback = true,
  ) {}

  public fragmentSelection(source: string, selector: AnnotationSelector): AnnotationSelection {
    if (selector.type !== "FragmentSelector" || typeof selector.value !== "string")
      throw new AnnotationSelectorResolutionError("The annotation does not contain a valid CFI selector.");
    if (classifyEpubReference(this.pkg.path, source).kind !== "package")
      throw new AnnotationSelectorResolutionError("External annotation targets cannot be resolved inside this publication.");
    const { start, end } = parseAnnotationCfi(selector.value);
    const spineIndex = this.spineIndex(source) ??
      (this.allowPackageFallback ? this.pkg.findSpineIndexByPackageCfiSteps(start.packageSteps) : undefined);
    if (spineIndex === undefined)
      throw new AnnotationSelectorResolutionError("The annotation source does not identify a spine document.");
    const steps = this.pkg.spine[spineIndex]!.packageCfiSteps;
    const reanchor = (cfi: EpubCfi) => new EpubCfi(
      steps, cfi.contentSteps, cfi.characterOffset, cfi.textAssertion, cfi.mediaOffsets,
    ).toString();
    return { spineIndex, startCfi: reanchor(start), endCfi: end ? reanchor(end) : undefined };
  }

  public async resolve(source: string, selector: AnnotationSelector): Promise<AnnotationSelection> {
    if (selector.type === "FragmentSelector") {
      if (selector.refinedBy !== undefined)
        throw new AnnotationSelectorResolutionError("CFI selector refinements are not supported.");
      const selection = this.fragmentSelection(source, selector);
      const document = this.allowPackageFallback ? undefined : await this.document(selection.spineIndex);
      if (!selection.endCfi) {
        if (document) this.locators.resolveInDocument(new Locator(selection.startCfi), selection.spineIndex, document);
        else await this.locators.resolve(new Locator(selection.startCfi));
        return selection;
      }
      const pair = document ? {
        document,
        start: this.locators.resolveInDocument(new Locator(selection.startCfi), selection.spineIndex, document),
        end: this.locators.resolveInDocument(new Locator(selection.endCfi), selection.spineIndex, document),
      } : await this.locators.resolvePair(new Locator(selection.startCfi), new Locator(selection.endCfi));
      requireDomRangeBoundary(pair.start);
      requireDomRangeBoundary(pair.end);
      const range = pair.document.createRange();
      if (pair.start.characterOffset === undefined) range.setStartBefore(pair.start.node);
      else range.setStart(pair.start.node, pair.start.characterOffset);
      if (pair.end.characterOffset === undefined) range.setEndAfter(pair.end.node);
      else range.setEnd(pair.end.node, pair.end.characterOffset);
      return { ...selection, text: range.toString() };
    }
    if ((selector.type !== "CssSelector" || typeof selector.value !== "string") &&
      (selector.type !== "TextPositionSelector" || typeof selector.start !== "number" || typeof selector.end !== "number"))
      throw new AnnotationSelectorResolutionError("The annotation selector is unsupported or malformed.");
    const spineIndex = this.spineIndex(source);
    if (spineIndex === undefined)
      throw new AnnotationSelectorResolutionError("The annotation source does not identify a spine document.");
    const document = await this.document(spineIndex);
    return this.resolveDomSelector(document, spineIndex, selector);
  }

  private spineIndex(source: string): number | undefined {
    const exact = this.pkg.spine.findIndex(ref => ref.manifestItem.path === source);
    if (exact !== -1) return exact;
    const reference = classifyEpubReference(this.pkg.path, source);
    if (reference.kind !== "package") return undefined;
    const relative = this.pkg.spine.findIndex(ref => ref.manifestItem.path === reference.path);
    return relative === -1 ? undefined : relative;
  }

  private document(spineIndex: number): Promise<Document> {
    let pending = this.documents.get(spineIndex);
    if (!pending) {
      const cfi = new EpubCfi(this.pkg.spine[spineIndex]!.packageCfiSteps, []).toString();
      pending = this.locators.resolve(new Locator(cfi)).then(position => {
        const document = position.node.ownerDocument;
        if (!document?.documentElement)
          throw new AnnotationSelectorResolutionError("The annotation document is unavailable.");
        return document;
      });
      this.documents.set(spineIndex, pending);
    }
    return pending;
  }

  private resolveDomSelector(
    document: Document,
    spineIndex: number,
    selector: AnnotationSelector,
    scope?: Element,
    depth = 0,
  ): AnnotationSelection {
    if (depth >= 16) throw new AnnotationSelectorResolutionError("The annotation refinement limit is exceeded.");
    const range = document.createRange();
    if (selector.type === "CssSelector" && typeof selector.value === "string") {
      if (!selector.value.trim() || selector.value.length > 16_384)
        throw new AnnotationSelectorResolutionError("The annotation CSS selector is empty or exceeds its limit.");
      let matches: Element[];
      try {
        matches = Array.from((scope ?? document).querySelectorAll(selector.value));
        if (scope?.matches(selector.value) && !matches.includes(scope)) matches.unshift(scope);
      } catch (error) {
        if (!(error instanceof DOMException) && !(error instanceof Error && error.name === "SyntaxError")) throw error;
        throw new AnnotationSelectorResolutionError(`Invalid annotation CSS selector: ${error.message}`);
      }
      if (matches.length !== 1)
        throw new AnnotationSelectorResolutionError("The annotation CSS selector must identify exactly one element.");
      const element = matches[0]!;
      if (selector.refinedBy !== undefined) {
        const refinement = selector.refinedBy;
        if (!refinement || typeof refinement !== "object" || Array.isArray(refinement))
          throw new AnnotationSelectorResolutionError("The annotation refinement is not a selector object.");
        const raw = refinement as Record<string, unknown>;
        if (typeof raw.type !== "string")
          throw new AnnotationSelectorResolutionError("The annotation refinement has no selector type.");
        return this.resolveDomSelector(document, spineIndex, { ...raw, type: raw.type }, element, depth + 1);
      }
      range.selectNodeContents(element);
    } else if (selector.type === "TextPositionSelector" &&
      typeof selector.start === "number" && typeof selector.end === "number") {
      if (selector.refinedBy !== undefined)
        throw new AnnotationSelectorResolutionError("Text-position selector refinements are not supported.");
      if (!Number.isSafeInteger(selector.start) || !Number.isSafeInteger(selector.end) ||
        selector.start < 0 || selector.end < selector.start)
        throw new AnnotationSelectorResolutionError("The annotation text positions must be ordered non-negative integers.");
      const root = scope ?? getFirstDescendantElementByNS(document, "http://www.w3.org/1999/xhtml", "body");
      if (!root) throw new AnnotationSelectorResolutionError("An unrefined text-position selector requires an HTML body.");
      // EPUB Annotations uses body/scope textContent in tree order, with
      // Unicode code-point offsets, not UTF-16 offsets or rendered whitespace.
      const walker = document.createTreeWalker(root, 4 | 8);
      let count = 0;
      let start: { node: Node; offset: number } | undefined;
      let end: { node: Node; offset: number } | undefined;
      for (let node = walker.nextNode(); node && !end; node = walker.nextNode()) {
        let offset = 0;
        if (count === selector.start && !start) start = { node, offset };
        if (count === selector.end) end = { node, offset };
        for (const character of node.textContent ?? "") {
          if (end) break;
          count++;
          offset += character.length;
          if (count === selector.start && !start) start = { node, offset };
          if (count === selector.end) end = { node, offset };
        }
      }
      if (!start || !end) {
        if (selector.start === 0 && selector.end === 0 && !root.textContent) {
          range.selectNodeContents(root);
          range.collapse(true);
        } else throw new AnnotationSelectorResolutionError("The annotation text positions exceed the scope.");
      } else {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
      }
    } else throw new AnnotationSelectorResolutionError(`Unsupported annotation selector: ${selector.type}`);
    const startCfi = this.locators.generateBoundary(spineIndex, range.startContainer, range.startOffset).cfi;
    let endCfi: string | undefined;
    if (!range.collapsed) {
      const end = this.locators.generateBoundary(spineIndex, range.endContainer, range.endOffset);
      const boundary = this.locators.resolveInDocument(end, spineIndex, document);
      // Bare element CFIs are inclusive range ends. Preserve an exclusive
      // DOM boundary before the following element with an explicit zero offset.
      endCfi = boundary.node.nodeType === 1 && boundary.characterOffset === undefined
        ? this.locators.generate(spineIndex, boundary.node, 0).cfi : end.cfi;
    }
    return { spineIndex, startCfi, endCfi, text: endCfi ? range.toString() : undefined };
  }
}

export function isAnnotationSelectorFailure(error: unknown): boolean {
  return error instanceof AnnotationSelectorResolutionError ||
    error instanceof EpubCfiParseError || error instanceof LocatorResolutionError;
}
