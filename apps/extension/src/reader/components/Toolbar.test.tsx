import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { LibraryRegular } from "@fluentui/react-icons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toolbar, type ToolbarProps } from "./Toolbar.js";
import type { ReaderSnapshot } from "../ReaderTypes.js";
import { getTranslate } from "../../i18n/LocaleContext.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "../../library/ReadingSettings.js";

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

  function render(chapter: string, isTocOpen = false, isAnnotationsOpen = false) {
    const noop = () => {};
    const props: ToolbarProps = {
      snapshot: { ...DEFAULT_GLOBAL_READING_SETTINGS, title: "Short book", currentChapterLabel: chapter } as ReaderSnapshot,
      openMenu: undefined, onOpenMenuChange: noop, isLibraryOpen: false, onToggleLibrary: backToLibrary,
      isTocOpen, onToggleToc: noop, isSearchOpen: false, onToggleSearch: noop,
      isAnnotationsOpen, onToggleAnnotations: noop, isDetailsOpen: false,
      onToggleDetails: toggleDetails, onToggleBookmark: noop, onSetViewMode: noop,
      onSetFontScale: noop, onSetLineSpacing: noop, onSetLetterSpacing: noop,
      onSetContentWidth: noop, onSetFontFamily: noop, onSetPageTheme: noop,
      onSetAlwaysShowOnePage: noop,
      onSetBrightness: noop, onSetChromeTheme: noop, onSetPageTurnAnimationStyle: noop,
      onSetProgressMarkerStyle: noop,
      onOpenHelp: noop, isHelpOpen: false, visible: true,
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

  it("places Contents before Library, reference actions after the title, and exposes Help directly", () => {
    render("");
    const t = getTranslate("en");
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons[0]!.getAttribute("aria-label")).toBe(t("toolbar.showContents"));
    expect(buttons[1]!.getAttribute("aria-label")).toBe(t("toolbar.backToLibrary"));
    const titleIndex = buttons.findIndex(button => button.textContent === "Short book");
    expect(buttons.slice(titleIndex + 1).map(button => button.getAttribute("aria-label"))).toEqual([
      t("toolbar.search"), t("toolbar.bookmarksAndHighlights"), t("toolbar.bookDetails"),
      t("settings.ambraTitle"), t("settings.helpAbout"), t("toolbar.bookmarkThisPage"),
    ]);
  });

  it.each([false, true])("keeps the Contents label stable with panel open=%s", open => {
    render("", open);
    const t = getTranslate("en");
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe(t("toc.contents"));
    expect(button.getAttribute("aria-label")).toBe(t(open ? "toolbar.hideContents" : "toolbar.showContents"));
    expect(button.getAttribute("aria-pressed")).toBe(String(open));
  });

  it.each([false, true])("keeps the Annotations label stable with panel open=%s", open => {
    render("", false, open);
    const t = getTranslate("en");
    const label = t(open ? "toolbar.hideBookmarksAndHighlights" : "toolbar.bookmarksAndHighlights");
    const button = container.querySelector(`button[aria-label="${label}"]`)!;
    expect(button.textContent).toBe(t("toolbar.bookmarksAndHighlights"));
    expect(button.getAttribute("aria-pressed")).toBe(String(open));
    const icon = button.querySelector("svg")!;
    expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("focusable")).toBe("false");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(icon.querySelector("path")?.getAttribute("d")).toBe("M5 3h14v18H5Zm4 5h6m-6 4h6m-6 4h4");
  });

  it("adds the resolved resume chapter without a slide and retains narrow-width ellipsis", () => {
    render("");
    const chapter = "Actual resumed chapter";
    let title = render(chapter);
    let group = title.parentElement!;
    expect(group.textContent).toBe(`Short book${chapter}`);
    expect(group.style.flexDirection).toBe("column");
    expect(group.style.left).toBe("50%");
    expect(group.style.transition).toBe("");
    measuredWidth = 800;
    act(() => resize([], {} as ResizeObserver));
    title = [...container.querySelectorAll("button")].find(button => button.textContent === "Short book")!;
    group = title.parentElement!;
    expect(group.style.left).toBe("0px");
    expect(group.style.right).toBe("0px");
    expect(group.style.transition).toBe("");
    expect(group.lastElementChild?.textContent).toBe(chapter);
    expect((group.lastElementChild as HTMLElement).style.textOverflow).toBe("ellipsis");
  });

  it("hides a cramped redundant title and transfers its focus to Book details on resize", () => {
    const title = render("Actual chapter");
    const region = title.closest("[data-ambra-toolbar-title]")!.parentElement as HTMLElement;
    expect(region.style.visibility).toBe("visible");
    act(() => title.focus());
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(40);
    act(() => resize([], {} as ResizeObserver));
    expect(region.style.visibility).toBe("hidden");
    const details = container.querySelector<HTMLButtonElement>('button[aria-label="Book details"]')!;
    expect(document.activeElement).toBe(details);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    act(() => resize([], {} as ResizeObserver));
    expect(region.style.visibility).toBe("visible");
    expect(document.activeElement).toBe(details);
  });
});
