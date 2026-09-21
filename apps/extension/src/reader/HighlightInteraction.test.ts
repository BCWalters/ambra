import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocatorResolver } from "@ambra/engine";
import type { Highlight } from "../library/LibraryDatabase.js";
import type { ActiveHighlightState, SelectionToolbarState } from "./ReaderTypes.js";
import { applyHighlightRanges, applySearchMatchRanges } from "./HighlightRenderer.js";
import { findTextRangesInDocument } from "./findTextRangesInDocument.js";
import { HighlightInteraction, type HighlightInteractionContext } from "./HighlightInteraction.js";

// `HighlightInteraction` only ever calls into these to actually paint —
// what's worth testing here is *which* documents/ranges/queries it feeds
// them, not the CSS Custom Highlight API mechanics themselves (that's
// `HighlightRenderer`'s own, separately-testable concern).
vi.mock("./HighlightRenderer.js", () => ({
  applyHighlightRanges: vi.fn(),
  applySearchMatchRanges: vi.fn(),
}));
vi.mock("./findTextRangesInDocument.js", () => ({
  findTextRangesInDocument: vi.fn().mockReturnValue([]),
}));

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "hl-1",
    bookId: "book-1",
    spineIndex: 0,
    startCfi: "epubcfi(/6/4!/4/2/2/1:0)",
    endCfi: "epubcfi(/6/4!/4/2/2/1:5)",
    style: "yellow",
    text: "a bad Faun",
    note: undefined,
    createdAt: 0,
    ...overrides,
  };
}

function makeLocatorResolver(): LocatorResolver {
  return {
    resolveInDocument: vi.fn().mockReturnValue({ node: {} as Node, characterOffset: 0 }),
  } as unknown as LocatorResolver;
}

/** A fake `Range` — good enough for `HighlightInteraction`'s own needs
 * (it only ever reads `getClientRects()`/`comparePoint`, and hands the
 * range opaquely to the (mocked) painting functions), never real DOM
 * Range semantics. */
function makeFakeRange(rects: Array<{ top: number; bottom: number }> = []): Range {
  return {
    setStart: vi.fn(),
    setEnd: vi.fn(),
    getClientRects: () => rects.map((r) => ({ ...r, left: 0, right: 10, height: r.bottom - r.top, width: 10 })),
    getBoundingClientRect: () => ({ top: rects[0]?.top ?? 0, left: 0, right: 10, bottom: rects[0]?.bottom ?? 0 }),
    comparePoint: vi.fn().mockReturnValue(0),
  } as unknown as Range;
}

/** A fake content `Document` — implements only what `HighlightInteraction`
 * actually touches: `defaultView.frameElement`, `createRange`,
 * `getSelection`, event (de)registration, and (for hit-testing)
 * `caretRangeFromPoint`. */
function makeFakeDoc(
  options: {
    iframeRect?: { top: number; left: number };
    clipPath?: string;
    range?: Range;
    caretRangeFromPoint?: (() => Range | null) | undefined;
  } = {},
): { doc: Document; iframeEl: HTMLIFrameElement; listeners: Map<string, (event: unknown) => void> } {
  const listeners = new Map<string, (event: unknown) => void>();
  const iframeEl = {
    getBoundingClientRect: () => ({ top: options.iframeRect?.top ?? 0, left: options.iframeRect?.left ?? 0, height: 800 }),
    style: { clipPath: options.clipPath ?? "" },
  } as unknown as HTMLIFrameElement;
  const doc = {
    defaultView: { frameElement: iframeEl },
    createRange: () => options.range ?? makeFakeRange(),
    getSelection: vi.fn().mockReturnValue(null),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    caretRangeFromPoint: options.caretRangeFromPoint,
  } as unknown as Document;
  return { doc, iframeEl, listeners };
}

function makeContext(overrides: Partial<HighlightInteractionContext> = {}): HighlightInteractionContext & {
  readonly activeHighlight: ActiveHighlightState | undefined;
  readonly selectionToolbar: SelectionToolbarState | undefined;
  readonly pendingSelectionRange: Range | undefined;
} {
  const state = {
    activeHighlight: undefined as ActiveHighlightState | undefined,
    selectionToolbar: undefined as SelectionToolbarState | undefined,
    pendingSelectionRange: undefined as Range | undefined,
  };
  return {
    spineIndex: () => 3,
    isFixedLayoutHost: () => false,
    allContentDocuments: () => [],
    mergedTailDocument: () => undefined,
    forSpineIndex: () => undefined,
    currentSearchHighlightQuery: () => undefined,
    setPendingSelectionRange: (range) => {
      state.pendingSelectionRange = range;
    },
    setSelectionToolbar: (toolbar) => {
      state.selectionToolbar = toolbar;
    },
    setActiveHighlight: (highlight) => {
      state.activeHighlight = highlight;
    },
    notify: vi.fn(),
    ...overrides,
    get activeHighlight() {
      return state.activeHighlight;
    },
    get selectionToolbar() {
      return state.selectionToolbar;
    },
    get pendingSelectionRange() {
      return state.pendingSelectionRange;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HighlightInteraction", () => {
  describe("applyHighlightsToCurrentHost()", () => {
    it("is a no-op for fixed-layout content", () => {
      const ctx = makeContext({ isFixedLayoutHost: () => true, allContentDocuments: vi.fn() });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applyHighlightsToCurrentHost();
      expect(ctx.allContentDocuments).not.toHaveBeenCalled();
      expect(applyHighlightRanges).not.toHaveBeenCalled();
    });

    it("paints every content document against the current spine index", () => {
      const { doc: doc1 } = makeFakeDoc();
      const { doc: doc2 } = makeFakeDoc();
      const highlight = makeHighlight();
      const ctx = makeContext({
        allContentDocuments: () => [doc1, doc2],
        forSpineIndex: (spineIndex) => (spineIndex === 3 ? [highlight] : undefined),
      });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applyHighlightsToCurrentHost();
      expect(applyHighlightRanges).toHaveBeenCalledTimes(2);
      const [, groups] = vi.mocked(applyHighlightRanges).mock.calls[0]!;
      expect(groups.get("yellow")).toHaveLength(1);
    });

    it("paints a merged spread's tail document against spineIndex - 1, and skips it in the main loop", () => {
      const { doc: tailDoc } = makeFakeDoc();
      const { doc: primaryDoc } = makeFakeDoc();
      const tailHighlight = makeHighlight({ id: "hl-tail", spineIndex: 2 });
      const ctx = makeContext({
        mergedTailDocument: () => tailDoc,
        allContentDocuments: () => [tailDoc, primaryDoc],
        forSpineIndex: (spineIndex) => (spineIndex === 2 ? [tailHighlight] : undefined),
      });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applyHighlightsToCurrentHost();
      // Once for the tail document (spineIndex 2) and once for the
      // primary document (spineIndex 3) — never twice for the tail doc.
      expect(applyHighlightRanges).toHaveBeenCalledTimes(2);
      const [firstDoc, firstGroups] = vi.mocked(applyHighlightRanges).mock.calls[0]!;
      expect(firstDoc).toBe(tailDoc);
      expect(firstGroups.get("yellow")).toHaveLength(1);
    });

    it("also refreshes the search-match spotlight and note markers", () => {
      const { doc } = makeFakeDoc();
      const ctx = makeContext({ allContentDocuments: () => [doc], currentSearchHighlightQuery: () => "faun" });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applyHighlightsToCurrentHost();
      expect(findTextRangesInDocument).toHaveBeenCalledWith(doc, "faun");
      expect(applySearchMatchRanges).toHaveBeenCalled();
    });
  });

  describe("applySearchHighlightToCurrentHost()", () => {
    it("is a no-op for fixed-layout content", () => {
      const ctx = makeContext({ isFixedLayoutHost: () => true, allContentDocuments: vi.fn() });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applySearchHighlightToCurrentHost();
      expect(ctx.allContentDocuments).not.toHaveBeenCalled();
    });

    it("clears matches (empty ranges) when there's no current query", () => {
      const { doc } = makeFakeDoc();
      const ctx = makeContext({ allContentDocuments: () => [doc], currentSearchHighlightQuery: () => undefined });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applySearchHighlightToCurrentHost();
      expect(findTextRangesInDocument).not.toHaveBeenCalled();
      expect(applySearchMatchRanges).toHaveBeenCalledWith(doc, []);
    });
  });

  describe("updateNoteMarkers()", () => {
    it("clears note markers for fixed-layout content", () => {
      const ctx = makeContext({ isFixedLayoutHost: () => true });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.updateNoteMarkers();
      expect(interaction.noteMarkers).toEqual([]);
    });

    it("places a marker for a highlight with a note whose last visible rect falls on the current page", () => {
      const range = makeFakeRange([{ top: 100, bottom: 120 }]);
      const { doc } = makeFakeDoc({ iframeRect: { top: 10, left: 5 }, range });
      const highlighted = makeHighlight({ id: "hl-note", note: "remember this" });
      const ctx = makeContext({
        allContentDocuments: () => [doc],
        forSpineIndex: () => [highlighted],
      });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.updateNoteMarkers();
      expect(interaction.noteMarkers).toEqual([{ id: "hl-note", left: 5 + 10, top: 10 + 100 }]);
    });

    it("skips a highlight without a note", () => {
      const range = makeFakeRange([{ top: 100, bottom: 120 }]);
      const { doc } = makeFakeDoc({ range });
      const ctx = makeContext({ allContentDocuments: () => [doc], forSpineIndex: () => [makeHighlight({ note: undefined })] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.updateNoteMarkers();
      expect(interaction.noteMarkers).toEqual([]);
    });

    it("skips a highlight whose rects are all off the current visible page", () => {
      // A non-empty clip-path means only the [900, 1700] band is visible;
      // the highlight's only rect sits entirely above it.
      const range = makeFakeRange([{ top: 100, bottom: 120 }]);
      const { doc } = makeFakeDoc({ clipPath: "inset(900px 0px 100px 0px)", range });
      const ctx = makeContext({ allContentDocuments: () => [doc], forSpineIndex: () => [makeHighlight({ note: "x" })] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.updateNoteMarkers();
      expect(interaction.noteMarkers).toEqual([]);
    });
  });

  describe("findHighlightAtPoint()", () => {
    it("returns undefined when the document has no caretRangeFromPoint support", () => {
      const { doc } = makeFakeDoc({ caretRangeFromPoint: undefined });
      const ctx = makeContext({ forSpineIndex: () => [makeHighlight()] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      expect(interaction.findHighlightAtPoint(doc, 1, 2)).toBeUndefined();
    });

    it("returns the highlight whose range contains the caret position", () => {
      const caretRange = { startContainer: {} as Node, startOffset: 0 } as Range;
      const matchingRange = makeFakeRange();
      const { doc } = makeFakeDoc({ caretRangeFromPoint: () => caretRange, range: matchingRange });
      const highlight = makeHighlight();
      const ctx = makeContext({ forSpineIndex: () => [highlight] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      expect(interaction.findHighlightAtPoint(doc, 1, 2)).toBe(highlight);
    });

    it("returns undefined when no highlight's range contains the caret position", () => {
      const caretRange = { startContainer: {} as Node, startOffset: 0 } as Range;
      const nonMatchingRange = makeFakeRange();
      vi.mocked(nonMatchingRange.comparePoint).mockReturnValue(1);
      const { doc } = makeFakeDoc({ caretRangeFromPoint: () => caretRange, range: nonMatchingRange });
      const ctx = makeContext({ forSpineIndex: () => [makeHighlight()] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      expect(interaction.findHighlightAtPoint(doc, 1, 2)).toBeUndefined();
    });
  });

  describe("setUpHighlightSelection() + selection/click handling", () => {
    it("sets selectionToolbar/pendingSelectionRange on a non-collapsed selection, and clears activeHighlight", () => {
      const range = { cloneRange: () => range, getBoundingClientRect: () => ({ top: 5, left: 5, width: 10, height: 10 }) } as unknown as Range;
      const selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
      const { doc, listeners } = makeFakeDoc({ iframeRect: { top: 0, left: 0 } });
      vi.mocked(doc.getSelection).mockReturnValue(selection);
      const ctx = makeContext({ allContentDocuments: () => [doc] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.setUpHighlightSelection();
      listeners.get("pointerup")!({ clientX: 1, clientY: 2 });
      expect(ctx.pendingSelectionRange).toBe(range);
      expect(ctx.selectionToolbar).toBeDefined();
      expect(ctx.activeHighlight).toBeUndefined();
    });

    it("checks for an existing-highlight click when there's no selection to show a toolbar for", () => {
      const selection = { isCollapsed: true, rangeCount: 0 } as unknown as Selection;
      const caretRange = { startContainer: {} as Node, startOffset: 0 } as Range;
      const matchingRange = makeFakeRange();
      const { doc, listeners } = makeFakeDoc({ caretRangeFromPoint: () => caretRange, range: matchingRange });
      vi.mocked(doc.getSelection).mockReturnValue(selection);
      const highlight = makeHighlight();
      const ctx = makeContext({ allContentDocuments: () => [doc], forSpineIndex: () => [highlight] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.setUpHighlightSelection();
      listeners.get("pointerup")!({ clientX: 1, clientY: 2 });
      expect(ctx.activeHighlight?.highlight).toBe(highlight);
    });

    it("teardownSelection() detaches every listener setUpHighlightSelection attached", () => {
      const { doc, listeners } = makeFakeDoc();
      const ctx = makeContext({ allContentDocuments: () => [doc] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.setUpHighlightSelection();
      expect(listeners.size).toBeGreaterThan(0);
      interaction.teardownSelection();
      expect(listeners.size).toBe(0);
    });
  });

  describe("dismissSelectionToolbar()", () => {
    it("clears the toolbar/pending range and every document's native selection", () => {
      const removeAllRanges = vi.fn();
      const { doc } = makeFakeDoc();
      vi.mocked(doc.getSelection).mockReturnValue({ removeAllRanges } as unknown as Selection);
      const ctx = makeContext({ allContentDocuments: () => [doc] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.dismissSelectionToolbar();
      expect(removeAllRanges).toHaveBeenCalled();
      expect(ctx.pendingSelectionRange).toBeUndefined();
      expect(ctx.selectionToolbar).toBeUndefined();
      expect(ctx.notify).toHaveBeenCalled();
    });
  });

  describe("dismissActiveHighlight()", () => {
    it("clears the active highlight", () => {
      const ctx = makeContext();
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.dismissActiveHighlight();
      expect(ctx.activeHighlight).toBeUndefined();
      expect(ctx.notify).toHaveBeenCalled();
    });
  });

  describe("openHighlightPopup()", () => {
    it("opens activeHighlight using the marker's own position, for a highlight with a marker on screen", () => {
      const range = makeFakeRange([{ top: 100, bottom: 120 }]);
      const { doc } = makeFakeDoc({ iframeRect: { top: 10, left: 5 }, range });
      const highlight = makeHighlight({ id: "hl-note", note: "x" });
      const ctx = makeContext({ allContentDocuments: () => [doc], forSpineIndex: () => [highlight] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.updateNoteMarkers();
      interaction.openHighlightPopup("hl-note");
      expect(ctx.activeHighlight).toEqual({ highlight, left: 15, top: 110 });
      expect(ctx.notify).toHaveBeenCalled();
    });

    it("is a no-op when the id doesn't match a marker currently on screen", () => {
      const ctx = makeContext();
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.openHighlightPopup("does-not-exist");
      expect(ctx.activeHighlight).toBeUndefined();
      expect(ctx.notify).not.toHaveBeenCalled();
    });
  });
});
