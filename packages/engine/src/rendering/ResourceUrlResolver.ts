import { ContentLoader } from "../content/ContentLoader.js";

/** Thrown when a resource reference can't be resolved to a manifest item
 * (and therefore has no known media type to serve it with). */
export class ResourceResolutionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ResourceResolutionError";
  }
}

export class ResourceResolutionCancelledError extends ResourceResolutionError {
  public constructor() {
    super("Resource URL resolver has been disposed.");
    this.name = "ResourceResolutionCancelledError";
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
  private readonly pendingByPath = new Map<string, { promise: Promise<string>; cancel: () => void }>();
  private disposed = false;

  public constructor(private readonly contentLoader: ContentLoader) {}

  /** Resolves `path` to a `blob:` URL, loading and caching it on first
   * request. */
  public async resolve(path: string): Promise<string> {
    if (this.disposed) {
      throw new ResourceResolutionCancelledError();
    }
    const cached = this.urlsByPath.get(path);
    if (cached) {
      return cached;
    }
    const pending = this.pendingByPath.get(path);
    if (pending) {
      return pending.promise;
    }

    const manifestItem = this.contentLoader.packageDocument.findManifestItemByPath(path);
    if (!manifestItem) {
      throw new ResourceResolutionError(`No manifest item found for resource path: ${path}`);
    }

    let cancel!: () => void;
    const promise = new Promise<string>((resolve, reject) => {
      cancel = () => reject(new ResourceResolutionCancelledError());
      this.createResourceUrl(path, manifestItem.mediaType).then(resolve, reject);
    });
    const entry = { promise, cancel };
    this.pendingByPath.set(path, entry);
    try {
      return await promise;
    } finally {
      if (this.pendingByPath.get(path) === entry) {
        this.pendingByPath.delete(path);
      }
    }
  }

  private async createResourceUrl(path: string, mediaType: string): Promise<string> {
    const bytes = await this.contentLoader.loadResourceBytes(path);
    if (this.disposed) {
      throw new ResourceResolutionCancelledError();
    }
    // Copy into a plain ArrayBuffer-backed Uint8Array: `bytes` may be a
    // subarray view whose buffer type is widened to `ArrayBufferLike`
    // (which includes SharedArrayBuffer), but BlobPart requires a
    // definite `ArrayBuffer`.
    const blob = new Blob([Uint8Array.from(bytes)], { type: mediaType });
    const url = URL.createObjectURL(blob);

    this.urlsByPath.set(path, url);
    return url;
  }

  /** Resolves several paths at once (in parallel), returning a map from
   * path to its resolved `blob:` URL. */
  public async resolveAll(paths: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (this.disposed) {
      throw new ResourceResolutionCancelledError();
    }
    const uniquePaths = [...new Set(paths)];
    const resolved = await Promise.all(
      uniquePaths.map(async (path) => [path, await this.resolve(path)] as const),
    );
    return new Map(resolved);
  }

  /** Revokes every `blob:` URL this resolver has created. Must be called
   * once the content referencing them is no longer displayed, to avoid
   * leaking memory (object URLs are held alive by the browser until
   * explicitly revoked or the document that created them is destroyed).
   * Terminal: pending and future resolutions reject with
   * `ResourceResolutionCancelledError`; in-flight byte reads cannot create URLs. */
  public dispose(): void {
    this.disposed = true;
    for (const pending of this.pendingByPath.values()) {
      pending.cancel();
    }
    this.pendingByPath.clear();
    for (const url of this.urlsByPath.values()) {
      URL.revokeObjectURL(url);
    }
    this.urlsByPath.clear();
  }
}
