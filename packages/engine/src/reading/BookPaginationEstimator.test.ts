// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
import { SpineItemRef } from "../container/PackageDocument.js";
import { LocatorResolver } from "../locator/Locator.js";
import { Page } from "../layout/Page.js";
import { ReadingTheme } from "../rendering/ReadingTheme.js";
import { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { BookPaginationEstimator } from "./BookPaginationEstimator.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";

describe("book-wide CFI page index", () => {
  let estimator: BookPaginationEstimator;
  let container: HTMLDivElement;
  let locators: LocatorResolver;
  let resources: ResourceUrlResolver;
  let loader: ContentLoader;
  let offsets: number[];
  let nodes: Map<number, Text>;

  beforeEach(async () => {
    const bytes = await readFile(fileURLToPath(
      new NodeURL("../../test/fixtures/content-loader.epub", import.meta.url),
    ));
    loader = await ContentLoader.create(await EpubContainer.open(new Uint8Array(bytes)));
    resources = new ResourceUrlResolver(loader);
    locators = new LocatorResolver(loader.packageDocument, loader);
    container = document.createElement("div");
    estimator = new BookPaginationEstimator(
      loader, resources, loader.packageDocument.spine,
      loader.packageDocument.metadata.renditionLayout, container, undefined, locators,
    );
    offsets = [0, 10, 20];
    nodes = new Map();
    vi.spyOn(PaginatedContentHost.prototype, "open").mockImplementation(async function (
      this: PaginatedContentHost,
      _loader, _resources, spineIndex,
    ) {
      const doc = document.implementation.createHTMLDocument();
      const text = doc.createTextNode("A sufficiently long paragraph for three measured pages.");
      doc.body.append(text);
      nodes.set(spineIndex, text);
      Object.defineProperty(this.element, "contentDocument", { value: doc });
      Reflect.set(this, "pages", offsets.map((offset, index) =>
        new Page(index, { node: text, offset }, {
          node: text, offset: offsets[index + 1] ?? text.length,
        }, index * 100, 100),
      ));
    });
  });

  afterEach(() => {
    estimator?.dispose();
    resources?.dispose();
    container?.remove();
    vi.restoreAllMocks();
  });

  function run(width = 600) {
    return estimator.run(
      0, width, 900, 1, ReadingTheme.DEFAULT_FONT_FAMILY,
      ReadingTheme.DEFAULT_LINE_SPACING, ReadingTheme.DEFAULT_LETTER_SPACING,
      ReadingTheme.DEFAULT_CONTENT_WIDTH_EM, () => {},
    );
  }

  function cfi(offset: number) {
    return locators.generate(0, nodes.get(0)!, offset).cfi;
  }

  it("knows every fixed-layout page immediately, including overrides and after invalidation", async () => {
    for (const item of loader.packageDocument.spine) {
      vi.spyOn(item, "resolveRenditionLayout").mockReturnValue("pre-paginated");
    }
    estimator.dispose();
    estimator = new BookPaginationEstimator(
      loader, resources, loader.packageDocument.spine, "reflowable", container,
    );
    const count = loader.packageDocument.spine.length;
    expect(estimator.positionFor(count - 1, 0)).toMatchObject({ currentPage: count, totalPages: count });
    expect(estimator.resolveGlobalPage(count)).toEqual({ spineIndex: count - 1, pageIndexInItem: 0 });
    expect(estimator.pageIndexForCfi(0, "unused")).toBe(0);
    estimator.invalidateSpineItem(0);
    expect(estimator.positionFor(0, 0).totalPages).toBe(count);
    await run();
    await run(900);
    expect(PaginatedContentHost.prototype.open).not.toHaveBeenCalled();
    expect(estimator.positionFor(0, 0).totalPages).toBe(count);
    expect(container.children).toHaveLength(0);
  });

  it("seeds only fixed items in mixed books and still measures reflowable items", async () => {
    const reflowable = loader.packageDocument.spine[0]!;
    const fixed = new SpineItemRef(
      reflowable.manifestItem, true, new Set(["rendition:layout-pre-paginated"]), [],
    );
    estimator.dispose();
    estimator = new BookPaginationEstimator(
      loader, resources, [fixed, reflowable], "reflowable", container,
    );
    expect(estimator.positionFor(0, 0)).toMatchObject({ currentPage: 1, totalPages: undefined });
    await run();
    expect(vi.mocked(PaginatedContentHost.prototype.open).mock.calls.every(call => call[2] !== 0)).toBe(true);
    expect(estimator.positionFor(0, 0).totalPages).toBe(4);
  });

  it("maps exact boundaries and intervening positions after disposing measurement hosts", async () => {
    expect(estimator.pageIndexForCfi(0, "unused")).toBeUndefined();
    await run();
    expect(container.children).toHaveLength(0);
    expect(estimator.pageIndexForCfi(0, cfi(0))).toBe(0);
    expect(estimator.pageIndexForCfi(0, cfi(9))).toBe(0);
    expect(estimator.pageIndexForCfi(0, cfi(10))).toBe(1);
    expect(estimator.pageIndexForCfi(0, cfi(19))).toBe(1);
    expect(estimator.pageIndexForCfi(0, cfi(20))).toBe(2);
    expect(estimator.pageIndexForCfi(0, cfi(40))).toBe(2);
    expect(estimator.pageIndexForCfi(99, cfi(10))).toBeUndefined();
  });

  it("reuses the cached index for unchanged layout and replaces it after resize", async () => {
    await run();
    const saved = cfi(15);
    expect(estimator.pageIndexForCfi(0, saved)).toBe(1);
    const opens = vi.mocked(PaginatedContentHost.prototype.open).mock.calls.length;
    await run();
    expect(PaginatedContentHost.prototype.open).toHaveBeenCalledTimes(opens);
    offsets = [0, 20];
    const resizing = run(900);
    expect(estimator.pageIndexForCfi(0, saved)).toBeUndefined();
    await resizing;
    expect(estimator.pageIndexForCfi(0, saved)).toBe(0);
  });

  it("preserves completed counts and CFIs when paused and skips them on resume", async () => {
    await run();
    const saved = cfi(15);
    const position = estimator.positionFor(0, 0);
    const openCount = vi.mocked(PaginatedContentHost.prototype.open).mock.calls.length;
    estimator.cancelPendingMeasurement();
    expect(estimator.positionFor(0, 0)).toEqual(position);
    expect(estimator.pageIndexForCfi(0, saved)).toBe(1);
    await run();
    expect(PaginatedContentHost.prototype.open).toHaveBeenCalledTimes(openCount);
  });

  it("rejects unexpected measurement failures instead of treating them as cancellation", async () => {
    const error = new Error("Unexpected measurement failure");
    vi.mocked(PaginatedContentHost.prototype.open).mockRejectedValueOnce(error);
    await expect(run()).rejects.toBe(error);
    expect(container.children).toHaveLength(0);
  });

  it("invalidates chapter CFIs alongside page counts when disclosure layout changes", async () => {
    await run();
    const saved = cfi(15);
    estimator.invalidateSpineItem(0);
    expect(estimator.pageIndexForCfi(0, saved)).toBeUndefined();
    await run();
    expect(estimator.pageIndexForCfi(0, saved)).toBe(1);
  });

  it("maps a fixed-layout spine item to its sole page without measuring a DOM", async () => {
    estimator.dispose();
    estimator = new BookPaginationEstimator(
      loader, resources, loader.packageDocument.spine, "pre-paginated",
      container, undefined, locators,
    );
    const content = document.implementation.createHTMLDocument();
    const saved = locators.generate(0, content.documentElement).cfi;
    expect(estimator.pageIndexForCfi(0, saved)).toBe(0);
    await run();
    expect(estimator.pageIndexForCfi(0, saved)).toBe(0);
    expect(PaginatedContentHost.prototype.open).not.toHaveBeenCalled();
  });

  it("does not publish page boundaries from a superseded measurement", async () => {
    const open = vi.mocked(PaginatedContentHost.prototype.open);
    const implementation = open.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    open.mockImplementationOnce(async function (this: PaginatedContentHost, ...args) {
      await gate;
      return implementation.apply(this, args);
    });
    const stale = run();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    offsets = [0, 20];
    await run(900);
    const saved = cfi(15);
    offsets = [0, 10, 20];
    release();
    await stale;
    expect(estimator.pageIndexForCfi(0, saved)).toBe(0);
  });

  it("checks cancellation after yielding, before opening any chapter", async () => {
    const pending = run();
    estimator.dispose();
    await pending;
    expect(PaginatedContentHost.prototype.open).not.toHaveBeenCalled();
    expect(container.children).toHaveLength(0);
  });

  it("applies typography before the only measurement and opts into cancellable work", async () => {
    const relayout = vi.spyOn(PaginatedContentHost.prototype, "relayout");
    await estimator.run(0, 600, 900, 1.25, "georgia", 1.8, 0.1, 32, () => {});
    const args = vi.mocked(PaginatedContentHost.prototype.open).mock.calls[0]!;
    const configure = args[4]!;
    const doc = document.implementation.createHTMLDocument();
    const fontScale = vi.spyOn(ReadingTheme, "applyFontScale");
    configure(doc);
    expect(fontScale).toHaveBeenCalledWith(doc, 1.25);
    expect(args[5]?.signal).toBeInstanceOf(AbortSignal);
    expect(relayout).not.toHaveBeenCalled();
  });

  it.each(["dispose", "cancelPendingMeasurement"] as const)(
    "%s releases an in-flight host immediately without publishing progress", async stop => {
    const open = vi.mocked(PaginatedContentHost.prototype.open);
    let release!: () => void;
    open.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const progress = vi.fn();
    const pending = estimator.run(
      0, 600, 900, 1, ReadingTheme.DEFAULT_FONT_FAMILY,
      ReadingTheme.DEFAULT_LINE_SPACING, ReadingTheme.DEFAULT_LETTER_SPACING,
      ReadingTheme.DEFAULT_CONTENT_WIDTH_EM, progress,
    );
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    expect(container.children).toHaveLength(1);
    estimator[stop]();
    expect(container.children).toHaveLength(0);
    expect(open.mock.calls[0]![5]?.signal?.aborted).toBe(true);
    release();
    await pending;
    expect(progress).not.toHaveBeenCalled();
    if (stop === "cancelPendingMeasurement") {
      await run();
      expect(estimator.positionFor(0, 0).totalPages).toBe(3);
    }
  });
});
