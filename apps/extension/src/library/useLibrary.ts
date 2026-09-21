import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importBook } from "./BookImporter.js";
import type { BookMetadata } from "./LibraryDatabase.js";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { DEFAULT_LIBRARY_SORT } from "./LibrarySortOption.js";
import type { LibrarySortOption } from "./LibrarySortOption.js";
import { LIBRARY_FULL_TAB_PARAM, LIBRARY_FULL_TAB_VALUE, openLibraryTab, openReaderTab } from "../navigation.js";
import { DEFAULT_CHROME_THEME } from "../reader/chromeTheme.js";
import type { ChromeThemeChoice } from "../reader/chromeTheme.js";
import { describeStorageError } from "../StorageErrors.js";

export interface LibraryBookViewModel extends BookMetadata {
  readonly coverUrl: string | undefined;
  /** Whole-book completion, 0–1 — see `ReadingProgress.fractionComplete`.
   * `undefined` for a book that's never been opened, or whose saved
   * progress predates this field / was saved in scroll mode. */
  readonly progressFraction: number | undefined;
}

/** A rough, purely-informational read on this origin's on-disk usage —
 * see `LibraryDatabase.estimateStorageUsage`. `undefined` until the
 * first estimate resolves, or permanently in a context where the
 * Storage API isn't available at all. */
export interface StorageUsageEstimate {
  readonly usageBytes: number;
  readonly quotaBytes: number | undefined;
}

export interface UseLibraryResult {
  books: readonly LibraryBookViewModel[];
  isLoading: boolean;
  error: string | undefined;
  /** Dismisses the current import-failure message (see
   * `LibraryImportError`) without otherwise affecting the library. */
  dismissError: () => void;
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
  /** How `books` is ordered — persisted across reloads via
   * `LibraryDatabase.getDefaultLibrarySort`. */
  sort: LibrarySortOption;
  setSort: (sort: LibrarySortOption) => void;
  /** `true` when this page is already showing in its own full browser
   * tab (see `openLibraryTab`) rather than the small toolbar popup —
   * `LibraryApp` uses this to hide its own "open in a new tab" button
   * once there's no smaller popup left to expand out of. */
  isFullTab: boolean;
  openInFullTab: () => void;
  /** See `StorageUsageEstimate` — `undefined` until the first estimate
   * resolves (or permanently, if the browser doesn't support it). */
  storageUsage: StorageUsageEstimate | undefined;
}

/** Owns the library's `LibraryDatabase` connection and book list for the
 * React library page: opens the database once, lists books (in whichever
 * order `sort` currently specifies), creates/revokes `blob:` object URLs
 * for cover images as the list changes so `<img>` tags can display them
 * directly, and reads the reader's own saved chrome theme preference so
 * the page can carry the same color across (see `chromeTheme` on
 * `UseLibraryResult`). */
export function useLibrary(): UseLibraryResult {
  const [db, setDb] = useState<LibraryDatabase | null>(null);
  const [rawBooks, setRawBooks] = useState<LibraryBookViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [chromeTheme, setChromeTheme] = useState<ChromeThemeChoice>(DEFAULT_CHROME_THEME);
  const [sort, setSortState] = useState<LibrarySortOption>(DEFAULT_LIBRARY_SORT);
  const [storageUsage, setStorageUsage] = useState<StorageUsageEstimate | undefined>(undefined);
  const coverUrlsRef = useRef(new Map<string, string>());

  const refreshStorageUsage = useCallback((): void => {
    void LibraryDatabase.estimateStorageUsage().then(setStorageUsage);
  }, []);

  const refresh = useCallback(async (database: LibraryDatabase): Promise<void> => {
    const metadataList = await database.listBooks();
    const progressByBookId = await database.getAllProgress();

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
        return { ...metadata, coverUrl, progressFraction: progressByBookId.get(metadata.id)?.fractionComplete };
      }),
    );

    setRawBooks(withCovers);
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
        const savedSort = await database.getDefaultLibrarySort();
        if (!cancelled && savedSort) {
          setSortState(savedSort);
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
    refreshStorageUsage();

    return () => {
      cancelled = true;
      for (const url of coverUrls.values()) {
        URL.revokeObjectURL(url);
      }
      coverUrls.clear();
    };
  }, [refresh, refreshStorageUsage]);

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
          setError(describeImportError(err, file.name));
        }
      }
      await refresh(db);
      refreshStorageUsage();
    },
    [db, refresh, refreshStorageUsage],
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
      refreshStorageUsage();
    },
    [db, refresh, refreshStorageUsage],
  );

  const openBook = useCallback((id: string): void => {
    void openReaderTab(id);
  }, []);

  const dismissError = useCallback((): void => {
    setError(undefined);
  }, []);

  const setSort = useCallback(
    (next: LibrarySortOption): void => {
      setSortState(next);
      void db?.setDefaultLibrarySort(next);
    },
    [db],
  );

  const openInFullTab = useCallback((): void => {
    void openLibraryTab();
  }, []);

  const isFullTab = useMemo(
    () => new URLSearchParams(window.location.search).get(LIBRARY_FULL_TAB_PARAM) === LIBRARY_FULL_TAB_VALUE,
    [],
  );

  const books = useMemo(() => sortBooks(rawBooks, sort), [rawBooks, sort]);

  return {
    books,
    isLoading,
    error,
    dismissError,
    importFiles,
    removeBook,
    openBook,
    chromeTheme,
    sort,
    setSort,
    isFullTab,
    openInFullTab,
    storageUsage,
  };
}

/** Collator-based comparison (locale-aware, case-insensitive) for the
 * title/author sorts — a plain `<`/`>` on raw strings would sort
 * "Zorro" before "apple" (capital letters sort before all lowercase
 * ones in code-point order), which reads as broken to anyone actually
 * looking for a book alphabetically. Date-based sorts don't need this,
 * since `addedAt` is already a plain numeric timestamp. */
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

function sortBooks(books: readonly LibraryBookViewModel[], sort: LibrarySortOption): LibraryBookViewModel[] {
  const sorted = [...books];
  switch (sort) {
    case "dateAddedAsc":
      sorted.sort((a, b) => a.addedAt - b.addedAt);
      break;
    case "titleAsc":
      sorted.sort((a, b) => collator.compare(a.title, b.title));
      break;
    case "authorAsc":
      // Books with no known author (rare, but not impossible for a
      // minimal/malformed EPUB) sort after every book that has one,
      // rather than clumping at the front the way an empty string
      // would under a plain locale comparison.
      sorted.sort((a, b) => {
        if (!a.creator && !b.creator) {
          return collator.compare(a.title, b.title);
        }
        if (!a.creator) {
          return 1;
        }
        if (!b.creator) {
          return -1;
        }
        return collator.compare(a.creator, b.creator) || collator.compare(a.title, b.title);
      });
      break;
    case "dateAddedDesc":
    default:
      sorted.sort((a, b) => b.addedAt - a.addedAt);
      break;
  }
  return sorted;
}

/** A friendlier message for an import failure — see
 * `describeStorageError`'s doc comment for the one case this
 * specifically improves on the raw error. */
function describeImportError(err: unknown, fileName: string): string {
  return describeStorageError(err, "import", `"${fileName}"`);
}
