import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubInspectionData, InspectorReaderBridge, InspectorReadingLocation } from "../ReaderTypes.js";
import { EpubInspectorPanel } from "./EpubInspectorPanel.js";
import { sourceSelectionOffset, sourceTextRange } from "./inspectorSourceSelection.js";

vi.mock("@fluentui/react-components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fluentui/react-components")>();
  return {
    ...actual,
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
    DialogSurface: ({ children, onKeyDown }: React.HTMLAttributes<HTMLDivElement>) => <div onKeyDown={onKeyDown}>{children}</div>,
  };
});

const data: EpubInspectionData = {
  files: ["one.xhtml", "two.xhtml", "style.css"].map((path) => ({
    path, size: 100, isDirectory: false,
    mediaType: path.endsWith("xhtml") ? "application/xhtml+xml" : "text/css",
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
  const onReadFile = vi.fn();
  const onGetPreviewUrl = vi.fn();
  const highlights = new Map<string, { ranges: Range[] }>();
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("Highlight", class { constructor(...publicRanges: Range[]) { this.ranges = publicRanges; } ranges: Range[]; });
    vi.stubGlobal("CSS", { ...CSS, highlights, escape: CSS.escape.bind(CSS) });
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(scrollIntoView);
    onOpenChange.mockReset();
    onReadFile.mockReset().mockResolvedValue(markup);
    scrollIntoView.mockClear();
    reader = {
      currentPath: "one.xhtml",
      locateCurrentPassage: vi.fn().mockResolvedValue({ path: "one.xhtml", elementPath: [1, 1] }),
      canShowInBook: (path) => path.endsWith(".xhtml"),
      showInBook: vi.fn().mockResolvedValue(undefined),
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

  async function render(open = true, bridge: InspectorReaderBridge | undefined = reader) {
    await act(async () => root.render(
      <EpubInspectorPanel open={open} onOpenChange={onOpenChange} data={data} fileName="book.epub"
        onReadFile={onReadFile} onGetPreviewUrl={onGetPreviewUrl} {...(bridge ? { reader: bridge } : {})} />,
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

  function selectedPath() {
    return container.querySelector("pre")?.getAttribute("aria-label") === "Source code"
      ? onReadFile.mock.calls.at(-1)?.[0] : undefined;
  }

  it("defaults to the current chapter on every reader open, without Library linking controls", async () => {
    await render();
    expect(selectedPath()).toBe("one.xhtml");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-file-path="two.xhtml"]')!.click());
    await render(false);
    await render();
    expect(selectedPath()).toBe("one.xhtml");
    await render(false);
    await act(async () => root.render(<EpubInspectorPanel open onOpenChange={onOpenChange} data={data}
      fileName="book.epub" onReadFile={onReadFile} onGetPreviewUrl={onGetPreviewUrl} />));
    expect(container.textContent).not.toContain("Locate current passage");
    expect(container.textContent).not.toContain("Show in book");
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
    expect(onOpenChange).toHaveBeenCalledWith(false, "show-in-book");
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

  it.each(["browse", "reopen"] as const)("does not emit the successful Show close reason after %s invalidates the request", async (action) => {
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
});
