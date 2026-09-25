import { readFile } from "node:fs/promises";
import { URL as NodeURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ContentLoader, EpubContainer, LocatorResolver, NavPoint, PaginatedContentHost } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";

describe("fragment-aware TOC locations (#202)", () => {
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
      pkg, spineIndex: 0, locatorResolver: new LocatorResolver(pkg, loader),
      navigation: { toc: { items: [beta, alpha, detail, missing] } },
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
    expect(label()).toBe("Start of Book");
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
