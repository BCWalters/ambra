import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryApp } from "./LibraryApp.js";
import { useLibrary, type LibraryBookViewModel, type UseLibraryResult } from "./useLibrary.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";

vi.mock("./useLibrary.js", () => ({ useLibrary: vi.fn() }));

describe("Focused library book removal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: UseLibraryResult;
  const removeBook = vi.fn();
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.2.3" }) } });
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      vi.spyOn(animation, "cancel").mockImplementation(() => animation.finish());
      queueMicrotask(() => animation.finish());
      return animation;
    });
    removeBook.mockReset();
    state = {
      books: ["First", "Second", "Third"].map((title) => ({ id: title, title, identifiers: [] } as unknown as LibraryBookViewModel)),
      isLoading: false, canImport: true, error: undefined,
      importActivities: [], dismissCompletedImports: vi.fn(), cancelDownload: vi.fn(),
      dismissError: vi.fn(), importFiles: vi.fn(), removeBook, openBook: vi.fn(),
      chromeTheme: "ambra", settings: DEFAULT_GLOBAL_READING_SETTINGS, setSettings: vi.fn(),
      sort: "dateAddedDesc", setSort: vi.fn(), isFullTab: true, openInFullTab: vi.fn(),
      storageUsage: undefined, openInspectionSession: vi.fn(), saveBookAs: vi.fn(),
    };
    vi.mocked(useLibrary).mockImplementation(() => state);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<LibraryApp />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const cover = (id: string) => container.querySelector<HTMLButtonElement>(`[data-book-open="${id}"]`)!;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((node) => node.textContent === label || node.getAttribute("aria-label") === label)!;
  async function key(target: HTMLElement, options: KeyboardEventInit = {}) {
    await act(async () => {
      target.focus();
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true, ...options }));
    });
  }
  it("registers both the cover and Details as focus-return targets", () => {
    const target = cover("Second").getAttribute("data-tabster");
    expect(target).not.toBeNull();
    expect(target).toBe(button("Second details").getAttribute("data-tabster"));
  });
  it.each(["Delete", "Backspace"])("%s asks once, names the book, starts on Cancel and never deletes before confirmation", async (keyName) => {
    await key(cover("Second"), { key: keyName });
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Second");
    expect(dialog.textContent).toContain("original EPUB");
    expect(document.activeElement).toBe(button("Cancel"));
    expect(removeBook).not.toHaveBeenCalled();
    await key(cover("Second"));
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    await act(async () => button("Cancel").click());
    expect(removeBook).not.toHaveBeenCalled();
  });
  it.each([
    { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { repeat: true }, { isComposing: true },
  ])("ignores unsafe key conditions %j", async (options) => {
    await key(cover("Second"), options);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(removeBook).not.toHaveBeenCalled();
  });
  it("does not own typing or another dialog, and details stays a direct always-visible action", async () => {
    await key(container.querySelector<HTMLInputElement>('input[type="search"]')!);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    const details = button("First details");
    expect(details.style.opacity).not.toBe("0");
    await act(async () => details.click());
    await key(cover("Second"));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => button("Remove from library").click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("First");
  });
  it.each([["First", "Second"], ["Third", "Second"]])("focuses the next/previous displayed book after removing %s", async (id, expected) => {
    removeBook.mockImplementation(async (removed) => {
      state.books = state.books.filter((book) => book.id !== removed);
      root.render(<LibraryApp />);
      return true;
    });
    await key(cover(id!));
    await act(async () => button("Remove from library").click());
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(removeBook).toHaveBeenCalledExactlyOnceWith(id);
    expect(document.activeElement).toBe(cover(expected!));
  });
  it("falls back to Import when the final book is removed", async () => {
    state.books = state.books.slice(0, 1);
    await act(async () => root.render(<LibraryApp />));
    removeBook.mockImplementation(async () => { state.books = []; root.render(<LibraryApp />); return true; });
    await key(cover("First"));
    await act(async () => button("Remove from library").click());
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(document.activeElement).toBe(button("Import EPUB"));
  });
});
