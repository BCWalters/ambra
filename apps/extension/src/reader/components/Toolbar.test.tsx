import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { LibraryRegular } from "@fluentui/react-icons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toolbar, type ToolbarProps } from "./Toolbar.js";
import type { ReaderSnapshot } from "../ReaderTypes.js";

vi.mock("./ReaderPreferencesMenus.js", () => ({
  ReaderSettingsMenu: () => null,
  TypographyMenu: () => null,
}));

describe("Toolbar startup positioning (#175)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let measuredWidth: number;
  let resize: ResizeObserverCallback;
  const toggleDetails = vi.fn();
  const backToLibrary = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    measuredWidth = 180;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => measuredWidth);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    toggleDetails.mockClear();
    backToLibrary.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function render(chapter: string) {
    const noop = () => {};
    const props: ToolbarProps = {
      snapshot: { title: "Short book", currentChapterLabel: chapter } as ReaderSnapshot,
      openMenu: undefined, onOpenMenuChange: noop, onBackToLibrary: backToLibrary,
      isTocOpen: false, onToggleToc: noop, isSearchOpen: false, onToggleSearch: noop,
      isAnnotationsOpen: false, onToggleAnnotations: noop, isDetailsOpen: false,
      onToggleDetails: toggleDetails, onToggleBookmark: noop, onSetViewMode: noop,
      onSetFontScale: noop, onSetLineSpacing: noop, onSetLetterSpacing: noop,
      onSetContentWidth: noop, onSetFontFamily: noop, onSetPageTheme: noop,
      onSetBrightness: noop, onSetChromeTheme: noop, onSetPageTurnAnimationStyle: noop,
      onOpenHelp: noop, visible: true,
      handlers: { onPointerEnter: noop, onPointerLeave: noop, onFocus: noop, onBlur: noop },
    };
    act(() => root.render(<Toolbar {...props} />));
    return [...container.querySelectorAll("button")].find(button => button.textContent === "Short book")!;
  }

  it("centers the initial title before paint without a slide or unresolved chapter separator", () => {
    const title = render("");
    const group = title.parentElement!;
    expect(group.style.left).toBe("50%");
    expect(group.style.transition).toBe("");
    expect(group.textContent).toBe("Short book");
    expect(container.querySelector('[aria-hidden="true"][style*="max-content"]')?.textContent).toBe("Short book");
    act(() => title.click());
    expect(toggleDetails).toHaveBeenCalledOnce();
  });

  it("uses a bookshelf icon for Library without changing its name or action (#190)", () => {
    render("");
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Library"]')!;
    const icon = document.createElement("div");
    icon.innerHTML = renderToStaticMarkup(<LibraryRegular />);
    expect(button.querySelector("path")?.getAttribute("d"))
      .toBe(icon.querySelector("path")?.getAttribute("d"));
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    act(() => button.click());
    expect(backToLibrary).toHaveBeenCalledOnce();
  });

  it("adds the resolved resume chapter without a slide and retains narrow-width ellipsis", () => {
    render("");
    const chapter = "Actual resumed chapter";
    let title = render(chapter);
    let group = title.parentElement!;
    expect(group.textContent).toBe(`Short book— ${chapter}`);
    expect(group.style.left).toBe("50%");
    expect(group.style.transition).toBe("");
    measuredWidth = 800;
    act(() => resize([], {} as ResizeObserver));
    title = [...container.querySelectorAll("button")].find(button => button.textContent === "Short book")!;
    group = title.parentElement!;
    expect(group.style.left).toBe("0px");
    expect(group.style.right).toBe("0px");
    expect(group.style.transition).toBe("");
    expect(group.lastElementChild?.textContent).toBe(`— ${chapter}`);
    expect((group.lastElementChild as HTMLElement).style.textOverflow).toBe("ellipsis");
  });
});
