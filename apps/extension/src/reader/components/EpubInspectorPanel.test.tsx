import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubInspectionData, InspectorReaderBridge, InspectorReadingLocation } from "../ReaderTypes.js";
import type { InspectorReference } from "../InspectorReferences.js";
import { CHROME_THEMES, DEFAULT_CHROME_THEME } from "../chromeTheme.js";
import { EpubInspectorPanel, INSPECTOR_DOCK_WIDTH } from "./EpubInspectorPanel.js";
import type { EpubInspectorPanelProps, InspectorViewMode } from "./EpubInspectorPanel.js";
import { sourceSelectionOffset, sourceTextRange } from "./inspectorSourceSelection.js";

const dialogMock = vi.hoisted(() => ({ props: vi.fn(), surface: vi.fn(), real: false }));

vi.mock("@fluentui/react-components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fluentui/react-components")>();
  return {
    ...actual,
    Dialog: (props: React.ComponentProps<typeof actual.Dialog>) => {
      dialogMock.props(props);
      return dialogMock.real ? <actual.Dialog {...props} /> : props.open ? <div>{props.children}</div> : null;
    },
    DialogSurface: (props: React.ComponentProps<typeof actual.DialogSurface>) => {
      dialogMock.surface(props);
      return dialogMock.real ? <actual.DialogSurface {...props} /> : <div {...props} />;
    },
  };
});

function ControlledInspector({ initialViewMode = "popover", onModeChange, ...props }:
  Omit<EpubInspectorPanelProps, "viewMode" | "onViewModeChange">
  & { initialViewMode?: InspectorViewMode; onModeChange?: (mode: InspectorViewMode) => void }) {
  const [viewMode, setViewMode] = useState(initialViewMode);
  return <EpubInspectorPanel {...props} viewMode={viewMode} onViewModeChange={(mode) => {
    onModeChange?.(mode);
    setViewMode(mode);
  }} />;
}

const data: EpubInspectionData = {
  files: ["one.xhtml", "two.xhtml", "style.css", "picture.png", "diagram.svg"].map((path) => ({
    path, size: 100, isDirectory: false,
    mediaType: path.endsWith("xhtml") ? "application/xhtml+xml" : path.endsWith("png") ? "image/png"
      : path.endsWith("svg") ? "image/svg+xml" : "text/css",
  })),
  rootFilePath: "book.opf", title: "Book", identifiers: [], language: "en", creator: undefined,
  creators: [], publisher: undefined, description: undefined, renditionLayout: "reflowable",
  renditionOrientation: "auto", rights: undefined, date: undefined, subjects: [], contributors: [],
  metaEntries: [], manifest: [], spine: [],
};
const markup = '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>One</p><p>Two &amp; three</p><a href="two.xhtml">Next</a></body></html>';

describe("Inspector reader linking", () => {
  let root: Root;
  let container: HTMLDivElement;
  let reader: InspectorReaderBridge;
  const onOpenChange = vi.fn();
  const onShowInBook = vi.fn();
  const onViewModeChange = vi.fn();
  const onReadFile = vi.fn();
  const onGetPreviewUrl = vi.fn();
  const onFindReferences = vi.fn<(path: string) => Promise<readonly InspectorReference[]>>();
  const highlights = new Map<string, { ranges: Range[] }>();
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("Highlight", class { constructor(...publicRanges: Range[]) { this.ranges = publicRanges; } ranges: Range[]; });
    vi.stubGlobal("CSS", { ...CSS, highlights, escape: CSS.escape.bind(CSS) });
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(scrollIntoView);
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      queueMicrotask(() => animation.finish());
      return animation;
    });
    onOpenChange.mockReset();
    onShowInBook.mockReset();
    onViewModeChange.mockReset();
    dialogMock.props.mockClear();
    dialogMock.surface.mockClear();
    dialogMock.real = false;
    onReadFile.mockReset().mockResolvedValue(markup);
    onGetPreviewUrl.mockReset().mockResolvedValue("blob:preview");
    onFindReferences.mockReset().mockResolvedValue([]);
    scrollIntoView.mockClear();
    reader = {
      currentPath: "one.xhtml",
      locateCurrentPassage: vi.fn().mockResolvedValue({ path: "one.xhtml", elementPath: [1, 1] }),
      canShowInBook: (path) => path.endsWith(".xhtml"),
      showInBook: vi.fn().mockResolvedValue(undefined),
      restoreFocus: vi.fn(),
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.getSelection()?.removeAllRanges();
    highlights.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(open = true, bridge: InspectorReaderBridge | null = reader, initialViewMode: InspectorViewMode = "popover") {
    await act(async () => root.render(
      <ControlledInspector open={open} onOpenChange={onOpenChange} data={data} fileName="book.epub"
        initialViewMode={initialViewMode} onModeChange={onViewModeChange} onShowInBook={onShowInBook}
        onReadFile={onReadFile} onGetPreviewUrl={onGetPreviewUrl} onFindReferences={onFindReferences}
        {...(bridge ? { reader: bridge } : {})} />,
    ));
  }

  function button(label: string) {
    const result = Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === label
      || entry.getAttribute("aria-label") === label);
    expect(result, `button: ${label}`).toBeDefined();
    return result!;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function selectFile(path: string) {
    await act(async () => container.querySelector<HTMLButtonElement>(`[data-file-path="${path}"]`)!.click());
  }

  async function openReference(path: string) {
    await act(async () => container.querySelector<HTMLButtonElement>(`[data-reference-source="${path}"]`)!.click());
  }

  function selectedPath() {
    return container.querySelector("pre")?.getAttribute("aria-label") === "Source code"
      ? onReadFile.mock.calls.at(-1)?.[0] : undefined;
  }

  const views = [
    ["popover", "Popover view"],
    ["fullscreen", "Full screen"],
    ["dock-left", "Dock left"],
    ["dock-right", "Dock right"],
  ] as const;

  it("offers all four pressed-state view controls in the header on every tab", async () => {
    await render();
    for (const tab of container.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      await act(async () => tab.click());
      for (const [mode, label] of views) {
        await click(label);
        expect(container.querySelector("[data-inspector-view]")?.getAttribute("data-inspector-view")).toBe(mode);
        expect(button(label).getAttribute("aria-pressed")).toBe("true");
        expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
        expect(container.querySelector('[role="tabpanel"]')?.contains(button(label))).toBe(false);
        expect(tab.getAttribute("aria-selected")).toBe("true");
        expect(dialogMock.props.mock.lastCall?.[0].modalType).toBe(mode === "fullscreen" ? "modal" : "non-modal");
        if (mode.startsWith("dock")) {
          const surface = container.querySelector<HTMLElement>("[data-inspector-view]")!;
          // happy-dom does not parse CSS min() lengths.
          expect(dialogMock.surface.mock.lastCall?.[0].style.width).toBe(INSPECTOR_DOCK_WIDTH);
          expect(surface.style.margin).toBe("0px");
          expect(surface.style.borderRadius).toBe("0px");
          expect(dialogMock.surface.mock.lastCall?.[0].style.minWidth).toBe(0);
          expect(surface.style[mode === "dock-left" ? "left" : "right"]).toBe("0px");
        }
      }
    }
    expect(onOpenChange).not.toHaveBeenCalled();
    await click("Close EPUB Inspector");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(views)("keeps Show in book open from %s and commits its visible mode before navigation", async (mode) => {
    await render(true, reader, mode);
    const pre = container.querySelector("pre")!;
    const expectedMode = mode === "fullscreen" ? "popover" : mode;
    vi.mocked(reader.showInBook).mockImplementation(async () => {
      expect(container.querySelector("[data-inspector-view]")?.getAttribute("data-inspector-view")).toBe(expectedMode);
      expect(onShowInBook).toHaveBeenCalledOnce();
      expect(container.querySelector("pre")).toBe(pre);
    });
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenCalledWith({ path: "one.xhtml" });
    expect(reader.restoreFocus).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(container.querySelector("[data-inspector-view]")?.getAttribute("data-inspector-view")).toBe(expectedMode);
    if (mode === "fullscreen") expect(onViewModeChange).toHaveBeenCalledWith("popover");
    else expect(onViewModeChange).not.toHaveBeenCalled();
  });

  it("preserves mounted source, text selection, wrapping and Back history across modes", async () => {
    await render();
    await click("Locate current passage");
    await act(async () => container.querySelector<HTMLElement>("[data-nav-path]")!.click());
    await click("Turn on line wrapping");
    const pre = container.querySelector("pre")!;
    const offset = pre.textContent!.indexOf("Two");
    await act(async () => {
      pre.focus();
      document.getSelection()!.addRange(sourceTextRange(pre, offset, offset + 3)!);
      document.dispatchEvent(new Event("selectionchange"));
    });
    const reads = onReadFile.mock.calls.length;
    for (const [, label] of views) {
      await click(label);
      expect(container.querySelector("pre")).toBe(pre);
      expect(pre.style.whiteSpace).toBe("pre-wrap");
      expect(document.getSelection()?.toString()).toBe("Two");
      expect(selectedPath()).toBe("two.xhtml");
      expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("<p>");
    }
    expect(onReadFile).toHaveBeenCalledTimes(reads);
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenCalledWith({ path: "two.xhtml", elementPath: [1, 1] });
    await click("Back");
    expect(selectedPath()).toBe("one.xhtml");
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("<p>");
  });

  it("preserves a media preview and reference results across mode changes", async () => {
    onFindReferences.mockResolvedValue([
      { sourcePath: "one.xhtml", kind: "markup", line: 9, snippet: "<img src='picture.png'/>", elementPath: [1, 1] },
    ]);
    await render();
    await selectFile("picture.png");
    await click("Find references");
    const image = container.querySelector("img");
    for (const [, label] of views) {
      await click(label);
      expect(container.querySelector("img")).toBe(image);
      expect(container.textContent).toContain("References (1)");
    }
    expect(onGetPreviewUrl).toHaveBeenCalledOnce();
    expect(onFindReferences).toHaveBeenCalledOnce();
    await openReference("one.xhtml");
    await click("Full screen");
    await click("Show in book");
    expect(onOpenChange).not.toHaveBeenCalled();
    await click("Back");
    expect(container.textContent).toContain("References (1)");
  });

  it("retains the actual Fluent portal, focus and source when modality changes, and permits outside interaction", async () => {
    dialogMock.real = true;
    await render();
    const surface = document.querySelector<HTMLElement>("[data-inspector-view]")!;
    const pre = surface.querySelector("pre")!;
    const outside = document.createElement("button");
    outside.textContent = "Book control";
    container.append(outside);
    const outsideClick = vi.fn();
    outside.addEventListener("click", outsideClick);
    for (const [mode, label] of [...views.slice(1), views[0]]) {
      await act(async () => {
        pre.focus();
        surface.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
      });
      expect(document.querySelector("[data-inspector-view]")).toBe(surface);
      expect(surface.querySelector("pre")).toBe(pre);
      expect(document.activeElement).toBe(pre);
      expect(surface.getAttribute("aria-modal")).toBe(mode === "fullscreen" ? "true" : "false");
      if (mode !== "fullscreen") {
        expect(document.querySelector(".fui-DialogSurface__backdrop")).toBeNull();
        await act(async () => { outside.focus(); outside.click(); });
        expect(document.activeElement).toBe(outside);
        expect(onOpenChange).not.toHaveBeenCalled();
      }
    }
    expect(outsideClick).toHaveBeenCalledTimes(3);
    await act(async () => surface.querySelector<HTMLButtonElement>('[aria-label="Inspector help"]')!.click());
    const help = document.querySelector<HTMLElement>('.fui-PopoverSurface')!;
    expect(help).not.toBeNull();
    await act(async () => help.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onOpenChange).not.toHaveBeenCalled();
    const bubbledEscape = vi.fn();
    container.addEventListener("keydown", bubbledEscape);
    await act(async () => pre.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(bubbledEscape).not.toHaveBeenCalled();
  });

  it("ignores backdrop dismissal and stale navigation failures after switching files", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(reader.showInBook).mockReturnValue(new Promise<void>((_resolve, fail) => { reject = fail; }));
    await render(true, reader, "fullscreen");
    await act(async () => dialogMock.props.mock.lastCall?.[0].onOpenChange(
      new MouseEvent("click"), { type: "backdropClick", open: false },
    ));
    expect(onOpenChange).not.toHaveBeenCalled();
    await click("Show in book");
    expect(button("Opening passage…").getAttribute("aria-disabled")).toBe("true");
    expect(reader.restoreFocus).not.toHaveBeenCalled();
    await selectFile("two.xhtml");
    await act(async () => reject(new Error("stale failure")));
    expect(selectedPath()).toBe("two.xhtml");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(reader.restoreFocus).not.toHaveBeenCalled();
  });

  it("reports failed fullscreen navigation in the still-open popover without claiming success", async () => {
    vi.mocked(reader.showInBook).mockRejectedValue(new Error("missing"));
    await render(true, reader, "fullscreen");
    await click("Show in book");
    expect(container.querySelector("[data-inspector-view]")?.getAttribute("data-inspector-view")).toBe("popover");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("missing");
    expect(button("Show in book").disabled).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(reader.restoreFocus).not.toHaveBeenCalled();
  });

  it("hands focus to the book only after navigation succeeds while keeping Inspector open", async () => {
    let resolve!: () => void;
    vi.mocked(reader.showInBook).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    await render(true, reader, "fullscreen");
    const book = document.createElement("button");
    book.textContent = "Book passage";
    container.append(book);
    vi.mocked(reader.restoreFocus!).mockImplementation(() => book.focus());
    await act(async () => button("Show in book").focus());
    await click("Show in book");
    expect(reader.restoreFocus).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(reader.restoreFocus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(book);
    expect(container.querySelector("[data-inspector-view]")?.getAttribute("data-inspector-view")).toBe("popover");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not restore book focus for a pending Show after Inspector closes", async () => {
    let resolve!: () => void;
    vi.mocked(reader.showInBook).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    await render();
    await click("Show in book");
    await render(false);
    await act(async () => resolve());
    expect(reader.restoreFocus).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each(["same", "different"] as const)("handles a %s-element native selectionchange during pending Show", async (selectionChange) => {
    let resolve!: () => void;
    vi.mocked(reader.showInBook).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    await render();
    const pre = container.querySelector("pre")!;
    const select = (text: string) => {
      const offset = pre.textContent!.indexOf(text);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(sourceTextRange(pre, offset, offset + text.length)!);
      document.dispatchEvent(new Event("selectionchange"));
    };
    await act(async () => select("Two"));
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenCalledWith({ path: "one.xhtml", elementPath: [1, 1] });
    await act(async () => select(selectionChange === "same" ? "three" : "One"));
    await act(async () => resolve());
    expect(reader.restoreFocus).toHaveBeenCalledTimes(selectionChange === "same" ? 1 : 0);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each(["forward", "backward"] as const)("shows the paragraph, not its parent, after a whole-element %s selection", async (direction) => {
    await render();
    const pre = container.querySelector("pre")!;
    const paragraph = "<p>Two &amp; three</p>";
    const start = pre.textContent!.indexOf(paragraph);
    expect(start).toBeGreaterThan(0);
    const range = sourceTextRange(pre, start, start + paragraph.length)!;
    const selection = document.getSelection()!;
    await act(async () => {
      if (direction === "forward") selection.addRange(range);
      else selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenCalledWith({ path: "one.xhtml", elementPath: [1, 1] });
    expect(reader.restoreFocus).toHaveBeenCalledOnce();
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("<p>");
  });

  it("keeps a busy Locate focusable and handles Escape after it finishes", async () => {
    dialogMock.real = true;
    let resolve!: (location: InspectorReadingLocation) => void;
    vi.mocked(reader.locateCurrentPassage).mockReturnValue(new Promise((done) => { resolve = done; }));
    await render();
    const locate = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((entry) => entry.textContent === "Locate current passage")!;
    await act(async () => { locate.focus(); locate.click(); });
    expect(locate.getAttribute("aria-disabled")).toBe("true");
    expect(locate.disabled).toBe(false);
    expect(document.activeElement).toBe(locate);
    await act(async () => locate.click());
    expect(reader.locateCurrentPassage).toHaveBeenCalledOnce();
    await act(async () => resolve({ path: "one.xhtml", elementPath: [1, 1] }));
    expect(document.activeElement).toBe(locate);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each(["Show in book", "Find references"] as const)("retains %s focus while busy and after an error", async (label) => {
    dialogMock.real = true;
    let reject!: (error: Error) => void;
    const request = label === "Show in book" ? vi.mocked(reader.showInBook) : onFindReferences;
    request.mockReturnValue(new Promise<never>((_resolve, fail) => { reject = fail; }));
    await render();
    if (label === "Find references") {
      await act(async () => document.querySelector<HTMLButtonElement>('[data-file-path="picture.png"]')!.click());
    }
    const control = [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent === label)!;
    await act(async () => { control.focus(); control.click(); });
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.disabled).toBe(false);
    expect(document.activeElement).toBe(control);
    await act(async () => control.click());
    expect(request).toHaveBeenCalledOnce();
    await act(async () => reject(new Error("failed")));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("failed");
    expect(document.activeElement).toBe(control);
    expect(control.getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => control.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each([0, 1])("keeps path tooltip %i bounded without an overflowing decorative arrow (#181)", async (index) => {
    await render();
    const trigger = container.querySelectorAll<HTMLElement>('[aria-label="one.xhtml"]')[index]!;
    expect(trigger).toBeDefined();
    await act(async () => trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.textContent).toBe("one.xhtml");
    expect(tooltip.children).toHaveLength(0);
    expect(tooltip.style.overflowWrap).toBe("anywhere");
    expect(tooltip.style.maxWidth).toContain("360px");
    expect(trigger.getAttribute("aria-label")).toBe("one.xhtml");
  });

  it("defaults to the current chapter on every reader open, without Library linking controls", async () => {
    await render();
    expect(selectedPath()).toBe("one.xhtml");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-file-path="two.xhtml"]')!.click());
    await render(false);
    await render();
    expect(selectedPath()).toBe("one.xhtml");
    await render(false);
    await act(async () => root.render(<ControlledInspector open onOpenChange={onOpenChange} data={data}
      fileName="book.epub" onReadFile={onReadFile} onGetPreviewUrl={onGetPreviewUrl} />));
    expect(container.textContent).not.toContain("Locate current passage");
    expect(container.textContent).not.toContain("Show in book");
  });

  it("associates each selected tab with a named keyboard-focusable panel", async () => {
    await render();
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("EPUB Inspector");
    for (const tab of container.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      await act(async () => tab.click());
      const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(panel.tabIndex).toBe(0);
      if (tab.textContent?.includes("Metadata")) {
        expect(panel.querySelector('th[scope="row"]')?.textContent).toBe("File name");
        expect(panel.querySelector('th[scope="row"]')?.getAttribute("style")).not.toContain("opacity");
      }
    }
  });

  it("wraps complete metadata, identifiers and archive table values without touching raw source", async () => {
    const longValue = "LongUnbroken".repeat(100);
    const path = `${longValue}.xhtml`;
    const inspection: EpubInspectionData = {
      ...data, title: longValue, description: longValue, subjects: [longValue],
      identifiers: [{ scheme: longValue, value: longValue }],
      metaEntries: [{ key: longValue, value: longValue, refines: longValue }],
      manifest: [{ id: longValue, path, mediaType: longValue, properties: [longValue] }],
      spine: [{ path, linear: true, mediaType: longValue, properties: [longValue] }],
    };
    await act(async () => root.render(
      <ControlledInspector open onOpenChange={onOpenChange} data={inspection} fileName={`${longValue}.epub`}
        onReadFile={onReadFile} onGetPreviewUrl={onGetPreviewUrl} reader={reader} />,
    ));
    expect(container.querySelector("pre")?.style.whiteSpace).toBe("pre");
    for (const name of ["Metadata", "Spine", "Manifest"]) {
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((tab) => tab.textContent?.startsWith(name))!.click());
      const panel = container.querySelector<HTMLElement>('[role="tabpanel"] > div')!;
      expect(panel.style.overflowWrap).toBe("anywhere");
      expect(panel.style.height).toBe("100%");
      expect(panel.style.overflowY).toBe("auto");
      expect(panel.textContent).toContain(longValue);
      for (const table of panel.querySelectorAll("table")) {
        expect(table.style.tableLayout).toBe("fixed");
        expect(table.style.width).toBe("100%");
      }
      const cells = [...panel.querySelectorAll("td")];
      expect(cells.some((cell) => cell.textContent === longValue)).toBe(true);
      expect(cells.every((cell) => cell.style.overflow !== "hidden")).toBe(true);
      if (name === "Metadata") {
        const subject = [...panel.querySelectorAll("span")].find((entry) =>
          entry.textContent === longValue && entry.style.display === "inline-block")!;
        expect(subject.style.maxWidth).toBe("calc(100% - 4px)");
      }
      if (name !== "Metadata") {
        const link = [...panel.querySelectorAll("button")].find((entry) => entry.textContent === path)!;
        expect(link.style.overflowWrap).toBe("anywhere");
        expect(link.textContent).toBe(path);
      }
    }
  });

  it("exposes the current file and prevents Space activation from also scrolling source", async () => {
    await render();
    expect(container.querySelector('[data-file-path][aria-current="true"]')?.getAttribute("data-file-path")).toBe("one.xhtml");
    const link = container.querySelector<HTMLElement>('[data-nav-path="two.xhtml"]')!;
    link.focus();
    const key = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    await act(async () => link.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-file-path][aria-current="true"]')?.getAttribute("data-file-path")).toBe("two.xhtml");
    expect(container.querySelectorAll('[data-file-path][aria-current="true"]')).toHaveLength(1);
    expect(document.activeElement?.getAttribute("data-file-path")).toBe("two.xhtml");
    await act(async () => button("Back").focus());
    await click("Back");
    expect(document.activeElement?.getAttribute("role")).toBe("tab");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
  });

  it("locates from any tab, highlights the opening tag, and re-scrolls a same-file Locate", async () => {
    await render();
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.includes("Metadata"))!.click());
    await click("Locate current passage");
    expect(container.textContent).toContain("Source element selected");
    expect(CSS.highlights).toBe(highlights);
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("<p>");
    const count = scrollIntoView.mock.calls.length;
    await click("Locate current passage");
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(count);
    expect(container.textContent).toContain("Source element selected");
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenCalledWith({ path: "one.xhtml", elementPath: [1, 1] });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onShowInBook).toHaveBeenCalledOnce();
  });

  it("preserves a text-selected element across button focus and clears it on another file", async () => {
    await render();
    const pre = container.querySelector("pre")!;
    const offset = pre.textContent!.indexOf("Two");
    await act(async () => {
      pre.focus();
      document.getSelection()!.addRange(sourceTextRange(pre, offset, offset + 3)!);
      pre.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await act(async () => button("Show in book").focus());
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenCalledWith({ path: "one.xhtml", elementPath: [1, 1] });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-file-path="two.xhtml"]')!.click());
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenLastCalledWith({ path: "two.xhtml" });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-file-path="style.css"]')!.click());
    expect(button("Show in book").disabled).toBe(true);
  });

  it.each([undefined, [1, 0]])("preserves a located spine occurrence with target %j and subsequent source selection", async (elementPath) => {
    vi.mocked(reader.locateCurrentPassage).mockResolvedValue({
      path: "one.xhtml", spineIndex: 4, ...(elementPath ? { elementPath } : {}),
    });
    await render();
    await click("Locate current passage");
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenLastCalledWith({
      path: "one.xhtml", spineIndex: 4, ...(elementPath ? { elementPath } : {}),
    });
    const pre = container.querySelector("pre")!;
    const offset = pre.textContent!.indexOf("Two");
    await act(async () => {
      pre.focus();
      document.getSelection()!.addRange(sourceTextRange(pre, offset, offset + 3)!);
      pre.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenLastCalledWith({ path: "one.xhtml", spineIndex: 4, elementPath: [1, 1] });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-file-path="two.xhtml"]')!.click());
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenLastCalledWith({ path: "two.xhtml" });
  });

  it("supports keyboard caret selection without making the source editable", async () => {
    await render();
    const pre = container.querySelector("pre")!;
    const selection = document.getSelection()!;
    const offset = pre.textContent!.indexOf("Two");
    const modify = vi.fn(() => {
      const next = sourceSelectionOffset(pre, selection)! + 1;
      selection.removeAllRanges();
      selection.addRange(sourceTextRange(pre, next, next)!);
    });
    Object.defineProperty(selection, "modify", { configurable: true, value: modify });
    try {
      await act(async () => {
        pre.focus();
        selection.addRange(sourceTextRange(pre, offset, offset)!);
        pre.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });
      expect(modify).toHaveBeenCalledWith("move", "forward", "character");
      expect(pre.hasAttribute("contenteditable")).toBe(false);
      await click("Show in book");
      expect(reader.showInBook).toHaveBeenCalledWith({ path: "one.xhtml", elementPath: [1, 1] });
    } finally {
      Reflect.deleteProperty(selection, "modify");
    }
  });

  it("tracks a native selectionchange even when source does not own keyboard focus", async () => {
    await render();
    const pre = container.querySelector("pre")!;
    const offset = pre.textContent!.indexOf("Two");
    await act(async () => {
      document.getSelection()!.addRange(sourceTextRange(pre, offset, offset + 3)!);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await act(async () => button("Show in book").focus());
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenCalledWith({ path: "one.xhtml", elementPath: [1, 1] });
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("<p>");
  });

  it("uses identical LF text for formatting, mapping and highlighted DOM offsets", async () => {
    onReadFile.mockResolvedValue('<html xmlns="http://www.w3.org/1999/xhtml">\r\n<head/>\r\n<body>\r\n<p>First</p>\r\n<p>Second</p>\r\n</body>\r\n</html>');
    await render();
    await click("Locate current passage");
    const pre = container.querySelector("pre")!;
    expect(pre.textContent).not.toContain("\r");
    const range = highlights.get("ambra-inspector-source")?.ranges[0];
    expect(range?.toString()).toBe("<p>");
    const prefix = document.createRange();
    prefix.selectNodeContents(pre);
    prefix.setEnd(range!.startContainer, range!.startOffset);
    expect(prefix.toString().length).toBe(pre.textContent!.indexOf("<p>Second"));
    const offset = pre.textContent!.indexOf("Second");
    await act(async () => {
      document.getSelection()!.addRange(sourceTextRange(pre, offset, offset + 6)!);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await click("Show in book");
    expect(reader.showInBook).toHaveBeenCalledWith({ path: "one.xhtml", elementPath: [1, 1] });
  });

  it.each(["browse", "reopen"] as const)("ignores late Locate after %s", async (action) => {
    let resolve!: (location: InspectorReadingLocation) => void;
    vi.mocked(reader.locateCurrentPassage).mockReturnValue(new Promise((done) => { resolve = done; }));
    await render();
    await click("Locate current passage");
    if (action === "browse") {
      await act(async () => container.querySelector<HTMLButtonElement>('[data-file-path="two.xhtml"]')!.click());
    } else {
      await render(false);
      await render(true, { ...reader, currentPath: "two.xhtml" });
    }
    await act(async () => resolve({ path: "one.xhtml", elementPath: [1, 0] }));
    expect(selectedPath()).toBe("two.xhtml");
    expect(highlights.has("ambra-inspector-source")).toBe(false);
  });

  it.each(["browse", "reopen"] as const)("ignores a late Show completion after %s invalidates the request", async (action) => {
    let resolve!: () => void;
    vi.mocked(reader.showInBook).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    await render();
    await click("Show in book");
    if (action === "browse") {
      await act(async () => container.querySelector<HTMLButtonElement>('[data-file-path="two.xhtml"]')!.click());
    } else {
      await render(false);
      await render(true, { ...reader, currentPath: "two.xhtml" });
    }
    await act(async () => resolve());
    expect(selectedPath()).toBe("two.xhtml");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(reader.restoreFocus).not.toHaveBeenCalled();
  });

  it("reports navigation failures without closing and source mapping failures without a wrong highlight", async () => {
    vi.mocked(reader.showInBook).mockRejectedValue(new Error("missing"));
    await render();
    await click("Show in book");
    expect(container.textContent).toContain("Could not open this location");
    expect(onOpenChange).not.toHaveBeenCalled();
    vi.mocked(reader.locateCurrentPassage).mockRejectedValueOnce(new Error("missing"));
    await click("Locate current passage");
    expect(container.textContent).toContain("Could not locate");
    vi.mocked(reader.locateCurrentPassage).mockResolvedValue({ path: "one.xhtml", elementPath: [9] });
    await click("Locate current passage");
    expect(container.textContent).toContain("could not be mapped");
    expect(highlights.has("ambra-inspector-source")).toBe(false);
    expect(button("Show in book").disabled).toBe(true);
  });

  it("shows action error details as safe text, without suggesting retries for permanent failures", async () => {
    const reason = 'Cannot navigate to <head>. <img src="bad" onerror="alert(1)">';
    vi.mocked(reader.showInBook).mockRejectedValue(new Error(reason));
    await render();
    await click("Show in book");
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe(`Could not open this location in the book. ${reason}`);
    expect(alert.querySelector("img")).toBeNull();
    expect(alert.textContent).not.toContain("Try again");
    expect(onOpenChange).not.toHaveBeenCalled();
    vi.mocked(reader.locateCurrentPassage).mockRejectedValue(new Error("The selected element is no longer available."));
    await click("Locate current passage");
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Could not locate the current passage. The selected element is no longer available.");
    vi.mocked(reader.locateCurrentPassage).mockRejectedValue(undefined);
    await click("Locate current passage");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not locate the current passage.");
  });

  it("keeps malformed source readable and only reports mapping failure when a location is requested", async () => {
    onReadFile.mockResolvedValue("<html>\r\n<p>broken &unknown;\r</html>");
    await render();
    expect(container.querySelector("pre")!.textContent).toContain("broken");
    expect(container.querySelector("pre")!.textContent).not.toContain("\r");
    expect(container.textContent).not.toContain("could not be mapped");
    await click("Locate current passage");
    expect(container.textContent).toContain("could not be mapped");
    expect(highlights.has("ambra-inspector-source")).toBe(false);
  });

  it("preserves source links and their source-location Back history", async () => {
    await render();
    await click("Locate current passage");
    const link = container.querySelector<HTMLElement>("[data-nav-path]")!;
    await act(async () => link.click());
    expect(selectedPath()).toBe("two.xhtml");
    await click("Back");
    expect(selectedPath()).toBe("one.xhtml");
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("<p>");
  });

  it("does not follow an href when a drag selection ends on its text", async () => {
    await render();
    const pre = container.querySelector("pre")!;
    const link = pre.querySelector<HTMLElement>("[data-nav-path]")!;
    const before = pre.textContent;
    await act(async () => {
      const range = document.createRange();
      range.selectNodeContents(link);
      document.getSelection()!.addRange(range);
      link.click();
    });
    expect(selectedPath()).toBe("one.xhtml");
    expect(pre.textContent).toBe(before);
    expect(document.getSelection()!.toString()).toBe('"two.xhtml"');
  });

  it("keeps source guidance in the help popover and themes Show in book", async () => {
    await render();
    expect(container.textContent).not.toContain("Click or select source text");
    expect(document.body.textContent).not.toContain("Line numbers refer to the original source");
    const themeStyle = document.createElement("span");
    themeStyle.style.background = CHROME_THEMES[DEFAULT_CHROME_THEME].accentForeground;
    expect(button("Show in book").style.background).toBe(themeStyle.style.background);
    expect(button("Show in book").style.color).toBe("#fff");
    await click("Inspector help");
    expect(document.body.textContent).toContain("Click or select source text");
    expect(document.body.textContent).toContain("Line numbers refer to the original source");
    expect(document.body.textContent).toContain("Use Tab and Enter");
  });

  it("lists image references, navigates precise markup and CSS targets, and restores results with Back", async () => {
    const css = '/* header */\r\n.picture { background: url("picture.png"); }\r\n';
    const start = css.replace(/\r\n/g, "\n").indexOf("picture.png");
    onReadFile.mockImplementation(async (path) => path === "style.css" ? css : markup);
    onFindReferences.mockResolvedValue([
      { sourcePath: "one.xhtml", kind: "markup", line: 9, snippet: "<img src='picture.png'/>", elementPath: [1, 1] },
      { sourcePath: "style.css", kind: "css", line: 2, snippet: '.picture { background: url("picture.png"); }',
        textRange: { start, end: start + "picture.png".length } },
    ]);
    await render();
    expect(container.textContent).not.toContain("Find references");
    await selectFile("picture.png");
    await click("Find references");
    expect(onFindReferences).toHaveBeenCalledWith("picture.png");
    expect(container.textContent).toContain("References (2)");
    expect(container.textContent).toContain("Original source line 9");
    expect(container.querySelector("[data-reference-source] img")).toBeNull();
    await openReference("one.xhtml");
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("<p>");
    await click("Back");
    expect(container.textContent).toContain("References (2)");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("picture.png");
    await openReference("style.css");
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("picture.png");
    expect(container.querySelector("pre")!.textContent).not.toContain("\r");
    expect(button("Show in book").disabled).toBe(true);
  });

  it("finds CSS references and highlights formatted markup in Library without reader actions", async () => {
    onFindReferences.mockResolvedValue([
      { sourcePath: "one.xhtml", kind: "markup", line: 1, snippet: '<link href="style.css"/>', elementPath: [0] },
    ]);
    await render(true, null);
    await selectFile("style.css");
    await click("Find references");
    expect(onFindReferences).toHaveBeenCalledWith("style.css");
    await openReference("one.xhtml");
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe("<head/>");
    expect(container.textContent).not.toContain("Locate current passage");
    expect(container.textContent).not.toContain("Show in book");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Source reference selected.");
  });

  it("reveals SVG source for a referring element rather than losing the target in its image preview", async () => {
    onReadFile.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><image href="picture.png"/></svg>');
    onFindReferences.mockResolvedValue([
      { sourcePath: "diagram.svg", kind: "markup", line: 1, snippet: '<image href="picture.png"/>', elementPath: [0] },
    ]);
    await render(true, null);
    await selectFile("picture.png");
    await click("Find references");
    await openReference("diagram.svg");
    expect(container.querySelector("pre")?.textContent).toContain('<image href="picture.png"/>');
    expect(highlights.get("ambra-inspector-source")?.ranges[0]?.toString()).toBe('<image href="picture.png"/>');
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens source without guessing a target when the reference has no safe mapping", async () => {
    onFindReferences.mockResolvedValue([
      { sourcePath: "one.xhtml", kind: "markup", line: 27, snippet: "<img src='picture.png'/>" },
    ]);
    await render(true, null);
    await selectFile("picture.png");
    await click("Find references");
    await openReference("one.xhtml");
    expect(container.querySelector("pre")?.textContent).toContain("<html");
    expect(highlights.has("ambra-inspector-source")).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows empty and failed reference searches, including safe failure details", async () => {
    await render();
    await selectFile("picture.png");
    await click("Find references");
    expect(container.textContent).toContain("References (0)");
    expect(container.textContent).toContain("No references found in this archive.");
    onFindReferences.mockRejectedValue(new Error("Unreadable <script>source</script>"));
    await click("Find references");
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("Could not find references. Unreadable <script>source</script>");
    expect(alert.querySelector("script")).toBeNull();
  });

  it.each(["browse", "reopen"] as const)("ignores stale reference results after %s", async (action) => {
    let resolve!: (references: readonly InspectorReference[]) => void;
    onFindReferences.mockReturnValue(new Promise((done) => { resolve = done; }));
    await render();
    await selectFile("picture.png");
    await click("Find references");
    expect(container.textContent).toContain("Finding references");
    expect(button("Find references").getAttribute("aria-disabled")).toBe("true");
    if (action === "browse") await selectFile("style.css");
    else {
      await render(false);
      await render();
    }
    await act(async () => resolve([{ sourcePath: "one.xhtml", kind: "markup", line: 1, snippet: "stale" }]));
    expect(container.textContent).not.toContain("stale");
    expect(container.textContent).not.toContain("Finding references");
    expect(container.querySelector("[data-reference-source]")).toBeNull();
  });
});
