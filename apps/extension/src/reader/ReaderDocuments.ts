import {
  FixedContentHost,
  FixedSpreadHost,
  PaginatedContentHost,
  RollContentHost,
  ScrollContentHost,
  SpreadPaginatedHost,
} from "@ambra/engine";
import type { ContentDocumentView } from "@ambra/engine";

export type ReadingHost =
  | PaginatedContentHost
  | SpreadPaginatedHost
  | RollContentHost
  | ScrollContentHost
  | FixedContentHost
  | FixedSpreadHost;

/** Host-specific document ownership is resolved once, not inferred by consumers. */
export function readerDocumentViews(
  host: ReadingHost | undefined,
  spineIndex: number,
): readonly ContentDocumentView[] {
  if (
    host instanceof SpreadPaginatedHost ||
    host instanceof FixedSpreadHost ||
    host instanceof RollContentHost
  ) return host.documentViews();
  const document = host?.element.contentDocument;
  if (!document) return [];
  return [{
    document,
    spineIndex,
    physicalSide: "single",
    page: host instanceof PaginatedContentHost ? host.currentPageAndDocument()?.page : undefined,
    ...(host instanceof PaginatedContentHost ? { revealOverlay: () => host.revealReaderOverlay() } : {}),
  }];
}
