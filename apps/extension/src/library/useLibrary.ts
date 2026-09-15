import { useCallback, useEffect, useRef, useState } from "react";
import { importBook } from "./BookImporter.js";
import type { BookMetadata } from "./LibraryDatabase.js";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { openReaderTab } from "../navigation.js";

export interface LibraryBookViewModel extends BookMetadata {
  readonly coverUrl: string | undefined;
}

export interface UseLibraryResult {
  books: readonly LibraryBookViewModel[];
  isLoading: boolean;
  error: string | undefined;
  importFiles: (files: readonly File[]) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  openBook: (id: string) => void;
}

/** Owns the library's `LibraryDatabase` connection and book list for the
 * React library page: opens the database once, lists books (newest
 * first), and creates/revokes `blob:` object URLs for cover images as the
 * list changes so `<img>` tags can display them directly. */
export function useLibrary(): UseLibraryResult {
  const [db, setDb] = useState<LibraryDatabase | null>(null);
  const [books, setBooks] = useState<LibraryBookViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const coverUrlsRef = useRef(new Map<string, string>());

  const refresh = useCallback(async (database: LibraryDatabase): Promise<void> => {
    const metadataList = await database.listBooks();

    const withCovers = await Promise.all(
      metadataList.map(async (metadata): Promise<LibraryBookViewModel> => {
        let coverUrl = coverUrlsRef.current.get(metadata.id);
        if (!coverUrl) {
          const blob = await database.getCoverBlob(metadata.id);
          if (blob) {
            coverUrl = URL.createObjectURL(blob);
            coverUrlsRef.current.set(metadata.id, coverUrl);
          }
        }
        return { ...metadata, coverUrl };
      }),
    );

    withCovers.sort((a, b) => b.addedAt - a.addedAt);
    setBooks(withCovers);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const coverUrls = coverUrlsRef.current;

    void (async () => {
      try {
        const database = await LibraryDatabase.open();
        if (cancelled) {
          database.close();
          return;
        }
        setDb(database);
        await refresh(database);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const url of coverUrls.values()) {
        URL.revokeObjectURL(url);
      }
      coverUrls.clear();
    };
  }, [refresh]);

  const importFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (!db) {
        return;
      }
      setError(undefined);
      for (const file of files) {
        try {
          await importBook(db, file);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      await refresh(db);
    },
    [db, refresh],
  );

  const removeBook = useCallback(
    async (id: string): Promise<void> => {
      if (!db) {
        return;
      }
      await db.deleteBook(id);
      const coverUrl = coverUrlsRef.current.get(id);
      if (coverUrl) {
        URL.revokeObjectURL(coverUrl);
        coverUrlsRef.current.delete(id);
      }
      await refresh(db);
    },
    [db, refresh],
  );

  const openBook = useCallback((id: string): void => {
    void openReaderTab(id);
  }, []);

  return { books, isLoading, error, importFiles, removeBook, openBook };
}
