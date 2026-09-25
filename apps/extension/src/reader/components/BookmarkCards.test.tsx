import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bookmark } from "../../library/LibraryDatabase.js";
import { AnnotationsPanel, type AnnotationsPanelProps } from "./AnnotationsPanel.js";

const bookmarks: Bookmark[] = ["first", "second", "third"].map((id, index) => ({
  id, bookId: "book", cfi: `cfi-${id}`, label: `Saved ${id} — Page 1`, createdAt: index,
}));

describe("Bookmark cards", () => {
  let root: Root;
  let container: HTMLDivElement;
  const select = vi.fn();
  const remove = vi.fn();
  const selectEmbedded = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(overrides: Partial<AnnotationsPanelProps> = {}) {
    act(() => root.render(
      <AnnotationsPanel bookmarks={bookmarks} bookmarkLocations={{
        first: { chapterTitle: "A chapter title that remains intact", page: { status: "known", number: 37 } },
        second: { page: { status: "pending" } },
        third: { page: { status: "unavailable" } },
      }} onSelectBookmark={select} onRemoveBookmark={remove} highlights={[]}
        onSelectHighlight={vi.fn()} onRemoveHighlight={vi.fn()} onSetHighlightNote={vi.fn()}
        readOnlyAnnotations={[]} onSelectReadOnlyAnnotation={selectEmbedded}
        onExport={vi.fn()} onImportFile={vi.fn()} open pinned={false}
        onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible {...overrides} />,
    ));
  }

  const links = () => container.querySelectorAll<HTMLButtonElement>("[data-bookmark-link]");
  const removeButtons = () => container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove bookmark:"]');

  it("keeps page metadata outside the clamped title and describes the navigation target", () => {
    render();
    const title = container.querySelector("[data-bookmark-title]")!;
    const page = container.querySelector("[data-bookmark-page]")!;
    expect(title.textContent).toBe("A chapter title that remains intact");
    expect(page.textContent).toBe("Page 37");
    expect(title.contains(page)).toBe(false);
    expect(links()[0]?.getAttribute("aria-describedby")).toBe(page.id);
    expect(container.textContent).toContain("Finding page");
    expect(container.textContent).toContain("Page unavailable");
    act(() => links()[0]!.click());
    expect(select).toHaveBeenCalledWith("cfi-first");
  });

  it("restores focus to the next card only after a committed deletion, then to the previous card", () => {
    render();
    const button = removeButtons()[1]!;
    act(() => { button.focus(); button.click(); });
    expect(remove).toHaveBeenCalledWith("second");
    render();
    expect(document.activeElement).toBe(button);
    render({ bookmarks: [bookmarks[0]!, bookmarks[2]!] });
    expect(document.activeElement).toBe(links()[1]);
    act(() => { removeButtons()[1]!.focus(); removeButtons()[1]!.click(); });
    render({ bookmarks: [bookmarks[0]!] });
    expect(document.activeElement).toBe(links()[0]);
    act(() => { removeButtons()[0]!.focus(); removeButtons()[0]!.click(); });
    render({ bookmarks: [] });
    expect(document.activeElement?.getAttribute("role")).toBe("tabpanel");
  });

  it("does not steal focus if the reader moves elsewhere while a deletion is pending", () => {
    render();
    act(() => { removeButtons()[0]!.focus(); removeButtons()[0]!.click(); });
    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]')!;
    act(() => tab.focus());
    render({ bookmarks: bookmarks.slice(1) });
    expect(document.activeElement).toBe(tab);
  });

  it("gives publisher bookmarks a page badge and separate navigation, never a remove action", () => {
    render({ bookmarks: [], readOnlyAnnotations: [{
      id: "publisher", cfi: "publisher-cfi", label: "Publisher's full note", note: "Publisher's full note",
      kind: "bookmark", location: { chapterTitle: "Chapter", page: { status: "known", number: 9 } },
    }] });
    expect(container.textContent).toContain("Publisher's full note");
    expect(container.textContent).toContain("Publisher note");
    expect(container.textContent).toContain("Page 9");
    expect(removeButtons()).toHaveLength(0);
    act(() => links()[0]!.click());
    expect(selectEmbedded).toHaveBeenCalledWith("publisher-cfi");
    expect(select).not.toHaveBeenCalled();
  });
});
