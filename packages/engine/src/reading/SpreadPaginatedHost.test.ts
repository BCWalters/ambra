// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { Page } from "../layout/Page.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";
import { SpreadPaginatedHost } from "./SpreadPaginatedHost.js";

afterEach(() => vi.restoreAllMocks());

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
