import { ContentLoader, EpubContainer } from "@ambra/engine";
import type { BookImportResult, LibraryDatabase } from "./LibraryDatabase.js";

export type BookImportPhase = "processing" | "saving";

const COVER_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/svg+xml",
  "image/webp", "image/avif", "image/bmp",
]);

/**
 * Parses `file` with the real engine (just enough to read metadata and
 * find a cover image — it never renders the book) and adds it to
 * `library`. Prefers EPUB3 cover-image, then a supported image referenced
 * by EPUB2 cover metadata. Kept as a standalone function rather than a `LibraryDatabase`
 * method since it depends on the engine, while the database class itself
 * deliberately doesn't (it's just IndexedDB plumbing).
 */
export async function importBook(
  library: Pick<LibraryDatabase, "addBook">,
  file: File,
  onPhase?: (phase: BookImportPhase) => void,
): Promise<BookImportResult> {
  onPhase?.("processing");
  const buffer = await file.arrayBuffer();
  const container = await EpubContainer.open(buffer);
  const pkg = await container.getPackageDocument();

  let coverBlob: Blob | undefined;
  let coverItem = pkg.manifest.find((item) => item.hasProperty("cover-image"));
  if (!coverItem) {
    const coverId = pkg.metadata.metaEntries.find((entry) => entry.key === "cover" && entry.refines === undefined)?.value;
    if (coverId) {
      const declaredCover = pkg.getManifestItem(coverId);
      if (declaredCover && COVER_IMAGE_MEDIA_TYPES.has(declaredCover.mediaType)) {
        coverItem = declaredCover;
      } else {
        console.warn("Ambra ignored a cover declaration that does not reference a supported image.", coverId);
      }
    }
  }
  if (coverItem) {
    const contentLoader = await ContentLoader.create(container);
    const bytes = await contentLoader.loadResourceBytes(coverItem.path);
    coverBlob = new Blob([new Uint8Array(bytes)], { type: coverItem.mediaType });
  }

  onPhase?.("saving");
  return library.addBook(
    new Blob([buffer], { type: "application/epub+zip" }),
    {
      title: pkg.metadata.title,
      creator: pkg.metadata.creator,
      identifier: pkg.metadata.identifier,
      fileName: file.name,
      fetchedDescription: undefined,
      fetchedDescriptionSourceName: undefined,
      fetchedDescriptionSourceUrl: undefined,
      descriptionFetchAttempts: undefined,
      description: pkg.metadata.description,
      publisher: pkg.metadata.publisher,
      rights: pkg.metadata.rights,
      identifiers: pkg.metadata.identifiers,
      accessibility: pkg.metadata.accessibility,
    },
    coverBlob,
  );
}
