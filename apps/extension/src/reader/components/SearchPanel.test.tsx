import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPanel, type SearchPanelProps } from "./SearchPanel.js";

describe("Search reference panel", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: SearchPanelProps;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      query: "", results: [], isSearching: false, onSearch: vi.fn(), onSelect: vi.fn(),
      open: true, pinned: false, onTogglePin: vi.fn(), onRequestClose: vi.fn(), scrubberVisible: false,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function render(update: Partial<SearchPanelProps> = {}) {
    props = { ...props, ...update };
    act(() => root.render(<SearchPanel {...props} />));
  }

  function type(value: string) {
    const input = container.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("debounces the real query callback and preserves the draft on closing and reopening", () => {
    render();
    expect(container.textContent).toContain("searches start at 3 characters");
    type("sea");
    act(() => vi.advanceTimersByTime(200));
    type("seaside");
    act(() => vi.advanceTimersByTime(249));
    expect(props.onSearch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(props.onSearch).toHaveBeenCalledExactlyOnceWith("seaside");
    render({ open: false, query: "seaside" });
    render({ open: true });
    expect(container.querySelector("input")?.value).toBe("seaside");
    type("");
    act(() => vi.advanceTimersByTime(250));
    expect(props.onSearch).toHaveBeenLastCalledWith("");
  });

  it("renders engine snippets literally and navigates the exact match CFI", () => {
    render({
      query: "sea",
      results: [{
        spineIndex: 2, cfi: "exact-match-cfi", chapterLabel: "第十二章 · The sea",
        before: "Full engine-provided prefix ", match: "SEA", after: "\n<script>literal</script>",
      }],
    });
    const result = container.querySelector("li button")!;
    expect(container.querySelector("h2")?.textContent).toBe("Search");
    expect(result.textContent).toContain("Full engine-provided prefix ");
    expect(result.querySelector("strong")?.textContent).toBe("SEA");
    expect(result.textContent).toContain("<script>literal</script>");
    expect(result.querySelector("script")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Results: 1");
    act(() => (result as HTMLButtonElement).click());
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("exact-match-cfi");
  });

  it("does not claim no results while searching or waiting to submit a changed query", () => {
    render({ query: "sea", isSearching: true });
    expect(container.textContent).toContain("Searching");
    expect(container.textContent).not.toContain("No matches found.");
    render({ isSearching: false });
    expect(container.textContent).toContain("No matches found.");
    type("another query");
    expect(container.textContent).not.toContain("No matches found.");
    render({ query: "another query" });
    expect(container.textContent).toContain("No matches found.");
    type("ab");
    expect(container.textContent).toContain("searches start at 3 characters");
    expect(container.textContent).not.toContain("No matches found.");
  });

  it("retains pinned Escape and temporary-panel dismissal behavior", () => {
    render({ pinned: true });
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(props.onRequestClose).not.toHaveBeenCalled();
    render({ pinned: false });
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(props.onRequestClose).toHaveBeenCalledOnce();
  });

  it("keeps an unavailable pin focusable, explained and inactive without losing the query on redocking", () => {
    render({ pinned: true });
    type("draft query");
    const input = container.querySelector("input")!;
    act(() => input.focus());
    render({ pinned: false, canPin: false });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("draft query");
    const pin = container.querySelector<HTMLButtonElement>('button[aria-label="Pin search panel"]')!;
    expect(pin.disabled).toBe(false);
    expect(pin.tabIndex).toBe(0);
    expect(pin.getAttribute("aria-disabled")).toBe("true");
    expect(pin.getAttribute("aria-description")).toContain("at least 320 px for the book");
    act(() => { pin.focus(); pin.click(); });
    expect(document.activeElement).toBe(pin);
    expect(props.onTogglePin).not.toHaveBeenCalled();
    render({ pinned: true, canPin: true });
    expect(document.activeElement).toBe(pin);
    expect(input.value).toBe("draft query");
    act(() => pin.click());
    expect(props.onTogglePin).toHaveBeenCalledOnce();
  });
});
