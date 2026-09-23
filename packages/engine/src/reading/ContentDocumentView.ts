import type { Page } from "../layout/Page.js";

/** A rendered document's publication identity, independent of its screen position. */
export interface ContentDocumentView {
  readonly document: Document;
  readonly spineIndex: number;
  readonly physicalSide: "single" | "left" | "right";
  readonly page?: Page;
  /** Temporarily gives a reader-owned top-layer control room, without repagination. */
  readonly revealOverlay?: () => () => void;
}
