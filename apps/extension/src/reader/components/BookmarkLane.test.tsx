import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bookmark } from "../../library/LibraryDatabase.js";
import { BookmarkLane, type BookmarkLaneProps } from "./BookmarkLane.js";

function bookmark(index: number): Bookmark {
  return {
    id: `bookmark-${index}`, bookId: "book", cfi: `epubcfi(/6/2!/4/${index * 2 + 2})`,
    label: `Chapter ${index}`, createdAt: index,
  };
}

describe("BookmarkLane", () => {
  let root: Root;
  let container: HTMLDivElement;
  let width: number;
  let resize: (() => void) | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      void animation.finished.catch(() => undefined);
      queueMicrotask(() => animation.finish());
      return animation;
    });
    width = 1000;
    resize = undefined;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      x: 0, y: 0, left: 0, top: 0, right: width, bottom: 24, width, height: 24, toJSON() {},
    }));
    vi.stubGlobal("ResizeObserver", class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        if (target.hasAttribute("data-bookmark-lane")) resize = () => this.callback([], this);
      }
      unobserve() {}
      disconnect() {}
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderLane(fractions: readonly number[], overrides: Partial<BookmarkLaneProps> = {}) {
    const bookmarks = fractions.map((_, index) => bookmark(index));
    const onSelect = vi.fn();
    const onShowAll = vi.fn();
    const onOpenChange = vi.fn();
    act(() => root.render(
      <FluentProvider theme={webLightTheme}>
        <BookmarkLane
          bookmarks={bookmarks}
          markers={fractions.map((fraction, index) => ({ id: bookmarks[index]!.id, fraction }))}
          locations={Object.fromEntries(bookmarks.map((bookmark, index) => [
            bookmark.id, { chapterTitle: "Chapter", page: { status: "known", number: Math.round(fractions[index]! * 100) } },
          ]))}
          rtl={false}
          onSelect={onSelect}
          onShowAll={onShowAll}
          onOpenChange={onOpenChange}
          {...overrides}
        />
      </FluentProvider>,
    ));
    return { bookmarks, onSelect, onShowAll, onOpenChange };
  }

  const flags = () => [...container.querySelectorAll<HTMLButtonElement>("[data-bookmark-marker]")];
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
  async function click(button: HTMLElement) { await act(async () => button.click()); }

  it.each([false, true])("navigates isolated flags to exact saved records and leaves empty space inert (rtl=%s)", async rtl => {
    const { bookmarks, onSelect, onOpenChange } = renderLane([0.2, 0.8], { rtl });
    expect(flags()).toHaveLength(2);
    expect(parseFloat(flags()[0]!.style.left)).toBe(rtl ? 80 : 20);
    expect(flags()[0]!.getAttribute("aria-label")).toBe("Go to bookmark: Chapter, Page 20");
    await click(container.querySelector<HTMLElement>("[data-bookmark-lane]")!);
    expect(onSelect).not.toHaveBeenCalled();
    await click(flags()[1]!);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(bookmarks[1]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("keeps distinct same-page CFIs in a counted chooser without seeking when opened", async () => {
    const { bookmarks, onSelect, onOpenChange } = renderLane([0.4, 0.4]);
    expect(flags()).toHaveLength(1);
    expect(flags()[0]!.dataset.bookmarkCount).toBe("2");
    await click(flags()[0]!);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(onSelect).not.toHaveBeenCalled();
    const choices = dialog()!.querySelectorAll("button");
    expect(choices).toHaveLength(2);
    expect(choices[0]!.textContent).toContain("Saved position 1");
    expect(choices[1]!.textContent).toContain("Saved position 2");
    await click(choices[1]!);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(bookmarks[1]);
    expect(onSelect.mock.calls[0]![0].cfi).not.toBe(bookmarks[0]!.cfi);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(dialog()).toBeNull();
  });

  it("caps a dense chooser at five choices with an independent Show all action and exact accessible count", async () => {
    const { onSelect, onShowAll } = renderLane(Array.from({ length: 120 }, () => 0.5));
    expect(flags()).toHaveLength(1);
    expect(flags()[0]!.textContent).toBe("99+");
    expect(flags()[0]!.getAttribute("aria-label")).toBe("120 bookmarks — choose a destination");
    await click(flags()[0]!);
    const choices = dialog()!.querySelectorAll("button");
    expect(choices).toHaveLength(6);
    expect(choices[5]!.textContent).toBe("Show all bookmarks");
    expect(choices[5]!.parentElement).toBe(dialog());
    const focusBeforeExit = vi.fn(() => dialog()?.isConnected);
    flags()[0]!.addEventListener("focus", focusBeforeExit, { once: true });
    await click(choices[5]!);
    expect(focusBeforeExit).toHaveReturnedWith(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    await act(async () => {
      await vi.waitFor(() => expect(onShowAll).toHaveBeenCalledOnce());
    });
  });

  it("dismisses Escape without page navigation and restores flag focus", async () => {
    const { onSelect } = renderLane([0.2, 0.21]);
    act(() => flags()[0]!.focus());
    await click(flags()[0]!);
    await act(async () => dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(flags()[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("regroups on resize without growing the lane or losing focused bookmark identity", () => {
    renderLane([0.2, 0.23, 0.9]);
    expect(flags()).toHaveLength(3);
    act(() => flags()[1]!.focus());
    width = 400;
    act(() => resize!());
    expect(flags()).toHaveLength(2);
    expect(flags()[0]!.dataset.bookmarkCount).toBe("2");
    expect(document.activeElement).toBe(flags()[0]);
    width = 1000;
    act(() => resize!());
    expect(flags()).toHaveLength(3);
    expect(document.activeElement).toBe(flags()[1]);
  });

  it("dismisses an open chooser when resizing separates its members", async () => {
    width = 400;
    const { onOpenChange, onSelect } = renderLane([0.2, 0.23]);
    await click(flags()[0]!);
    expect(dialog()).not.toBeNull();
    width = 1000;
    act(() => resize!());
    expect(dialog()).toBeNull();
    expect(flags()).toHaveLength(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("only shows measured markers for existing saved bookmarks", () => {
    renderLane([0.4], { bookmarks: [], locations: {} });
    expect(flags()).toHaveLength(0);
  });

  it("closes for an external content gesture without restoring focus away from the book", async () => {
    renderLane([0.4, 0.4]);
    await click(flags()[0]!);
    const book = document.createElement("button");
    document.body.append(book);
    act(() => book.focus());
    await act(async () => { renderLane([0.4, 0.4], { dismissRequest: 1 }); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(book);
    book.remove();
  });

  it("uses an explicit unavailable page label instead of inventing a page", () => {
    renderLane([0.4], { locations: {} });
    expect(flags()[0]!.getAttribute("aria-label")).toBe("Go to bookmark: Chapter 0, Page unavailable");
  });
});
