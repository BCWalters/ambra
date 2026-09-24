/** Keep full EPUB labels readable without letting tooltip portals exceed the viewport. */
export const EPUB_TOOLTIP_STYLE = {
  maxWidth: "min(360px, calc(100vw - 32px))",
  maxHeight: "min(240px, calc(100vh - 32px))",
  overflowWrap: "anywhere",
  overflowY: "auto",
} as const;
