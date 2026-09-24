import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryApp } from "./LibraryApp.js";
import { useLibrary, type LibraryBookViewModel } from "./useLibrary.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";
import { getTranslate } from "../i18n/translate.js";

vi.mock("./useLibrary.js", () => ({ useLibrary: vi.fn() }));

describe("Library card focus (#173)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let keyboardFocus: boolean;
  const openBook = vi.fn();
  const removeBook = vi.fn();
  const t = getTranslate("en");

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.2.3" }) } });
    keyboardFocus = false;
    openBook.mockClear();
    removeBook.mockClear();
    // happy-dom does not implement the browser's input-modality heuristic.
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector) {
      return selector === ":focus-visible" ? keyboardFocus : matches.call(this, selector);
    });
    vi.mocked(useLibrary).mockReturnValue({
      books: ["First", "Second"].map((title) => ({
        id: title, title, identifiers: [],
      } as unknown as LibraryBookViewModel)),
      isLoading: false, canImport: true, error: undefined,
      importActivities: [], dismissCompletedImports: vi.fn(),
      dismissError: vi.fn(), importFiles: vi.fn(), removeBook, openBook,
      chromeTheme: "ambra", settings: DEFAULT_GLOBAL_READING_SETTINGS, setSettings: vi.fn(),
      sort: "dateAddedDesc", setSort: vi.fn(), isFullTab: true, openInFullTab: vi.fn(),
      storageUsage: undefined, openInspectionSession: vi.fn(),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<LibraryApp />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((entry) => entry.getAttribute("aria-label") === label)!;
  }

  function cover(title: string) {
    return button(t("library.openBook", { title }));
  }

  function expectActions(title: string, visible: boolean) {
    for (const key of ["library.bookDetails", "library.removeBook"] as const) {
      const action = button(t(key, { title }));
      expect(action.style.opacity).toBe(visible ? "1" : "0");
      expect(action.style.pointerEvents).toBe(visible ? "auto" : "none");
      expect(action.tabIndex).toBe(0);
    }
  }

  it("hides the previously opened card when the pointer moves away after returning to Library", () => {
    const first = cover("First");
    const second = cover("Second");
    act(() => {
      first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      first.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      first.focus();
      first.click();
    });
    expect(openBook).toHaveBeenCalledWith("First");
    expectActions("First", true);
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      first.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: second }));
      second.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: first }));
    });
    expect(document.activeElement).toBe(first);
    expectActions("First", false);
    expectActions("Second", true);
  });

  it("keeps keyboard-focused card actions visible across focus transfers and tab return", () => {
    keyboardFocus = true;
    act(() => cover("First").focus());
    expectActions("First", true);
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      button(t("library.bookDetails", { title: "First" })).focus();
    });
    expectActions("First", true);
    act(() => button(t("library.removeBook", { title: "First" })).focus());
    expectActions("First", true);
    act(() => button(t("library.removeBook", { title: "First" })).click());
    expect(removeBook).toHaveBeenCalledWith("First");
    act(() => cover("Second").focus());
    expectActions("First", false);
    expectActions("Second", true);
  });

  it("reveals controls when keyboard interaction resumes on a pointer-focused cover", () => {
    const first = cover("First");
    act(() => first.focus());
    expectActions("First", false);
    act(() => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expectActions("First", true);
    act(() => first.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expectActions("First", false);
  });
});
