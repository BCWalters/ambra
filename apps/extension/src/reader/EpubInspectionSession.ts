import {
  ContentLoader,
  EpubContainer,
  NCX_MEDIA_TYPE,
  type PackageDocument,
} from "@ambra/engine";
import type { EpubInspectionData, EpubInspectionFile } from "./ReaderTypes.js";

/**
 * Builds and serves EPUB Inspector data (issue #46) from an already-open
 * `ContentLoader`/`PackageDocument` pair — the archive-listing +
 * metadata assembly, file ordering, and on-demand raw-file/preview-URL
 * reads that used to live directly on `ReaderController`. Pulled out
 * so the same inspector can be driven by a live reading session
 * (`ReaderController`) or a standalone one opened just to inspect a
 * library book that isn't currently being read (issue #111) — either
 * caller only needs to open the container once and hand the resulting
 * `pkg`/`contentLoader` here.
 */
export class EpubInspectionSession {
  private readonly previewUrlCache = new Map<string, string>();
  private readonly pendingPreviews = new Map<string, Promise<string>>();
  private disposed = false;

  public constructor(
    private readonly contentLoader: ContentLoader,
    private readonly pkg: PackageDocument,
    private readonly rootFilePath: string,
  ) {}

  /** Opens a book's raw bytes just far enough to inspect it — no
   * rendering surface, navigation, or locator resolver, none of which
   * the Inspector itself needs. */
  public static async openStandalone(buffer: ArrayBuffer): Promise<EpubInspectionSession> {
    const container = await EpubContainer.open(buffer);
    const contentLoader = await ContentLoader.create(container);
    return new EpubInspectionSession(contentLoader, contentLoader.packageDocument, container.rootFilePath);
  }

  public getEpubInspectionData(): EpubInspectionData {
    const manifestMediaTypeByPath = new Map(this.pkg.manifest.map((item) => [item.path, item.mediaType]));

    return {
      files: this.orderInspectionFiles(
        this.contentLoader.archiveEntries
          .filter((entry) => !entry.isDirectory)
          .map((entry) => ({
            path: entry.fileName,
            size: entry.uncompressedSize,
            isDirectory: entry.isDirectory,
            mediaType: manifestMediaTypeByPath.get(entry.fileName),
          })),
      ),
      rootFilePath: this.rootFilePath,
      title: this.pkg.metadata.title,
      identifiers: this.pkg.metadata.identifiers,
      language: this.pkg.metadata.language,
      creator: this.pkg.metadata.creator,
      creators: this.pkg.metadata.creators,
      publisher: this.pkg.metadata.publisher,
      description: this.pkg.metadata.description,
      renditionLayout: this.pkg.metadata.renditionLayout,
      renditionOrientation: this.pkg.metadata.renditionOrientation,
      rights: this.pkg.metadata.rights,
      date: this.pkg.metadata.date,
      subjects: this.pkg.metadata.subjects,
      contributors: this.pkg.metadata.contributors,
      metaEntries: this.pkg.metadata.metaEntries,
      manifest: this.pkg.manifest.map((item) => ({
        id: item.id,
        path: item.path,
        mediaType: item.mediaType,
        properties: Array.from(item.properties),
      })),
      spine: this.pkg.spine.map((spineItemRef) => ({
        path: spineItemRef.manifestItem.path,
        linear: spineItemRef.linear,
        mediaType: spineItemRef.manifestItem.mediaType,
        properties: Array.from(spineItemRef.properties),
      })),
    };
  }

  /** Orders Inspector files by EPUB structure: core container files first,
   * then spine items in reading order, then other manifest resources, and
   * finally non-manifest leftovers. */
  private orderInspectionFiles(
    files: readonly { path: string; size: number; isDirectory: boolean; mediaType: string | undefined }[],
  ): EpubInspectionFile[] {
    const rootFilePath = this.rootFilePath;
    const navPath = this.pkg.manifest.find((item) => item.isNavDocument)?.path;
    const ncxPath = this.pkg.manifest.find((item) => item.mediaType === NCX_MEDIA_TYPE)?.path;
    const spineOrder = new Map(this.pkg.spine.map((ref, index) => [ref.manifestItem.path, index]));

    function groupOf(path: string): number {
      if (path === "mimetype") {
        return 0;
      }
      if (path.startsWith("META-INF/")) {
        return 1;
      }
      if (path === rootFilePath) {
        return 2;
      }
      if (path === ncxPath) {
        return 3;
      }
      if (path === navPath) {
        return 4;
      }
      if (spineOrder.has(path)) {
        return 5;
      }
      return 6;
    }

    return files
      .map((file, originalIndex) => ({ file, originalIndex }))
      .sort((a, b) => {
        const groupA = groupOf(a.file.path);
        const groupB = groupOf(b.file.path);
        if (groupA !== groupB) {
          return groupA - groupB;
        }
        if (groupA === 5) {
          // Within the spine group, preserve reading order instead of
          // archive order.
          return (spineOrder.get(a.file.path) ?? 0) - (spineOrder.get(b.file.path) ?? 0);
        }
        return a.originalIndex - b.originalIndex;
      })
      .map(({ file }) => file);
  }

  /** Reads one archive file's raw text for the Inspector file browser,
   * without any rendering-time parsing or rewriting. */
  public readInspectionFileText(path: string): Promise<string> {
    return this.contentLoader.readArchiveFileText(path);
  }

  /** Builds and caches an object URL for an Inspector media preview.
   * The caller supplies the resolved `mediaType` so the preview element
   * gets a correctly typed `Blob`. */
  public getInspectionFilePreviewUrl(path: string, mediaType: string): Promise<string> {
    if (this.disposed) return Promise.reject(new Error("The EPUB inspection session has been closed."));
    const cached = this.previewUrlCache.get(path);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    const pending = this.pendingPreviews.get(path);
    if (pending) return pending;
    const request = this.createPreviewUrl(path, mediaType).finally(() => {
      this.pendingPreviews.delete(path);
    });
    this.pendingPreviews.set(path, request);
    return request;
  }

  private async createPreviewUrl(path: string, mediaType: string): Promise<string> {
    const bytes = await this.contentLoader.readArchiveFileBytes(path);
    if (this.disposed) throw new Error("The EPUB inspection session has been closed.");
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType }));
    this.previewUrlCache.set(path, url);
    return url;
  }

  /** Revokes every cached preview object URL — call when the session is
   * no longer needed (a live `ReaderController`'s own lifetime already
   * covers this via its existing `dispose`; a standalone session opened
   * just to inspect a library book must call this itself). */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const url of this.previewUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.previewUrlCache.clear();
    this.pendingPreviews.clear();
  }
}
