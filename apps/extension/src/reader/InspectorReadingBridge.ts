import { isReaderOwnedContent, Locator, SUPPORTED_CONTENT_DOCUMENT_MEDIA_TYPES } from "@ambra/engine";
import type {
  ContentDocumentView,
  ContentLoader,
  DomBreakPoint,
  LocatorResolver,
  PackageDocument,
} from "@ambra/engine";
import type { InspectorReaderBridge, InspectorReadingLocation, InspectorSourcePoint, InspectorVisiblePage } from "./ReaderTypes.js";
import { selectedReadingPosition, visibleReadingPosition, type ReadingPosition } from "./ReadingPosition.js";

interface ReadingContext {
  documents: () => readonly ContentDocumentView[];
  pageNumber: (view: ContentDocumentView) => number | undefined;
  currentPosition: () => DomBreakPoint | undefined;
  navigate: (spineIndex: number, cfi?: string) => Promise<void>;
  focus: (document: Document, element: Element) => void;
  isDisposed: () => boolean;
}

/** Converts between original-source elements and the reader's canonical positions. */
export class InspectorReadingBridge {
  private readonly contentPaths: readonly (string | undefined)[];

  public constructor(
    private readonly loader: ContentLoader,
    private readonly resolver: LocatorResolver,
    pkg: PackageDocument,
    private readonly context: ReadingContext,
  ) {
    this.contentPaths = pkg.spine.map(
      ({ manifestItem }) =>
        pkg
          .resolveManifestItemChain(manifestItem)
          .find((item) => SUPPORTED_CONTENT_DOCUMENT_MEDIA_TYPES.has(item.mediaType))?.path,
    );
  }

  public create(): InspectorReaderBridge {
    // Capture selection before moving focus into the Inspector's modal document.
    const selection = this.selectedPosition();
    const initial = selection ?? this.visiblePosition();
    let destination: ReadingPosition | undefined;
    return {
      currentPath: initial ? this.contentPaths[initial.spineIndex] : undefined,
      locateCurrentPassage: () => this.locate(selection ?? this.visiblePosition()),
      canShowInBook: (path) => this.contentPaths.includes(path),
      showInBook: async (location) => {
        destination = await this.show(location);
      },
      getVisiblePages: () => this.visiblePages(),
      restoreFocus: () => {
        const target = destination;
        if (!target || this.context.isDisposed()) return;
        const view = this.context.documents().find((item) => item.spineIndex === target.spineIndex);
        if (!view) return;
        const node = target.cfi
          ? this.resolver.resolveInDocument(new Locator(target.cfi), view.spineIndex, view.document)
              .node
          : (view.document.body ?? view.document.documentElement);
        const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
        if (element) this.context.focus(view.document, element);
      },
    };
  }

  private async visiblePages(): Promise<readonly InspectorVisiblePage[]> {
    this.checkActive();
    const views = this.context.documents().filter(view => view.page);
    return Promise.all(views.map(async view => {
      const page = view.page!;
      const pageNumber = this.context.pageNumber(view);
      const content = await this.loader.loadSpineDocument(view.spineIndex);
      this.checkActive();
      return {
        path: content.manifestItem.path,
        spineIndex: view.spineIndex,
        pageIndex: page.index,
        pageNumber,
        physicalSide: view.physicalSide,
        start: this.sourcePoint(page.startBreak, view.spineIndex, content.document),
        end: this.sourcePoint(page.endBreak, view.spineIndex, content.document),
        hasPositionOverrides: !!page.positionOverrides?.length,
      };
    }));
  }

  private sourcePoint(point: DomBreakPoint, spineIndex: number, original: Document): InspectorSourcePoint {
    const locator = this.resolver.generate(spineIndex, point.node,
      point.node.nodeType === 1 ? undefined : point.offset ?? 0);
    const resolved = this.resolver.resolveInDocument(locator, spineIndex, original);
    const node = resolved.node;
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!element) throw new Error("The page boundary has no source element.");
    const elementPath = this.elementPath(element, original);
    if (point.node.nodeType === 1) {
      if (point.offset === undefined) return { elementPath };
      if (!Number.isInteger(point.offset) || point.offset < 0 || point.offset > point.node.childNodes.length) {
        throw new Error("The page boundary has an invalid child offset.");
      }
      const childIndex = Array.from(point.node.childNodes).slice(0, point.offset)
        .filter(child => !isReaderOwnedContent(child)).length;
      if (childIndex > node.childNodes.length) throw new Error("The page boundary does not match original source children.");
      return { elementPath, childIndex };
    }
    if (node.nodeType !== 3 && node.nodeType !== 4) throw new Error("The page boundary is not source text.");
    return {
      elementPath,
      childIndex: Array.from(element.childNodes).findIndex(child => child === node),
      textOffset: resolved.characterOffset ?? 0,
    };
  }

  private elementPath(sourceElement: Element, original: Document): number[] {
    let element = sourceElement;
    const path: number[] = [];
    while (element !== original.documentElement) {
      const parent = element.parentElement;
      if (!parent) throw new Error("The source element is outside the publication document.");
      path.unshift(Array.from(parent.children).indexOf(element));
      element = parent;
    }
    return path;
  }

  private selectedPosition(): ReadingPosition | undefined {
    return selectedReadingPosition(this.context.documents(), this.resolver);
  }

  private visiblePosition(): ReadingPosition | undefined {
    return visibleReadingPosition(this.context.documents(), this.context.currentPosition(), this.resolver);
  }

  private async locate(position: ReadingPosition | undefined): Promise<InspectorReadingLocation> {
    if (!position) throw new Error("The book does not have a readable position yet.");
    const content = await this.loader.loadSpineDocument(position.spineIndex);
    this.checkActive();
    const node = position.cfi
      ? this.resolver.resolveInDocument(
          new Locator(position.cfi),
          position.spineIndex,
          content.document,
        ).node
      : content.document.documentElement;
    const sourceElement = node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (!sourceElement) throw new Error("The passage could not be matched to a source element.");
    const elementPath = this.elementPath(sourceElement, content.document);
    return { path: content.manifestItem.path, spineIndex: position.spineIndex, elementPath };
  }

  private async show(location: InspectorReadingLocation): Promise<ReadingPosition> {
    this.checkActive();
    const spineIndex =
      location.spineIndex !== undefined && this.contentPaths[location.spineIndex] === location.path
        ? location.spineIndex
        : this.contentPaths.indexOf(location.path);
    if (spineIndex < 0) throw new Error("This file is not a readable spine document.");
    const content = await this.loader.loadSpineDocument(spineIndex);
    this.checkActive();
    let element: Element = content.document.documentElement;
    if (location.elementPath) {
      for (const index of location.elementPath) {
        const child = Number.isInteger(index) && index >= 0 ? element.children[index] : undefined;
        if (!child) throw new Error("The selected source element no longer exists.");
        element = child;
      }
      const body = content.document.body;
      if (body && element !== content.document.documentElement && !body.contains(element)) {
        throw new Error("This source element is outside the book's reading content.");
      }
    }
    const cfi = location.elementPath?.length
      ? this.resolver.generate(spineIndex, element).cfi
      : undefined;
    await this.context.navigate(spineIndex, cfi);
    return { spineIndex, cfi };
  }

  private checkActive(): void {
    if (this.context.isDisposed()) throw new Error("The reading session has been closed.");
  }
}
