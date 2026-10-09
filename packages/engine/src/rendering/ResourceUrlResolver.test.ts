// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentDocument, ContentLoader, ContentLoaderError } from "../content/ContentLoader.js";
import { ManifestItem } from "../container/PackageDocument.js";
import type { ResourceCapabilities } from "./ResourceCapabilities.js";
import { findResourceReferencesInDocument } from "../content/ContentLoader.js";
import { resourceResolutionKey } from "./ResourceFallbackSelector.js";
import { classifyEpubReference } from "../container/EpubReference.js";
import { MAX_NESTED_DOCUMENT_BYTES } from "./ContentDocumentAssembler.js";
import {
  ResourceResolutionCancelledError,
  ResourceResolutionError,
  ResourceUrlResolver,
  MAX_NESTED_DOCUMENT_DEPTH,
} from "./ResourceUrlResolver.js";

async function loadFixture(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("ResourceUrlResolver", () => {
  let loader: ContentLoader;

  beforeAll(async () => {
    const container = await EpubContainer.open(await loadFixture("content-loader.epub"));
    loader = await ContentLoader.create(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves a resource path to a blob: URL", async () => {
    const resolver = new ResourceUrlResolver(loader);

    const url = await resolver.resolve("OEBPS/images/photo.png");

    expect(url).toMatch(/^blob:/);
    resolver.dispose();
  });

  it("uses the HTML base for inline CSS, but keeps local paint-server fragments and linked CSS bases independent", async () => {
    const resolver = new ResourceUrlResolver(loader, { supports: async () => true });
    const loadSpy = vi.spyOn(loader, "loadResourceBytes");
    try {
      const css = await resolver.rewriteCss(
        'p{background:url(photo.png#view);filter:url(#paint)}',
        "OEBPS/chapter.xhtml", false, new Set(), false, undefined, "images/",
      );
      expect(css).toMatch(/background:url\("blob:.*#view"\)/);
      expect(css).toContain('filter:url("#paint")');
      expect(loadSpy.mock.calls.map(([path]) => path)).toEqual(["OEBPS/images/photo.png"]);
      await resolver.resolve("OEBPS/styles/main.css");
      expect(loadSpy.mock.calls.some(([path]) => path === "OEBPS/styles/main.css")).toBe(true);
    } finally {
      resolver.dispose();
    }
  });

  it.each(["https://base.invalid/", "file:///private/"])(
    "reports %s inline CSS resources without ZIP reads and preserves unrelated declarations",
    async base => {
      const resolver = new ResourceUrlResolver(loader);
      const loadSpy = vi.spyOn(loader, "loadResourceBytes");
      const unavailable = vi.fn();
      resolver.fallbackSelector.onUnsupported(unavailable);
      try {
        const css = await resolver.rewriteCss(
          "p{background:url(photo.png);color:green}", "OEBPS/chapter.xhtml",
          false, new Set(), false, undefined, base,
        );
        expect(css).toBe("p{color:green}");
        expect(loadSpy).not.toHaveBeenCalled();
        expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ path: `${base}photo.png`, consumer: "image" }));
      } finally {
        resolver.dispose();
      }
    },
  );

  it("caches resolution: the same path returns the same URL and is only loaded once", async () => {
    const resolver = new ResourceUrlResolver(loader);
    const loadSpy = vi.spyOn(loader, "loadResourceBytes");

    const first = await resolver.resolve("OEBPS/images/photo.png");
    const second = await resolver.resolve("OEBPS/images/photo.png");

    expect(second).toBe(first);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    resolver.dispose();
  });

  it("resolveAll resolves multiple (deduplicated) paths in parallel", async () => {
    const resolver = new ResourceUrlResolver(loader);

    const urls = await resolver.resolveAll([
      "OEBPS/images/photo.png",
      "OEBPS/images/diagram.png",
      "OEBPS/images/photo.png",
    ]);

    expect(urls.size).toBe(2);
    expect(urls.get("OEBPS/images/photo.png")).toMatch(/^blob:/);
    expect(urls.get("OEBPS/images/diagram.png")).toMatch(/^blob:/);
    resolver.dispose();
  });

  it("throws ResourceResolutionError for a path with no matching manifest item", async () => {
    const resolver = new ResourceUrlResolver(loader);

    await expect(resolver.resolve("OEBPS/does-not-exist.png")).rejects.toThrow(
      ResourceResolutionError,
    );
  });

  it("dispose() revokes every created URL", async () => {
    const resolver = new ResourceUrlResolver(loader);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");

    await resolver.resolveAll(["OEBPS/images/photo.png", "OEBPS/images/diagram.png"]);
    resolver.dispose();

    expect(revokeSpy).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight resource between concurrent callers", async () => {
    const resolver = new ResourceUrlResolver(loader);
    let complete!: (bytes: Uint8Array) => void;
    const loadSpy = vi.spyOn(loader, "loadResourceBytes").mockImplementation(
      () => new Promise((resolve) => { complete = resolve; }),
    );
    const createSpy = vi.spyOn(URL, "createObjectURL");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const first = resolver.resolve("OEBPS/images/photo.png");
    const second = resolver.resolveAll(["OEBPS/images/photo.png"]);

    expect(loadSpy).toHaveBeenCalledTimes(1);
    complete(new Uint8Array([1]));
    const [url, urls] = await Promise.all([first, second]);
    expect(urls.get("OEBPS/images/photo.png")).toBe(url);
    expect(createSpy).toHaveBeenCalledTimes(1);
    resolver.dispose();
    expect(revokeSpy).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("propagates shared load failures and permits a later retry", async () => {
    const resolver = new ResourceUrlResolver(loader);
    const failure = new Error("Resource read failed");
    const loadSpy = vi.spyOn(loader, "loadResourceBytes")
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(new Uint8Array([1]));
    const first = resolver.resolve("OEBPS/images/photo.png");
    const second = resolver.resolve("OEBPS/images/photo.png");
    await expect(Promise.allSettled([first, second])).resolves.toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    await expect(resolver.resolve("OEBPS/images/photo.png")).resolves.toMatch(/^blob:/);
    expect(loadSpy).toHaveBeenCalledTimes(2);
    resolver.dispose();
  });

  it("immediately cancels pending callers and never creates a URL after disposal", async () => {
    const resolver = new ResourceUrlResolver(loader);
    let complete!: (bytes: Uint8Array) => void;
    vi.spyOn(loader, "loadResourceBytes").mockImplementation(
      () => new Promise((resolve) => { complete = resolve; }),
    );
    const createSpy = vi.spyOn(URL, "createObjectURL");
    const first = resolver.resolve("OEBPS/images/photo.png");
    const second = resolver.resolve("OEBPS/images/photo.png");
    const results = Promise.allSettled([first, second]);

    resolver.dispose();
    for (const result of await results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ResourceResolutionCancelledError);
      }
    }
    complete(new Uint8Array([1]));
    await Promise.resolve();
    await Promise.resolve();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects future resolutions after terminal disposal and revokes only once", async () => {
    const resolver = new ResourceUrlResolver(loader);
    const url = await resolver.resolve("OEBPS/images/photo.png");
    const loadSpy = vi.spyOn(loader, "loadResourceBytes");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    resolver.dispose();
    resolver.dispose();

    await expect(resolver.resolve("OEBPS/images/photo.png")).rejects.toBeInstanceOf(ResourceResolutionCancelledError);
    await expect(resolver.resolveAll([])).rejects.toBeInstanceOf(ResourceResolutionCancelledError);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledExactlyOnceWith(url);
  });

  function cssGraph(
    files: Record<string, { type: string; text: string; fallback?: string }>,
    capabilities: ResourceCapabilities = { supports: async () => true },
  ) {
    const blobs: Blob[] = [];
    const find = (path: string) => {
      const file = files[path];
      const location = classifyEpubReference("package.opf", path);
      return file ? new ManifestItem(path, path, file.type, new Set(), file.fallback, undefined,
        location.kind === "package" || location.kind === "fragment" ? undefined : location) : undefined;
    };
    vi.spyOn(loader.packageDocument, "findManifestItemByPath").mockImplementation(find);
    vi.spyOn(loader.packageDocument, "getManifestItem").mockImplementation(find);
    const load = vi.spyOn(loader, "loadResourceBytes").mockImplementation(async path => {
      const file = files[path];
      if (!file) throw new ResourceResolutionError(`Missing ${path}`);
      return new TextEncoder().encode(file.text);
    });
    const documents = vi.spyOn(loader, "loadContentDocument").mockImplementation(async item => {
      const file = files[item.path];
      if (!file) throw new ResourceResolutionError(`Missing ${item.path}`);
      const document = new DOMParser().parseFromString(file.text, "application/xhtml+xml");
      if (document.querySelector("parsererror")) throw new ContentLoaderError(`Malformed XHTML at ${item.path}`);
      return new ContentDocument(item, document, file.text);
    });
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => {
      if (!(blob instanceof Blob)) throw new Error("Expected a resource Blob.");
      blobs.push(blob);
      return `blob:resource-${blobs.length}`;
    });
    return { blobs, load, documents, resolver: new ResourceUrlResolver(loader, capabilities) };
  }

  it("makes packaged SVG image graphs self-contained instead of leaving relative nested image URLs", async () => {
    const { resolver, blobs } = cssGraph({
      "art/main.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><image href="parts/child.svg" width="80" height="40"/></svg>' },
      "art/parts/child.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><image href="../leaf.svg" width="80" height="40"/></svg>' },
      "art/leaf.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>' },
    });
    try {
      await resolver.resolve("art/main.svg");
      const main = new DOMParser().parseFromString(await blobs.at(-1)!.text(), "image/svg+xml");
      const child = main.querySelector("image")!.getAttribute("href")!;
      expect(child).toMatch(/^data:image\/svg\+xml;base64,/);
      const childDocument = new DOMParser().parseFromString(atob(child.split(",")[1]!), "image/svg+xml");
      expect(childDocument.querySelector("image")!.getAttribute("href")).toMatch(/^data:image\/svg\+xml;base64,/);
    } finally {
      resolver.dispose();
    }
  });

  it("cuts SVG image cycles without discarding unrelated artwork or waiting on public pending roots", async () => {
    const { resolver, blobs } = cssGraph({
      "a.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" width="20" height="20"/><image href="b.svg"/></svg>' },
      "b.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="b" width="20" height="20"/><image href="a.svg"/></svg>' },
    });
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    try {
      await Promise.all([resolver.resolve("a.svg"), resolver.resolve("b.svg")]);
      expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: "cycle" }));
      expect(blobs.some(blob => blob.type === "image/svg+xml")).toBe(true);
    } finally {
      resolver.dispose();
    }
  });

  it("omits blocked or broken SVG dependencies while retaining a usable SVG image", async () => {
    const { resolver, blobs, load } = cssGraph({
      "main.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="kept" width="20" height="20"/><image href="missing.svg"/><image href="https://remote.invalid/image.svg"/><image href="file:///private/image.svg"/></svg>' },
    });
    try {
      await resolver.resolve("main.svg");
      const document = new DOMParser().parseFromString(await blobs.at(-1)!.text(), "image/svg+xml");
      expect(document.getElementById("kept")).not.toBeNull();
      expect([...document.querySelectorAll("image")].every(image => !image.hasAttribute("href"))).toBe(true);
      expect(load.mock.calls.map(([path]) => path)).not.toContain("https://remote.invalid/image.svg");
      expect(load.mock.calls.map(([path]) => path)).not.toContain("file:///private/image.svg");
    } finally {
      resolver.dispose();
    }
  });

  it("localizes qualified SVG fragments in hrefs, presentation attributes and CSS without mutating source", async () => {
    const source = '<s:svg xmlns:s="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink"><s:defs><s:linearGradient id="paint"/><s:rect id="shape" fill="url(main.svg#paint)"/></s:defs><s:use xl:href="./main.svg#shape" style="stroke:url(./main.svg#paint)"/><s:style>rect{filter:url(main.svg#filter)}</s:style></s:svg>';
    const { resolver, blobs, documents } = cssGraph({
      "art/main.svg": { type: "image/svg+xml", text: source },
    });
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    try {
      await resolver.resolve("art/main.svg");
      const markup = await blobs.at(-1)!.text();
      expect(markup).toContain('xl:href="#shape"');
      expect(markup).not.toContain("main.svg#");
      expect(markup).toContain("#paint");
      expect(documents).toHaveBeenCalledTimes(1);
      expect(unavailable).not.toHaveBeenCalled();
      const original: ContentDocument = await documents.mock.results[0]!.value;
      expect(Array.from(original.document.querySelectorAll("*"))
        .find(element => element.localName === "use")?.getAttribute("xl:href")).toBe("./main.svg#shape");
    } finally {
      resolver.dispose();
    }
  });

  it("rewrites SVG presentation values using CSS escaping and keeps plain values and local paint servers", async () => {
    const { resolver, blobs } = cssGraph({
      "main.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg"><rect id="kept" fill="green" stroke="url(#paint)" filter="url(https://blocked.invalid/filter.svg#filter)" cursor="url(cursor.svg), auto" marker-end="u\\72l(cursor.svg#marker)" mask="url(missing.svg#mask)"/></svg>' },
      "cursor.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg"><path id="marker" d="M0 0L5 5"/></svg>' },
    });
    try {
      await resolver.resolve("main.svg");
      const document = new DOMParser().parseFromString(await blobs.at(-1)!.text(), "image/svg+xml");
      const rect = document.getElementById("kept")!;
      expect(rect.getAttribute("fill")).toBe("green");
      expect(rect.getAttribute("stroke")).toBe('url("#paint")');
      expect(rect.hasAttribute("filter")).toBe(false);
      expect(rect.hasAttribute("mask")).toBe(false);
      expect(rect.getAttribute("cursor")).toMatch(/^url\("data:image\/svg\+xml;base64,.*"\), auto$/);
      expect(rect.getAttribute("marker-end")).toMatch(/^url\("data:image\/svg\+xml;base64,.*#marker"\)$/);
    } finally {
      resolver.dispose();
    }
  });

  it("cuts concurrent SVG and CSS cycles without awaiting public roots", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver, blobs } = cssGraph({
      "main.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "main.css";</style><rect id="kept" fill="green"/></svg>' },
      "main.css": { type: "text/css", text: 'rect{background:url(main.svg)}' },
    });
    try {
      await Promise.all([resolver.resolve("main.svg"), resolver.resolve("main.css")]);
      expect(blobs.some(blob => blob.type === "image/svg+xml")).toBe(true);
      expect(blobs.some(blob => blob.type === "text/css")).toBe(true);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Cyclic CSS import omitted"));
    } finally {
      resolver.dispose();
    }
  });

  it("bounds SVG depth without dropping remaining artwork", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const files: Record<string, { type: string; text: string }> = {};
    for (let index = 0; index < 12; index++) {
      files[`${index}.svg`] = { type: "image/svg+xml", text: `<svg xmlns="http://www.w3.org/2000/svg"><rect id="kept" fill="green"/><image href="${index + 1}.svg"/></svg>` };
    }
    const { resolver, blobs, documents } = cssGraph(files);
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    try {
      await resolver.resolve("0.svg");
      expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: "depth-limit" }));
      expect(documents.mock.calls.length).toBeLessThan(12);
      expect(await blobs.at(-1)!.text()).toContain('id="kept"');
    } finally {
      resolver.dispose();
    }
  });

  it("reports oversized or malformed optional SVGs while preserving chapter text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver, documents } = cssGraph({
      "big.svg": { type: "image/svg+xml", text: `<svg xmlns="http://www.w3.org/2000/svg"><!--${"x".repeat(MAX_NESTED_DOCUMENT_BYTES)}--></svg>` },
      "broken.svg": { type: "image/svg+xml", text: "<svg/>" },
    });
    documents.mockImplementationOnce(async () => { throw new ContentLoaderError("Malformed SVG."); });
    const host = new DOMParser().parseFromString('<html><body><p>Kept chapter</p><img src="broken.svg"/><img src="big.svg"/></body></html>', "text/html");
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    try {
      const results = await resolver.resolveReferences(findResourceReferencesInDocument(host, "chapter.xhtml"));
      expect([...results.values()]).toEqual([null, null]);
      expect(host.querySelector("p")?.textContent).toBe("Kept chapter");
      expect(unavailable).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Unable to resolve publication image resource broken.svg."), expect.any(ContentLoaderError));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Unable to resolve publication image resource big.svg."), expect.any(ContentLoaderError));
    } finally {
      resolver.dispose();
    }
  });

  it("shares one bounded expansion budget across SVG image siblings", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver, blobs } = cssGraph({
      "a.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="green"/></svg>' },
      "b.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="blue"/></svg>' },
    });
    const host = new DOMParser().parseFromString('<html><body><img src="a.svg"/><img src="b.svg"/></body></html>', "text/html");
    const budget = { remaining: 24 * 1024 };
    try {
      const results = await resolver.resolveReferences(
        findResourceReferencesInDocument(host, "root.xhtml"), new Set(["root.xhtml"]), false, budget,
      );
      expect([...results.values()].filter(result => result === null)).toHaveLength(1);
      expect([...results.values()].filter(result => result?.mediaType === "image/svg+xml")).toHaveLength(1);
      expect(blobs).toHaveLength(1);
      expect(budget.remaining).toBeGreaterThanOrEqual(0);
    } finally {
      resolver.dispose();
    }
  });

  it("assembles packaged child CSS, images and nested frames relative to their selected document", async () => {
    const { resolver, blobs, documents } = cssGraph({
      "foreign.bin": { type: "application/foreign", text: "", fallback: "nested/child.xhtml" },
      "nested/child.xhtml": { type: "application/xhtml+xml", text: '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../styles.css"/><style>p{background:url(pic.svg)}</style></head><body><p id="text">Static child</p><img src="pic.svg"/><iframe src="grandchild.xhtml" sandbox="allow-scripts"/></body></html>' },
      "nested/grandchild.xhtml": { type: "application/xhtml+xml", text: '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Grandchild</title></head><body>Static grandchild</body></html>' },
      "nested/pic.svg": { type: "image/svg+xml", text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>' },
      "styles.css": { type: "text/css", text: "p{color:green}" },
    }, { supports: async type => type !== "application/foreign" });
    const result = await resolver.resolveForConsumer("foreign.bin", "document", new Set(["root.xhtml"]));
    expect(result).toMatchObject({ path: "nested/child.xhtml", isolatedDocument: true });
    const markup = await blobs[Number(result.url.split("-").at(-1)) - 1]!.text();
    const child = new DOMParser().parseFromString(markup, "text/html");
    expect(child.querySelector("iframe")?.getAttribute("sandbox")).toBe("");
    expect(child.querySelector("iframe")?.getAttribute("src")).toMatch(/^data:application\/xhtml\+xml;base64,/);
    expect(child.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(child.querySelector("link")?.getAttribute("href")).toMatch(/^data:text\/css;base64,/);
    expect(child.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("script-src 'none'");
    expect(markup).not.toContain("var(--ambra-font");
    expect(documents).toHaveBeenCalledWith(expect.objectContaining({ path: "nested/pic.svg" }));
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    resolver.dispose();
    expect(revoke).toHaveBeenCalledTimes(blobs.length);
  });

  it("terminates aliased document cycles without dropping readable child content", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver, blobs, documents } = cssGraph({
      "a.xhtml": { type: "application/xhtml+xml", text: '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Child A<iframe src="b.xhtml"/></body></html>' },
      "b.xhtml": { type: "application/xhtml+xml", text: '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Child B<iframe src="alias.bin"/></body></html>' },
      "alias.bin": { type: "application/foreign", text: "", fallback: "a.xhtml" },
    }, { supports: async type => type !== "application/foreign" });
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    await resolver.resolveForConsumer("a.xhtml", "document", new Set(["root.xhtml"]));
    expect(documents.mock.calls.map(([item]) => item.path)).toEqual(["a.xhtml", "b.xhtml"]);
    expect(blobs).toHaveLength(1);
    const root = new DOMParser().parseFromString(await blobs[0]!.text(), "text/html");
    const childUrl = root.querySelector("iframe")!.getAttribute("src")!;
    const childText = Buffer.from(childUrl.slice(childUrl.indexOf(",") + 1), "base64").toString("utf8");
    expect(childText).toContain("Child B");
    expect(new DOMParser().parseFromString(childText, "text/html").querySelector("iframe")?.hasAttribute("src")).toBe(false);
    expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: "cycle" }));
    resolver.dispose();
  });

  it("renders exactly eight child levels and reports the ninth without loading it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const files = Object.fromEntries(Array.from({ length: MAX_NESTED_DOCUMENT_DEPTH + 1 }, (_, index) => [
      `level${index}.xhtml`, {
        type: "application/xhtml+xml",
        text: `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Level ${index}<iframe src="level${index + 1}.xhtml"/></body></html>`,
      },
    ]));
    const { resolver, blobs, documents } = cssGraph(files);
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    await resolver.resolveForConsumer("level0.xhtml", "document", new Set(["root.xhtml"]));
    expect(documents).toHaveBeenCalledTimes(8);
    expect(blobs).toHaveLength(1);
    expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: "depth-limit" }));
    let markup = await blobs[0]!.text();
    for (let depth = 1; depth < 8; depth++) {
      const url = new DOMParser().parseFromString(markup, "text/html").querySelector("iframe")!.getAttribute("src")!;
      expect(url).toMatch(/^data:application\/xhtml\+xml;base64,/);
      markup = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString("utf8");
    }
    expect(markup).toContain("Level 7");
    expect(new DOMParser().parseFromString(markup, "text/html").querySelector("iframe")?.hasAttribute("src")).toBe(false);
    resolver.dispose();
  });

  it("rejects expanded child markup beyond eight MiB without creating a URL or failing host assembly", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver, blobs } = cssGraph({
      "large.xhtml": { type: "application/xhtml+xml", text: `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>${"x".repeat(MAX_NESTED_DOCUMENT_BYTES)}</body></html>` },
    });
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    const host = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body>Host remains readable<iframe src="large.xhtml"/></body></html>',
      "application/xhtml+xml",
    );
    const result = await resolver.resolveReferences(findResourceReferencesInDocument(host, "root.xhtml"));
    expect(result.get(resourceResolutionKey("large.xhtml", "document"))).toBeNull();
    expect(blobs).toHaveLength(0);
    expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: "exhausted" }));
    resolver.dispose();
  });

  it("reports malformed or missing children without rejecting otherwise readable host resources", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver } = cssGraph({
      "bad.xhtml": { type: "application/xhtml+xml", text: "<html><unclosed></html>" },
      "good.svg": { type: "image/svg+xml", text: "<svg/>" },
    });
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    const document = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><body><iframe src="bad.xhtml"/><iframe src="missing.xhtml"/><img src="good.svg"/></body></html>', "application/xhtml+xml");
    const results = await resolver.resolveReferences(findResourceReferencesInDocument(document, "root.xhtml"));
    expect(results.get(resourceResolutionKey("bad.xhtml", "document"))).toBeNull();
    expect(results.get(resourceResolutionKey("missing.xhtml", "document"))).toBeNull();
    expect(results.get(resourceResolutionKey("good.svg", "image"))?.url).toMatch(/^blob:/);
    expect(unavailable).toHaveBeenCalledTimes(2);
    resolver.dispose();
  });

  it("bounds repeated inline-resource expansion before creating the child URL", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver, blobs } = cssGraph({
      "child.xhtml": { type: "application/xhtml+xml", text: `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>${'<img src="large.svg"/>'.repeat(4)}</body></html>` },
      "large.svg": { type: "image/svg+xml", text: `<svg xmlns="http://www.w3.org/2000/svg"><!--${"x".repeat(1_600_000)}--></svg>` },
    });
    await expect(resolver.resolveForConsumer("child.xhtml", "document", new Set(["root.xhtml"])))
      .rejects.toThrow("bounded assembly budget");
    expect(blobs).toHaveLength(0);
    resolver.dispose();
  });

  it("shares the assembly budget across siblings and retains the child that fits", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver, blobs } = cssGraph({
      "a.xhtml": { type: "application/xhtml+xml", text: '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Child A</body></html>' },
      "b.xhtml": { type: "application/xhtml+xml", text: '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Child B</body></html>' },
    });
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    const host = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><iframe src="a.xhtml"/><iframe src="b.xhtml"/></body></html>',
      "application/xhtml+xml",
    );
    const budget = { remaining: 24 * 1024 };
    const results = await resolver.resolveReferences(
      findResourceReferencesInDocument(host, "root.xhtml"), new Set(["root.xhtml"]), false, budget,
    );
    expect([...results.values()].filter(result => result?.isolatedDocument)).toHaveLength(1);
    expect([...results.values()].filter(result => result === null)).toHaveLength(1);
    expect(blobs).toHaveLength(1);
    expect(budget.remaining).toBeGreaterThanOrEqual(0);
    expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ reason: "exhausted" }));
    resolver.dispose();
  });

  it.each(["application/xhtml+xml", "image/svg+xml"])("cancels %s assembly without creating a URL after disposal", async type => {
    const raw = type === "image/svg+xml"
      ? '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>'
      : '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Child</body></html>';
    const { resolver, blobs, documents } = cssGraph({
      "child.xhtml": { type, text: raw },
    });
    let complete!: (document: ContentDocument) => void;
    documents.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = resolver.resolveForConsumer("child.xhtml", type === "image/svg+xml" ? "image" : "document", new Set(["root.xhtml"]));
    const rejected = expect(pending).rejects.toBeInstanceOf(ResourceResolutionCancelledError);
    await vi.waitFor(() => expect(documents).toHaveBeenCalledTimes(1));
    resolver.dispose();
    complete(new ContentDocument(
      loader.packageDocument.findManifestItemByPath("child.xhtml")!,
      new DOMParser().parseFromString(raw, "application/xhtml+xml"), raw,
    ));
    await rejected;
    expect(blobs).toHaveLength(0);
  });

  it("resolves nested imports, images, fonts, spaces and SVG fragments relative to each sheet", async () => {
    const { blobs, load, resolver } = cssGraph({
      "EPUB/styles/main.css": { type: "text/css", text: '@import "nested/child.css" screen; p{filter:url("../images/filter.svg#shadow")}' },
      "EPUB/styles/nested/child.css": { type: "text/css", text: '@font-face{font-family:Test;src:url("../../fonts/test.woff2")}p{background:url("../../images/a%20b.png")}' },
      "EPUB/fonts/test.woff2": { type: "font/woff2", text: "font bytes" },
      "EPUB/images/a b.png": { type: "image/png", text: "image bytes" },
      "EPUB/images/filter.svg": { type: "image/svg+xml", text: "<svg/>" },
    });
    await resolver.resolve("EPUB/styles/main.css");
    const css = await Promise.all(blobs.filter(blob => blob.type === "text/css").map(blob => blob.text()));
    expect(css).toEqual([
      '@font-face{font-family:Test;src:url("blob:resource-1")}p{background:url("blob:resource-2")}',
      '@import "blob:resource-3" screen; p{filter:url("blob:resource-4#shadow")}',
    ]);
    expect(load).toHaveBeenCalledWith("EPUB/fonts/test.woff2");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    resolver.dispose();
    expect(revoke).toHaveBeenCalledTimes(blobs.length);
  });

  it("terminates cyclic graphs even when both roots are requested concurrently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { blobs, resolver } = cssGraph({
      "a.css": { type: "text/css", text: '@import "b.css"; p{color:red}' },
      "b.css": { type: "text/css", text: '@import "a.css"; p{color:blue}' },
    });
    const urls = await resolver.resolveAll(["a.css", "b.css"]);
    expect(urls.size).toBe(2);
    expect(blobs).toHaveLength(4);
    const rootSheets = await Promise.all([...urls.values()].map(url =>
      blobs[Number(url.split("-").at(-1)) - 1]!.text()));
    expect(rootSheets.every(css => css.includes("@import"))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Cyclic CSS import omitted"));
    resolver.dispose();
  });

  it("reports missing dependencies without aborting the remaining stylesheet or chapter", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { blobs, resolver } = cssGraph({
      "main.css": { type: "text/css", text: '@import "missing.css"; p{background:url(missing.png);color:red}' },
    });
    const urls = await resolver.resolveAll(["main.css"]);
    expect(urls.size).toBe(1);
    expect(await blobs[0]!.text()).toContain("color:red");
    expect(warn).toHaveBeenCalled();
    resolver.dispose();
  });

  it("preserves explicit failures for missing markup resources while allowing a missing declared stylesheet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver } = cssGraph({});
    vi.spyOn(loader.packageDocument, "findManifestItemByPath").mockImplementation(path =>
      path === "missing.css" ? new ManifestItem(path, path, "text/css", new Set()) : undefined);
    await expect(resolver.resolveAll(["missing.css"])).resolves.toEqual(new Map());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Unable to resolve packaged stylesheet missing.css"), expect.anything(),
    );
    await expect(resolver.resolveAll(["missing-image.png"])).rejects.toThrow(
      "No manifest item found for resource path: missing-image.png",
    );
    resolver.dispose();
  });

  it("removes blocked external and data URLs without aliasing archive files, while preserving local fragments", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { load, resolver } = cssGraph({});
    const css = await resolver.rewriteCss(
      'p{filter:url(#shadow);background:url(data:image/png;base64,AAAA);mask:url(https://example.test/image.svg)}',
      "EPUB/chapter.xhtml",
    );
    expect(css).toContain('url("#shadow")');
    expect(css).not.toContain("data:");
    expect(css).not.toContain("https:");
    expect(load).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("(policy;"));
    resolver.dispose();
  });

  it("omits malformed publisher CSS with a diagnostic and preserves cancellation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver } = cssGraph({});
    await expect(resolver.rewriteCss("p{", "chapter.xhtml")).resolves.toBe("");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Invalid publisher CSS omitted"), expect.anything());
    resolver.dispose();
    await expect(resolver.rewriteCss("p{}", "chapter.xhtml")).rejects.toBeInstanceOf(ResourceResolutionCancelledError);
  });

  it("CSS font references use de-obfuscated IDPF and Adobe bytes before creating blobs", async () => {
    const container = await EpubContainer.open(await loadFixture("font-obfuscation.epub"));
    const fonts = await ContentLoader.create(container);
    const resolver = new ResourceUrlResolver(fonts, { supports: async () => true });
    const captured: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => {
      if (!(blob instanceof Blob)) throw new Error("Expected font Blob.");
      captured.push(blob);
      return `blob:font-${captured.length}`;
    });
    await resolver.rewriteCss(
      '@font-face{font-family:IDPF;src:url(fonts/idpf-obfuscated.otf)}@font-face{font-family:Adobe;src:url(fonts/adobe-obfuscated.otf)}',
      "OEBPS/ch1.xhtml",
    );
    const plaintext = await loadFixture("font-obfuscation-plaintext.bin");
    expect(captured).toHaveLength(2);
    for (const blob of captured) {
      expect(blob.type).toBe("font/otf");
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(plaintext);
    }
    resolver.dispose();
  });

  it("resolves fallback stylesheet dependencies relative to the selected sheet and detects alias cycles", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { blobs, load, documents, resolver } = cssGraph({
      "foreign.bin": { type: "application/foreign", text: "", fallback: "styles/main.css" },
      "styles/main.css": { type: "text/css", text: '@import "../foreign.bin";p{background:url(image.bin)}@font-face{src:url(font.bin) format("foreign")}' },
      "styles/image.bin": { type: "application/foreign", text: "", fallback: "image.svg" },
      "styles/font.bin": { type: "application/foreign", text: "", fallback: "font.woff2" },
      "image.svg": { type: "image/svg+xml", text: "<svg/>" },
      "font.woff2": { type: "font/woff2", text: "font" },
    }, { supports: async type => type !== "application/foreign" });
    const result = await resolver.resolveForConsumer("foreign.bin", "stylesheet");
    expect(result).toMatchObject({ path: "styles/main.css", mediaType: "text/css" });
    expect(load.mock.calls.map(call => call[0])).toEqual(["styles/main.css", "font.woff2"]);
    expect(documents).toHaveBeenCalledWith(expect.objectContaining({ path: "image.svg" }));
    expect(await blobs.at(-1)!.text()).toContain('background:url("blob:resource-1")');
    expect(await blobs.at(-1)!.text()).not.toContain("@import");
    expect(await blobs.at(-1)!.text()).not.toContain("format");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Cyclic CSS import omitted"));
    resolver.dispose();
  });

  it("does not abort unrelated markup for exhausted fallbacks but retains direct missing-resource errors and raw resolution", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver } = cssGraph({
      "bad.bin": { type: "application/foreign", text: "original bytes" },
      "good.png": { type: "image/png", text: "supported bytes" },
    }, { supports: async type => type === "image/png" });
    const document = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="bad.bin"/><img src="good.png"/></body></html>',
      "application/xhtml+xml",
    );
    const references = findResourceReferencesInDocument(document, "chapter.xhtml");
    const results = await resolver.resolveReferences(references);
    expect(results.get(resourceResolutionKey("bad.bin", "image"))).toBeNull();
    expect(results.get(resourceResolutionKey("good.png", "image"))?.mediaType).toBe("image/png");
    await expect(resolver.resolve("bad.bin")).resolves.toMatch(/^blob:/);
    await expect(resolver.resolveForConsumer("missing.png", "image")).rejects.toThrow("No manifest item");
    resolver.dispose();
  });

  it("never aliases non-package markup URLs to archive paths and can select a declared remote resource's local fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver, load } = cssGraph({
      "https://example.test/image.png": { type: "image/png", text: "must not be read", fallback: "good.png" },
      "good.png": { type: "image/png", text: "image bytes" },
    });
    const document = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="https://example.test/image.png"/>' +
      '<img src="file:///good.png"/><img src="data:image/png;base64,SECRET"/><img src="//example.test/good.png"/><img src="good.png"/></body></html>',
      "application/xhtml+xml",
    );
    const references = findResourceReferencesInDocument(document, "chapter.xhtml", { includeUnavailable: true });
    const results = await resolver.resolveReferences(references);
    expect(results.get(resourceResolutionKey("https://example.test/image.png", "image"))?.path).toBe("good.png");
    expect([...results.values()].filter(result => result === null)).toHaveLength(2);
    expect(results.get(resourceResolutionKey("data:image/png;base64,SECRET", "image"))?.url).toMatch(/^blob:/);
    expect(load.mock.calls.map(call => call[0])).toEqual(["good.png"]);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("SECRET");
    await expect(resolver.resolve("https://example.test/image.png")).rejects.toThrow("https URL policy");
    resolver.dispose();
  });

  it("reports missing image subresources without dropping the host's other resources", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolver } = cssGraph({
      "good.svg": { type: "image/svg+xml", text: "<svg/>" },
    });
    const unavailable = vi.fn();
    resolver.fallbackSelector.onUnsupported(unavailable);
    const document = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body>Readable host<img src="missing.png"/><img src="good.svg"/></body></html>',
      "application/xhtml+xml",
    );
    const references = findResourceReferencesInDocument(document, "root.xhtml");
    const results = await resolver.resolveReferences(references);
    expect(results.get(resourceResolutionKey("missing.png", "image"))).toBeNull();
    expect(results.get(resourceResolutionKey("good.svg", "image"))?.url).toMatch(/^blob:/);
    expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ path: "missing.png", consumer: "image" }));
    resolver.dispose();
  });

  it("rewrites embedded markup, CSS and srcset images through the same bounded byte reader", async () => {
    const { resolver, load, blobs } = cssGraph({});
    const url = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='20'/%3E";
    const document = new DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="${url}"/><img srcset="${url} 1x, ${url} 2x"/></body></html>`,
      "application/xhtml+xml",
    );
    const results = await resolver.resolveReferences(
      findResourceReferencesInDocument(document, "root.xhtml", { includeUnavailable: true }),
    );
    expect(results.size).toBe(1);
    expect(results.get(resourceResolutionKey(url, "image"))?.url).toMatch(/^blob:/);
    expect(await resolver.rewriteCss(`p{background:url("${url}")}`, "root.xhtml")).toContain("blob:");
    expect(blobs).toHaveLength(1);
    expect(await blobs[0]!.text()).toContain('width=\'20\'');
    expect(load).not.toHaveBeenCalled();
    resolver.dispose();
  });
});
