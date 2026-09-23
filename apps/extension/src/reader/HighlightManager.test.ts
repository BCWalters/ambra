import { describe, expect, it, vi } from "vitest";
import type { LocatorResolver } from "@ambra/engine";
import type { Highlight, LibraryDatabase } from "../library/LibraryDatabase.js";
import type { ActiveHighlightState } from "./ReaderTypes.js";
import { HighlightManager, type HighlightManagerContext } from "./HighlightManager.js";

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "hl-1",
    bookId: "book-1",
    spineIndex: 0,
    startCfi: "epubcfi(/6/4!/4/2/2/1:0)",
    endCfi: "epubcfi(/6/4!/4/2/2/1:5)",
    style: "yellow",
    text: "Once upon a time",
    note: undefined,
    createdAt: 0,
    ...overrides,
  };
}

/** A fake `Range` — `HighlightManager.add` only ever reads its
 * container/offset endpoints and stringifies it, never touches the real
 * DOM Range API. */
function makeRange(text = "a bad Faun"): Range {
  const ownerDocument = {} as Document;
  return {
    startContainer: { ownerDocument } as Node,
    startOffset: 0,
    endContainer: { ownerDocument } as Node,
    endOffset: text.length,
    toString: () => text,
  } as unknown as Range;
}

function makeLocatorResolver(): LocatorResolver {
  return {
    generate: vi.fn().mockReturnValue({ cfi: "epubcfi(/6/4!/4/2/2/1:0)" }),
  } as unknown as LocatorResolver;
}

function makeLibrary(initial: Highlight[] = []): LibraryDatabase {
  const stored = [...initial];
  return {
    addHighlight: vi.fn().mockImplementation(async (input: Omit<Highlight, "id" | "createdAt">) => {
      const highlight = makeHighlight({ ...input, id: `hl-${stored.length + 1}`, createdAt: stored.length });
      stored.push(highlight);
      return highlight;
    }),
    removeHighlight: vi.fn().mockImplementation(async (id: string) => {
      const index = stored.findIndex((h) => h.id === id);
      if (index !== -1) stored.splice(index, 1);
    }),
    patchHighlight: vi.fn().mockImplementation(async (id: string, patch: Parameters<LibraryDatabase["patchHighlight"]>[1]) => {
      const index = stored.findIndex((h) => h.id === id);
      if (index === -1) return undefined;
      const updated = { ...stored[index]!, ...patch };
      stored[index] = updated;
      return updated;
    }),
  } as unknown as LibraryDatabase;
}

function makeContext(overrides: Partial<HighlightManagerContext> = {}): HighlightManagerContext {
  let active: ActiveHighlightState | undefined;
  const selection = makeRange();
  return {
    spineIndexForDocument: () => 0,
    isSpineVisible: spineIndex => spineIndex === 0,
    isFixedLayoutHost: () => false,
    pendingSelectionRange: () => selection,
    selectionToolbarAnchor: () => ({ left: 10, top: 20 }),
    dismissSelectionToolbar: vi.fn(),
    applyHighlightsToCurrentHost: vi.fn(),
    updateNoteMarkers: vi.fn(),
    announce: vi.fn(),
    getActiveHighlight: () => active,
    setActiveHighlight: (state) => {
      active = state;
    },
    reportError: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  };
}

describe("HighlightManager", () => {
  it("load() groups highlights by spine index", () => {
    const manager = new HighlightManager(makeLibrary(), "book-1", makeLocatorResolver(), makeContext());
    const a = makeHighlight({ id: "a", spineIndex: 0 });
    const b = makeHighlight({ id: "b", spineIndex: 1 });
    const c = makeHighlight({ id: "c", spineIndex: 0 });

    manager.load([a, b, c]);

    expect(manager.forSpineIndex(0)).toEqual([a, c]);
    expect(manager.forSpineIndex(1)).toEqual([b]);
    expect(manager.forSpineIndex(2)).toBeUndefined();
  });

  it("allSorted() orders highlights by book position (startCfi), across every spine index", () => {
    const manager = new HighlightManager(makeLibrary(), "book-1", makeLocatorResolver(), makeContext());
    const later = makeHighlight({ id: "later", spineIndex: 1, startCfi: "epubcfi(/6/8!/4/2/2/1:0)", createdAt: 1 });
    const earlier = makeHighlight({ id: "earlier", spineIndex: 0, startCfi: "epubcfi(/6/4!/4/2/2/1:0)", createdAt: 2 });
    manager.load([later, earlier]);

    expect(manager.allSorted().map((h) => h.id)).toEqual(["earlier", "later"]);
  });

  it("allSorted() falls back to creation order when a CFI fails to parse", () => {
    const manager = new HighlightManager(makeLibrary(), "book-1", makeLocatorResolver(), makeContext());
    const first = makeHighlight({ id: "first", startCfi: "not-a-cfi", createdAt: 1 });
    const second = makeHighlight({ id: "second", startCfi: "not-a-cfi-either", createdAt: 2 });
    manager.load([second, first]);

    expect(manager.allSorted().map((h) => h.id)).toEqual(["first", "second"]);
  });

  it("add() persists a highlight, caches it, repaints, and announces", async () => {
    const library = makeLibrary();
    const ctx = makeContext();
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);

    await manager.add("yellow");

    expect(library.addHighlight).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "book-1", spineIndex: 0, style: "yellow", text: "a bad Faun" }),
    );
    expect(manager.forSpineIndex(0)).toHaveLength(1);
    expect(ctx.applyHighlightsToCurrentHost).toHaveBeenCalled();
    expect(ctx.announce).toHaveBeenCalledWith("announcements.highlightAdded");
    expect(ctx.dismissSelectionToolbar).toHaveBeenCalled();
  });

  it("add() with openNoteEditor opens the active-highlight popup at the toolbar's anchor", async () => {
    const ctx = makeContext();
    const manager = new HighlightManager(makeLibrary(), "book-1", makeLocatorResolver(), ctx);

    await manager.add("yellow", true);

    expect(ctx.getActiveHighlight()).toMatchObject({ left: 10, top: 20, openNoteEditor: true });
  });

  it("add() uses the selected document's spine identity", async () => {
    const library = makeLibrary();
    const ctx = makeContext({ spineIndexForDocument: () => 12 });
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    await manager.add("green");
    expect(library.addHighlight).toHaveBeenCalledWith(expect.objectContaining({ spineIndex: 12 }));
    expect(manager.forSpineIndex(12)).toHaveLength(1);
  });

  it("add() rejects a selection whose document is no longer visible", async () => {
    const library = makeLibrary();
    const ctx = makeContext({ spineIndexForDocument: () => undefined });
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    await manager.add("green");
    expect(library.addHighlight).not.toHaveBeenCalled();
    expect(ctx.reportError).toHaveBeenCalledWith(new Error("The selection no longer belongs to a visible document."));
  });

  it("a late addition publishes its record without dismissing a newer selection or opening a stale editor", async () => {
    let selection = makeRange();
    const library = makeLibrary();
    let commit!: (highlight: Highlight) => void;
    vi.mocked(library.addHighlight).mockImplementation(() => new Promise(resolve => { commit = resolve; }));
    const ctx = makeContext({ pendingSelectionRange: () => selection });
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    const saving = manager.add("yellow", true);
    selection = makeRange("A newer selection");
    commit(makeHighlight());
    await saving;
    expect(manager.allSorted()).toHaveLength(1);
    expect(ctx.notify).toHaveBeenCalled();
    expect(ctx.dismissSelectionToolbar).not.toHaveBeenCalled();
    expect(ctx.getActiveHighlight()).toBeUndefined();
  });

  it("add() reports a failed save via reportError instead of silently doing nothing", async () => {
    const library = {
      addHighlight: vi.fn().mockRejectedValue(new DOMException("quota", "QuotaExceededError")),
    } as unknown as LibraryDatabase;
    const ctx = makeContext();
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);

    await manager.add("yellow");

    expect(manager.forSpineIndex(0)).toBeUndefined();
    expect(ctx.reportError).toHaveBeenCalledTimes(1);
    expect(ctx.announce).not.toHaveBeenCalledWith("announcements.highlightAdded");
    // Even a failed save still dismisses the selection toolbar — the
    // selection itself is stale either way.
    expect(ctx.dismissSelectionToolbar).toHaveBeenCalled();
  });

  it("add() is a no-op without a pending selection", async () => {
    const library = makeLibrary();
    const ctx = makeContext({ pendingSelectionRange: () => undefined });
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);

    await manager.add("yellow");

    expect(library.addHighlight).not.toHaveBeenCalled();
  });

  it("add() is a no-op for fixed-layout content", async () => {
    const library = makeLibrary();
    const ctx = makeContext({ isFixedLayoutHost: () => true });
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);

    await manager.add("yellow");

    expect(library.addHighlight).not.toHaveBeenCalled();
  });

  it("remove() deletes from the cache and library, and repaints if visible", async () => {
    const existing = makeHighlight({ id: "hl-1", spineIndex: 0 });
    const library = makeLibrary([existing]);
    const ctx = makeContext();
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    manager.load([existing]);

    await manager.remove("hl-1");

    expect(library.removeHighlight).toHaveBeenCalledWith("hl-1");
    expect(manager.forSpineIndex(0)).toEqual([]);
    expect(ctx.applyHighlightsToCurrentHost).toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalled();
  });

  it("remove() clears the active highlight if it's the one being removed", async () => {
    const existing = makeHighlight({ id: "hl-1" });
    const ctx = makeContext();
    ctx.setActiveHighlight({ highlight: existing, left: 0, top: 0 });
    const manager = new HighlightManager(makeLibrary([existing]), "book-1", makeLocatorResolver(), ctx);
    manager.load([existing]);

    await manager.remove("hl-1");

    expect(ctx.getActiveHighlight()).toBeUndefined();
  });

  it("setNote() updates the note, persists, and updates note markers (no repaint)", async () => {
    const existing = makeHighlight({ id: "hl-1" });
    const library = makeLibrary([existing]);
    const ctx = makeContext();
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    manager.load([existing]);

    expect(await manager.setNote("hl-1", "a note")).toBe(true);

    expect(library.patchHighlight).toHaveBeenCalledWith("hl-1", { note: "a note" });
    expect(manager.forSpineIndex(0)?.[0]?.note).toBe("a note");
    expect(ctx.updateNoteMarkers).toHaveBeenCalled();
    expect(ctx.applyHighlightsToCurrentHost).not.toHaveBeenCalled();
  });

  it("setStyle() updates the style, persists, and repaints when the spine item is current", async () => {
    const existing = makeHighlight({ id: "hl-1", spineIndex: 0 });
    const library = makeLibrary([existing]);
    const ctx = makeContext();
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    manager.load([existing]);

    await manager.setStyle("hl-1", "green");

    expect(library.patchHighlight).toHaveBeenCalledWith("hl-1", { style: "green" });
    expect(manager.forSpineIndex(0)?.[0]?.style).toBe("green");
    expect(ctx.applyHighlightsToCurrentHost).toHaveBeenCalled();
  });

  it("setStyle() skips the repaint when the highlight belongs to a different (not-current) spine item", async () => {
    const existing = makeHighlight({ id: "hl-1", spineIndex: 3 });
    const library = makeLibrary([existing]);
    const ctx = makeContext({ isSpineVisible: spineIndex => spineIndex === 0 });
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    manager.load([existing]);

    await manager.setStyle("hl-1", "green");

    expect(ctx.applyHighlightsToCurrentHost).not.toHaveBeenCalled();
  });

  it("concurrent note and style edits preserve both fields in cache and popup", async () => {
    const existing = makeHighlight();
    const library = makeLibrary([existing]);
    const ctx = makeContext();
    ctx.setActiveHighlight({ highlight: existing, left: 0, top: 0 });
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    manager.load([existing]);

    await Promise.all([manager.setNote(existing.id, "Keep this note"), manager.setStyle(existing.id, "green")]);
    expect(manager.forSpineIndex(0)?.[0]).toMatchObject({ note: "Keep this note", style: "green" });
    expect(ctx.getActiveHighlight()?.highlight).toMatchObject({ note: "Keep this note", style: "green" });
    await manager.setNote(existing.id, undefined);
    expect(manager.forSpineIndex(0)?.[0]).toMatchObject({ note: undefined, style: "green" });
  });

  it("publishes an update into the current cache rather than a replaced array", async () => {
    const existing = makeHighlight();
    const library = makeLibrary([existing]);
    let commit!: (highlight: Highlight) => void;
    vi.mocked(library.patchHighlight).mockImplementation(() => new Promise(resolve => { commit = resolve; }));
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), makeContext());
    manager.load([existing]);
    const pending = manager.setNote(existing.id, "Committed");
    manager.load([{ ...existing }]);
    expect(manager.forSpineIndex(0)?.[0]?.note).toBeUndefined();
    commit({ ...existing, note: "Committed" });
    await pending;
    expect(manager.forSpineIndex(0)?.[0]?.note).toBe("Committed");
  });

  it.each(["remove", "setNote", "setStyle"] as const)("failed %s preserves cache and popup and reports the failure", async operation => {
    const existing = makeHighlight();
    const library = makeLibrary([existing]);
    const error = new DOMException("Aborted", "AbortError");
    vi.mocked(library.removeHighlight).mockRejectedValue(error);
    vi.mocked(library.patchHighlight).mockRejectedValue(error);
    const ctx = makeContext();
    ctx.setActiveHighlight({ highlight: existing, left: 0, top: 0 });
    const manager = new HighlightManager(library, "book-1", makeLocatorResolver(), ctx);
    manager.load([existing]);

    if (operation === "remove") await manager.remove(existing.id);
    else if (operation === "setNote") expect(await manager.setNote(existing.id, "Rejected")).toBe(false);
    else await manager.setStyle(existing.id, "green");
    expect(manager.forSpineIndex(0)).toEqual([existing]);
    expect(ctx.getActiveHighlight()?.highlight).toEqual(existing);
    expect(ctx.notify).not.toHaveBeenCalled();
    expect(ctx.reportError).toHaveBeenCalledWith(error);
  });

  it("removes stale cached annotations rather than resurrecting a deleted record", async () => {
    const existing = makeHighlight();
    const ctx = makeContext();
    const manager = new HighlightManager(makeLibrary(), "book-1", makeLocatorResolver(), ctx);
    manager.load([existing]);
    await manager.setNote(existing.id, "Too late");
    expect(manager.forSpineIndex(0)).toEqual([]);
    expect(ctx.reportError).toHaveBeenCalledOnce();
  });
});
