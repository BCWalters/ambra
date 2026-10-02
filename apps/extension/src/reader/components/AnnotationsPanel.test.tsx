import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight } from "../../library/LibraryDatabase.js";
import { AnnotationsPanel, type AnnotationsPanelProps } from "./AnnotationsPanel.js";

const noted: Highlight = {
  id: "noted", bookId: "book", spineIndex: 0, startCfi: "saved-passage", endCfi: "end",
  style: "yellow", text: "The quoted passage", note: "My words\n<script>literal</script>", createdAt: 1,
};
const plain: Highlight = { ...noted, id: "plain", style: "underline", text: "Another passage", note: undefined };

describe("Annotations reference panel", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: AnnotationsPanelProps;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      bookmarks: [{ id: "bookmark", bookId: "book", cfi: "saved-bookmark", label: "Chapter", createdAt: 2 }],
      highlights: [noted, plain], readOnlyAnnotations: [],
      onSelectBookmark: vi.fn(), onRemoveBookmark: vi.fn(), onSelectHighlight: vi.fn(),
      onRemoveHighlight: vi.fn(), onSetHighlightNote: vi.fn().mockResolvedValue(true),
      onSelectReadOnlyAnnotation: vi.fn(), onExport: vi.fn(), onImportFile: vi.fn(),
      open: true, pinned: false, onTogglePin: vi.fn(), onRequestClose: vi.fn(), scrubberVisible: false,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(update: Partial<AnnotationsPanelProps> = {}) {
    props = { ...props, ...update };
    act(() => root.render(<AnnotationsPanel {...props} />));
  }

  function button(text: string) {
    return [...container.querySelectorAll("button")].find(button => button.textContent === text)!;
  }

  function filter(value: string) {
    const select = container.querySelector("select")!;
    act(() => {
      select.focus();
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return select;
  }

  function edit(value: string) {
    const textarea = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return textarea;
  }

  const options = () => [...container.querySelectorAll("option")].map(option => option.textContent);

  it("keeps an unavailable pin keyboard-focusable and explains why it cannot be used", () => {
    render({ canPin: false });
    const pin = container.querySelector<HTMLButtonElement>('button[aria-label="Pin annotations panel"]')!;
    expect(pin.disabled).toBe(false);
    expect(pin.tabIndex).toBe(0);
    expect(pin.getAttribute("aria-disabled")).toBe("true");
    expect(pin.getAttribute("aria-description")).toContain("at least 320 px for the book");
    act(() => { pin.focus(); pin.click(); });
    expect(document.activeElement).toBe(pin);
    expect(props.onTogglePin).not.toHaveBeenCalled();
    render({ canPin: true });
    act(() => pin.click());
    expect(props.onTogglePin).toHaveBeenCalledOnce();
  });

  it("retains the active note draft and filter without refocusing when docking changes", () => {
    render({ pinned: true });
    filter("notes");
    act(() => button("Edit note").click());
    const textarea = edit("Draft while resizing\nSecond line");
    act(() => textarea.focus());
    render({ pinned: false, canPin: false });
    expect(document.activeElement).toBe(textarea);
    expect(container.querySelector("select")?.value).toBe("notes");
    expect(textarea.value).toBe("Draft while resizing\nSecond line");
    render({ pinned: true, canPin: true });
    expect(document.activeElement).toBe(textarea);
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(props.onSetHighlightNote).not.toHaveBeenCalled();
  });

  it("reveals a retained draft without taking focus from the opposite panel", () => {
    render({ pinned: true });
    act(() => button("Edit note").click());
    const textarea = edit("Retained during narrow layout");
    const other = document.createElement("button");
    document.body.append(other);
    try {
      act(() => other.focus());
      render({ open: false, pinned: false, focusOnOpen: false });
      render({ open: true, pinned: true });
      expect(document.activeElement).toBe(other);
      expect(container.querySelector("textarea")).toBe(textarea);
      expect(textarea.value).toBe("Retained during narrow layout");
      act(() => button("Cancel").click());
      act(() => button("Edit note").click());
      expect(document.activeElement).toBe(container.querySelector("textarea"));
    } finally {
      other.remove();
    }
  });

  it("uses one counted Show filter with overlapping Notes and Highlights, including publisher entries", () => {
    render({ readOnlyAnnotations: [
      { id: "embedded", kind: "highlight", cfi: "embedded", label: "Publisher text", note: "Publisher comment" },
    ] });
    expect(container.querySelector("h2")?.textContent).toBe("Annotations");
    expect(container.querySelectorAll("select")).toHaveLength(1);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(options()).toEqual(["All annotations (4)", "Highlights (3)", "Notes (2)", "Bookmarks (1)"]);
    filter("notes");
    expect(button("Add note").closest("li")?.hidden).toBe(true);
    expect(button("Edit note").closest("li")?.hidden).toBe(false);
    expect(button("Edit note").closest("li")?.textContent).toContain("Your note");
    filter("highlights");
    expect(button("Add note").closest("li")?.hidden).toBe(false);
    expect(button("Edit note").closest("li")?.hidden).toBe(false);
  });

  it("puts literal multiline own words before the quieter quotation and navigation", () => {
    render();
    const row = button("Edit note").closest("li")!;
    const note = [...row.querySelectorAll("p")].find(p => p.textContent === noted.note)!;
    const quote = row.querySelector("blockquote")!;
    expect(note.style.whiteSpace).toBe("pre-wrap");
    expect(row.querySelector("script")).toBeNull();
    expect(note.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(quote.compareDocumentPosition(button("Go to passage")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(quote.style.fontSize).toBe("12px");
    expect(button("Add note").closest("li")?.textContent).not.toContain("Your note");
    act(() => button("Go to passage").click());
    expect(props.onSelectHighlight).toHaveBeenCalledWith("saved-passage");
  });

  it("retains drafts and editor state through every filter and panel switch", () => {
    render();
    act(() => button("Edit note").click());
    const textarea = edit("Unsaved\nnew words");
    filter("bookmarks");
    expect(textarea.closest("li")?.hidden).toBe(true);
    render({ open: false });
    render({ open: true });
    expect(document.activeElement).not.toBe(textarea);
    filter("notes");
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("Unsaved\nnew words");
    expect(document.activeElement).toBe(textarea);
    filter("all");
    expect(textarea.value).toBe("Unsaved\nnew words");
    expect(props.onSetHighlightNote).not.toHaveBeenCalled();
  });

  it("keeps composition Escape local, then cancels only the editor and restores its action", () => {
    render();
    act(() => button("Edit note").click());
    const textarea = edit("Composition draft");
    act(() => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true })));
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(props.onRequestClose).not.toHaveBeenCalled();
    act(() => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, keyCode: 229 })));
    expect(container.querySelector("textarea")).toBe(textarea);
    act(() => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button("Edit note"));
    expect(props.onRequestClose).not.toHaveBeenCalled();
  });

  it("clears a saved note through persistence without deleting its highlight, updating counts and focus", async () => {
    render({
      onSetHighlightNote: vi.fn(async (id, note) => {
        render({ highlights: props.highlights.map(highlight => highlight.id === id ? { ...highlight, note } : highlight) });
        return true;
      }),
    });
    const select = filter("notes");
    act(() => button("Edit note").click());
    edit("  ");
    await act(async () => button("Save").click());
    expect(props.onSetHighlightNote).toHaveBeenCalledWith("noted", undefined);
    expect(props.onRemoveHighlight).not.toHaveBeenCalled();
    expect(options()).toEqual(["All annotations (3)", "Highlights (2)", "Notes (0)", "Bookmarks (1)"]);
    expect(document.activeElement).toBe(select);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("No notes yet.");
    filter("highlights");
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
  });

  it.each([true, false])("finishes pending save (%s) without stealing focus after a filter switch", async (saved) => {
    let resolve!: (saved: boolean) => void;
    render({ onSetHighlightNote: vi.fn(() => new Promise<boolean>(done => { resolve = done; })) });
    act(() => button("Edit note").click());
    const textarea = edit("Pending draft");
    act(() => button("Save").click());
    const select = filter("bookmarks");
    await act(async () => resolve(saved));
    expect(document.activeElement).toBe(select);
    filter("notes");
    if (saved) expect(container.querySelector("textarea")).toBeNull();
    else expect(textarea.value).toBe("Pending draft");
  });

  it("restores Show if a committed note removal reaches the panel after its save completes", async () => {
    render();
    const select = filter("notes");
    act(() => button("Edit note").click());
    edit("");
    await act(async () => button("Save").click());
    expect(document.activeElement).toBe(button("Edit note"));
    render({ highlights: [{ ...noted, note: undefined }, plain] });
    expect(document.activeElement).toBe(select);
  });

  it("preserves import/export handlers, repeated file selection, drafts and refreshed counts", () => {
    render();
    act(() => button("Edit note").click());
    const textarea = edit("Keep me through import");
    filter("bookmarks");
    const file = new File(["{}"], "annotations.json", { type: "application/json" });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(props.onImportFile).toHaveBeenNthCalledWith(1, file);
    expect(props.onImportFile).toHaveBeenNthCalledWith(2, file);
    expect(input.value).toBe("");
    act(() => button("Export").click());
    expect(props.onExport).toHaveBeenCalledOnce();
    render({ highlights: [...props.highlights, { ...plain, id: "imported" }] });
    expect(options()).toEqual(["All annotations (4)", "Highlights (3)", "Notes (1)", "Bookmarks (1)"]);
    filter("all");
    expect(textarea.value).toBe("Keep me through import");
  });

  it("preserves pin/close and exact bookmark target actions", () => {
    render();
    act(() => container.querySelector<HTMLButtonElement>("[data-bookmark-link]")!.click());
    expect(props.onSelectBookmark).toHaveBeenCalledWith("saved-bookmark");
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label^="Pin "]')!.click());
    expect(props.onTogglePin).toHaveBeenCalledOnce();
    render({ pinned: true });
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(props.onRequestClose).not.toHaveBeenCalled();
  });

  it.each([false, true])("opens filtered to Bookmarks and focuses Show with pinned=%s", (pinned) => {
    render({ open: false });
    render({ open: true, pinned, filterRequest: { filter: "bookmarks", requestId: 1 } });
    const select = container.querySelector("select")!;
    expect(select.value).toBe("bookmarks");
    expect(document.activeElement).toBe(select);
    act(() => container.querySelector<HTMLButtonElement>("[data-bookmark-link]")!.click());
    expect(props.onSelectBookmark).toHaveBeenCalledExactlyOnceWith("saved-bookmark");
  });

  it("repeats an external Bookmarks request while open without controlling later manual filters or losing drafts", () => {
    render();
    act(() => button("Edit note").click());
    const textarea = edit("Preserved across external requests");
    render({ filterRequest: { filter: "bookmarks", requestId: 1 } });
    const select = container.querySelector("select")!;
    expect(select.value).toBe("bookmarks");
    expect(document.activeElement).toBe(select);
    filter("notes");
    render();
    expect(select.value).toBe("notes");
    expect(textarea.value).toBe("Preserved across external requests");
    render({ filterRequest: { filter: "bookmarks", requestId: 2 } });
    expect(select.value).toBe("bookmarks");
    expect(document.activeElement).toBe(select);
    filter("all");
    expect(textarea.value).toBe("Preserved across external requests");
    expect(props.onSetHighlightNote).not.toHaveBeenCalled();
  });

  it.each(["all", "notes"] as const)("restores the manual %s filter after a bookmark-shortcut visit", manual => {
    render();
    filter(manual);
    render({ filterRequest: { filter: "bookmarks", requestId: 1 } });
    expect(container.querySelector("select")?.value).toBe("bookmarks");
    render({ open: false });
    render({ open: true, filterRequest: undefined });
    expect(container.querySelector("select")?.value).toBe(manual);
    render({ filterRequest: { filter: "bookmarks", requestId: 1 } });
    expect(container.querySelector("select")?.value).toBe("bookmarks");
  });

  it("retains an explicit filter choice made during a bookmark-shortcut visit", () => {
    render({ filterRequest: { filter: "bookmarks", requestId: 1 } });
    filter("highlights");
    render({ open: false });
    render({ open: true, filterRequest: undefined });
    expect(container.querySelector("select")?.value).toBe("highlights");
  });
});
