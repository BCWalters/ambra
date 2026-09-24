import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { ReaderApp } from "./ReaderApp.js";
import { useReaderController, type UseReaderControllerResult } from "./useReaderController.js";
import type { ReaderSnapshot } from "./ReaderTypes.js";
import type { ToolbarProps } from "./components/Toolbar.js";

const realMenu = vi.hoisted(() => ({ enabled: false }));
vi.mock("./useReaderController.js", () => ({ useReaderController: vi.fn() }));
vi.mock("../library/LibraryDatabase.js", () => ({
  LibraryDatabase: {
    open: async () => ({
      getBookFile: async () => new Blob(["book"]),
      getLocalePreference: async () => "en",
      getShortcutPreferences: async () => ({ enabled: true }),
      subscribePreferences: () => () => {},
      close: () => {},
    }),
  },
}));
vi.mock("./components/Toolbar.js", () => ({
  Toolbar: (props: ToolbarProps) => (
    <div data-testid="toolbar" data-visible={props.visible} data-open-menu={props.openMenu}
      onFocus={realMenu.enabled ? props.handlers.onFocus : undefined}
      onBlur={realMenu.enabled ? props.handlers.onBlur : undefined}>
      <button onClick={props.onToggleToc}>toc</button>
      <button onClick={props.onToggleAnnotations}>annotations</button>
      <button onClick={props.onToggleSearch}>search</button>
      <button onClick={props.onToggleDetails}>details</button>
      <button onClick={event => props.onOpenHelp?.(event.currentTarget)}>help</button>
      <button onClick={() => props.onOpenMenuChange("settings")}>settings</button>
      <button onClick={() => props.onOpenMenuChange("typography")}>typography</button>
      {realMenu.enabled && <Menu open={props.openMenu !== undefined}>
        <MenuTrigger disableButtonEnhancement><button>Menu trigger</button></MenuTrigger>
        <MenuPopover><MenuList><MenuItem>Preference</MenuItem></MenuList></MenuPopover>
      </Menu>}
    </div>
  ),
}));
vi.mock("./components/PageFurniture.js", () => ({ PageFurniture: () => null }));
vi.mock("./components/ProgressScrubber.js", () => ({ ProgressScrubber: () => null }));

let root: Root;
let container: HTMLDivElement;
let bridge: UseReaderControllerResult;
let dismiss: (() => boolean) | undefined;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "1.0.0" }) } });
  const animate = Element.prototype.animate;
  vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
    const animation = animate.call(this, keyframes, options);
    void animation.finished.catch(() => undefined);
    queueMicrotask(() => animation.finish());
    return animation;
  });
  window.history.replaceState({}, "", "?bookId=test");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  realMenu.enabled = false;
  dismiss = undefined;
  bridge = {
    snapshot: {
      title: "Book", viewMode: "paginated", pageTheme: "white", chromeTheme: "silver",
      toc: [], bookmarks: [], highlights: [], searchResults: [], searchQuery: "", noteMarkers: [],
      tocPageNumbers: new Map(), contentPointerActivityId: 0,
    } as unknown as ReaderSnapshot,
    contentHostRef: { current: null },
    openBook: vi.fn(async () => {}),
    setContentUiDismissal: vi.fn(callback => { dismiss = callback; }),
    setShortcutActions: vi.fn(),
    setShortcutPreferences: vi.fn(),
    setShortcutModalOpen: vi.fn(),
    setSearchPanelState: vi.fn(),
    search: vi.fn(),
    restoreContentFocus: vi.fn(() => {
      const content = bridge.contentHostRef.current!;
      content.tabIndex = -1;
      content.focus();
    }),
    listEmbeddedAnnotations: () => [],
    refreshBookmarks: vi.fn(async () => {}),
    getBookDetails: vi.fn(async () => undefined),
    dismissFootnotePopup: vi.fn(),
    dismissActiveHighlight: vi.fn(),
  } as unknown as UseReaderControllerResult;
  vi.mocked(useReaderController).mockReturnValue(bridge);
  await act(async () => root.render(<ReaderApp />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function chromeVisible() {
  return container.querySelector('[data-testid="toolbar"]')?.getAttribute("data-visible") === "true";
}

async function openPanel(name: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="toolbar"] button')]
    .find(button => button.textContent === name)!;
  await act(async () => button.click());
}

it("wires synchronous dismissal before content activity and clears the contract on unmount", () => {
  expect(chromeVisible()).toBe(true);
  act(() => { expect(dismiss?.()).toBe(true); });
  expect(chromeVisible()).toBe(false);
  expect(dismiss?.()).toBe(false);
  act(() => root.unmount());
  expect(dismiss).toBeUndefined();
  root = createRoot(container);
});

it.each(["settings", "typography"])("dismisses %s independently of faded toolbar visibility", async menu => {
  act(() => { dismiss?.(); });
  await openPanel(menu);
  expect(chromeVisible()).toBe(false);
  expect(container.querySelector('[data-testid="toolbar"]')?.getAttribute("data-open-menu")).toBe(menu);
  act(() => {
    expect(dismiss?.()).toBe(true);
    expect(dismiss?.()).toBe(false);
  });
  expect(container.querySelector('[data-testid="toolbar"]')?.hasAttribute("data-open-menu")).toBe(false);
});

it("moves focus out of a closing Fluent menu before it can restore and reveal the toolbar", async () => {
  realMenu.enabled = true;
  await act(async () => root.render(<ReaderApp />));
  await openPanel("settings");
  await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.focus());
  expect(document.activeElement?.textContent).toBe("Preference");
  await act(async () => { expect(dismiss?.()).toBe(true); });
  expect(document.activeElement).toBe(bridge.contentHostRef.current);
  expect(chromeVisible()).toBe(false);
  expect(dismiss?.()).toBe(false);
});

it("provides the search callback when the panel's debounced query runs", async () => {
  await openPanel("search");
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
  });
  expect(bridge.search).toHaveBeenCalledWith("");
});

it.each(["toc", "annotations", "search", "details"])(
  "%s backdrop closes chrome in the same click, not on the next reading click",
  async panel => {
    await openPanel(panel);
    expect(chromeVisible()).toBe(true);
    const backdrop = [...container.querySelectorAll<HTMLDivElement>('div[aria-hidden="true"]')]
      .find(element => element.style.pointerEvents === "auto" && element.style.zIndex === "7")!;
    expect(backdrop).toBeDefined();
    await act(async () => backdrop.click());
    expect(bridge.restoreContentFocus).toHaveBeenCalled();
    expect(chromeVisible()).toBe(false);
    expect(dismiss?.()).toBe(false);
  },
);

it("keeps pinned chrome visible and does not charge reading clicks for dismissing it", async () => {
  await openPanel("toc");
  const pin = container.querySelector<HTMLButtonElement>('button[aria-label="Pin contents panel"]')!;
  expect(pin).not.toBeNull();
  await act(async () => pin.click());
  expect(dismiss?.()).toBe(false);
  expect(chromeVisible()).toBe(true);
});

it("keeps chrome for a remaining panel when the other panel's backdrop closes", async () => {
  await openPanel("toc");
  await openPanel("details");
  const details = container.querySelector('aside[aria-label="Book details"]')!;
  const backdrop = details.previousElementSibling as HTMLElement;
  await act(async () => backdrop.click());
  expect(chromeVisible()).toBe(true);
  expect(dismiss?.()).toBe(false);
});

it("retains keyboard panel dismissal and focus restoration", async () => {
  await openPanel("toc");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(bridge.restoreContentFocus).toHaveBeenCalled();
  expect(chromeVisible()).toBe(true);
});

it("hides chrome with Help's modal backdrop instead of charging another reading click", async () => {
  await openPanel("help");
  const backdrop = document.querySelector<HTMLElement>(".fui-OverlayDrawer__backdrop")!;
  expect(backdrop).not.toBeNull();
  await act(async () => backdrop.click());
  expect(chromeVisible()).toBe(false);
  expect(dismiss?.()).toBe(false);
});

it("dismisses a footnote even after chrome has auto-hidden", async () => {
  act(() => { dismiss?.(); });
  bridge.snapshot = {
    ...bridge.snapshot!,
    footnotePopup: { content: "A footnote", left: 100, top: 100 },
  };
  await act(async () => root.render(<ReaderApp />));
  act(() => { expect(dismiss?.()).toBe(true); });
  expect(bridge.dismissFootnotePopup).toHaveBeenCalledOnce();
  expect(chromeVisible()).toBe(false);
});
