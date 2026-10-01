import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderLibraryPanel, type ReaderLibraryPanelProps } from "./ReaderLibraryPanel.js";
import { ChromeThemeProvider } from "../ChromeThemeContext.js";
import { CHROME_TOOLBAR_HEIGHT } from "../../components/ChromeToolbarStyles.js";
import { SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { useLibrary, type LibraryBookViewModel, type UseLibraryResult } from "../../library/useLibrary.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "../../library/ReadingSettings.js";

vi.mock("../../library/useLibrary.js", () => ({ useLibrary: vi.fn() }));

describe("Reader library reference panel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: UseLibraryResult;
  let props: ReaderLibraryPanelProps;
  const mounted = vi.fn();
  const disposed = vi.fn();
  const draw = () => root.render(<ChromeThemeProvider theme="green"><ReaderLibraryPanel {...props} /></ChromeThemeProvider>);
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((node) => node.textContent === label || node.getAttribute("aria-label") === label)!;
  const cover = (id: string) => container.querySelector<HTMLButtonElement>(`[data-book-open="${id}"]`)!;
  const panel = () => container.querySelector<HTMLElement>("[data-ambra-library-panel]")!;
  const search = () => container.querySelector<HTMLInputElement>('input[type="search"]')!;
  async function render(patch: Partial<ReaderLibraryPanelProps> = {}) {
    props = { ...props, ...patch };
    await act(async () => draw());
  }
  async function key(target: EventTarget, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...options });
    await act(async () => target.dispatchEvent(event));
    return event;
  }
  async function query(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search(), value);
      search().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

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
    mounted.mockReset();
    disposed.mockReset();
    state = {
      books: ["First", "Second", "Third"].map((title) => ({ id: title, title, identifiers: [] } as unknown as LibraryBookViewModel)),
      isLoading: false, canImport: true, error: undefined, importActivities: [],
      dismissCompletedImports: vi.fn(), cancelDownload: vi.fn().mockReturnValue(true),
      dismissError: vi.fn(), importFiles: vi.fn().mockResolvedValue(undefined),
      removeBook: vi.fn().mockResolvedValue(true), openBook: vi.fn(),
      chromeTheme: "ambra", settings: DEFAULT_GLOBAL_READING_SETTINGS, setSettings: vi.fn(),
      sort: "dateAddedDesc", setSort: vi.fn(), isFullTab: true, openInFullTab: vi.fn(),
      storageUsage: undefined, openInspectionSession: vi.fn(), saveBookAs: vi.fn().mockResolvedValue(undefined),
      getBookFileSize: vi.fn().mockResolvedValue(2048),
    };
    vi.mocked(useLibrary).mockImplementation(function useMockLibrary() {
      useEffect(() => { mounted(); return () => { disposed(); }; }, []);
      return state;
    });
    props = {
      open: false, onRequestClose: vi.fn(), onOutsideClick: vi.fn(),
      onActivateBook: vi.fn(), scrubberVisible: true, currentBookId: "First",
    };
    document.title = "Reading First";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stays mounted, hidden and inert when closed; opens a bounded left reference surface without duplicate app chrome", async () => {
    expect(panel().hidden).toBe(true);
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(panel().style.display).toBe("none");
    await render({ open: true });
    expect(panel().hidden).toBe(false);
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(panel().getAttribute("aria-label")).toBe("Library");
    expect(panel().style.top).toBe(`${CHROME_TOOLBAR_HEIGHT}px`);
    expect(panel().style.bottom).toBe(`calc(${SCRUBBER_HEIGHT}px + var(--ambra-narration-height, 0px))`);
    expect(panel().style.left).toBe("0px");
    expect(panel().style.width).toBe("360px");
    expect(panel().style.maxWidth).toBe("100%");
    expect(document.activeElement).toBe(button("Close"));
    expect(panel().querySelector('main, h1, [aria-label="Ambra settings"], [aria-label="Help & About"], [aria-label*="Pin"]')).toBeNull();
    expect(document.title).toBe("Reading First");
    const collection = container.querySelector<HTMLElement>("[data-library-collection]")!;
    expect(collection.style.flexDirection).toBe("column");
    expect(collection.parentElement!.style.minHeight).toBe("160px");
    expect(collection.parentElement!.parentElement!.style.overflow).toBe("auto");
    expect(cover("First").getAttribute("aria-current")).toBe("true");
    await render({ open: false, scrubberVisible: false });
    expect(panel().style.bottom).toBe("calc(8px + var(--ambra-narration-height, 0px))");
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();
  });

  it("does not register another Help shortcut owner in the reader", async () => {
    await render({ open: true });
    await key(document, { key: "?", shiftKey: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("routes cards and completed-import Read now through the reader callback, never new reader tabs", async () => {
    state.importActivities = [{ id: 1, fileName: "Second.epub", phase: "complete", bookId: "Second", outcome: "existing" }];
    await render({ open: true });
    await act(async () => cover("Third").click());
    await act(async () => button("Read now").click());
    expect(props.onActivateBook).toHaveBeenNthCalledWith(1, "Third");
    expect(props.onActivateBook).toHaveBeenNthCalledWith(2, "Second");
    expect(state.openBook).not.toHaveBeenCalled();
    expect(panel().textContent).toContain("already");
    await act(async () => button("Find books").click());
    expect(state.openInFullTab).toHaveBeenLastCalledWith(true);
    await act(async () => button("Open library in new tab").click());
    expect(state.openInFullTab).toHaveBeenLastCalledWith();
  });

  it("preserves search and import lifecycle while closed; Escape clears the query before closing", async () => {
    await render({ open: true });
    await query("Second");
    expect(container.querySelectorAll("[data-library-book]")).toHaveLength(1);
    state.importActivities = [{ id: 3, fileName: "new.epub", phase: "downloading" }];
    await render({ open: false });
    await render({ open: true });
    expect(search().value).toBe("Second");
    expect(panel().textContent).toContain("new.epub");
    await key(search());
    expect(search().value).toBe("");
    expect(props.onRequestClose).not.toHaveBeenCalled();
    await key(search());
    expect(props.onRequestClose).toHaveBeenCalledTimes(1);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();
  });

  it.each(["queued", "downloading", "processing", "saving"] as const)(
    "blocks other-book navigation during %s, including completed batch entries, but preserves current-book return and closing",
    async (phase) => {
      state.importActivities = [
        { id: 1, fileName: "Second.epub", phase: "complete", bookId: "Second" },
        { id: 2, fileName: "First.epub", phase: "complete", bookId: "First", outcome: "existing" },
        { id: 3, fileName: "Third.epub", phase },
      ];
      await render({ open: true });
      expect(cover("Second").disabled).toBe(true);
      expect(cover("Third").disabled).toBe(true);
      expect(button("Read now: Second").disabled).toBe(true);
      const descriptionId = cover("Second").getAttribute("aria-describedby")!;
      expect(document.getElementById(descriptionId)?.textContent).toContain("Keep your library open");
      expect(button("Read now: Second").getAttribute("aria-describedby")).toBe(descriptionId);
      await act(async () => { cover("Second").click(); button("Read now: Second").click(); });
      expect(props.onActivateBook).not.toHaveBeenCalled();
      expect(cover("First").disabled).toBe(false);
      expect(button("Read now: First").disabled).toBe(false);
      await act(async () => { cover("First").click(); button("Read now: First").click(); });
      expect(props.onActivateBook).toHaveBeenCalledTimes(2);
      expect(props.onActivateBook).toHaveBeenLastCalledWith("First");
      await act(async () => button("Close").click());
      expect(props.onRequestClose).toHaveBeenCalledOnce();
      await render({ open: false });
      expect(disposed).not.toHaveBeenCalled();
      expect(mounted).toHaveBeenCalledOnce();
      state.importActivities = state.importActivities.map((activity) => ({ ...activity, phase: "complete" }));
      await render({ open: true });
      expect(cover("Second").disabled).toBe(false);
      expect(button("Read now: Second").disabled).toBe(false);
      expect(cover("Second").hasAttribute("aria-describedby")).toBe(false);
      await act(async () => cover("Second").click());
      expect(props.onActivateBook).toHaveBeenLastCalledWith("Second");
      expect(state.openBook).not.toHaveBeenCalled();
    },
  );

  it.each(["cancelled", "failed"])("re-enables activation when the last import is %s", async (outcome) => {
    state.importActivities = [{ id: 1, fileName: "new.epub", phase: "downloading" }];
    await render({ open: true });
    expect(cover("Second").disabled).toBe(true);
    state.importActivities = [];
    state.error = outcome === "failed" ? "Import failed" : undefined;
    await render();
    expect(cover("Second").disabled).toBe(false);
    await act(async () => cover("Second").click());
    expect(props.onActivateBook).toHaveBeenCalledWith("Second");
  });

  it("retains details, Save as and confirmed removal while imports disable navigation", async () => {
    state.importActivities = [{ id: 1, fileName: "new.epub", phase: "processing" }];
    await render({ open: true });
    await act(async () => button("Second details").click());
    await act(async () => button("Publication details").click());
    await act(async () => button("Save as…").click());
    expect(state.saveBookAs).toHaveBeenCalledWith("Second");
    vi.mocked(state.removeBook).mockImplementation(async (id) => {
      state.books = state.books.filter((book) => book.id !== id);
      draw();
      return true;
    });
    await act(async () => button("Remove from library").click());
    expect(document.activeElement).toBe(button("Cancel"));
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
      .find((node) => node.textContent === "Remove from library")!;
    await act(async () => confirm.click());
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(state.removeBook).toHaveBeenCalledExactlyOnceWith("Second");
    expect(cover("Third").disabled).toBe(true);
    expect(document.activeElement).toBe(button("Third details"));
    expect(props.onActivateBook).not.toHaveBeenCalled();
  });

  it("retains real Import, cancellation, error dismissal and the shared four-choice sort preference", async () => {
    state.error = "Import failed";
    state.importActivities = [{ id: 3, fileName: "new.epub", phase: "downloading" }];
    await render({ open: true });
    const files = [new File(["epub"], "book.epub")];
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(state.importFiles).toHaveBeenCalledWith(files);
    await act(async () => button("Cancel download: new.epub").click());
    expect(state.cancelDownload).toHaveBeenCalledWith(3);
    const error = [...container.querySelectorAll('[role="alert"]')].find((node) => node.textContent?.includes("Import failed"))!;
    await act(async () => error.querySelector<HTMLButtonElement>("button")!.click());
    expect(state.dismissError).toHaveBeenCalledTimes(1);
    await act(async () => button("Sort library").click());
    const choices = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(choices).toHaveLength(4);
    await act(async () => choices.find((node) => node.textContent === "Title (A–Z)")!.click());
    expect(state.setSort).toHaveBeenCalledWith("titleAsc");
    await act(async () => button("Sort library").click());
    await render({ open: false });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await render({ open: true });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps Book details, lazy metadata and Save as; child dialogs own Escape and disappear on panel close", async () => {
    await render({ open: true });
    await act(async () => button("Second details").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Second");
    expect(state.getBookFileSize).toHaveBeenCalledWith("Second");
    await act(async () => button("Publication details").click());
    await act(async () => button("Save as…").click());
    expect(state.saveBookAs).toHaveBeenCalledWith("Second");
    await key(document.activeElement!);
    expect(props.onRequestClose).not.toHaveBeenCalled();
    await act(async () => button("Second details").click());
    await render({ open: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await render({ open: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("confirms removal once with Cancel initially focused and restores the next displayed row", async () => {
    await render({ open: true });
    vi.mocked(state.removeBook).mockImplementation(async (id) => {
      state.books = state.books.filter((book) => book.id !== id);
      draw();
      return true;
    });
    await key(cover("Second"), { key: "Delete" });
    expect(document.activeElement).toBe(button("Cancel"));
    expect(state.removeBook).not.toHaveBeenCalled();
    await act(async () => button("Remove from library").click());
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(state.removeBook).toHaveBeenCalledExactlyOnceWith("Second");
    expect(document.activeElement).toBe(cover("Third"));
    expect(props.onRequestClose).not.toHaveBeenCalled();
  });

  it("does not delete underneath the current reader session", async () => {
    await render({ open: true });
    await key(cover("First"), { key: "Backspace" });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("close this reader tab first");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(state.removeBook).not.toHaveBeenCalled();
  });

  it("does not steal focus when a confirmed deletion completes after the panel closes", async () => {
    let finish!: (removed: boolean) => void;
    vi.mocked(state.removeBook).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render({ open: true });
    await key(cover("Second"), { key: "Delete" });
    await act(async () => button("Remove from library").click());
    await render({ open: false });
    const readerFocus = document.createElement("button");
    container.append(readerFocus);
    readerFocus.focus();
    await act(async () => {
      state.books = state.books.filter((book) => book.id !== "Second");
      finish(true);
      draw();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement).toBe(readerFocus);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it.each([{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }])(
    "ignores guarded Escape %j", async (options) => {
      await render({ open: true });
      await key(document, options);
      expect(props.onRequestClose).not.toHaveBeenCalled();
    },
  );

  it("leaves prevented Escape and modal ownership alone; explicit close and backdrop have distinct callbacks", async () => {
    await render({ open: true });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    await act(async () => document.dispatchEvent(event));
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    document.body.append(modal);
    await key(document);
    modal.remove();
    expect(props.onRequestClose).not.toHaveBeenCalled();
    await act(async () => button("Close").click());
    expect(props.onRequestClose).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector<HTMLElement>("[data-ambra-library-backdrop]")!.click());
    expect(props.onOutsideClick).toHaveBeenCalledTimes(1);
    expect(props.onRequestClose).toHaveBeenCalledTimes(1);
    await render({ open: false });
    await key(document);
    expect(props.onRequestClose).toHaveBeenCalledTimes(1);
  });
});
