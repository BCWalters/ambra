import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryImportStatus, type LibraryImportActivity } from "./LibraryImportStatus.js";

describe("Library import feedback (#187)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpenBook = vi.fn();
  const onDismissCompleted = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onOpenBook.mockClear();
    onDismissCompleted.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  function render(activities: readonly LibraryImportActivity[], books = [{ id: "saved", title: "An EPUB title" }]) {
    const content = <LibraryImportStatus activities={activities} books={books}
      onOpenBook={onOpenBook} onDismissCompleted={onDismissCompleted} />;
    act(() => root.render(content));
    return content;
  }

  it("uses persisted title and a named Read now action only after completion", () => {
    const activity = { id: 1, fileName: "pg1234.epub", bookId: "saved" };
    render([{ ...activity, phase: "saving" }]);
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Adding An EPUB title");
    render([{ ...activity, phase: "complete" }]);
    expect(container.textContent).toContain("Added An EPUB title to your library.");
    expect(container.textContent).not.toContain("pg1234.epub");
    const read = container.querySelector<HTMLButtonElement>('[aria-label="Read now: An EPUB title"]')!;
    act(() => read.click());
    expect(onOpenBook).toHaveBeenCalledExactlyOnceWith("saved");
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector('[role="status"]')?.hasAttribute("aria-busy")).toBe(false);
  });

  it("does not offer to open missing or removed books and preserves a filename fallback", () => {
    render([{ id: 1, fileName: "pg1234.epub", bookId: "saved", phase: "complete" }], []);
    expect(container.textContent).toContain("Added pg1234.epub");
    expect(container.querySelector('[aria-label^="Read now:"]')).toBeNull();
  });

  it("keeps active imports announced while successful items can be opened or dismissed", () => {
    render([
      { id: 1, fileName: "pending.epub", phase: "downloading" },
      { id: 2, fileName: "pg1234.epub", bookId: "saved", phase: "complete" },
    ]);
    expect(container.textContent).toContain("Downloading pending.epub");
    expect(container.textContent).toContain("Keep your library open");
    const dismiss = [...container.querySelectorAll("button")].find(button => button.textContent === "Dismiss")!;
    act(() => dismiss.click());
    expect(onDismissCompleted).toHaveBeenCalledOnce();
  });

  it("bounds long success text without shortening its accessible action name", () => {
    const title = "LongBookTitle".repeat(100);
    const content = render([{ id: 1, fileName: "pg.epub", bookId: "saved", phase: "complete" }],
      [{ id: "saved", title }]);
    expect(renderToStaticMarkup(content)).toContain("-webkit-line-clamp:2");
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(`Read now: ${title}`);
  });
});
