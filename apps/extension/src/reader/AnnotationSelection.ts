import { intersectPageRange, type ContentDocumentView } from "@ambra/engine";

export function annotationSelectionRange(range: Range, views: readonly ContentDocumentView[]): Range | undefined {
  const view = views.find(view => view.document === range.startContainer.ownerDocument);
  if (!view || range.endContainer.ownerDocument !== view.document) {
    throw new Error("The selection no longer belongs to a visible document.");
  }
  const ranges = view.page ? intersectPageRange(view.page, range, view.document) : [range.cloneRange()];
  const textRanges = ranges.filter(range => !range.collapsed && range.toString().length > 0);
  if (textRanges.length > 1) throw new Error("Select text within one contiguous visible page range; reordered off-page content cannot be included.");
  return textRanges[0];
}
