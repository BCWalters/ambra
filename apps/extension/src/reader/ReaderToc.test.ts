import { readFile } from "node:fs/promises";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContentLoader, EpubContainer, LocatorResolver, NavigationDocument, NavigationList, NavPoint, PaginatedContentHost } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";
import { getTranslate } from "../i18n/translate.js";

const tocNavigation = (items: readonly NavPoint[]) =>
  new NavigationDocument(new NavigationList("toc", items), undefined, undefined);

describe("fragment-aware TOC locations (#202)", () => {
  it("labels scrubber destinations by measured section pages, not the currently displayed subsection", () => {
    const reader = Object.create(ReaderController.prototype) as ReaderController;
    const alpha = new NavPoint("Alpha", "text.xhtml", "alpha", []);
    const beta = new NavPoint("Beta", "text.xhtml", "beta", []);
    const missing = new NavPoint("Missing", "text.xhtml", "missing", []);
    Object.assign(reader, {
      translate: getTranslate("en"),
      pkg: { spine: [{ manifestItem: { path: "front.xhtml" } }, { manifestItem: { path: "text.xhtml" } }] },
      navigation: tocNavigation([beta, alpha, missing]),
      chapterLabel: () => "Currently displayed section",
      bookPagination: {
        positionFor: (spine: number, page: number) => ({ currentPage: spine === 0 ? 1 : page + 3, totalPages: 20 }),
        resolveGlobalPage: (page: number) => ({ spineIndex: page < 3 ? 0 : 1, pageIndexInItem: page - 3 }),
        pageIndexForFragment: (_spine: number, fragment: string) => new Map([["alpha", 2], ["beta", 8]]).get(fragment),
      },
    });
    expect(reader.previewSeek(0).chapterLabel).toBe("Start of book");
    expect(reader.previewSeek(4 / 20).chapterLabel).toBe("Start of book");
    expect(reader.previewSeek(5 / 20)).toEqual({
      position: { kind: "page", current: 5, total: 20 }, chapterLabel: "Alpha",
    });
    expect(reader.previewSeek(10 / 20).chapterLabel).toBe("Alpha");
    expect(reader.previewSeek(11 / 20).chapterLabel).toBe("Beta");
    expect(reader.previewSeek(1).chapterLabel).toBe("Beta");
    Object.assign(reader, { bookPagination: undefined, navigation: tocNavigation([alpha, beta]) });
    expect(reader.previewSeek(0.75)).toEqual({
      position: { kind: "chapter", current: 2, total: 2 }, chapterLabel: "Alpha",
    });
    Object.assign(reader, { navigation: tocNavigation([]) });
    expect(reader.previewSeek(0.75).chapterLabel).toBe("");
  });

  it("uses the nearest CFI, not TOC array order, and retains parent sections before their children", async () => {
    const bytes = await readFile(fileURLToPath(new NodeURL("../../../../packages/engine/test/fixtures/content-loader.epub", import.meta.url)));
    const loader = await ContentLoader.create(await EpubContainer.open(new Uint8Array(bytes)));
    const pkg = loader.packageDocument;
    const document = globalThis.document.implementation.createHTMLDocument();
    document.body.innerHTML = '<div id="alpha"><h2>Alpha</h2><p>Opening.</p><h3 id="detail">Detail</h3><p>More.</p></div><h2 id="beta">Beta</h2>';
    const path = pkg.spine[0]!.manifestItem.path;
    const alpha = new NavPoint("Alpha", path, "alpha", []);
    const detail = new NavPoint("Detail", path, "detail", []);
    const beta = new NavPoint("Beta", path, "beta", []);
    const missing = new NavPoint("Missing", path, "missing", []);
    const reader = Object.create(ReaderController.prototype) as ReaderController;
    let node: Node = document.querySelector("p")!.firstChild!;
    Object.assign(reader, {
      translate: getTranslate("en"),
      pkg, spineIndex: 0, locatorResolver: new LocatorResolver(pkg, loader),
      navigation: tocNavigation([beta, alpha, detail, missing]),
      tocLocations: new WeakMap(),
      nativeReading: { current: () => undefined },
      contentDocumentViews: () => [{ document, spineIndex: 0, page: { startBreak: { node, offset: 0 } } }],
    });
    const label = () => reader["chapterLabel"](0);
    expect(label()).toBe("Alpha");
    node = document.getElementById("detail")!;
    expect(label()).toBe("Detail");
    expect(reader["tocHighlightPath"]()).toBe(`${path}#detail`);
    node = document.getElementById("beta")!.firstChild!;
    expect(label()).toBe("Beta");
    node = document.body;
    expect(label()).toBe("Start of book");
    Object.assign(reader, { translate: getTranslate("fr") });
    expect(label()).toBe(getTranslate("fr")("toc.startOfBook"));
    Object.assign(reader, { navigation: tocNavigation([]) });
    expect(label()).toBe("");
    const frame = globalThis.document.createElement("iframe");
    Object.assign(reader, { host: { element: frame } });
    reader["updateContentTitle"]();
    expect(frame.title).toBe(pkg.metadata.title);
  });

  it("maps temporary fragment-anchored pages back to natural whole-book numbering", () => {
    const reader = Object.create(ReaderController.prototype) as ReaderController;
    const host = Object.create(PaginatedContentHost.prototype) as PaginatedContentHost;
    const node = document.createTextNode("Section");
    Object.assign(host, { pageIndex: 8, currentPosition: () => ({ node, offset: 0 }) });
    Object.assign(reader, {
      host, spineIndex: 1,
      locatorResolver: { generateBoundary: () => ({ cfi: "current-position" }) },
      bookPagination: {
        pageIndexForCfi: (spine: number, cfi: string) => spine === 1 && cfi === "current-position" ? 7 : undefined,
        positionFor: (_spine: number, index: number) => ({ currentPage: index + 2, totalPages: 20 }),
      },
    });
    expect(reader["bookWidePagePosition"]()).toEqual({ bookPageIndex: 9, bookPageCount: 20 });
  });
});
