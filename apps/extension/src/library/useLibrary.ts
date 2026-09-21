import { useCallback, useEffect, useRef, useState } from "react";
import { importBook } from "./BookImporter.js";
import type { BookMetadata } from "./LibraryDatabase.js";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { openReaderTab } from "../navigation.js";
import { DEFAULT_CHROME_THEME } from "../reader/chromeTheme.js";
import type { ChromeThemeChoice } from "../reader/chromeTheme.js";

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
  /** The same "Reader Theme" chosen in the reader's own Settings menu
   * (`ReaderController.setChromeTheme`/`LibraryDatabase.
   * getDefaultChromeTheme`) — read once, here, so the Library page can
   * carry the same chrome color across as its own page background
   * rather than reading as a completely separate, undecorated app once
   * a reader has picked a theme. Not editable from here; the Settings
   * menu inside the reader remains the one place it's chosen. */
  chromeTheme: ChromeThemeChoice;
}

/** Owns the library's `LibraryDatabase` connection and book list for the
 * React library page: opens the database once, lists books (newest
 * first), creates/revokes `blob:` object URLs for cover images as the
 * list changes so `<img>` tags can display them directly, and reads the
 * reader's own saved chrome theme preference so the page can carry the
 * same color across (see `chromeTheme` on `UseLibraryResult`). */
export function useLibrary(): UseLibraryResult {
  const [db, setDb] = useState<LibraryDatabase | null>(null);
  const [books, setBooks] = useState<LibraryBookViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [chromeTheme, setChromeTheme] = useState<ChromeThemeChoice>(DEFAULT_CHROME_THEME);
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
        const savedTheme = await database.getDefaultChromeTheme();
        if (!cancelled && savedTheme) {
          setChromeTheme(savedTheme);
        }
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

  return { books, isLoading, error, importFiles, removeBook, openBook, chromeTheme };
}
