import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importBook } from "./BookImporter.js";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { LibrarySession, type LibraryBookViewModel } from "./LibrarySession.js";
import { DEFAULT_LIBRARY_SORT } from "./LibrarySortOption.js";
import type { LibrarySortOption } from "./LibrarySortOption.js";
import { LIBRARY_FULL_TAB_PARAM, LIBRARY_FULL_TAB_VALUE, LIBRARY_IMPORT_URL_PARAM, openLibraryTab, openReaderTab } from "../navigation.js";
import { DEFAULT_CHROME_THEME } from "../reader/chromeTheme.js";
import type { ChromeThemeChoice } from "../reader/chromeTheme.js";
import { EpubInspectionSession } from "../reader/EpubInspectionSession.js";
import { describeStorageError } from "../StorageErrors.js";

export type { LibraryBookViewModel } from "./LibrarySession.js";

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
  /** Opens a standalone `EpubInspectionSession` (issue #111) directly
   * from a library book's stored bytes — no live `ReaderController`/
   * reading session needed. Rejects if the book's file is missing or
   * fails to parse; the caller decides how to surface that. */
  openInspectionSession: (id: string) => Promise<EpubInspectionSession>;
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
  const sessionRef = useRef<LibrarySession | undefined>(undefined);

  const ownsDatabase = useCallback((database: LibraryDatabase): boolean =>
    sessionRef.current?.database === database, []);

  const refreshStorageUsage = useCallback((): void => {
    const session = sessionRef.current;
    if (!session) return;
    void LibraryDatabase.estimateStorageUsage().then((estimate) => {
      if (sessionRef.current === session) setStorageUsage(estimate);
    });
  }, []);

  const refresh = useCallback(async (database: LibraryDatabase): Promise<void> => {
    const session = sessionRef.current;
    if (!session || session.database !== database) return;
    const books = await session.refresh();
    if (books && sessionRef.current === session) setRawBooks(books);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let session: LibrarySession | undefined;

    void (async () => {
      try {
        const database = await LibraryDatabase.open();
        if (cancelled) {
          database.close();
          return;
        }
        session = new LibrarySession(database);
        sessionRef.current = session;
        setDb(database);
        refreshStorageUsage();
        const [savedTheme, savedSort] = await Promise.all([
          database.getDefaultChromeTheme(), database.getDefaultLibrarySort(),
        ]);
        if (cancelled) return;
        if (savedTheme) setChromeTheme(savedTheme);
        if (savedSort) setSortState(savedSort);
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
      if (sessionRef.current === session) sessionRef.current = undefined;
      session?.dispose();
    };
  }, [refresh, refreshStorageUsage]);

  const importFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (!db || !ownsDatabase(db)) {
        return;
      }
      setError(undefined);
      for (const file of files) {
        if (!ownsDatabase(db)) return;
        try {
          await importBook(db, file);
        } catch (err) {
          if (ownsDatabase(db)) setError(describeImportError(err, file.name));
        }
      }
      try {
        await refresh(db);
        if (ownsDatabase(db)) refreshStorageUsage();
      } catch (err) {
        if (ownsDatabase(db)) setError(describeStorageError(err, "refresh", "your library"));
      }
    },
    [db, ownsDatabase, refresh, refreshStorageUsage],
  );

  const removeBook = useCallback(
    async (id: string): Promise<void> => {
      if (!db || !ownsDatabase(db)) {
        return;
      }
      setError(undefined);
      try {
        await db.deleteBook(id);
      } catch (err) {
        if (ownsDatabase(db)) setError(describeStorageError(err, "remove", "that book"));
        return;
      }
      try {
        await refresh(db);
        if (ownsDatabase(db)) refreshStorageUsage();
      } catch (err) {
        if (ownsDatabase(db)) setError(describeStorageError(err, "refresh", "your library"));
      }
    },
    [db, ownsDatabase, refresh, refreshStorageUsage],
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
      if (db && ownsDatabase(db)) {
        void db.setDefaultLibrarySort(next).catch((err) => {
          if (ownsDatabase(db)) setError(describeStorageError(err, "save", "your library sort"));
        });
      }
    },
    [db, ownsDatabase],
  );

  const openInFullTab = useCallback((): void => {
    void openLibraryTab();
  }, []);

  const openInspectionSession = useCallback(
    async (id: string): Promise<EpubInspectionSession> => {
      if (!db || !ownsDatabase(db)) {
        throw new Error("The library isn't ready yet.");
      }
      const blob = await db.getBookFile(id);
      if (!blob) {
        throw new Error("This book's file couldn't be found.");
      }
      return EpubInspectionSession.openStandalone(await blob.arrayBuffer());
    },
    [db, ownsDatabase],
  );

  const isFullTab = useMemo(
    () => new URLSearchParams(window.location.search).get(LIBRARY_FULL_TAB_PARAM) === LIBRARY_FULL_TAB_VALUE,
    [],
  );

  // Issue #122: a proactively-intercepted EPUB download (`epubDirectImport.ts`)
  // lands here as a source URL to fetch and import automatically, rather
  // than ever reaching the Downloads folder. A ref (not just gating on
  // `db`) guards against double-handling — React 18 Strict Mode's
  // development-only double-invocation of effects would otherwise import
  // the same book twice.
  const importUrlHandledRef = useRef(false);
  useEffect(() => {
    if (!db || importUrlHandledRef.current) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get(LIBRARY_IMPORT_URL_PARAM);
    if (!importUrl) {
      return;
    }
    importUrlHandledRef.current = true;
    // Strip the param immediately (not after the fetch resolves) so a
    // reload while the fetch is still in flight can't re-trigger it.
    params.delete(LIBRARY_IMPORT_URL_PARAM);
    const nextSearch = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);

    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(importUrl, { signal: abort.signal });
        if (!response.ok) {
          throw new Error(`That download couldn't be fetched (HTTP ${response.status}).`);
        }
        const blob = await response.blob();
        if (abort.signal.aborted || !ownsDatabase(db)) return;
        const file = new File([blob], suggestedFileNameFor(importUrl), { type: "application/epub+zip" });
        await importFiles([file]);
      } catch (err) {
        if (!abort.signal.aborted && ownsDatabase(db)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => abort.abort();
  }, [db, importFiles, ownsDatabase]);

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
    openInspectionSession,
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

/** A reasonable filename for a book fetched from `url` (issue #122) —
 * `File`'s own name is purely informational here (`BookImporter` never
 * requires a `.epub` extension to import successfully), but showing a
 * blank or clearly-wrong name in the library's own UI later would be a
 * needless rough edge. Falls back to a generic name if the URL's last
 * path segment is missing or empty (e.g. a bare domain). */
function suggestedFileNameFor(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    if (last) {
      return /\.epub/i.test(last) ? last : `${last}.epub`;
    }
  } catch {
    // Fall through to the generic name below.
  }
  return "book.epub";
}
