import { ContentLoader } from "../content/ContentLoader.js";

/** Thrown when a resource reference can't be resolved to a manifest item
 * (and therefore has no known media type to serve it with). */
export class ResourceResolutionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ResourceResolutionError";
  }
}

/**
 * Loads referenced resources (images, fonts, stylesheets, audio/video) via
 * a `ContentLoader` and exposes them as `blob:` object URLs with the
 * correct MIME type (from the manifest), for injection into the sandboxed
 * rendering surface. Caches by path, and tracks every URL it creates so
 * they can all be revoked together via `dispose()` — object URLs are not
 * garbage collected automatically and must be explicitly released once the
 * content that references them is no longer displayed.
 */
export class ResourceUrlResolver {
  private readonly urlsByPath = new Map<string, string>();

  public constructor(private readonly contentLoader: ContentLoader) {}

  /** Resolves `path` to a `blob:` URL, loading and caching it on first
   * request. */
  public async resolve(path: string): Promise<string> {
    const cached = this.urlsByPath.get(path);
    if (cached) {
      return cached;
    }

    const manifestItem = this.contentLoader.packageDocument.findManifestItemByPath(path);
    if (!manifestItem) {
      throw new ResourceResolutionError(`No manifest item found for resource path: ${path}`);
    }

    const bytes = await this.contentLoader.loadResourceBytes(path);
    // Copy into a plain ArrayBuffer-backed Uint8Array: `bytes` may be a
    // subarray view whose buffer type is widened to `ArrayBufferLike`
    // (which includes SharedArrayBuffer), but BlobPart requires a
    // definite `ArrayBuffer`.
    const blob = new Blob([Uint8Array.from(bytes)], { type: manifestItem.mediaType });
    const url = URL.createObjectURL(blob);

    this.urlsByPath.set(path, url);
    return url;
  }

  /** Resolves several paths at once (in parallel), returning a map from
   * path to its resolved `blob:` URL. */
  public async resolveAll(paths: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const uniquePaths = [...new Set(paths)];
    const resolved = await Promise.all(
      uniquePaths.map(async (path) => [path, await this.resolve(path)] as const),
    );
    return new Map(resolved);
  }

  /** Revokes every `blob:` URL this resolver has created. Must be called
   * once the content referencing them is no longer displayed, to avoid
   * leaking memory (object URLs are held alive by the browser until
   * explicitly revoked or the document that created them is destroyed). */
  public dispose(): void {
    for (const url of this.urlsByPath.values()) {
      URL.revokeObjectURL(url);
    }
    this.urlsByPath.clear();
  }
}
