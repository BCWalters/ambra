import { ContentLoader } from "../content/ContentLoader.js";
import { EpubContainerError } from "../container/EpubContainer.js";
import { resolveEpubPath } from "../container/EpubPath.js";
import { ZipFormatError, ZipIntegrityError } from "../container/ZipArchive.js";
import { UnsupportedEncryptionAlgorithmError } from "../encryption/FontDeobfuscator.js";
import { CssSyntaxError } from "postcss";
import { rewriteCssResources } from "./CssResourceRewriter.js";

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
  private readonly createdUrls = new Set<string>();
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

  private async createResourceUrl(
    path: string,
    mediaType: string,
    ancestors: ReadonlySet<string> = new Set(),
  ): Promise<string> {
    let bytes = await this.contentLoader.loadResourceBytes(path);
    if (mediaType === "text/css") {
      bytes = new TextEncoder().encode(await this.rewriteCss(
        new TextDecoder().decode(bytes), path, false, new Set([...ancestors, path]),
      ));
    }
    if (this.disposed) {
      throw new ResourceResolutionCancelledError();
    }
    // Copy into a plain ArrayBuffer-backed Uint8Array: `bytes` may be a
    // subarray view whose buffer type is widened to `ArrayBufferLike`
    // (which includes SharedArrayBuffer), but BlobPart requires a
    // definite `ArrayBuffer`.
    const blob = new Blob([Uint8Array.from(bytes)], { type: mediaType });
    const contextualStylesheet = mediaType === "text/css" && ancestors.size > 0;
    const cached = contextualStylesheet ? undefined : this.urlsByPath.get(path);
    if (cached) return cached;
    const url = URL.createObjectURL(blob);

    this.createdUrls.add(url);
    if (!contextualStylesheet) this.urlsByPath.set(path, url);
    return url;
  }

  /** Inline publisher CSS uses the same graph resolver as linked stylesheets. */
  public async rewriteCss(
    source: string,
    documentPath: string,
    declarations = false,
    ancestors: ReadonlySet<string> = new Set(),
  ): Promise<string> {
    if (this.disposed) throw new ResourceResolutionCancelledError();
    try {
      return await rewriteCssResources(source, async (href, importing) => {
        if (!href || href.startsWith("#")) return href;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) {
          if (!/^data:/i.test(href)) {
            console.warn(`External CSS resource remains blocked by content policy: ${href}`);
          }
          return href;
        }
        const hash = href.indexOf("#");
        const reference = hash < 0 ? href : href.slice(0, hash);
        const fragment = hash < 0 ? "" : href.slice(hash);
        const path = resolveEpubPath(documentPath, reference);
        if (ancestors.has(path)) {
          console.warn(`Cyclic CSS import omitted: ${documentPath} -> ${path}`);
          return undefined;
        }
        const item = this.contentLoader.packageDocument.findManifestItemByPath(path);
        if (importing && item?.mediaType !== "text/css") {
          console.warn(`CSS import does not reference a packaged stylesheet: ${documentPath} -> ${path}`);
          return undefined;
        }
        try {
          // Nested imports deliberately bypass public pending promises: two
          // concurrently requested roots may import each other.
          const url = item?.mediaType === "text/css"
            ? await this.createResourceUrl(path, item.mediaType, ancestors)
            : await this.resolve(path);
          return url + fragment;
        } catch (error) {
          if (!isResourceFailure(error)) throw error;
          console.warn(`Unable to resolve CSS resource ${href} from ${documentPath}.`, error);
          return undefined;
        }
      }, declarations);
    } catch (error) {
      if (!(error instanceof CssSyntaxError)) throw error;
      console.warn(`Invalid publisher CSS omitted from ${documentPath}.`, error);
      return "";
    }
  }

  /** Resolves several paths at once (in parallel), returning a map from
   * path to its resolved `blob:` URL. */
  public async resolveAll(paths: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (this.disposed) {
      throw new ResourceResolutionCancelledError();
    }
    const uniquePaths = [...new Set(paths)];
    const resolved = new Map<string, string>();
    await Promise.all(uniquePaths.map(async path => {
      try {
        resolved.set(path, await this.resolve(path));
      } catch (error) {
        if (!isResourceFailure(error)) throw error;
        console.warn(`Unable to resolve packaged resource ${path}.`, error);
      }
    }));
    return resolved;
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
    for (const url of this.createdUrls) {
      URL.revokeObjectURL(url);
    }
    this.createdUrls.clear();
    this.urlsByPath.clear();
  }
}

function isResourceFailure(error: unknown): boolean {
  if (error instanceof ResourceResolutionCancelledError) return false;
  return error instanceof ResourceResolutionError ||
    error instanceof EpubContainerError ||
    error instanceof ZipFormatError ||
    error instanceof ZipIntegrityError ||
    error instanceof UnsupportedEncryptionAlgorithmError;
}
