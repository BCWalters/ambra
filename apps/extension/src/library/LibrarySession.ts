import type { BookMetadata, LibraryDatabase } from "./LibraryDatabase.js";

export interface LibraryBookViewModel extends BookMetadata {
  readonly coverUrl: string | undefined;
  readonly progressFraction: number | undefined;
}

/** One mounted library's database connection, cover URLs, and refresh ownership. */
export class LibrarySession {
  private readonly coverUrls = new Map<string, string>();
  private generation = 0;
  private disposed = false;

  public constructor(public readonly database: LibraryDatabase) {}

  public async refresh(): Promise<LibraryBookViewModel[] | undefined> {
    if (this.disposed) return undefined;
    const generation = ++this.generation;
    const isCurrent = () => !this.disposed && generation === this.generation;
    try {
      const [metadata, progress] = await Promise.all([
        this.database.listBooks(),
        this.database.getAllProgress(),
      ]);
      if (!isCurrent()) return undefined;
      const covers = await Promise.all(metadata.map((book) =>
        this.coverUrls.has(book.id) ? undefined : this.database.getCoverBlob(book.id),
      ));
      if (!isCurrent()) return undefined;

      // Allocate only after all reads succeed and this refresh still owns publication.
      const ids = new Set(metadata.map((book) => book.id));
      for (const [id, url] of this.coverUrls) {
        if (!ids.has(id)) {
          URL.revokeObjectURL(url);
          this.coverUrls.delete(id);
        }
      }
      return metadata.map((book, index) => {
        const cover = covers[index];
        if (cover && !this.coverUrls.has(book.id)) {
          this.coverUrls.set(book.id, URL.createObjectURL(cover));
        }
        return {
          ...book,
          coverUrl: this.coverUrls.get(book.id),
          progressFraction: progress.get(book.id)?.fractionComplete,
        };
      });
    } catch (error) {
      if (isCurrent()) throw error;
      return undefined;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    for (const url of this.coverUrls.values()) URL.revokeObjectURL(url);
    this.coverUrls.clear();
    this.database.close();
  }
}
