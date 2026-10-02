import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { ReaderApp } from "./ReaderApp.js";
import { useReaderController, type UseReaderControllerResult } from "./useReaderController.js";
import type { ReaderSnapshot } from "./ReaderTypes.js";
import type { ToolbarProps } from "./components/Toolbar.js";
import type { ProgressScrubberProps } from "./components/ProgressScrubber.js";
import type { ReaderLibraryPanel } from "./components/ReaderLibraryPanel.js";

const realMenu = vi.hoisted(() => ({ enabled: false }));
const welcomePreference = vi.hoisted(() => ({ version: 1, acknowledge: vi.fn() }));
vi.mock("./useReaderController.js", () => ({ useReaderController: vi.fn() }));
vi.mock("../library/LibraryDatabase.js", () => ({
  LibraryDatabase: {
    open: async () => ({
      getBookFile: async () => new Blob(["book"]),
      getLocalePreference: async () => "en",
      getShortcutPreferences: async () => ({ enabled: true }),
      getReadingWelcomeVersion: async () => welcomePreference.version,
      acknowledgeReadingWelcome: welcomePreference.acknowledge,
      subscribePreferences: () => () => {},
      close: () => {},
    }),
  },
}));
vi.mock("./components/Toolbar.js", () => ({
  Toolbar: (props: ToolbarProps) => (
    <div ref={props.handlers.ref} style={{ opacity: props.visible ? 1 : 0 }}
      data-testid="toolbar" data-visible={props.visible} data-open-menu={props.openMenu}
      onFocus={realMenu.enabled ? props.handlers.onFocus : undefined}
      onBlur={realMenu.enabled ? props.handlers.onBlur : undefined}>
      <button onClick={props.onToggleToc}>toc</button>
      <button onClick={props.onToggleLibrary}>library</button>
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
vi.mock("./components/ReaderLibraryPanel.js", () => ({
  ReaderLibraryPanel: (props: ComponentProps<typeof ReaderLibraryPanel>) => (
    <aside data-testid="reader-library" hidden={!props.open}>
      <button data-testid="current-book" onClick={() => props.onActivateBook(props.currentBookId!)}>Current book</button>
      <button data-testid="other-book" onClick={() => props.onActivateBook("other book")}>Other book</button>
      <button data-testid="next-book" onClick={() => props.onActivateBook("next book")}>Next book</button>
      <button data-testid="close-library" onClick={props.onRequestClose}>Close library</button>
    </aside>
  ),
}));
vi.mock("./components/PageFurniture.js", () => ({ PageFurniture: () => null }));
vi.mock("./components/ProgressScrubber.js", () => ({
  ProgressScrubber: (props: ProgressScrubberProps) =>
    <>
      <button data-testid="seek" onClick={() => void props.onSeek(0.3)}>Seek</button>
      <button data-testid="bookmark-chooser" data-dismiss-request={props.bookmarkChooserDismissRequest}
        onClick={() => props.onBookmarkChooserOpenChange(true)}>Bookmark chooser</button>
      <button data-testid="show-bookmarks" onClick={props.onShowBookmarks}>Show all bookmarks</button>
    </>,
}));

let root: Root;
let container: HTMLDivElement;
let bridge: UseReaderControllerResult;
let dismiss: (() => boolean) | undefined;
let availableRowWidth: number;
let measuredPanelWidths: Record<string, number>;
const resizeObservers = new Set<TestResizeObserver>();

class TestResizeObserver implements ResizeObserver {
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) { resizeObservers.add(this); }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); resizeObservers.delete(this); }
  notify() { this.callback([], this); }
}

async function resizeReferenceRow(width: number) {
  availableRowWidth = width;
  await act(async () => {
    for (const observer of resizeObservers) {
      if ([...observer.targets].some(target => target.hasAttribute("data-ambra-reference-row"))) observer.notify();
    }
  });
}

beforeEach(async () => {
  welcomePreference.version = 1;
  welcomePreference.acknowledge.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  availableRowWidth = 1200;
  measuredPanelWidths = { toc: 300, annotations: 300, search: 300 };
  resizeObservers.clear();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  const getBounds = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("data-ambra-reference-row")) return new DOMRect(0, 0, availableRowWidth, 900);
    const panel = this.getAttribute("data-ambra-reference-panel");
    if (panel) return new DOMRect(0, 0, measuredPanelWidths[panel]!, 900);
    return getBounds.call(this);
  });
  vi.stubGlobal("chrome", { runtime: {
    getManifest: () => ({ version: "1.0.0" }),
    getURL: (path: string) => `chrome-extension://test/${path}`,
  } });
  vi.spyOn(window.location, "assign").mockImplementation(() => {});
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
    recordDiagnosticEvent: vi.fn(),
    recordDiagnosticSurfaces: vi.fn(),
    snapshot: {
      title: "Book", viewMode: "paginated", pageTheme: "white", chromeTheme: "silver",
      toc: [], bookmarks: [], highlights: [], searchResults: [], searchQuery: "", noteMarkers: [],
      tocPageNumbers: new Map(), contentPointerActivityId: 0,
    } as unknown as ReaderSnapshot,
    contentHostRef: { current: null },
    openBook: vi.fn(async () => {}),
    flushProgress: vi.fn(async () => {}),
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
    seekToFraction: vi.fn(async () => {}),
    narrationAction: vi.fn(),
    setNarrationRate: vi.fn(),
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

it("uses book preparation copy before the first snapshot", async () => {
  bridge.snapshot = undefined;
  await act(async () => root.render(<ReaderApp />));
  expect(container.textContent).toContain("Getting your book ready…");
  expect(container.textContent).not.toContain("Loading…");
});

it("automatically exposes paused read-along without autoplay, focus stealing, or a discovery notice", async () => {
  const focus = container.querySelector<HTMLButtonElement>('[data-testid="toolbar"] button')!;
  act(() => focus.focus());
  bridge.snapshot = {
    ...bridge.snapshot!,
    narrationNoticeVisible: true,
    narration: {
      available: true, status: "idle", following: true, rate: 1,
      hasPrevious: false, hasNext: true, hasTarget: false,
    },
  };
  await act(async () => root.render(<ReaderApp />));
  expect(container.querySelector('[data-narration-controls]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="Play narration"]')).not.toBeNull();
  expect(bridge.narrationAction).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(focus);
  const collapse = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse read-along controls"]')!;
  await act(async () => collapse.click());
  expect(container.querySelector('[data-narration-controls]')?.getAttribute("data-collapsed")).toBe("true");
  expect(container.querySelector('button[aria-label="Expand read-along controls"]')).toBe(collapse);
  expect(bridge.narrationAction).not.toHaveBeenCalled();
  const play = container.querySelector<HTMLButtonElement>('button[aria-label="Play narration"]')!;
  await act(async () => play.click());
  expect(bridge.narrationAction).toHaveBeenCalledExactlyOnceWith("toggle");
});

it("offers welcome only after content commits without an error, even while totals are unknown", async () => {
  welcomePreference.version = 0;
  bridge.snapshot = { ...bridge.snapshot!, hasRenderedContent: false, isLoading: false };
  await act(async () => root.render(<ReaderApp />));
  expect(document.querySelector(".reading-welcome")).toBeNull();
  bridge.snapshot = { ...bridge.snapshot, hasRenderedContent: true, isLoading: true };
  await act(async () => root.render(<ReaderApp />));
  expect(document.querySelector(".reading-welcome")).toBeNull();
  bridge.snapshot = { ...bridge.snapshot, isLoading: false, error: "Could not open this chapter" };
  await act(async () => root.render(<ReaderApp />));
  expect(document.querySelector(".reading-welcome")).toBeNull();
  expect(welcomePreference.acknowledge).not.toHaveBeenCalled();
  bridge.snapshot = { ...bridge.snapshot, error: undefined, bookPageCount: undefined, currentChapterLabel: "" };
  await act(async () => root.render(<ReaderApp />));
  expect(document.querySelector(".reading-welcome")?.textContent).toContain("Make yourself at home");
  expect(bridge.setShortcutModalOpen).toHaveBeenLastCalledWith(true);
  const start = [...document.querySelectorAll<HTMLButtonElement>(".reading-welcome button")]
    .find(button => button.textContent === "Start reading")!;
  await act(async () => start.click());
  expect(welcomePreference.acknowledge).toHaveBeenCalledOnce();
  expect(document.querySelector(".reading-welcome")).toBeNull();
  expect(bridge.setShortcutModalOpen).toHaveBeenLastCalledWith(false);
});

it.each([
  ["opening", "Getting your book ready…"],
  ["navigating", "Turning to your page…"],
] as const)("shows the %s loading message without moving focus", async (phase, label) => {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="toolbar"] button')!;
  act(() => button.focus());
  bridge.snapshot = { ...bridge.snapshot!, isLoading: true, loadingPhase: phase };
  await act(async () => root.render(<ReaderApp />));
  expect(container.textContent).toContain(label);
  const spinner = [...container.querySelectorAll('[role="progressbar"]')].find(element =>
    document.getElementById(element.getAttribute("aria-labelledby") ?? "")?.textContent === label,
  );
  expect(spinner).toBeDefined();
  expect(document.activeElement).toBe(button);
  bridge.snapshot = { ...bridge.snapshot, isLoading: false, loadingPhase: undefined };
  await act(async () => root.render(<ReaderApp />));
  expect(container.textContent).not.toContain(label);
});

async function openPanel(name: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="toolbar"] button')]
    .find(button => button.textContent === name)!;
  await act(async () => button.click());
}

it("clips the shell without creating a programmatically scrollable container", () => {
  expect(container.querySelector<HTMLElement>('div[style*="height: 100vh"]')?.style.overflow).toBe("clip");
});

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
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenCalledWith(expect.objectContaining({
    [menu]: { open: true },
  }));
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    [menu]: { open: false },
  }));
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

it("opens Go to through shortcut actions and distinguishes it from scrubber navigation", async () => {
    vi.mocked(bridge.getBookDetails).mockResolvedValue({
      title: "Private title", creator: undefined, description: undefined,
      descriptionSourceName: undefined, descriptionSourceUrl: undefined,
      publisher: undefined, language: "en", identifiers: [], fileName: "private.epub",
      fileSizeBytes: 100, rights: undefined, coverUrl: undefined,
      accessibility: { accessModes: [], accessibilityFeatures: [], accessibilityHazards: [], accessibilitySummary: undefined },
    });

    await openPanel("details");
    expect(container.textContent).not.toMatch(/go to percentage/i);
    const actions = vi.mocked(bridge.setShortcutActions).mock.lastCall![0];
    await act(async () => actions.goToPercentage());
    expect(bridge.setShortcutModalOpen).toHaveBeenLastCalledWith(true);
    expect(bridge.recordDiagnosticSurfaces).toHaveBeenCalledWith({ "go-to": { open: true, mode: "percentage" } });
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(bridge.recordDiagnosticEvent).toHaveBeenCalledWith({ kind: "navigation", source: "go-to", fraction: 0.25 });
    expect(bridge.seekToFraction).toHaveBeenCalledWith(0.25, { preserveFocus: true });
    expect(bridge.setShortcutModalOpen).toHaveBeenLastCalledWith(false);
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(bridge.restoreContentFocus).toHaveBeenCalled();
    expect(bridge.recordDiagnosticSurfaces).toHaveBeenCalledWith({ "go-to": { open: false, mode: "percentage" } });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="seek"]')!.click());
    expect(bridge.recordDiagnosticEvent).toHaveBeenCalledWith({ kind: "navigation", source: "scrubber", fraction: 0.3 });
    expect(bridge.seekToFraction).toHaveBeenCalledWith(0.3);
    expect(JSON.stringify(vi.mocked(bridge.recordDiagnosticEvent).mock.calls)).not.toContain("Private");
});

it.each([
  { viewMode: "paginated", isFixedLayout: false, message: "Still measuring" },
  { viewMode: "scroll", isFixedLayout: false, message: "requires paginated mode" },
  { viewMode: "paginated", isFixedLayout: true, message: "unavailable for fixed-layout" },
] as const)("wires page count and reading mode availability from the snapshot (%j)", async scenario => {
  bridge.snapshot = { ...bridge.snapshot!, ...scenario, bookPageCount: undefined };
  await act(async () => root.render(<ReaderApp />));
  await act(async () => vi.mocked(bridge.setShortcutActions).mock.lastCall![0].goToPage());
  const modal = document.querySelector('[role="dialog"]')!;
  expect(modal.textContent).toContain(scenario.message);
  expect(modal.querySelector("input")).toBeNull();
  expect(bridge.seekToFraction).not.toHaveBeenCalled();
  expect(bridge.setShortcutModalOpen).toHaveBeenLastCalledWith(true);
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
    expect(bridge.recordDiagnosticSurfaces).toHaveBeenCalledWith(expect.objectContaining({
      [panel]: expect.objectContaining({ open: true }),
    }));
    expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
      [panel]: expect.objectContaining({ open: false }),
    }));
  },
);

it("keeps pinned chrome visible and does not charge reading clicks for dismissing it", async () => {
  await openPanel("toc");
  const pin = container.querySelector<HTMLButtonElement>('button[aria-label="Pin contents panel"]')!;
  expect(pin).not.toBeNull();
  await act(async () => pin.click());
  expect(dismiss?.()).toBe(false);
  expect(chromeVisible()).toBe(true);
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    toc: { open: true, pinned: true },
  }));
});

it.each(
  ["toc", "library", "annotations", "search", "details"].flatMap(from =>
    ["toc", "library", "annotations", "search", "details"].filter(to => to !== from).map(to => [from, to])),
)("replaces the %s reference panel with %s across both sides", async (from, to) => {
  await openPanel(from!);
  await openPanel(to!);
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    [from!]: expect.objectContaining({ open: false }),
    [to!]: expect.objectContaining({ open: true }),
  }));
});

it("loads Library on first use and keeps its component mounted when another panel replaces it", async () => {
  expect(container.querySelector('[data-testid="reader-library"]')).toBeNull();
  await openPanel("library");
  const library = container.querySelector('[data-testid="reader-library"]')!;
  expect(library.hasAttribute("hidden")).toBe(false);
  await openPanel("toc");
  expect(container.querySelector('[data-testid="reader-library"]')).toBe(library);
  expect(library.hasAttribute("hidden")).toBe(true);
});

it("returns to the current book without reloading or replacing its reading state", async () => {
  await openPanel("library");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="current-book"]')!.click());
  expect(bridge.flushProgress).not.toHaveBeenCalled();
  expect(window.location.assign).not.toHaveBeenCalled();
  expect(bridge.restoreContentFocus).toHaveBeenCalled();
  expect(container.querySelector('[data-testid="reader-library"]')!.hasAttribute("hidden")).toBe(true);
});

it("awaits saved reading position and only activates the latest requested book in the same tab", async () => {
  let finishSave!: () => void;
  vi.mocked(bridge.flushProgress).mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
  await openPanel("library");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="other-book"]')!.click());
  const finishFirstSave = finishSave;
  expect(window.location.assign).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="next-book"]')!.click());
  await act(async () => finishFirstSave());
  expect(window.location.assign).not.toHaveBeenCalled();
  await act(async () => finishSave());
  expect(window.location.assign).toHaveBeenCalledExactlyOnceWith(
    "chrome-extension://test/src/reader/index.html?bookId=next%20book",
  );
});

it("reports a position-save failure and retains the current book instead of navigating away", async () => {
  vi.mocked(bridge.flushProgress).mockRejectedValue(new Error("The reading position could not be saved."));
  await openPanel("library");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="other-book"]')!.click());
  expect(window.location.assign).not.toHaveBeenCalled();
  expect(container.textContent).toContain("The reading position could not be saved.");
  expect(container.querySelector('[data-testid="reader-library"]')!.hasAttribute("hidden")).toBe(false);
});

it("logs a superseded save failure without showing an obsolete activation error", async () => {
  let failSave!: (error: Error) => void;
  const error = new Error("An older checkpoint failed.");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(bridge.flushProgress).mockImplementation(() => new Promise((_resolve, reject) => { failSave = reject; }));
  await openPanel("library");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="other-book"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="current-book"]')!.click());
  await act(async () => failSave(error));
  expect(window.location.assign).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain(error.message);
  expect(log).toHaveBeenCalledWith("Could not save reading position for a superseded Library request.", error);
});

it("shares the Contents/Annotations pin preference while retaining opposite docks and keeping Search independent", async () => {
  await openPanel("toc");
  const pin = container.querySelector<HTMLButtonElement>('button[aria-label="Pin contents panel"]')!;
  await act(async () => pin.click());
  await openPanel("annotations");
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    toc: { open: true, pinned: true },
    annotations: { open: true, pinned: true },
  }));
  await openPanel("search");
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    toc: { open: true, pinned: true },
    annotations: { open: false, pinned: false },
    search: { open: true, pinned: false },
  }));
  await openPanel("toc");
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    toc: { open: false, pinned: false },
    search: { open: true, pinned: false },
  }));
  await openPanel("toc");
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    toc: { open: true, pinned: true },
    search: { open: false, pinned: false },
  }));
});

it("falls back at the measured 320px reading threshold and restores the shared pin choice without refocusing", async () => {
  await openPanel("toc");
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Pin contents panel"]')!.click());
  const panel = container.querySelector<HTMLElement>('[data-ambra-reference-panel="toc"]')!;
  const focus = container.querySelector<HTMLButtonElement>('[data-testid="toolbar"] button')!;
  act(() => focus.focus());
  await resizeReferenceRow(620);
  expect(panel.style.position).toBe("relative");
  expect(document.activeElement).toBe(focus);
  await resizeReferenceRow(619);
  expect(panel.style.position).toBe("absolute");
  expect(panel.style.visibility).toBe("visible");
  expect(document.activeElement).toBe(focus);
  const unavailable = panel.querySelector<HTMLButtonElement>('button[aria-label="Pin contents panel"]')!;
  expect(unavailable.getAttribute("aria-disabled")).toBe("true");
  await act(async () => unavailable.click());
  await resizeReferenceRow(620);
  expect(panel.style.position).toBe("relative");
  expect(panel.querySelector('button[aria-label="Unpin contents panel"]')).not.toBeNull();
  await openPanel("annotations");
  const annotations = container.querySelector<HTMLElement>('[data-ambra-reference-panel="annotations"]')!;
  expect(panel.style.position).toBe("relative");
  expect(annotations.style.position).toBe("absolute");
  await resizeReferenceRow(619);
  expect(panel.style.visibility).toBe("hidden");
  expect(annotations.style.visibility).toBe("visible");
  await openPanel("annotations");
  await resizeReferenceRow(620);
  expect(annotations.style.visibility).toBe("hidden");
  await openPanel("annotations");
  expect(annotations.style.position).toBe("absolute");
  await resizeReferenceRow(920);
  expect(panel.style.position).toBe("relative");
  expect(annotations.style.position).toBe("relative");
});

it("observes the available row when loading finishes and disconnects when the layout is removed", async () => {
  const readySnapshot = bridge.snapshot;
  bridge.snapshot = undefined;
  await act(async () => root.render(<ReaderApp />));
  expect([...resizeObservers].some(observer =>
    [...observer.targets].some(target => target.hasAttribute("data-ambra-reference-row")))).toBe(false);
  await resizeReferenceRow(619);
  bridge.snapshot = readySnapshot;
  await act(async () => root.render(<ReaderApp />));
  await openPanel("toc");
  expect(container.querySelector('button[aria-label="Pin contents panel"]')!.getAttribute("aria-disabled")).toBe("true");
  const observer = [...resizeObservers].find(observer =>
    [...observer.targets].some(target => target.hasAttribute("data-ambra-reference-row")))!;
  expect(observer.targets.size).toBe(4);
  await resizeReferenceRow(620);
  expect(container.querySelector('button[aria-label="Pin contents panel"]')!.getAttribute("aria-disabled")).not.toBe("true");
});

it("uses each measured panel width and available row width rather than the window or a fixed breakpoint", async () => {
  vi.stubGlobal("innerWidth", 1600);
  measuredPanelWidths = { toc: 284, annotations: 316, search: 348 };
  await resizeReferenceRow(636);
  await openPanel("toc");
  expect(container.querySelector('button[aria-label="Pin contents panel"]')!.getAttribute("aria-disabled")).not.toBe("true");
  await openPanel("annotations");
  expect(container.querySelector('button[aria-label="Pin annotations panel"]')!.getAttribute("aria-disabled")).not.toBe("true");
  await openPanel("search");
  expect(container.querySelector('button[aria-label="Pin search panel"]')!.getAttribute("aria-disabled")).toBe("true");
  await resizeReferenceRow(668);
  expect(container.querySelector('button[aria-label="Pin search panel"]')!.getAttribute("aria-disabled")).not.toBe("true");
  measuredPanelWidths.search = 349;
  await resizeReferenceRow(668);
  expect(container.querySelector('button[aria-label="Pin search panel"]')!.getAttribute("aria-disabled")).toBe("true");
});

it("retains Search's independent pin preference, input and results across an available-row reduction", async () => {
  bridge.snapshot = {
    ...bridge.snapshot!,
    searchQuery: "words",
    searchResults: [{ spineIndex: 0, cfi: "found", chapterLabel: "Chapter", before: "before", match: "words", after: "after" }],
  };
  await act(async () => root.render(<ReaderApp />));
  await openPanel("search");
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Pin search panel"]')!.click());
  const panel = container.querySelector<HTMLElement>('[data-ambra-reference-panel="search"]')!;
  const input = panel.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "unsent draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
  await resizeReferenceRow(500);
  expect(panel.style.position).toBe("absolute");
  expect(input.value).toBe("unsent draft");
  expect(panel.textContent).toContain("beforewordsafter");
  expect(document.activeElement).toBe(input);
  await resizeReferenceRow(1000);
  expect(panel.style.position).toBe("relative");
  expect(document.activeElement).toBe(input);
  await openPanel("toc");
  expect(container.querySelector<HTMLElement>('[data-ambra-reference-panel="toc"]')!.style.position).toBe("absolute");
  expect(panel.style.position).toBe("relative");
  expect(panel.style.visibility).toBe("visible");
  await openPanel("search");
  expect(panel.style.visibility).toBe("hidden");
  await openPanel("search");
  expect(panel.style.position).toBe("relative");
  expect(input.value).toBe("unsent draft");
});

it("hides chrome after dismissing the sole replacement reference panel", async () => {
  await openPanel("toc");
  await openPanel("details");
  const details = container.querySelector('aside[aria-label="Book details"]')!;
  const backdrop = details.previousElementSibling as HTMLElement;
  await act(async () => backdrop.click());
  expect(chromeVisible()).toBe(false);
  expect(dismiss?.()).toBe(false);
});

it("dismisses a bookmark chooser and chrome in the first content gesture", async () => {
  const chooser = container.querySelector<HTMLButtonElement>('[data-testid="bookmark-chooser"]')!;
  await act(async () => chooser.click());
  expect(chromeVisible()).toBe(true);
  await act(async () => { expect(dismiss?.()).toBe(true); });
  expect(chooser.dataset.dismissRequest).toBe("1");
  expect(bridge.restoreContentFocus).toHaveBeenCalled();
  expect(chromeVisible()).toBe(false);
  expect(dismiss?.()).toBe(false);
});

it("opens and refocuses the Bookmarks filter from the dense bookmark fallback", async () => {
  const all = container.querySelector<HTMLButtonElement>('[data-testid="show-bookmarks"]')!;
  await act(async () => all.click());
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    annotations: { open: true, pinned: false },
  }));
  const filter = container.querySelector<HTMLSelectElement>('select')!;
  expect(filter.value).toBe("bookmarks");
  expect(document.activeElement).toBe(filter);
  act(() => {
    filter.value = "all";
    filter.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => all.click());
  expect(filter.value).toBe("bookmarks");
  expect(document.activeElement).toBe(filter);
});

it("retains keyboard panel dismissal and focus restoration", async () => {
  await openPanel("toc");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(bridge.restoreContentFocus).toHaveBeenCalled();
  expect(chromeVisible()).toBe(true);
  expect(bridge.recordDiagnosticSurfaces).toHaveBeenLastCalledWith(expect.objectContaining({
    toc: { open: false, pinned: false },
  }));
});

it("hides chrome with Help's modal backdrop instead of charging another reading click", async () => {
  await openPanel("help");
  const backdrop = document.querySelector<HTMLElement>(".fui-DialogSurface__backdrop")!;
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
  expect(bridge.dismissFootnotePopup).toHaveBeenCalledWith(false);
  expect(chromeVisible()).toBe(false);
});
