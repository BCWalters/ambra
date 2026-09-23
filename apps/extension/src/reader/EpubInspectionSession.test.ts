import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentLoader, EpubContainer, type PackageDocument } from "@ambra/engine";
import type { Window } from "happy-dom";
import { EpubInspectionSession } from "./EpubInspectionSession.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function makeSession(readArchiveFileBytes: ContentLoader["readArchiveFileBytes"]) {
  return new EpubInspectionSession(
    { readArchiveFileBytes } as ContentLoader, {} as PackageDocument, "content.opf",
  );
}

describe("EpubInspectionSession", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  function referenceSession(files: Record<string, string>, read = vi.fn(async (path: string) => files[path]!)) {
    const loader = {
      readArchiveFileText: read,
      archiveEntries: Object.keys(files).map(fileName => ({ fileName, isDirectory: false })),
    } as unknown as ContentLoader;
    const pkg = { manifest: [] } as unknown as PackageDocument;
    return { session: new EpubInspectionSession(loader, pkg, "content.opf"), read };
  }

  describe("reference lookup", () => {
    it("finds actual image, SVG and CSS references in an existing EPUB archive", async () => {
      const { readFile } = await vi.importActual<{ readFile(path: string): Promise<Uint8Array> }>("node:fs/promises");
      const { fileURLToPath, URL: NodeURL } = await vi.importActual<{
        fileURLToPath(url: string): string;
        URL: new (url: string, base: string) => { href: string };
      }>("node:url");
      const file = new NodeURL("../../../../packages/engine/test/fixtures/content-loader.epub", import.meta.url);
      const container = await EpubContainer.open(new Uint8Array(await readFile(fileURLToPath(file.href))));
      const loader = await ContentLoader.create(container);
      const settings = (window as unknown as Window).happyDOM.settings;
      const oldLoading = settings.disableCSSFileLoading;
      const oldSuccess = settings.handleDisabledFileLoadingAsSuccess;
      settings.disableCSSFileLoading = true;
      settings.handleDisabledFileLoadingAsSuccess = true;
      try {
        // happy-dom uppercases nested SVG's localName in XHTML. Correct only
        // that test-DOM discrepancy; use the real archive, loader and parser.
        const parse = DOMParser.prototype.parseFromString;
        vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, source, type) {
          const document = parse.call(this, source, type);
          for (const element of Array.from(document.querySelectorAll("*"))) {
            if (element.namespaceURI !== "http://www.w3.org/2000/svg" || element.localName !== "SVG") continue;
            const replacement = document.createElementNS(element.namespaceURI, "svg");
            for (const attribute of Array.from(element.attributes)) replacement.setAttribute(attribute.name, attribute.value);
            while (element.firstChild) replacement.appendChild(element.firstChild);
            element.replaceWith(replacement);
          }
          return document;
        });
        const session = new EpubInspectionSession(loader, loader.packageDocument, container.rootFilePath);
        expect(await session.findReferences("OEBPS/images/photo.png")).toMatchObject([
          { sourcePath: "OEBPS/ch1.xhtml", elementPath: [1, 1], kind: "markup", line: 10 },
        ]);
        expect(await session.findReferences("OEBPS/images/diagram.png")).toMatchObject([
          { sourcePath: "OEBPS/ch1.xhtml", elementPath: [1, 2, 0], kind: "markup" },
        ]);
        expect(await session.findReferences("OEBPS/styles/main.css")).toMatchObject([
          { sourcePath: "OEBPS/ch1.xhtml", elementPath: [0, 1], kind: "markup" },
        ]);
        expect(await session.findReferences("OEBPS/fonts/font.otf")).toMatchObject([
          { sourcePath: "OEBPS/styles/main.css", kind: "css", line: 7 },
        ]);
        session.dispose();
      } finally {
        settings.disableCSSFileLoading = oldLoading;
        settings.handleDisabledFileLoadingAsSuccess = oldSuccess;
      }
    });

    it("lazily shares concurrent work and caches results across targets for the session", async () => {
      const files = {
        "OEBPS/ch.xhtml": '<root><img src="a.png"/><link href="main.css"/></root>',
        "OEBPS/main.css": "p{background:url(a.png)}",
        "OEBPS/content.opf": '<manifest><item href="a.png"/></manifest>',
        "OEBPS/a.png": "not text",
      };
      const { session, read } = referenceSession(files);
      expect(read).not.toHaveBeenCalled();
      const first = session.findReferences("OEBPS/a.png");
      expect(session.findReferences("OEBPS/a.png")).toBe(first);
      const stylesheet = session.findReferences("OEBPS/main.css");
      const references = await first;
      expect(references.map(item => item.sourcePath)).toEqual(["OEBPS/ch.xhtml", "OEBPS/main.css"]);
      expect(await stylesheet).toHaveLength(1);
      expect(session.findReferences("OEBPS/a.png")).toBe(first);
      expect(await session.findReferences("missing.png")).toEqual([]);
      expect(read.mock.calls.map(call => call[0])).toEqual(["OEBPS/ch.xhtml", "OEBPS/main.css"]);
    });

    it("indexes manifest-typed files without conventional extensions", async () => {
      const read = vi.fn().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><image href="pic.png"/></svg>');
      const loader = {
        readArchiveFileText: read,
        archiveEntries: [{ fileName: "page", isDirectory: false }],
      } as unknown as ContentLoader;
      const pkg = { manifest: [{ path: "page", mediaType: "image/svg+xml" }] } as unknown as PackageDocument;
      const session = new EpubInspectionSession(loader, pkg, "content.opf");
      expect(await session.findReferences("pic.png")).toHaveLength(1);
    });

    it("rejects lookup after disposal without reading files", async () => {
      const { session, read } = referenceSession({ "main.css": "p{background:url(a.png)}" });
      session.dispose();
      await expect(session.findReferences("a.png")).rejects.toThrow("closed");
      expect(read).not.toHaveBeenCalled();
    });

    it("rejects in-flight lookup and stops indexing when disposed during a read", async () => {
      const loading = deferred<string>();
      const read = vi.fn().mockReturnValue(loading.promise);
      const { session } = referenceSession({ "one.css": "", "two.css": "" }, read);
      const pending = session.findReferences("a.png");
      const rejection = expect(pending).rejects.toThrow("closed");
      session.dispose();
      loading.resolve("p{background:url(a.png)}");
      await rejection;
      expect(read).toHaveBeenCalledOnce();
      await expect(session.findReferences("a.png")).rejects.toThrow("closed");
    });

    it("surfaces archive-read errors with file context and allows retry", async () => {
      const read = vi.fn().mockRejectedValueOnce(new Error("ZIP read failed"))
        .mockResolvedValue("p{background:url(a.png)}");
      const { session } = referenceSession({ "main.css": "" }, read);
      await expect(session.findReferences("a.png")).rejects.toThrow("main.css: ZIP read failed");
      expect(await session.findReferences("a.png")).toHaveLength(1);
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("does not return silently partial results if a later file has a parse error", async () => {
      const { session } = referenceSession({
        "valid.css": "p{background:url(a.png)}",
        "invalid.xhtml": "<root><img></root>",
      });
      await expect(session.findReferences("a.png")).rejects.toThrow(/invalid.xhtml.*Malformed XML/);
    });

    it("does not share indexes between separate sessions", async () => {
      const first = referenceSession({ "a.css": "p{background:url(a.png)}" });
      const second = referenceSession({ "b.css": "p{background:url(b.png)}" });
      expect(await first.session.findReferences("a.png")).toHaveLength(1);
      expect(await second.session.findReferences("a.png")).toEqual([]);
      first.session.dispose();
      expect(await second.session.findReferences("b.png")).toHaveLength(1);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shares in-flight preview creation and revokes the resulting URL exactly once", async () => {
    const bytes = deferred<Uint8Array>();
    const read = vi.fn().mockReturnValue(bytes.promise);
    const session = makeSession(read);
    const first = session.getInspectionFilePreviewUrl("image.png", "image/png");
    const second = session.getInspectionFilePreviewUrl("image.png", "image/png");
    expect(second).toBe(first);
    expect(read).toHaveBeenCalledOnce();
    bytes.resolve(new Uint8Array([1]));
    expect(await first).toBe("blob:preview");
    expect(await second).toBe("blob:preview");
    expect(await session.getInspectionFilePreviewUrl("image.png", "image/png")).toBe("blob:preview");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    session.dispose();
    session.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview");
    await expect(session.getInspectionFilePreviewUrl("image.png", "image/png")).rejects.toThrow("closed");
  });

  it("never creates an object URL when disposed during the archive read", async () => {
    const bytes = deferred<Uint8Array>();
    const session = makeSession(vi.fn().mockReturnValue(bytes.promise));
    const pending = session.getInspectionFilePreviewUrl("image.png", "image/png");
    const rejection = expect(pending).rejects.toThrow("closed");
    session.dispose();
    bytes.resolve(new Uint8Array([1]));
    await rejection;
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("evicts rejected in-flight reads so a retry can succeed", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("Read failed"))
      .mockResolvedValueOnce(new Uint8Array([1]));
    const session = makeSession(read);
    await expect(session.getInspectionFilePreviewUrl("image.png", "image/png")).rejects.toThrow("Read failed");
    expect(await session.getInspectionFilePreviewUrl("image.png", "image/png")).toBe("blob:preview");
    expect(read).toHaveBeenCalledTimes(2);
    session.dispose();
  });
});
