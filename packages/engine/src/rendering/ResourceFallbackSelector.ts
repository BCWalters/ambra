import { ManifestItem, type PackageDocument } from "../container/PackageDocument.js";
import { classifyEpubReference } from "../container/EpubReference.js";
import {
  decodeEmbeddedDataImage, embeddedDataImageType, EmbeddedDataImageError,
  MAX_EMBEDDED_IMAGE_TOTAL_BYTES,
} from "./EmbeddedDataImage.js";
import {
  BrowserResourceCapabilities,
  type ResourceCapabilities,
  type ResourceConsumer,
} from "./ResourceCapabilities.js";

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

export class UnsupportedResourceError extends ResourceResolutionError {
  public constructor(
    public readonly path: string,
    public readonly consumer: ResourceConsumer,
    public readonly reason: "exhausted" | "missing-target" | "cycle" | "policy" | "depth-limit",
    public readonly chain: readonly string[],
  ) {
    super(
      `No supported ${consumer} resource for "${/^data:/i.test(path) ? "[data URL]" : path}" (${reason}; fallback chain: ${chain.join(" -> ")}).`,
    );
    this.name = "UnsupportedResourceError";
  }
}

export class ResourceFallbackSelector {
  private readonly pending = new Map<string, Promise<ManifestItem>>();
  private readonly selected = new Map<string, ManifestItem>();
  private readonly unsupported = new Map<string, UnsupportedResourceError>();
  private readonly abort = new AbortController();
  private readonly notified = new Set<string>();
  private readonly listeners = new Set<(error: UnsupportedResourceError) => void>();
  private readonly embeddedImages = new Map<string, Uint8Array>();
  private embeddedBytes = 0;

  public constructor(
    private readonly pkg: PackageDocument,
    private readonly read: (path: string) => Promise<Uint8Array>,
    private readonly capabilities: ResourceCapabilities = new BrowserResourceCapabilities(),
  ) {}

  public onUnsupported(listener: (error: UnsupportedResourceError) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async readResourceBytes(path: string): Promise<Uint8Array> {
    this.abort.signal.throwIfAborted();
    const item = this.pkg.findManifestItemByPath(path);
    if (item && !item.location) return this.read(path);
    const location = item?.location ?? classifyEpubReference("", path);
    if (location.kind === "data") {
      const cached = this.embeddedImages.get(path);
      if (cached) return cached;
      const { bytes } = decodeEmbeddedDataImage(path);
      if (bytes.byteLength > MAX_EMBEDDED_IMAGE_TOTAL_BYTES - this.embeddedBytes) {
        throw new EmbeddedDataImageError("Embedded images exceed the shared decoded payload limit.");
      }
      this.embeddedBytes += bytes.byteLength;
      this.embeddedImages.set(path, bytes);
      return bytes;
    }
    if (location.kind !== "package" && location.kind !== "fragment") {
      throw new ResourceResolutionError(`Publication resource is blocked by the ${location.kind} URL policy.`);
    }
    return this.read(path);
  }

  public reportUnavailable(
    path: string,
    consumer: ResourceConsumer,
    reason: UnsupportedResourceError["reason"] = "policy",
    chain: readonly string[] = [],
  ): void {
    const key = resourceResolutionKey(path, consumer);
    if (this.notified.has(key)) return;
    this.notified.add(key);
    const error = new UnsupportedResourceError(path, consumer, reason, chain);
    console.warn(error.message);
    for (const listener of this.listeners) listener(error);
  }

  public async select(path: string, consumer: ResourceConsumer): Promise<ManifestItem> {
    this.abort.signal.throwIfAborted();
    const key = resourceResolutionKey(path, consumer);
    const unsupported = this.unsupported.get(key);
    if (unsupported) throw unsupported;
    const cached = this.selected.get(key);
    if (cached) return cached;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = this.cancellable(this.walk(path, consumer)).then(
      (item) => {
        this.abort.signal.throwIfAborted();
        this.selected.set(key, item);
        return item;
      },
      (error: unknown) => {
        if (error instanceof UnsupportedResourceError && !this.notified.has(key)) {
          this.unsupported.set(key, error);
          this.notified.add(key);
          console.warn(error.message);
          for (const listener of this.listeners) listener(error);
        }
        throw error;
      },
    );
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    }
  }

  private cancellable<T>(work: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const signal = this.abort.signal;
      const aborted = (): void => reject(signal.reason);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    });
  }

  private async walk(path: string, consumer: ResourceConsumer): Promise<ManifestItem> {
    let item = this.pkg.findManifestItemByPath(path);
    const imageConsumer = consumer === "image" || consumer === "object" || consumer === "auto";
    const reference = classifyEpubReference("", path);
    if (!item && reference.kind === "data") {
      if (!imageConsumer) throw new UnsupportedResourceError(path, consumer, "policy", []);
      try {
        item = new ManifestItem("[embedded image]", path, embeddedDataImageType(path), new Set(),
          undefined, undefined, reference);
      } catch (error) {
        if (!(error instanceof EmbeddedDataImageError)) throw error;
        console.warn(error.message);
        throw new UnsupportedResourceError(path, consumer, "policy", []);
      }
    }
    if (!item)
      throw new ResourceResolutionError(`No manifest item found for resource path: ${path}`);
    const chain: string[] = [];
    const seen = new Set<string>();
    while (item) {
      this.abort.signal.throwIfAborted();
      if (seen.has(item.id))
        throw new UnsupportedResourceError(path, consumer, "cycle", [...chain, item.id]);
      chain.push(item.id);
      seen.add(item.id);
      const candidate = item;
      if (candidate.location && (candidate.location.kind !== "data" || !imageConsumer)) {
        console.warn(`Publication resource candidate "${candidate.id}" is blocked by the ${candidate.location.kind} URL policy.`);
      } else {
        try {
          const dataType = candidate.location?.kind === "data" ? embeddedDataImageType(candidate.path) : undefined;
          if (!dataType || dataType === candidate.mediaType.split(";")[0]!.trim().toLowerCase()) {
            if (dataType) await this.readResourceBytes(candidate.path);
            if (await this.capabilities.supports(candidate.mediaType, consumer,
              () => this.readResourceBytes(candidate.path), this.abort.signal)) {
              return item;
            }
          }
        } catch (error) {
          if (!(error instanceof EmbeddedDataImageError)) throw error;
          console.warn(error.message);
        }
      }
      if (item.fallback === undefined)
        throw new UnsupportedResourceError(path, consumer, "exhausted", chain);
      const target = item.fallback;
      item = this.pkg.getManifestItem(target);
      if (!item)
        throw new UnsupportedResourceError(path, consumer, "missing-target", [...chain, target]);
    }
    throw new Error("Resource fallback traversal ended unexpectedly.");
  }

  public dispose(): void {
    this.abort.abort(new ResourceResolutionCancelledError());
    this.selected.clear();
    this.unsupported.clear();
    this.pending.clear();
    this.listeners.clear();
    this.notified.clear();
    this.embeddedImages.clear();
    this.embeddedBytes = 0;
  }
}

export function resourceResolutionKey(path: string, consumer: ResourceConsumer): string {
  return JSON.stringify([consumer, path]);
}
