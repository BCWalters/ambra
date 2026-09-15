/** Book metadata as stored in the library — small enough to list in bulk
 * without touching the (potentially large) book file/cover blobs, which
 * live in their own object stores. */
export interface BookMetadata {
  readonly id: string;
  readonly title: string;
  readonly creator: string | undefined;
  readonly identifier: string;
  readonly addedAt: number;
}

interface BlobRecord {
  readonly id: string;
  readonly blob: Blob;
}

const DB_NAME = "pagina-library";
const DB_VERSION = 1;
const BOOKS_STORE = "books";
const FILES_STORE = "bookFiles";
const COVERS_STORE = "bookCovers";

/**
 * The extension's local book library: book metadata, the original EPUB
 * file bytes, and (optionally) a cover image, each in their own IndexedDB
 * object store so listing the library doesn't have to touch the large
 * blobs. All local-only in v1, no cloud sync — see the wave-1 plan's
 * storage section.
 */
export class LibraryDatabase {
  private constructor(private readonly db: IDBDatabase) {}

  public static open(): Promise<LibraryDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BOOKS_STORE)) {
          db.createObjectStore(BOOKS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          db.createObjectStore(FILES_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(COVERS_STORE)) {
          db.createObjectStore(COVERS_STORE, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(new LibraryDatabase(request.result));
      request.onerror = () => reject(request.error ?? new Error("Failed to open the Pagina library database."));
    });
  }

  /** Adds a book to the library and returns its generated id. */
  public async addBook(
    fileBlob: Blob,
    metadata: Omit<BookMetadata, "id" | "addedAt">,
    coverBlob: Blob | undefined,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const record: BookMetadata = { id, addedAt: Date.now(), ...metadata };

    await this.put(BOOKS_STORE, record);
    await this.put(FILES_STORE, { id, blob: fileBlob });
    if (coverBlob) {
      await this.put(COVERS_STORE, { id, blob: coverBlob });
    }
    return id;
  }

  public listBooks(): Promise<BookMetadata[]> {
    return this.getAll<BookMetadata>(BOOKS_STORE);
  }

  public async getBookFile(id: string): Promise<Blob | undefined> {
    return (await this.get<BlobRecord>(FILES_STORE, id))?.blob;
  }

  public async getCoverBlob(id: string): Promise<Blob | undefined> {
    return (await this.get<BlobRecord>(COVERS_STORE, id))?.blob;
  }

  public async deleteBook(id: string): Promise<void> {
    await this.delete(BOOKS_STORE, id);
    await this.delete(FILES_STORE, id);
    await this.delete(COVERS_STORE, id);
  }

  public close(): void {
    this.db.close();
  }

  private put(storeName: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to write to the "${storeName}" store.`));
    });
  }

  private get<T>(storeName: string, key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error(`Failed to read from the "${storeName}" store.`));
    });
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error ?? new Error(`Failed to read from the "${storeName}" store.`));
    });
  }

  private delete(storeName: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed to delete from the "${storeName}" store.`));
    });
  }
}
