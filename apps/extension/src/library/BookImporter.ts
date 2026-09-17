import { ContentLoader, EpubContainer } from "@pagina/engine";
import type { BookMetadata } from "./LibraryDatabase.js";
import { LibraryDatabase } from "./LibraryDatabase.js";

/**
 * Parses `file` with the real engine (just enough to read metadata and
 * find a cover image — it never renders the book) and adds it to
 * `library`. Kept as a standalone function rather than a `LibraryDatabase`
 * method since it depends on the engine, while the database class itself
 * deliberately doesn't (it's just IndexedDB plumbing).
 */
export async function importBook(library: LibraryDatabase, file: File): Promise<BookMetadata["id"]> {
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

  return library.addBook(
    new Blob([buffer], { type: "application/epub+zip" }),
    { title: pkg.metadata.title, creator: pkg.metadata.creator, identifier: pkg.metadata.identifier, fileName: file.name },
    coverBlob,
  );
}
