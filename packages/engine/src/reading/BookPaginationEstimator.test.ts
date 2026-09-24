// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
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
    expect(estimator.pageIndexForCfi(0, saved)).toBeUndefined();
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
});
