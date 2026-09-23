import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContentLoader,
  EpubContainer,
  Locator,
  LocatorResolver,
  type ContentDocumentView,
  type DomBreakPoint,
} from "@ambra/engine";
import { InspectorReadingBridge } from "./InspectorReadingBridge.js";

afterEach(() => vi.restoreAllMocks());

async function loadFixture(name = "minimal.epub", source: "engine" | "e2e" = "engine") {
  // Keep Node-only fixture I/O out of the extension's browser TypeScript types.
  const { readFile } = await vi.importActual<{ readFile(path: string): Promise<Uint8Array> }>(
    "node:fs/promises",
  );
  const { fileURLToPath, URL: NodeURL } = await vi.importActual<{
    fileURLToPath(url: string): string;
    URL: new (url: string, base: string) => { href: string };
  }>("node:url");
  const directory =
    source === "engine" ? "../../../../packages/engine/test/fixtures" : "../../../e2e/fixtures";
  const bytes = await readFile(
    fileURLToPath(new NodeURL(`${directory}/${name}`, import.meta.url).href),
  );
  const container = await EpubContainer.open(new Uint8Array(bytes));
  return ContentLoader.create(container);
}

function view(
  document: Document,
  spineIndex = 0,
  physicalSide: ContentDocumentView["physicalSide"] = "single",
): ContentDocumentView {
  return { document, spineIndex, physicalSide };
}

function harness(loader: ContentLoader, views: ContentDocumentView[], position?: DomBreakPoint) {
  const state = { views, position, disposed: false };
  const resolver = new LocatorResolver(loader.packageDocument, loader);
  const navigate = vi
    .fn<(spineIndex: number, cfi?: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const focus = vi.fn<(document: Document, element: Element) => void>();
  const owner = new InspectorReadingBridge(loader, resolver, loader.packageDocument, {
    documents: () => state.views,
    currentPosition: () => state.position,
    navigate,
    focus,
    isDisposed: () => state.disposed,
  });
  return { state, resolver, navigate, focus, owner };
}

function selectionAt(document: Document, node: Node, offset: number) {
  // happy-dom does not implement selections reliably on DOMParser documents.
  // Only this browser boundary is stubbed; nodes, archive loading and CFIs are real.
  return vi.spyOn(document, "getSelection").mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({ startContainer: node, startOffset: offset }),
  } as unknown as Selection);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("InspectorReadingBridge locating the live passage", () => {
  it("resolves a visible text position against the original source without requiring IDs", async () => {
    const loader = await loadFixture();
    const content = await loader.loadSpineDocument(0);
    const paragraph = content.document.querySelector("p")!;
    expect(paragraph.id).toBe("");
    const { owner, resolver } = harness(loader, [view(content.document)], {
      node: paragraph.firstChild!,
      offset: 17,
    });
    const resolve = vi.spyOn(resolver, "resolveInDocument");
    const bridge = owner.create();
    expect(bridge.currentPath).toBe("OEBPS/chapter1.xhtml");
    await expect(bridge.locateCurrentPassage()).resolves.toEqual({
      path: "OEBPS/chapter1.xhtml",
      spineIndex: 0,
      elementPath: [1, 1],
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0]![2]).not.toBe(content.document);
  });

  it("captures the selection before modal focus clears it and the visible position changes", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const heading = document.querySelector("h1")!;
    const paragraph = document.querySelector("p")!;
    const selection = selectionAt(document, paragraph.firstChild!, 13);
    const { owner, state } = harness(loader, [view(document)], {
      node: heading.firstChild!,
      offset: 0,
    });
    const bridge = owner.create();
    selection.mockReturnValue(null);
    state.position = { node: document.body, offset: 0 };
    await expect(bridge.locateCurrentPassage()).resolves.toMatchObject({ elementPath: [1, 1] });
    await expect(bridge.locateCurrentPassage()).resolves.toMatchObject({ elementPath: [1, 1] });
    expect(selection).toHaveBeenCalledOnce();
  });

  it("maps an element-boundary selection to the selected child", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const paragraph = document.querySelector("p")!;
    const childOffset = Array.from(document.body.childNodes).indexOf(paragraph);
    selectionAt(document, document.body, childOffset);
    const bridge = harness(loader, [view(document)]).owner.create();
    await expect(bridge.locateCurrentPassage()).resolves.toMatchObject({ elementPath: [1, 1] });
  });

  it("reads the current visible position at Locate time when no selection was captured", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const { owner, state } = harness(loader, [view(document)], {
      node: document.querySelector("h1")!,
    });
    const bridge = owner.create();
    state.position = { node: document.querySelector("p")!.firstChild!, offset: 5 };
    await expect(bridge.locateCurrentPassage()).resolves.toMatchObject({ elementPath: [1, 1] });
  });

  it("ignores collapsed selections and uses the visible passage", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    vi.spyOn(document, "getSelection").mockReturnValue({
      isCollapsed: true,
      rangeCount: 1,
    } as Selection);
    const bridge = harness(loader, [view(document)], {
      node: document.querySelector("p")!,
    }).owner.create();
    await expect(bridge.locateCurrentPassage()).resolves.toMatchObject({ elementPath: [1, 1] });
  });

  it("uses the second fixed-spread document's ownership rather than the primary document", async () => {
    const loader = await loadFixture("fxl-spread-ltr.epub", "e2e");
    const left = await loader.loadSpineDocument(1);
    const right = await loader.loadSpineDocument(2);
    const bridge = harness(
      loader,
      [view(left.document, 1, "left"), view(right.document, 2, "right")],
      {
        node: right.document.querySelector("h1")!.firstChild!,
        offset: 1,
      },
    ).owner.create();
    expect(bridge.currentPath).toBe("OEBPS/p2.xhtml");
    await expect(bridge.locateCurrentPassage()).resolves.toEqual({
      path: "OEBPS/p2.xhtml",
      spineIndex: 2,
      elementPath: [1, 0],
    });
  });

  it("prefers a selection in the second spread document over the primary visible position", async () => {
    const loader = await loadFixture("fxl-spread-ltr.epub", "e2e");
    const left = await loader.loadSpineDocument(1);
    const right = await loader.loadSpineDocument(2);
    selectionAt(right.document, right.document.querySelector("h1")!.firstChild!, 0);
    const bridge = harness(
      loader,
      [view(left.document, 1, "left"), view(right.document, 2, "right")],
      {
        node: left.document.querySelector("h1")!,
      },
    ).owner.create();
    expect(bridge.currentPath).toBe("OEBPS/p2.xhtml");
    await expect(bridge.locateCurrentPassage()).resolves.toMatchObject({
      spineIndex: 2,
      elementPath: [1, 0],
    });
  });

  it("uses the first document body when no page position is available", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const bridge = harness(loader, [view(document)]).owner.create();
    await expect(bridge.locateCurrentPassage()).resolves.toMatchObject({ elementPath: [1] });
  });

  it("reports unavailable positions without guessing a different document", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const other = await loader.loadSpineDocument(0);
    const bridge = harness(loader, [view(document)], { node: other.document.body }).owner.create();
    expect(bridge.currentPath).toBeUndefined();
    await expect(bridge.locateCurrentPassage()).rejects.toThrow(/readable position/);
    const empty = harness(loader, []).owner.create();
    expect(empty.currentPath).toBeUndefined();
    await expect(empty.locateCurrentPassage()).rejects.toThrow(/readable position/);
  });
});

describe("InspectorReadingBridge showing source in the book", () => {
  it("navigates an idless source element with its canonical CFI", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const paragraph = document.querySelector("p")!;
    const { owner, resolver, navigate } = harness(loader, [view(document)]);
    const expectedCfi = resolver.generate(0, paragraph).cfi;
    await owner.create().showInBook({ path: "OEBPS/chapter1.xhtml", elementPath: [1, 1] });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(0, expectedCfi);
    const resolved = await resolver.resolve(new Locator(expectedCfi));
    expect(resolved.spineIndex).toBe(0);
    expect(resolved.node.textContent).toBe(paragraph.textContent);
    expect((resolved.node as Element).localName).toBe("p");
  });

  it.each([undefined, []])(
    "navigates a whole file or document root to the file start: %s",
    async (elementPath) => {
      const loader = await loadFixture("two-chapter.epub", "e2e");
      const { document } = await loader.loadSpineDocument(0);
      const { owner, navigate } = harness(loader, [view(document)]);
      await owner.create().showInBook({ path: "OEBPS/ch2.xhtml", elementPath });
      expect(navigate).toHaveBeenCalledExactlyOnceWith(1, undefined);
    },
  );

  it("uses actual file ownership when a supplied spine hint names another file", async () => {
    const loader = await loadFixture("two-chapter.epub", "e2e");
    const { document } = await loader.loadSpineDocument(0);
    const { owner, navigate, resolver } = harness(loader, [view(document)]);
    await owner
      .create()
      .showInBook({ path: "OEBPS/ch2.xhtml", spineIndex: 0, elementPath: [1, 1] });
    expect(navigate).toHaveBeenCalledOnce();
    const [spineIndex, cfi] = navigate.mock.calls[0]!;
    expect(spineIndex).toBe(1);
    const resolved = await resolver.resolve(new Locator(cfi!));
    expect(resolved.spineIndex).toBe(1);
    expect(resolved.node.textContent).toContain("C2Para 1.");
  });

  it.each([[0], [0, 0]])("rejects head elements at path %s", async (...elementPath) => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const { owner, navigate } = harness(loader, [view(document)]);
    await expect(
      owner.create().showInBook({
        path: "OEBPS/chapter1.xhtml",
        elementPath,
      }),
    ).rejects.toThrow(/outside.*reading content/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    { elementPath: [-1] },
    { elementPath: [1, 999] },
    { elementPath: [1, 0.5] },
    { elementPath: [Number.NaN] },
    { elementPath: [Infinity] },
    { elementPath: [1, 1, 0] },
  ])("rejects nonexistent or invalid element paths: $elementPath", async ({ elementPath }) => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const { owner, navigate } = harness(loader, [view(document)]);
    await expect(
      owner.create().showInBook({
        path: "OEBPS/chapter1.xhtml",
        elementPath,
      }),
    ).rejects.toThrow(/no longer exists/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    "OEBPS/nav.xhtml",
    "OEBPS/content.opf",
    "missing.xhtml",
    "OEBPS/chapter1.xhtml#fragment",
  ])("rejects nonspine or noncanonical file %s", async (path) => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const { owner, navigate } = harness(loader, [view(document)]);
    const bridge = owner.create();
    expect(bridge.canShowInBook(path)).toBe(false);
    expect(bridge.canShowInBook("OEBPS/chapter1.xhtml")).toBe(true);
    await expect(bridge.showInBook({ path })).rejects.toThrow(/not a readable spine document/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("uses the supported fallback's actual source path and original spine CFI identity", async () => {
    const loader = await loadFixture("manifest-fallback.epub");
    const content = await loader.loadSpineDocument(0);
    const { owner, navigate, resolver } = harness(loader, [view(content.document)], {
      node: content.document.querySelector("p")!.firstChild!,
      offset: 8,
    });
    const bridge = owner.create();
    expect(loader.packageDocument.spine[0]!.manifestItem.path).toBe("OEBPS/ch1.pdf");
    expect(bridge.currentPath).toBe("OEBPS/ch1.xhtml");
    expect(bridge.canShowInBook("OEBPS/ch1.pdf")).toBe(false);
    expect(bridge.canShowInBook("OEBPS/ch1.xhtml")).toBe(true);
    const location = await bridge.locateCurrentPassage();
    expect(location).toEqual({ path: "OEBPS/ch1.xhtml", spineIndex: 0, elementPath: [1, 0] });
    await bridge.showInBook(location);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      0,
      resolver.generate(0, content.document.querySelector("p")!).cfi,
    );
  });
});

describe("InspectorReadingBridge navigation and session lifetime", () => {
  it.each(["locate", "show"] as const)(
    "rejects %s if the session closes while source is loading",
    async (action) => {
      const loader = await loadFixture();
      const content = await loader.loadSpineDocument(0);
      const { owner, state, navigate, focus } = harness(loader, [view(content.document)]);
      const bridge = owner.create();
      const loading = deferred<typeof content>();
      vi.spyOn(loader, "loadSpineDocument").mockReturnValue(loading.promise);
      const pending =
        action === "locate"
          ? bridge.locateCurrentPassage()
          : bridge.showInBook({ path: "OEBPS/chapter1.xhtml", elementPath: [1, 1] });
      const rejection = expect(pending).rejects.toThrow(/session has been closed/);
      state.disposed = true;
      loading.resolve(content);
      await rejection;
      bridge.restoreFocus?.();
      expect(navigate).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it("does not load or navigate after the session has already closed", async () => {
    const loader = await loadFixture();
    const content = await loader.loadSpineDocument(0);
    const { owner, state, navigate } = harness(loader, [view(content.document)]);
    const bridge = owner.create();
    const load = vi.spyOn(loader, "loadSpineDocument");
    state.disposed = true;
    await expect(bridge.showInBook({ path: "OEBPS/chapter1.xhtml" })).rejects.toThrow(/closed/);
    expect(load).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("restores focus only after navigation, resolving against the newly rendered destination document", async () => {
    const loader = await loadFixture("two-chapter.epub", "e2e");
    const initial = await loader.loadSpineDocument(0);
    const destination = await loader.loadSpineDocument(1);
    const { owner, state, navigate, focus } = harness(loader, [view(initial.document)]);
    const navigation = deferred<void>();
    navigate.mockReturnValue(navigation.promise);
    const bridge = owner.create();
    const showing = bridge.showInBook({ path: "OEBPS/ch2.xhtml", elementPath: [1, 2] });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    bridge.restoreFocus?.();
    expect(focus).not.toHaveBeenCalled();
    state.views = [view(destination.document, 1)];
    navigation.resolve(undefined);
    await showing;
    expect(focus).not.toHaveBeenCalled();
    bridge.restoreFocus?.();
    expect(focus).toHaveBeenCalledExactlyOnceWith(
      destination.document,
      destination.document.querySelectorAll("p")[1],
    );
  });

  it("restores file-start focus to the destination body, including the second spread document", async () => {
    const loader = await loadFixture("fxl-spread-ltr.epub", "e2e");
    const left = await loader.loadSpineDocument(1);
    const right = await loader.loadSpineDocument(2);
    const { owner, focus } = harness(loader, [
      view(left.document, 1, "left"),
      view(right.document, 2, "right"),
    ]);
    const bridge = owner.create();
    await bridge.showInBook({ path: "OEBPS/p2.xhtml" });
    bridge.restoreFocus?.();
    expect(focus).toHaveBeenCalledExactlyOnceWith(right.document, right.document.body);
  });

  it("does not restore focus when navigation fails", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const { owner, navigate, focus } = harness(loader, [view(document)]);
    navigate.mockRejectedValue(new Error("Navigation failed"));
    const bridge = owner.create();
    await expect(bridge.showInBook({ path: "OEBPS/chapter1.xhtml" })).rejects.toThrow(
      "Navigation failed",
    );
    bridge.restoreFocus?.();
    expect(focus).not.toHaveBeenCalled();
  });

  it("does not restore focus after disposal or when the destination is no longer rendered", async () => {
    const loader = await loadFixture();
    const { document } = await loader.loadSpineDocument(0);
    const { owner, state, focus } = harness(loader, [view(document)]);
    const bridge = owner.create();
    await bridge.showInBook({ path: "OEBPS/chapter1.xhtml", elementPath: [1, 1] });
    state.disposed = true;
    bridge.restoreFocus?.();
    expect(focus).not.toHaveBeenCalled();
    state.disposed = false;
    state.views = [];
    bridge.restoreFocus?.();
    expect(focus).not.toHaveBeenCalled();
  });
});
