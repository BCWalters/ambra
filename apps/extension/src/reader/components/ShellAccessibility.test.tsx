import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ArrowDownloadRegular, ArrowUploadRegular } from "@fluentui/react-icons";
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

  it("uses download/export and upload/import glyphs with unchanged annotation actions (#184)", async () => {
    const onExport = vi.fn();
    await act(async () => root.render(
      <AnnotationsPanel bookmarks={[]} highlights={[]} readOnlyAnnotations={[]}
        onSelectBookmark={vi.fn()} onRemoveBookmark={vi.fn()} onSelectHighlight={vi.fn()}
        onRemoveHighlight={vi.fn()} onSetHighlightNote={vi.fn()} onSelectReadOnlyAnnotation={vi.fn()}
        onExport={onExport} onImportFile={vi.fn()} open pinned
        onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible={false} />,
    ));
    const exporting = [...container.querySelectorAll("button")].find(button => button.textContent === "Export")!;
    const importing = [...container.querySelectorAll("button")].find(button => button.textContent === "Import")!;
    const icons = document.createElement("div");
    icons.innerHTML = renderToStaticMarkup(<><ArrowDownloadRegular /><ArrowUploadRegular /></>);
    expect(exporting.querySelector("path")?.getAttribute("d")).toBe(icons.querySelectorAll("path")[0]?.getAttribute("d"));
    expect(importing.querySelector("path")?.getAttribute("d")).toBe(icons.querySelectorAll("path")[1]?.getAttribute("d"));
    expect(exporting.getAttribute("aria-label")).toContain("Export");
    expect(importing.getAttribute("aria-label")).toContain("Import");
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await act(async () => { exporting.click(); importing.click(); });
    expect(onExport).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("clamps long search chapter labels without shortening result text or navigation targets", async () => {
    const chapterLabel = `Chapter ${"長い章".repeat(100)}`;
    const onSelect = vi.fn();
    const content = (
      <SearchPanel query="match" results={[{
        spineIndex: 0, chapterLabel, cfi: "epubcfi(/6/2!/4/2)", before: "prefix", match: "match", after: "suffix",
      }]} isSearching={false} onSearch={vi.fn()} onSelect={onSelect} open pinned
        onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible={false} />
    );
    expect(renderToStaticMarkup(content)).toContain("-webkit-line-clamp:2");
    await act(async () => root.render(content));
    const label = [...container.querySelectorAll("p")].find((entry) => entry.textContent === chapterLabel)!;
    expect(label.style.overflowWrap).toBe("anywhere");
    expect(label.style.overflow).toBe("hidden");
    const result = label.closest("button")!;
    expect(result.textContent).toContain("match");
    await act(async () => result.click());
    expect(onSelect).toHaveBeenCalledWith("epubcfi(/6/2!/4/2)");
  });

  it("bounds annotation action tooltips and wraps publisher labels while preserving complete notes", async () => {
    const text = "UnbrokenExcerpt".repeat(100);
    const note = "Full editable note ".repeat(100);
    await act(async () => root.render(
      <AnnotationsPanel bookmarks={[]} highlights={[{
        id: "highlight", bookId: "book", spineIndex: 0, startCfi: "start", endCfi: "end",
        style: "yellow", text, note, createdAt: 1,
      }]} readOnlyAnnotations={[{ id: "publisher", cfi: "publisher-cfi", label: text, note: undefined, kind: "highlight" }]}
        onSelectBookmark={vi.fn()} onRemoveBookmark={vi.fn()} onSelectHighlight={vi.fn()}
        onRemoveHighlight={vi.fn()} onSetHighlightNote={vi.fn()} onSelectReadOnlyAnnotation={vi.fn()}
        onExport={vi.fn()} onImportFile={vi.fn()} open pinned
        onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible={false} />,
    ));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent?.startsWith("Highlights"))!.click());
    const publisherLabel = [...container.querySelectorAll("span")].find((entry) =>
      entry.textContent === text && entry.style.overflowWrap === "anywhere")!;
    expect(publisherLabel.style.overflow).toBe("hidden");
    const edit = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((entry) => entry.getAttribute("aria-label") === `Edit note: ${text}`)!;
    expect(edit).toBeDefined();
    await act(async () => edit.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.textContent).toBe(`Edit note: ${text}`);
    expect(tooltip.style.overflowWrap).toBe("anywhere");
    expect(tooltip.style.maxHeight).toContain("240px");
    await act(async () => edit.click());
    expect(container.querySelector("textarea")?.value).toBe(note);
  });
});
