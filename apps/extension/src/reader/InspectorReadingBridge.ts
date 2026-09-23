import { Locator, SUPPORTED_CONTENT_DOCUMENT_MEDIA_TYPES } from "@ambra/engine";
import type {
  ContentDocumentView,
  ContentLoader,
  DomBreakPoint,
  LocatorResolver,
  PackageDocument,
} from "@ambra/engine";
import type { InspectorReaderBridge, InspectorReadingLocation } from "./ReaderTypes.js";

interface ReadingContext {
  documents: () => readonly ContentDocumentView[];
  currentPosition: () => DomBreakPoint | undefined;
  navigate: (spineIndex: number, cfi?: string) => Promise<void>;
  focus: (document: Document, element: Element) => void;
  isDisposed: () => boolean;
}

interface ReadingPosition {
  spineIndex: number;
  cfi?: string;
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

  private selectedPosition(): ReadingPosition | undefined {
    for (const view of this.context.documents()) {
      const selection = view.document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) continue;
      const range = selection.getRangeAt(0);
      let node = range.startContainer;
      let offset = range.startOffset;
      if (node.nodeType === 1 && node.childNodes[offset]) {
        node = node.childNodes[offset]!;
        offset = 0;
      }
      return {
        spineIndex: view.spineIndex,
        cfi: this.resolver.generate(view.spineIndex, node, node.nodeType === 1 ? undefined : offset)
          .cfi,
      };
    }
    return undefined;
  }

  private visiblePosition(): ReadingPosition | undefined {
    const views = this.context.documents();
    const position = this.context.currentPosition();
    const view = position
      ? views.find((candidate) => candidate.document === position.node.ownerDocument)
      : views[0];
    if (!view) return undefined;
    const node = position?.node ?? view.document.body ?? view.document.documentElement;
    return {
      spineIndex: view.spineIndex,
      cfi:
        node === view.document.documentElement
          ? undefined
          : this.resolver.generate(
              view.spineIndex,
              node,
              node.nodeType === 1 ? undefined : position?.offset,
            ).cfi,
    };
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
    let element: Element = sourceElement;
    const elementPath: number[] = [];
    while (element !== content.document.documentElement) {
      const parent: Element | null = element.parentElement;
      if (!parent) throw new Error("The passage is outside the publication document.");
      elementPath.unshift(Array.from(parent.children).indexOf(element));
      element = parent;
    }
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
