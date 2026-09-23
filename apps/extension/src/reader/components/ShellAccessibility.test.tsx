import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationsPanel } from "./AnnotationsPanel.js";
import { SearchPanel } from "./SearchPanel.js";

describe("Shell accessibility semantics", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("associates annotation tabs with keyboard-focusable named content, including empty lists", async () => {
    await act(async () => root.render(
      <AnnotationsPanel bookmarks={[]} highlights={[]} readOnlyAnnotations={[]}
        onSelectBookmark={vi.fn()} onRemoveBookmark={vi.fn()} onSelectHighlight={vi.fn()}
        onRemoveHighlight={vi.fn()} onSetHighlightNote={vi.fn()} onSelectReadOnlyAnnotation={vi.fn()}
        onExport={vi.fn()} onImportFile={vi.fn()} open pinned
        onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible={false} />,
    ));
    for (const tab of container.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      await act(async () => tab.click());
      const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(panel.tabIndex).toBe(0);
      expect(panel.textContent).toContain(tab.textContent === "Bookmarks" ? "No bookmarks" : "No highlights");
    }
  });

  it("names Search independently of its placeholder and exposes settled results as status", async () => {
    const render = async (isSearching: boolean, query: string) => {
      await act(async () => root.render(
        <SearchPanel query={query} results={[]} isSearching={isSearching} onSearch={vi.fn()}
          onSelect={vi.fn()} open pinned onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible={false} />,
      ));
    };
    await render(true, "nothing");
    expect(container.querySelector('input[type="search"]')?.getAttribute("aria-label")).toBe("Search this book…");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Searching");
    await render(false, "nothing");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("No matches found.");
    expect(container.querySelector('[role="status"] p')?.getAttribute("style")).not.toContain("opacity");
    await render(false, "older query");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });
});
