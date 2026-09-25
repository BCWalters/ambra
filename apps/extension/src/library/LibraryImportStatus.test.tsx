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
  const onCancelDownload = vi.fn().mockReturnValue(true);
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onOpenBook.mockClear();
    onDismissCompleted.mockClear();
    onCancelDownload.mockClear();
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
      onOpenBook={onOpenBook} onDismissCompleted={onDismissCompleted} onCancelDownload={onCancelDownload} />;
    act(() => root.render(content));
    return content;
  }

  it("uses persisted title and a named Read now action only after completion", () => {
    const activity = { id: 1, fileName: "pg1234.epub", bookId: "saved" };
    render([{ ...activity, phase: "saving" }]);
    expect(container.querySelector('[aria-label^="Read now:"]')).toBeNull();
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
    const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!;
    act(() => dismiss.click());
    expect(onDismissCompleted).toHaveBeenCalledOnce();
  });

  it("bounds long success text without shortening its accessible action name", () => {
    const title = "LongBookTitle".repeat(100);
    const content = render([{ id: 1, fileName: "pg.epub", bookId: "saved", phase: "complete" }],
      [{ id: "saved", title }]);
    expect(renderToStaticMarkup(content)).toContain("-webkit-line-clamp:2");
    expect(container.querySelector('[aria-label^="Read now:"]')?.getAttribute("aria-label")).toBe(`Read now: ${title}`);
  });

  it("uses one centered decorative animation outside the live region without decorative controls", () => {
    const activities = [
      { id: 1, fileName: "first.epub", phase: "downloading" as const },
      { id: 2, fileName: "second.epub", phase: "queued" as const },
    ];
    render(activities);
    const illustration = container.querySelector('[data-testid="library-import-illustration"]')!;
    expect(container.querySelectorAll("svg[data-testid]")).toHaveLength(1);
    expect(illustration.getAttribute("aria-hidden")).toBe("true");
    expect(illustration.getAttribute("focusable")).toBe("false");
    expect(illustration.closest('[role="status"]')).toBeNull();
    expect(illustration.parentElement?.style.justifyContent).toBe("center");
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Cancel download: first.epub");
    render([{ ...activities[0]!, bookId: "saved", phase: "complete" }]);
    const control = container.querySelector("button")!;
    expect(control.getAttribute("aria-label")).toBe("Dismiss");
    expect(container.querySelector('[data-testid="arriving-book"]')?.getAttribute("class")).toBeNull();
    act(() => control.click());
    expect(onDismissCompleted).toHaveBeenCalledOnce();
    render([]);
    expect(container.querySelector('[data-testid="library-import-illustration"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("offers a filename-specific Cancel download action only during downloading", () => {
    render([
      { id: 1, fileName: "pending.epub", phase: "downloading" },
      { id: 2, fileName: "queued.epub", phase: "queued" },
      { id: 3, fileName: "processing.epub", phase: "processing" },
      { id: 4, fileName: "saving.epub", phase: "saving" },
      { id: 5, fileName: "done.epub", phase: "complete", bookId: "saved" },
    ]);
    const cancel = container.querySelector<HTMLButtonElement>('[aria-label="Cancel download: pending.epub"]')!;
    expect(cancel.textContent).toBe("Cancel download");
    expect(container.querySelectorAll('[aria-label^="Cancel download:"]')).toHaveLength(1);
    expect(cancel.style.gridColumn).toBe("3");
    expect(cancel.previousElementSibling?.getAttribute("style")).toContain("grid-column: 2;");
    act(() => cancel.click());
    expect(onCancelDownload).toHaveBeenCalledExactlyOnceWith(1);
    const read = container.querySelector<HTMLButtonElement>('[aria-label^="Read now:"]')!;
    expect(read.style.gridColumn).toBe("3");
    expect(read.previousElementSibling?.getAttribute("style")).toContain("grid-column: 2;");
  });

  it("keeps focus in place when a stale Cancel action is rejected", () => {
    const fallback = document.createElement("button");
    document.body.append(fallback);
    try {
      act(() => root.render(<LibraryImportStatus
        activities={[{ id: 1, fileName: "book.epub", phase: "downloading" }]} books={[]}
        onOpenBook={onOpenBook} onDismissCompleted={onDismissCompleted}
        onCancelDownload={() => false} focusFallbackRef={{ current: fallback }} />));
      const cancel = container.querySelector<HTMLButtonElement>('[aria-label^="Cancel download:"]')!;
      cancel.focus();
      act(() => cancel.click());
      expect(document.activeElement).toBe(cancel);
    } finally {
      fallback.remove();
    }
  });

  it("shows real byte progress without making every update a live announcement", () => {
    const activity = { id: 1, fileName: "book.epub", phase: "downloading" as const };
    render([{ ...activity, download: { receivedBytes: 1024, totalBytes: 2048 } }]);
    const progress = container.querySelector('[role="progressbar"]')!;
    expect(progress.getAttribute("aria-valuenow")).toBe("50");
    expect(progress.getAttribute("aria-valuetext")).toContain("50%");
    expect(progress.getAttribute("aria-label")).toContain("book.epub");
    expect(progress.closest('[aria-live="off"]')).not.toBeNull();
    render([{ ...activity, download: { receivedBytes: 1024 } }]);
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(progress.getAttribute("aria-valuetext")).toContain("received");
    expect(progress.getAttribute("aria-valuetext")).not.toContain("%");
    render([{ ...activity, phase: "processing" }]);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });
});
