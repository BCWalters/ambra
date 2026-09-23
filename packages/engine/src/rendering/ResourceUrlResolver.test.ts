// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EpubContainer } from "../container/EpubContainer.js";
import { ContentLoader } from "../content/ContentLoader.js";
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
});
