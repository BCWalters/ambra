import { ContentLoader, EpubContainer } from "@ambra/engine";
import type { BookMetadata, LibraryDatabase } from "./LibraryDatabase.js";

export type BookImportPhase = "processing" | "saving";

/**
 * Parses `file` with the real engine (just enough to read metadata and
 * find a cover image — it never renders the book) and adds it to
 * `library`. Kept as a standalone function rather than a `LibraryDatabase`
 * method since it depends on the engine, while the database class itself
 * deliberately doesn't (it's just IndexedDB plumbing).
 */
export async function importBook(
  library: LibraryDatabase,
  file: File,
  onPhase?: (phase: BookImportPhase) => void,
): Promise<BookMetadata["id"]> {
  onPhase?.("processing");
  const buffer = await file.arrayBuffer();
  const container = await EpubContainer.open(buffer);
  const pkg = await container.getPackageDocument();

  let coverBlob: Blob | undefined;
  const coverItem = pkg.manifest.find((item) => item.hasProperty("cover-image"));
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
