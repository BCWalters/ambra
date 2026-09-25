import { describe, expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";
import { DEFAULT_BOOK_READING_SETTINGS } from "../library/ReadingSettings.js";

function controller() {
  const reader = Object.create(ReaderController.prototype) as ReaderController;
  const chapterLabel = vi.fn((index: number) => index === 0 ? "Chapter One" : "Chapter Two");
  Object.assign(reader, {
    pkg: { metadata: { title: "Book" }, spine: [
      { manifestItem: { path: "one.xhtml" } }, { manifestItem: { path: "two.xhtml" } },
    ] },
    spineIndex: 0, host: undefined, isLoading: false,
    narration: { snapshot: { available: false } },
    navigation: { toc: { items: [] } },
    bookmarks: { onCurrentPage: () => [], flagsForCurrentPages: () => [], allSorted: () => [] },
    highlights: { allSorted: () => [] },
    highlightInteraction: { noteMarkers: [] },
    searchCoordinator: { snapshot: {} },
    currentLayout: () => DEFAULT_BOOK_READING_SETTINGS,
    bookWidePagePosition: () => undefined,
    tocHighlightPath: () => undefined,
    computeTocPageNumbers: () => new Map(),
    chapterLabel,
  });
  return { reader, chapterLabel };
}

describe("Startup chapter publication (#175)", () => {
  it("does not publish the provisional first chapter before mount or while progress lookup is pending", () => {
    const { reader, chapterLabel } = controller();
    expect(reader.snapshot().title).toBe("Book");
    expect(reader.snapshot().loadingPhase).toBeUndefined();
    expect(reader.snapshot().currentChapterLabel).toBe("");
    Object.assign(reader, { cachedSnapshot: undefined, isLoading: true });
    expect(reader.snapshot().loadingPhase).toBe("opening");
    expect(reader.snapshot().currentChapterLabel).toBe("");
    expect(chapterLabel).not.toHaveBeenCalled();
  });

  it.each([0, 1])("publishes only committed spine %i for initial or resumed reading", (spineIndex) => {
    const { reader, chapterLabel } = controller();
    expect(reader.snapshot().currentChapterLabel).toBe("");
    // A staged load must not publish a label before a committed host exists.
    Object.assign(reader, { cachedSnapshot: undefined, spineIndex, isLoading: true });
    expect(reader.snapshot().currentChapterLabel).toBe("");
    Object.assign(reader, { cachedSnapshot: undefined, host: {} });
    expect(reader.snapshot().currentChapterLabel).toBe(spineIndex === 0 ? "Chapter One" : "Chapter Two");
    expect(chapterLabel).toHaveBeenCalledExactlyOnceWith(spineIndex);
  });

  it("keeps the actual chapter during later in-session loading rather than blanking on every load", () => {
    const { reader } = controller();
    Object.assign(reader, { host: {}, spineIndex: 1, isLoading: true });
    expect(reader.snapshot().currentChapterLabel).toBe("Chapter Two");
    expect(reader.snapshot().loadingPhase).toBe("navigating");
    Object.assign(reader, { cachedSnapshot: undefined, isLoading: false });
    expect(reader.snapshot().loadingPhase).toBeUndefined();
  });
});
