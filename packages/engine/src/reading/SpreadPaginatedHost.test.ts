// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { Page } from "../layout/Page.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";
import { SpreadPaginatedHost } from "./SpreadPaginatedHost.js";

afterEach(() => vi.restoreAllMocks());

async function resizeFixture(crossChapter = false, paired = true) {
  vi.spyOn(PaginatedContentHost.prototype, "open").mockImplementation(async function (this: PaginatedContentHost) {
    const doc = document.implementation.createHTMLDocument();
    doc.body.textContent = "Original page text.";
    Object.defineProperty(this.element, "contentDocument", { configurable: true, value: doc });
    Reflect.set(this, "pages", Array.from({ length: 6 }, (_, index) =>
      new Page(index, { node: doc.body }, { node: doc.body, offset: 1 }, index * 600, (index + 1) * 600)));
  });
  const host = new SpreadPaginatedHost(1400, 900);
  await host.openSpread({} as ContentLoader, {} as ResourceUrlResolver, {
    first: { spineIndex: 0, pageIndex: crossChapter || !paired ? 5 : 2 },
    ...(paired ? { second: { spineIndex: crossChapter ? 1 : 0, pageIndex: crossChapter ? 0 : 3 } } : {}),
  });
  const first = Reflect.get(host, "first") as PaginatedContentHost;
  const second = Reflect.get(host, "second") as PaginatedContentHost;
  const reflow = vi.spyOn(PaginatedContentHost.prototype, "relayout").mockImplementation(() => {});
  return { host, first, second, reflow };
}

describe("in-place spread resize", () => {
  it.each([false, true])("keeps the same documents and adjacent positions across a boundary=%s", async crossChapter => {
    const { host } = await resizeFixture(crossChapter);
    const docs = host.contentDocuments();
    const positions = host.positions;
    expect(host.relayoutForResize(1300, 950)).toBe(true);
    expect(host.contentDocuments()).toEqual(docs);
    expect(host.positions).toEqual(positions);
    expect(host.element.style.height).toBe("950px");
    host.dispose();
  });

  it("keeps a native reading anchor in its existing second-column document", async () => {
    const { host, first, second, reflow } = await resizeFixture();
    const anchor = { node: second.element.contentDocument!.body.firstChild!, offset: 4 };
    reflow.mockImplementation(function (this: PaginatedContentHost, _width, _height, position) {
      if (this === second && position === anchor) this.goToPageIndex(4);
    });
    expect(host.relayoutForResize(1250, 900, anchor)).toBe(true);
    expect(reflow).toHaveBeenCalledWith(605, 900, anchor, false);
    expect(first.currentPageIndex).toBe(3);
    expect(second.currentPageIndex).toBe(4);
    host.dispose();
  });

  it.each(["missing-companion", "new-chapter-tail", "anchor-before-first"] as const)(
    "rolls back an unsafe %s pairing for the owned load path", async reason => {
      const { host, first, second, reflow } = await resizeFixture(reason === "new-chapter-tail", reason !== "missing-companion");
      const before = host.positions;
      const docs = host.contentDocuments();
      const anchor = reason === "anchor-before-first"
        ? { node: second.element.contentDocument!.body, offset: 0 } : undefined;
      reflow.mockImplementation(function (this: PaginatedContentHost, width) {
        if (width !== 630) return;
        if (reason === "anchor-before-first" && this === second) this.goToPageIndex(0);
        if (reason !== "anchor-before-first" && this === first) this.goToPageIndex(3);
      });
      expect(host.relayoutForResize(1300, 950, anchor)).toBe(false);
      expect(host.positions).toEqual(before);
      expect(first.currentPageIndex).toBe(before.first.pageIndex);
      if (before.second) expect(second.currentPageIndex).toBe(before.second.pageIndex);
      expect(host.element.style.height).toBe("900px");
      expect(host.contentDocuments()).toEqual(docs);
      expect(reflow).toHaveBeenCalledWith(680, 900, undefined, false);
      host.dispose();
    },
  );

  it("retains a genuinely unpaired final page without loading a hidden document", async () => {
    const { host, reflow } = await resizeFixture(false, false);
    expect(host.relayoutForResize(1300, 950)).toBe(true);
    expect(reflow).toHaveBeenCalledTimes(1);
    expect(host.positions.second).toBeUndefined();
    host.dispose();
  });
});

describe("reflowable document ownership", () => {
  it.each(["ltr", "rtl"] as const)("keeps explicit spine identities in reading order under %s", async direction => {
    vi.spyOn(PaginatedContentHost.prototype, "open").mockImplementation(async function (this: PaginatedContentHost, _loader, _resolver, spineIndex) {
      const doc = document.implementation.createHTMLDocument(String(spineIndex));
      doc.title = String(spineIndex);
      doc.body.textContent = "A page";
      Object.defineProperty(this.element, "contentDocument", { configurable: true, value: doc });
    });
    vi.spyOn(PaginatedContentHost.prototype, "pageCount", "get").mockReturnValue(20);
    vi.spyOn(PaginatedContentHost.prototype, "goToPageIndex").mockImplementation(() => {});
    vi.spyOn(PaginatedContentHost.prototype, "currentPageAndDocument").mockImplementation(function (this: PaginatedContentHost) {
      const doc = this.element.contentDocument!;
      return { document: doc, page: new Page(0, { node: doc.body }, { node: doc.body, offset: 1 }, 0, 100) };
    });
    const host = new SpreadPaginatedHost(1400, 900);
    host.setProgressionDirection(direction);
    const loader = {} as ContentLoader;
    const resolver = {} as ResourceUrlResolver;
    await host.openSpread(loader, resolver, {
      first: { spineIndex: 9, pageIndex: 4 }, second: { spineIndex: 14, pageIndex: 0 },
    });

    const views = host.documentViews();
    expect(views.map(view => [view.spineIndex, view.document.title, view.physicalSide])).toEqual([
      [9, "9", direction === "rtl" ? "right" : "left"],
      [14, "14", direction === "rtl" ? "left" : "right"],
    ]);
    expect(host.currentPagesAndDocuments().map(view => view.spineIndex)).toEqual([9, 14]);
    expect(host.primaryContentDocument()).toBe(views[1]!.document);

    await host.openSpread(loader, resolver, { first: { spineIndex: 14, pageIndex: 1 } });
    expect(host.documentViews().map(view => view.spineIndex)).toEqual([14]);
    expect(host.contentDocuments()).toHaveLength(1);
    host.dispose();
  });
});
