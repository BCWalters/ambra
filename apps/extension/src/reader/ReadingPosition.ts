import type { ContentDocumentView, DomBreakPoint, LocatorResolver } from "@ambra/engine";

export interface ReadingPosition {
  spineIndex: number;
  cfi?: string;
}

export function selectedReadingRange(
  views: readonly ContentDocumentView[],
): { view: ContentDocumentView; range: Range } | undefined {
  for (const view of views) {
    const selection = view.document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) continue;
    return { view, range: selection.getRangeAt(0) };
  }
  return undefined;
}

export function selectedReadingPosition(
  views: readonly ContentDocumentView[],
  resolver: Pick<LocatorResolver, "generate">,
): ReadingPosition | undefined {
  const selection = selectedReadingRange(views);
  if (!selection) return undefined;
  const { view, range } = selection;
  let node = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType === 1 && node.childNodes[offset]) {
    node = node.childNodes[offset]!;
    offset = 0;
  }
  return {
    spineIndex: view.spineIndex,
    cfi: resolver.generate(view.spineIndex, node, node.nodeType === 1 ? undefined : offset).cfi,
  };
}

export function visibleReadingPosition(
  views: readonly ContentDocumentView[],
  position: DomBreakPoint | undefined,
  resolver: Pick<LocatorResolver, "generate">,
): ReadingPosition | undefined {
  const view = position ? views.find(candidate => candidate.document === position.node.ownerDocument) : views[0];
  if (!view) return undefined;
  const node = position?.node ?? view.document.body ?? view.document.documentElement;
  return {
    spineIndex: view.spineIndex,
    cfi: node === view.document.documentElement ? undefined
      : resolver.generate(view.spineIndex, node, node.nodeType === 1 ? undefined : position?.offset).cfi,
  };
}
