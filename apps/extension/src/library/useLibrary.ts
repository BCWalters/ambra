import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importBook } from "./BookImporter.js";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { LibrarySession, type LibraryBookViewModel } from "./LibrarySession.js";
import { DEFAULT_LIBRARY_SORT } from "./LibrarySortOption.js";
import type { LibrarySortOption } from "./LibrarySortOption.js";
import { LIBRARY_FULL_TAB_PARAM, LIBRARY_FULL_TAB_VALUE, LIBRARY_IMPORT_URL_PARAM, openLibraryTab, openReaderTab } from "../navigation.js";
import type { ChromeThemeChoice } from "../reader/chromeTheme.js";
import { DEFAULT_GLOBAL_READING_SETTINGS, type GlobalReadingSettings } from "./ReadingSettings.js";
import { EpubInspectionSession } from "../reader/EpubInspectionSession.js";
import { useLocale, useTranslation } from "../i18n/LocaleContext.js";
import type { StringCatalog } from "../i18n/locales/en.js";
import { EPUB_IMPORT_ACTIVE, EPUB_IMPORT_CANCEL, EPUB_IMPORT_RESULT, LIBRARY_IMPORT_TOKEN_PARAM, hasImportHostAccess, httpImportOrigins } from "../epubImportHandoff.js";
import type { LibraryImportActivity } from "./LibraryImportStatus.js";
import { readLibraryDownload } from "./LibraryDownload.js";
import { saveLibraryBookAs } from "./LibrarySaveAs.js";
import { isInvalidEpubError } from "../EpubErrors.js";

type LibraryError = string |
  { key: keyof StringCatalog; params?: Record<string, string | number>; headline?: keyof StringCatalog } |
  { detail: string; headline: keyof StringCatalog };

function describeLibraryStorageError(error: unknown, fileName?: string): LibraryError {
  if (isInvalidEpubError(error)) {
    return { detail: error instanceof Error ? error.message : String(error), headline: "error.invalidEpubHeadline" };
  }
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return fileName ? { key: "library.importStorageFull", params: { fileName } } : { key: "library.storageFull" };
  }
  return error instanceof Error ? error.message : String(error);
}

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
  /** Import requires a live database and completed initial library loading. */
  canImport: boolean;
  importActivities: readonly LibraryImportActivity[];
  dismissCompletedImports: () => void;
  /** Returns false if the download has already entered processing. */
  cancelDownload: (id: number) => boolean;
  error: string | undefined;
  errorHeadline?: string;
  /** Dismisses the current import-failure message (see
   * `LibraryImportError`) without otherwise affecting the library. */
  dismissError: () => void;
  importFiles: (files: readonly File[]) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  openBook: (id: string) => void;
  saveBookAs: (id: string) => Promise<void>;
  /** App-global settings, shared live with open readers. */
  chromeTheme: ChromeThemeChoice;
  settings: GlobalReadingSettings;
  setSettings: (patch: Partial<GlobalReadingSettings>) => void;
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
 * directly, and keeps app-global settings in sync with open readers. */
export function useLibrary(): UseLibraryResult {
  const t = useTranslation();
  const { locale } = useLocale();
  const translateRef = useRef(t);
  translateRef.current = t;
  const [db, setDb] = useState<LibraryDatabase | null>(null);
  const [rawBooks, setRawBooks] = useState<LibraryBookViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<LibraryError | undefined>(undefined);
  const [importActivities, setImportActivities] = useState<LibraryImportActivity[]>([]);
  const nextImportId = useRef(0);
  const cancelDownloadRef = useRef<((id: number) => boolean) | undefined>(undefined);
  const cancelDownload = useCallback((id: number) => cancelDownloadRef.current?.(id) ?? false, []);
  const [settings, setSettingsState] = useState<GlobalReadingSettings>(DEFAULT_GLOBAL_READING_SETTINGS);
  const settingsRevision = useRef(0);
  const [sort, setSortState] = useState<LibrarySortOption>(DEFAULT_LIBRARY_SORT);
  const [storageUsage, setStorageUsage] = useState<StorageUsageEstimate | undefined>(undefined);
  const sessionRef = useRef<LibrarySession | undefined>(undefined);
  const canImport = db !== null && !isLoading;

  const ownsDatabase = useCallback((database: LibraryDatabase): boolean =>
    sessionRef.current?.database === database, []);

  const startImports = useCallback((files: readonly { name: string }[], phase: LibraryImportActivity["phase"]) => {
    const activities = files.map(({ name }) => ({ id: ++nextImportId.current, fileName: name, phase }));
    setImportActivities((current) => [...current.filter((entry) => entry.phase !== "complete"), ...activities]);
    return activities;
  }, []);

  const updateImport = useCallback((id: number, phase?: LibraryImportActivity["phase"], bookId?: string) => {
    setImportActivities((current) => phase
      ? current.map((entry) => entry.id === id ? {
        ...entry, phase, download: phase === "downloading" ? entry.download : undefined,
        ...(bookId ? { bookId } : {}),
      } : entry)
      : current.filter((entry) => entry.id !== id));
  }, []);

  const dismissCompletedImports = useCallback(() => {
    setImportActivities((current) => current.filter((entry) => entry.phase !== "complete"));
  }, []);

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

  const refreshSettings = useCallback(async (database: LibraryDatabase): Promise<void> => {
    const revision = ++settingsRevision.current;
    const saved = await database.getGlobalReadingSettings();
    if (ownsDatabase(database) && revision === settingsRevision.current) setSettingsState(saved);
  }, [ownsDatabase]);

  useEffect(() => {
    let cancelled = false;
    let session: LibrarySession | undefined;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeBooks: (() => void) | undefined;

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
        unsubscribe = database.subscribePreferences(() => {
          void refreshSettings(database).catch((err) => {
            if (!cancelled) setError(describeLibraryStorageError(err));
          });
        });
        unsubscribeBooks = database.subscribeBooks(() => {
          void refresh(database).then(() => {
            if (!cancelled) refreshStorageUsage();
          }).catch((err) => {
            if (!cancelled) setError(describeLibraryStorageError(err));
          });
        });
        const [, savedSort] = await Promise.all([
          refreshSettings(database), database.getDefaultLibrarySort(),
        ]);
        if (cancelled) return;
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
      unsubscribe?.();
      unsubscribeBooks?.();
      if (sessionRef.current === session) sessionRef.current = undefined;
      session?.dispose();
    };
  }, [refresh, refreshStorageUsage, refreshSettings]);

  const setSettings = useCallback((patch: Partial<GlobalReadingSettings>): void => {
    if (!db || !ownsDatabase(db) || isLoading) return;
    void db.patchGlobalReadingSettings(patch).then(() => {
      if (ownsDatabase(db)) return refreshSettings(db);
    }).catch((err) => {
      if (ownsDatabase(db)) setError(describeLibraryStorageError(err));
    });
  }, [db, isLoading, ownsDatabase, refreshSettings]);

  const importFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (db && !ownsDatabase(db)) return;
      if (!db || !canImport) {
        setError((current) => current ?? { key: "library.importNotReady" });
        return;
      }
      if (!files.length) return;
      setError(undefined);
      const activities = startImports(files, "queued");
      const saved: { activityId: number; bookId: string }[] = [];
      for (const [index, file] of files.entries()) {
        if (!ownsDatabase(db)) return;
        const activity = activities[index]!;
        updateImport(activity.id, "processing");
        try {
          const bookId = await importBook(db, file, (phase) => {
            if (ownsDatabase(db)) updateImport(activity.id, phase);
          });
          if (!ownsDatabase(db)) return;
          saved.push({ activityId: activity.id, bookId });
        } catch (err) {
          if (ownsDatabase(db)) {
            updateImport(activity.id);
            setError(describeLibraryStorageError(err, file.name));
          }
        }
      }
      try {
        await refresh(db);
        if (ownsDatabase(db)) refreshStorageUsage();
      } catch (err) {
        if (ownsDatabase(db)) setError(describeLibraryStorageError(err));
      } finally {
        if (ownsDatabase(db)) {
          for (const { activityId, bookId } of saved) updateImport(activityId, "complete", bookId);
        }
      }
    },
    [db, canImport, ownsDatabase, refresh, refreshStorageUsage, startImports, updateImport],
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
        if (ownsDatabase(db)) setError(describeLibraryStorageError(err));
        return;
      }
      try {
        await refresh(db);
        if (ownsDatabase(db)) refreshStorageUsage();
      } catch (err) {
        if (ownsDatabase(db)) setError(describeLibraryStorageError(err));
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
          if (ownsDatabase(db)) setError(describeLibraryStorageError(err));
        });
      }
    },
    [db, ownsDatabase],
  );

  const openInFullTab = useCallback((): void => {
    void openLibraryTab();
  }, []);

  const saveBookAs = useCallback(async (id: string): Promise<void> => {
    if (!db || !ownsDatabase(db)) {
      throw new Error(translateRef.current("library.notReady"));
    }
    await saveLibraryBookAs(db, id, translateRef.current);
  }, [db, ownsDatabase]);

  const openInspectionSession = useCallback(
    async (id: string): Promise<EpubInspectionSession> => {
      if (!db || !ownsDatabase(db)) {
        throw new Error(translateRef.current("library.notReady"));
      }
      const blob = await db.getBookFile(id);
      if (!blob) {
        throw new Error(translateRef.current("library.fileMissing"));
      }
      return EpubInspectionSession.openStandalone(await blob.arrayBuffer());
    },
    [db, ownsDatabase],
  );

  const isFullTab = useMemo(
    () => new URLSearchParams(window.location.search).get(LIBRARY_FULL_TAB_PARAM) === LIBRARY_FULL_TAB_VALUE,
    [],
  );

  // The paused Chrome download remains a fallback until persistence succeeds.
  // The ref also prevents duplicate imports in StrictMode.
  const importUrlHandledRef = useRef(false);
  useEffect(() => {
    if (!db || !canImport || importUrlHandledRef.current) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const importUrl = params.get(LIBRARY_IMPORT_URL_PARAM);
    if (!importUrl) {
      return;
    }
    importUrlHandledRef.current = true;
    const token = params.get(LIBRARY_IMPORT_TOKEN_PARAM);
    // Strip the param immediately (not after the fetch resolves) so a
    // reload while the fetch is still in flight can't re-trigger it.
    params.delete(LIBRARY_IMPORT_URL_PARAM);
    params.delete(LIBRARY_IMPORT_TOKEN_PARAM);
    const nextSearch = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);

    const abort = new AbortController();
    const activity = startImports([{ name: suggestedFileNameFor(importUrl) }], "downloading")[0]!;
    const reportActive = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: EPUB_IMPORT_ACTIVE, token });
        if (response?.received !== true) {
          console.warn("Ambra could not report EPUB import activity. Chrome may resume the original download.");
        }
      } catch (error) {
        console.warn("Ambra could not report EPUB import activity. Chrome may resume the original download.", error);
      }
    };
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let downloading = true;
    let userCancelled = false;
    const cancel = (id: number): boolean => {
      if (id !== activity.id || !downloading || abort.signal.aborted || !ownsDatabase(db)) return false;
      // Set this before aborting: the fetch's finally must never resume the
      // original Chrome download via a normal failed-import result.
      userCancelled = true;
      downloading = false;
      clearInterval(heartbeat);
      abort.abort();
      updateImport(activity.id);
      if (token) {
        void (async () => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const response = await Promise.race([
              chrome.runtime.sendMessage({ type: EPUB_IMPORT_CANCEL, token }),
              new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error("Cancellation acknowledgement timed out")), 5_000);
              }),
            ]);
            if (response?.received !== true) throw new Error("Cancellation not acknowledged");
          } catch {
            if (ownsDatabase(db)) setError({ key: "library.cancelDownloadFailed" });
          } finally {
            clearTimeout(timeout);
          }
        })();
      }
      return true;
    };
    cancelDownloadRef.current = cancel;
    void (async () => {
      let importing = false;
      let imported = false;
      let bookId: string | undefined;
      try {
        if (!httpImportOrigins([importUrl])) {
          setError({ key: "library.downloadUnsupported" });
          return;
        }
        if (!await hasImportHostAccess([importUrl])) {
          if (!abort.signal.aborted && ownsDatabase(db)) {
            setError({ key: "library.downloadAccessDenied" });
          }
          return;
        }
        if (abort.signal.aborted || !ownsDatabase(db)) return;
        if (token) {
          await reportActive();
          if (abort.signal.aborted || !ownsDatabase(db)) return;
          heartbeat = setInterval(() => { void reportActive(); }, 30_000);
        }
        const response = await fetch(importUrl, { signal: abort.signal });
        if (!response.ok) {
          if (!abort.signal.aborted && ownsDatabase(db)) {
            setError({ key: "library.downloadFailed", params: { status: response.status } });
          }
          return;
        }
        const blob = await readLibraryDownload(response, (download) => {
          if (abort.signal.aborted || !ownsDatabase(db)) return;
          setImportActivities((current) => current.map((entry) =>
            entry.id === activity.id && entry.phase === "downloading" ? { ...entry, download } : entry));
        }, abort.signal);
        if (abort.signal.aborted || !ownsDatabase(db)) return;
        downloading = false;
        const file = new File([blob], suggestedFileNameFor(importUrl), { type: "application/epub+zip" });
        importing = true;
        updateImport(activity.id, "processing");
        // importFiles reports errors without rejecting; only importBook's
        // persistence result can safely acknowledge this download handoff.
        bookId = await importBook(db, file, (phase) => {
          if (!abort.signal.aborted && ownsDatabase(db)) updateImport(activity.id, phase);
        });
        if (abort.signal.aborted || !ownsDatabase(db)) return;
        imported = true;
        await refresh(db);
        if (ownsDatabase(db)) refreshStorageUsage();
      } catch (err) {
        if (!abort.signal.aborted && ownsDatabase(db)) {
          if (imported || (err instanceof DOMException && err.name === "QuotaExceededError")) {
            setError(describeLibraryStorageError(err));
          } else if (importing) {
            setError({
              key: "library.downloadImportFailed",
              params: { detail: err instanceof Error ? err.message : String(err) },
              headline: isInvalidEpubError(err) ? "error.invalidEpubHeadline" : undefined,
            });
          } else {
            setError({ key: "library.downloadNetworkFailed" });
          }
        }
      } finally {
        downloading = false;
        if (cancelDownloadRef.current === cancel) cancelDownloadRef.current = undefined;
        clearInterval(heartbeat);
        if (!abort.signal.aborted && ownsDatabase(db)) {
          updateImport(activity.id, imported ? "complete" : undefined, imported ? bookId : undefined);
        }
        if (token && !userCancelled) {
          try {
            const response = await chrome.runtime.sendMessage({
              type: EPUB_IMPORT_RESULT, token,
              imported: imported && !abort.signal.aborted && ownsDatabase(db),
            });
            if (response?.received !== true) {
              console.warn("Ambra's background worker did not acknowledge the EPUB import result. The browser download was left unchanged.");
            }
          } catch (error) {
            // A restarted worker may no longer own this handoff. Chrome's
            // original download stays intact; the imported book is still safe.
            console.warn("Ambra could not report the EPUB import result. The browser download was left unchanged.", error);
          }
        }
      }
    })();
    return () => {
      if (cancelDownloadRef.current === cancel) cancelDownloadRef.current = undefined;
      clearInterval(heartbeat);
      abort.abort();
    };
  }, [db, canImport, ownsDatabase, refresh, refreshStorageUsage, startImports, updateImport]);

  const books = useMemo(() => sortBooks(rawBooks, sort, locale), [rawBooks, sort, locale]);

  return {
    books,
    isLoading,
    canImport,
    importActivities,
    dismissCompletedImports,
    cancelDownload,
    errorHeadline: typeof error === "object" && error.headline ? t(error.headline) : undefined,
    error: typeof error === "string" || error === undefined ? error : "detail" in error ? error.detail : t(error.key, {
      importLabel: t(books.length ? "library.importEpub" : "library.chooseEpubFiles"),
      ...error.params,
    }),
    dismissError,
    importFiles,
    removeBook,
    openBook,
    saveBookAs,
    chromeTheme: settings.chromeTheme,
    settings,
    setSettings,
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
function sortBooks(books: readonly LibraryBookViewModel[], sort: LibrarySortOption, locale: string): LibraryBookViewModel[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
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
