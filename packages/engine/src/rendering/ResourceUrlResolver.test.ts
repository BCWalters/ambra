// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
import { ManifestItem } from "../container/PackageDocument.js";
import {
  ResourceResolutionCancelledError,
  ResourceResolutionError,
  ResourceUrlResolver,
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

  function cssGraph(files: Record<string, { type: string; text: string }>) {
    const blobs: Blob[] = [];
    vi.spyOn(loader.packageDocument, "findManifestItemByPath").mockImplementation(path => {
      const file = files[path];
      return file ? new ManifestItem(path, path, file.type, new Set()) : undefined;
    });
    const load = vi.spyOn(loader, "loadResourceBytes").mockImplementation(async path => {
      const file = files[path];
      if (!file) throw new ResourceResolutionError(`Missing ${path}`);
      return new TextEncoder().encode(file.text);
    });
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => {
      if (!(blob instanceof Blob)) throw new Error("Expected a resource Blob.");
      blobs.push(blob);
      return `blob:resource-${blobs.length}`;
    });
    return { blobs, load, resolver: new ResourceUrlResolver(loader) };
  }

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
    const urls = await resolver.resolveAll(["main.css", "missing-image.png"]);
    expect(urls.size).toBe(1);
    expect(await blobs[0]!.text()).toContain("color:red");
    expect(warn).toHaveBeenCalled();
    resolver.dispose();
  });

  it("does not alias external URLs to packaged resources and preserves data/local fragments", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { load, resolver } = cssGraph({});
    const css = await resolver.rewriteCss(
      'p{filter:url(#shadow);background:url(data:image/png;base64,AAAA);mask:url(https://example.test/image.svg)}',
      "EPUB/chapter.xhtml",
    );
    expect(css).toContain('url("#shadow")');
    expect(css).toContain('url("data:image/png;base64,AAAA")');
    expect(load).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("External CSS resource remains blocked"));
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
    const resolver = new ResourceUrlResolver(fonts);
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
});
