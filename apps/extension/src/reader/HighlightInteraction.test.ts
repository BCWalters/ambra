import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentDocumentView, LocatorResolver } from "@ambra/engine";
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
  applyActiveHighlightRange: vi.fn(),
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
function makeFakeRange(rects: Array<{ top: number; bottom: number; left?: number; right?: number }> = []): Range {
  const range = {
    setStart: vi.fn(),
    setEnd: vi.fn(),
    cloneRange: () => range,
    getClientRects: () => rects.map((r) =>
      new DOMRect(r.left ?? 0, r.top, (r.right ?? 10) - (r.left ?? 0), r.bottom - r.top)),
    getBoundingClientRect: () => ({ top: rects[0]?.top ?? 0, left: 0, right: 10, bottom: rects[0]?.bottom ?? 0 }),
    comparePoint: vi.fn().mockReturnValue(0),
  } as unknown as Range;
  return range;
}

/** A fake content `Document` — implements only what `HighlightInteraction`
 * actually touches: `defaultView.frameElement`, `createRange`,
 * `getSelection`, event (de)registration, and (for hit-testing)
 * `caretRangeFromPoint`. */
function makeFakeDoc(
  options: {
    iframeRect?: { top: number; left: number; width?: number; height?: number };
    clipPath?: string;
    range?: Range;
    caretRangeFromPoint?: (() => Range | null) | undefined;
  } = {},
): { doc: Document; iframeEl: HTMLIFrameElement; listeners: Map<string, (event: unknown) => void> } {
  const listeners = new Map<string, (event: unknown) => void>();
  const iframeEl = {
    getBoundingClientRect: () => new DOMRect(
      options.iframeRect?.left ?? 0, options.iframeRect?.top ?? 0,
      options.iframeRect?.width ?? 600, options.iframeRect?.height ?? 800,
    ),
    ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 900 } },
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
    isFixedLayoutHost: () => false,
    contentDocuments: () => [],
    forSpineIndex: () => undefined,
    currentSearchHighlightQuery: () => undefined,
    getActiveHighlight: () => state.activeHighlight,
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

function views(...documents: Document[]): ContentDocumentView[] {
  return documents.map(document => ({ document, spineIndex: 3, physicalSide: "single" }));
}

function selectRange(doc: Document, range: Range): Selection {
  const selection = {
    isCollapsed: false, rangeCount: 1, getRangeAt: () => range, removeAllRanges: vi.fn(),
  } as unknown as Selection;
  vi.mocked(doc.getSelection).mockReturnValue(selection);
  return selection;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HighlightInteraction", () => {
  describe("applyHighlightsToCurrentHost()", () => {
    it("is a no-op for fixed-layout content", () => {
      const ctx = makeContext({ isFixedLayoutHost: () => true, contentDocuments: vi.fn() });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applyHighlightsToCurrentHost();
      expect(ctx.contentDocuments).not.toHaveBeenCalled();
      expect(applyHighlightRanges).not.toHaveBeenCalled();
    });

    it("paints every content document against the current spine index", () => {
      const { doc: doc1 } = makeFakeDoc();
      const { doc: doc2 } = makeFakeDoc();
      const highlight = makeHighlight();
      const ctx = makeContext({
        contentDocuments: () => views(doc1, doc2),
        forSpineIndex: (spineIndex) => (spineIndex === 3 ? [highlight] : undefined),
      });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applyHighlightsToCurrentHost();
      expect(applyHighlightRanges).toHaveBeenCalledTimes(2);
      const [, entries] = vi.mocked(applyHighlightRanges).mock.calls[0]!;
      expect(entries.filter((e) => e.style === "yellow")).toHaveLength(1);
    });

    it("paints nonconsecutive spine items using explicit document ownership", () => {
      const { doc: tailDoc } = makeFakeDoc();
      const { doc: primaryDoc } = makeFakeDoc();
      const tailHighlight = makeHighlight({ id: "hl-tail", spineIndex: 9 });
      const ctx = makeContext({
        contentDocuments: () => [
          { document: tailDoc, spineIndex: 9, physicalSide: "left" },
          { document: primaryDoc, spineIndex: 14, physicalSide: "right" },
        ],
        forSpineIndex: (spineIndex) => (spineIndex === 9 ? [tailHighlight] : undefined),
      });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applyHighlightsToCurrentHost();
      expect(applyHighlightRanges).toHaveBeenCalledTimes(2);
      const [firstDoc, firstEntries] = vi.mocked(applyHighlightRanges).mock.calls[0]!;
      expect(firstDoc).toBe(tailDoc);
      expect(firstEntries.filter((e) => e.style === "yellow")).toHaveLength(1);
    });

    it("also refreshes the search-match spotlight and note markers", () => {
      const { doc } = makeFakeDoc();
      const ctx = makeContext({ contentDocuments: () => views(doc), currentSearchHighlightQuery: () => "faun" });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applyHighlightsToCurrentHost();
      expect(findTextRangesInDocument).toHaveBeenCalledWith(doc, "faun");
      expect(applySearchMatchRanges).toHaveBeenCalled();
    });
  });

  describe("applySearchHighlightToCurrentHost()", () => {
    it("is a no-op for fixed-layout content", () => {
      const ctx = makeContext({ isFixedLayoutHost: () => true, contentDocuments: vi.fn() });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.applySearchHighlightToCurrentHost();
      expect(ctx.contentDocuments).not.toHaveBeenCalled();
    });

    it("clears matches (empty ranges) when there's no current query", () => {
      const { doc } = makeFakeDoc();
      const ctx = makeContext({ contentDocuments: () => views(doc), currentSearchHighlightQuery: () => undefined });
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
        contentDocuments: () => views(doc),
        forSpineIndex: () => [highlighted],
      });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.updateNoteMarkers();
      expect(interaction.noteMarkers).toEqual([{ id: "hl-note", left: 5 + 10, top: 10 + 100 }]);
    });

    it("skips a highlight without a note", () => {
      const range = makeFakeRange([{ top: 100, bottom: 120 }]);
      const { doc } = makeFakeDoc({ range });
      const ctx = makeContext({ contentDocuments: () => views(doc), forSpineIndex: () => [makeHighlight({ note: undefined })] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.updateNoteMarkers();
      expect(interaction.noteMarkers).toEqual([]);
    });

    it("skips a highlight whose rects are all off the current visible page", () => {
      // A non-empty clip-path means only the [900, 1700] band is visible;
      // the highlight's only rect sits entirely above it.
      const range = makeFakeRange([{ top: 100, bottom: 120 }]);
      const { doc } = makeFakeDoc({ clipPath: "inset(900px 0px 100px 0px)", range });
      const ctx = makeContext({ contentDocuments: () => views(doc), forSpineIndex: () => [makeHighlight({ note: "x" })] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.updateNoteMarkers();
      expect(interaction.noteMarkers).toEqual([]);
    });
  });

  describe("findHighlightAtPoint()", () => {
    it("hits and opens notes from the earlier document in a cross-chapter spread", () => {
      const caret = { startContainer: {} as Node, startOffset: 0 } as Range;
      const { doc: earlier, listeners } = makeFakeDoc({
        caretRangeFromPoint: () => caret, range: makeFakeRange([{ top: 100, bottom: 120 }]),
      });
      const { doc: later } = makeFakeDoc();
      const highlight = makeHighlight({ spineIndex: 7, note: "Earlier chapter" });
      const resolver = makeLocatorResolver();
      const ctx = makeContext({
        contentDocuments: () => [
          { document: earlier, spineIndex: 7, physicalSide: "right" },
          { document: later, spineIndex: 12, physicalSide: "left" },
        ],
        forSpineIndex: index => index === 7 ? [highlight] : undefined,
      });
      const interaction = new HighlightInteraction(resolver, ctx);
      expect(interaction.findHighlightAtPoint(earlier, 1, 2)).toBe(highlight);
      expect(interaction.findHighlightAtPoint(later, 1, 2)).toBeUndefined();
      expect(resolver.resolveInDocument).toHaveBeenCalledWith(expect.anything(), 7, earlier);
      interaction.setUpHighlightSelection();
      listeners.get("pointerup")!({ clientX: 1, clientY: 2 });
      expect(ctx.activeHighlight?.highlight).toBe(highlight);
      interaction.dismissActiveHighlight();
      interaction.updateNoteMarkers();
      interaction.openHighlightPopup(highlight.id);
      expect(ctx.activeHighlight?.highlight).toBe(highlight);
    });

    it("returns undefined when the document has no caretRangeFromPoint support", () => {
      const { doc } = makeFakeDoc({ caretRangeFromPoint: undefined });
      const ctx = makeContext({ contentDocuments: () => views(doc), forSpineIndex: () => [makeHighlight()] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      expect(interaction.findHighlightAtPoint(doc, 1, 2)).toBeUndefined();
    });

    it("returns the highlight whose range contains the caret position", () => {
      const caretRange = { startContainer: {} as Node, startOffset: 0 } as Range;
      const matchingRange = makeFakeRange();
      const { doc } = makeFakeDoc({ caretRangeFromPoint: () => caretRange, range: matchingRange });
      const highlight = makeHighlight();
      const ctx = makeContext({ contentDocuments: () => views(doc), forSpineIndex: () => [highlight] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      expect(interaction.findHighlightAtPoint(doc, 1, 2)).toBe(highlight);
    });

    it("returns undefined when no highlight's range contains the caret position", () => {
      const caretRange = { startContainer: {} as Node, startOffset: 0 } as Range;
      const nonMatchingRange = makeFakeRange();
      vi.mocked(nonMatchingRange.comparePoint).mockReturnValue(1);
      const { doc } = makeFakeDoc({ caretRangeFromPoint: () => caretRange, range: nonMatchingRange });
      const ctx = makeContext({ contentDocuments: () => views(doc), forSpineIndex: () => [makeHighlight()] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      expect(interaction.findHighlightAtPoint(doc, 1, 2)).toBeUndefined();
    });
  });

  describe("setUpHighlightSelection() + selection/click handling", () => {
    it("sets selectionToolbar/pendingSelectionRange on a non-collapsed selection, and clears activeHighlight", () => {
      const range = makeFakeRange([{ top: 5, bottom: 15, left: 5, right: 15 }]);
      const { doc, listeners } = makeFakeDoc({ iframeRect: { top: 0, left: 0 } });
      selectRange(doc, range);
      const ctx = makeContext({ contentDocuments: () => views(doc) });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.setUpHighlightSelection();
      listeners.get("pointerup")!({ clientX: 1, clientY: 2 });
      expect(ctx.pendingSelectionRange).toBe(range);
      expect(ctx.selectionToolbar).toBeDefined();
      expect(ctx.activeHighlight).toBeUndefined();
    });

    for (const event of ["pointerup", "keyup"]) {
      it.each([
        [{ top: -200, bottom: -180 }],
        [{ top: 10, bottom: 30 }],
        [{ top: 760, bottom: 780 }],
        [{ top: 100, bottom: 120, left: -30, right: -10 }],
        [{ top: 100, bottom: 120, left: 610, right: 630 }],
        [{ top: 100, bottom: 120, left: 20, right: 20 }],
        [{ top: 30, bottom: 50 }],
        [{ top: 750, bottom: 770 }],
        [{ top: -200, bottom: -180 }, { top: 800, bottom: 820 }],
      ])(`${event} suppresses annotation UI for invisible selection rects %j`, (...rects) => {
        const range = makeFakeRange(rects);
        const caretRangeFromPoint = vi.fn(() => range);
        const { doc, listeners } = makeFakeDoc({
          clipPath: "inset(50px 0px 50px 0px)", caretRangeFromPoint, range,
        });
        const selection = selectRange(doc, range);
        const ctx = makeContext({
          contentDocuments: () => views(doc), forSpineIndex: () => [makeHighlight()],
        });
        ctx.setSelectionToolbar({ left: 20, top: 100 });
        ctx.setPendingSelectionRange(range);
        const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
        interaction.setUpHighlightSelection();
        listeners.get(event)!({ clientX: 590, clientY: 200 });
        expect(ctx.selectionToolbar).toBeUndefined();
        expect(ctx.pendingSelectionRange).toBeUndefined();
        expect(ctx.activeHighlight).toBeUndefined();
        expect(caretRangeFromPoint).not.toHaveBeenCalled();
        expect(selection.removeAllRanges).not.toHaveBeenCalled();
      });
    }

    it("anchors a cross-page selection to its visible fragments without truncating the native range", () => {
      const range = makeFakeRange([
        { top: -200, bottom: -180 },
        { top: 30, bottom: 80, left: 20, right: 120 },
        { top: 120, bottom: 150, left: 80, right: 300 },
        { top: 760, bottom: 790 },
      ]);
      const { doc, listeners } = makeFakeDoc({
        iframeRect: { left: 100, top: 20 }, clipPath: "inset(50px 0px 50px 0px)",
      });
      const selection = selectRange(doc, range);
      const ctx = makeContext({ contentDocuments: () => views(doc) });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.setUpHighlightSelection();
      listeners.get("keyup")!({});
      expect(ctx.selectionToolbar).toEqual({ left: 260, top: 70 });
      expect(ctx.pendingSelectionRange).toBe(range);
      expect(selection.removeAllRanges).not.toHaveBeenCalled();
    });

    it("clips scroll-mode selection anchors to the iframe and the shell viewport", () => {
      const range = makeFakeRange([{ top: 80, bottom: 140, left: 80, right: 140 }]);
      const { doc, listeners } = makeFakeDoc({ iframeRect: { left: -100, top: -100 } });
      selectRange(doc, range);
      const ctx = makeContext({ contentDocuments: () => views(doc) });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.setUpHighlightSelection();
      listeners.get("keyup")!({});
      expect(ctx.selectionToolbar).toEqual({ left: 20, top: 0 });
      expect(ctx.pendingSelectionRange).toBe(range);
    });

    it.each([false, true])("scroll only updates an already presented selection toolbar (presented: %s)", presented => {
      const rects = [{ top: 100, bottom: 120 }];
      const range = makeFakeRange(rects);
      const { doc, listeners } = makeFakeDoc();
      const selection = selectRange(doc, range);
      const ctx = makeContext({ contentDocuments: () => views(doc) });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      let scrollFrame: FrameRequestCallback | undefined;
      const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => {
        scrollFrame = callback;
        return 1;
      });
      try {
        interaction.setUpHighlightSelection();
        if (presented) {
          listeners.get("keyup")!({});
          expect(ctx.selectionToolbar).toBeDefined();
          rects[0] = { top: -100, bottom: -80 };
        }
        listeners.get("scroll")!({});
        expect(scrollFrame).toBeDefined();
        scrollFrame!(0);
        expect(ctx.selectionToolbar).toBeUndefined();
        expect(ctx.pendingSelectionRange).toBeUndefined();
        expect(selection.removeAllRanges).not.toHaveBeenCalled();
      } finally {
        interaction.teardownSelection();
        raf.mockRestore();
      }
    });

    it("does not replace a selection toolbar when a different spread document scrolls", () => {
      const left = makeFakeDoc();
      const right = makeFakeDoc({ iframeRect: { left: 600, top: 0 } });
      const leftRange = makeFakeRange([{ top: 100, bottom: 120 }]);
      const rightRange = makeFakeRange([{ top: 200, bottom: 220 }]);
      selectRange(left.doc, leftRange);
      selectRange(right.doc, rightRange);
      const ctx = makeContext({ contentDocuments: () => views(left.doc, right.doc) });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      let scrollFrame: FrameRequestCallback | undefined;
      const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(callback => {
        scrollFrame = callback;
        return 1;
      });
      try {
        interaction.setUpHighlightSelection();
        left.listeners.get("keyup")!({});
        right.listeners.get("keyup")!({});
        left.listeners.get("scroll")!({});
        expect(scrollFrame).toBeDefined();
        scrollFrame!(0);
        expect(ctx.selectionToolbar).toEqual({ left: 605, top: 200 });
        expect(ctx.pendingSelectionRange).toBe(rightRange);
      } finally {
        interaction.teardownSelection();
        raf.mockRestore();
      }
    });

    it("checks for an existing-highlight click when there's no selection to show a toolbar for", () => {
      const selection = { isCollapsed: true, rangeCount: 0 } as unknown as Selection;
      const caretRange = { startContainer: {} as Node, startOffset: 0 } as Range;
      const matchingRange = makeFakeRange();
      const { doc, listeners } = makeFakeDoc({ caretRangeFromPoint: () => caretRange, range: matchingRange });
      vi.mocked(doc.getSelection).mockReturnValue(selection);
      const highlight = makeHighlight();
      const ctx = makeContext({ contentDocuments: () => views(doc), forSpineIndex: () => [highlight] });
      const interaction = new HighlightInteraction(makeLocatorResolver(), ctx);
      interaction.setUpHighlightSelection();
      listeners.get("pointerup")!({ clientX: 1, clientY: 2 });
      expect(ctx.activeHighlight?.highlight).toBe(highlight);
    });

    it("teardownSelection() detaches every listener setUpHighlightSelection attached", () => {
      const { doc, listeners } = makeFakeDoc();
      const ctx = makeContext({ contentDocuments: () => views(doc) });
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
      const ctx = makeContext({ contentDocuments: () => views(doc) });
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
      const ctx = makeContext({ contentDocuments: () => views(doc), forSpineIndex: () => [highlight] });
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
