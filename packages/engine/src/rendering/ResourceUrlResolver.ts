import { ContentLoader } from "../content/ContentLoader.js";
import { EpubContainerError } from "../container/EpubContainer.js";
import { ZipFormatError, ZipIntegrityError } from "../container/ZipArchive.js";
import { UnsupportedEncryptionAlgorithmError } from "../encryption/FontDeobfuscator.js";
import { CssSyntaxError } from "postcss";
import { rewriteCssResources } from "./CssResourceRewriter.js";
import type { ResourceReference } from "../content/ContentLoader.js";
import type { ResourceCapabilities, ResourceConsumer } from "./ResourceCapabilities.js";
import {
  ResourceFallbackSelector, ResourceResolutionError, ResourceResolutionCancelledError,
  UnsupportedResourceError, resourceResolutionKey,
} from "./ResourceFallbackSelector.js";
import { classifyEpubReference } from "../container/EpubReference.js";
export { ResourceResolutionError, ResourceResolutionCancelledError } from "./ResourceFallbackSelector.js";

export interface ResolvedResource {
  readonly url: string;
  readonly path: string;
  readonly mediaType: string;
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
  public readonly fallbackSelector: ResourceFallbackSelector;

  public constructor(private readonly contentLoader: ContentLoader, capabilities?: ResourceCapabilities) {
    this.fallbackSelector = new ResourceFallbackSelector(
      contentLoader.packageDocument, path => contentLoader.loadResourceBytes(path), capabilities,
    );
  }

  public async resolveForConsumer(path: string, consumer: ResourceConsumer): Promise<ResolvedResource> {
    const item = await this.fallbackSelector.select(path, consumer);
    return { url: await this.resolve(item.path), path: item.path, mediaType: item.mediaType };
  }

  public async resolveReferences(
    references: readonly ResourceReference[],
  ): Promise<ReadonlyMap<string, ResolvedResource | null>> {
    if (this.disposed) throw new ResourceResolutionCancelledError();
    const requests = new Map(references.map(ref => [resourceResolutionKey(ref.path, ref.consumer), ref]));
    const resolved = new Map<string, ResolvedResource | null>();
    await Promise.all([...requests].map(async ([key, ref]) => {
      try {
        if (ref.location && !this.contentLoader.packageDocument.findManifestItemByPath(ref.path)) {
          this.fallbackSelector.reportUnavailable(ref.location.kind === "data" ? "[data URL]" : ref.path, ref.consumer);
          resolved.set(key, null);
          return;
        }
        resolved.set(key, await this.resolveForConsumer(ref.path, ref.consumer));
      } catch (error) {
        if (error instanceof UnsupportedResourceError) {
          resolved.set(key, null);
          return;
        }
        if (ref.consumer !== "stylesheet" || !isResourceFailure(error)) throw error;
        console.warn(`Unable to resolve packaged stylesheet ${ref.path}.`, error);
        resolved.set(key, null);
      }
    }));
    return resolved;
  }

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
    if (manifestItem.location) throw new ResourceResolutionError(`Publication resource is blocked by the ${manifestItem.location.kind} URL policy.`);

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
      return await rewriteCssResources(source, async (href, importing, consumer = "image") => {
        const reference = classifyEpubReference(documentPath, href);
        if (reference.kind === "fragment") return href;
        const path = reference.kind === "package" ? reference.path : reference.url.split("#")[0]!;
        if (reference.kind !== "package" && !this.contentLoader.packageDocument.findManifestItemByPath(path)) {
          this.fallbackSelector.reportUnavailable(reference.kind === "data" ? "[data URL]" : path, importing ? "stylesheet" : consumer);
          return undefined;
        }
        const hash = href.indexOf("#");
        const fragment = hash < 0 ? "" : href.slice(hash);
        try {
          const item = await this.fallbackSelector.select(path, importing ? "stylesheet" : consumer);
          if (ancestors.has(item.path)) {
            console.warn(`Cyclic CSS import omitted: ${documentPath} -> ${item.path}`);
            return undefined;
          }
          // Nested imports deliberately bypass public pending promises: two
          // concurrently requested roots may import each other.
          const url = item.mediaType === "text/css"
            ? await this.createResourceUrl(item.path, item.mediaType, ancestors)
            : await this.resolve(item.path);
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
        const stylesheet = this.contentLoader.packageDocument.findManifestItemByPath(path)?.mediaType === "text/css";
        if (!stylesheet || !isResourceFailure(error)) throw error;
        console.warn(`Unable to resolve packaged stylesheet ${path}.`, error);
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
    this.fallbackSelector.dispose();
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
