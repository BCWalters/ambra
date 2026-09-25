import { EpubCfi } from "@ambra/engine";
import type { HighlightStyle, BookIdentifier, AccessibilityMetadata } from "@ambra/engine";
import type { LocalePreference } from "../i18n/Locale.js";
import type { LibrarySortOption } from "./LibrarySortOption.js";
import { DEFAULT_BOOK_READING_SETTINGS, DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";
import type { BookReadingSettings, GlobalReadingSettings } from "./ReadingSettings.js";
import { parseShortcutPreferences } from "../shortcuts/ReaderCommands.js";
import type { ShortcutPreferences } from "../shortcuts/ReaderCommands.js";
import { createLibraryCover } from "./LibraryCover.js";

/** Orders two CFI strings by book reading order (see `EpubCfi.compare`),
 * falling back to `fallbackA - fallbackB` (each side's own `createdAt`)
 * if either CFI fails to parse — vanishingly unlikely for CFIs this app
 * generated itself, but a stored bookmark/highlight predating some
 * future CFI format change, or any other unexpected corruption, should
 * degrade to the old creation-order sort rather than throwing out of a
 * list view entirely. */
function compareByCfiThenCreatedAt(cfiA: string, cfiB: string, fallbackA: number, fallbackB: number): number {
  try {
    return EpubCfi.compare(cfiA, cfiB);
  } catch {
    return fallbackA - fallbackB;
  }
}

/** Book metadata as stored in the library — small enough to list in bulk
 * without touching the (potentially large) book file/cover blobs, which
 * live in their own object stores. */
export interface BookMetadata {
  readonly id: string;
  /** SHA-256 of the complete EPUB archive bytes, never its URL, filename,
   * title or OPF identifier. Absent on pre-v6 records until the next import.
   * Even a repackaged archive is distinct if its bytes changed. */
  readonly contentHash?: string;
  readonly title: string;
  readonly creator: string | undefined;
  readonly identifier: string;
  readonly addedAt: number;
  /** The original file's own name (e.g. `moby-dick.epub`) at import time
   * — shown in the Book Details panel. `undefined` for books imported
   * before this field existed; not worth a migration for a single,
   * purely-informational display field. */
  readonly fileName: string | undefined;
  /** A fetched fallback description for a book whose EPUB doesn't
   * declare its own `dc:description` — see
   * `BookDescriptionEnrichment.fetchBookDescription` and
   * `ReaderController`'s one-time-per-open fetch trigger. Never
   * overwrites (or is preferred over) an EPUB-provided description;
   * only ever read when the book has none of its own. `undefined` for
   * books imported before this field existed, or where no fetch has
   * succeeded yet. */
  readonly fetchedDescription: string | undefined;
  /** Which free source `fetchedDescription` came from — shown as an
   * attribution/"via ..." link in the Book Details panel, since neither
   * source's terms allow presenting their content without credit. */
  readonly fetchedDescriptionSourceName: "Open Library" | "Wikipedia" | undefined;
  readonly fetchedDescriptionSourceUrl: string | undefined;
  /** How many times a description fetch has been attempted and found
   * nothing usable — capped at `MAX_DESCRIPTION_FETCH_ATTEMPTS` in
   * `ReaderController` so a book with no discoverable description isn't
   * retried forever on every single open. `undefined` (treated as `0`)
   * for books that have never had a fetch attempted. */
  readonly descriptionFetchAttempts: number | undefined;
  /** The EPUB's own `dc:description`, captured at import time so the
   * Library's Book Details flyout (issue #105) can show it without
   * re-parsing the book — distinct from `fetchedDescription` (a
   * fallback for books that have none of their own). `undefined` for
   * books imported before this field existed, or that simply have no
   * `dc:description`. */
  readonly description: string | undefined;
  readonly publisher: string | undefined;
  readonly rights: string | undefined;
  /** Every `dc:identifier` the OPF declares (the single `identifier`
   * field above is just the primary `unique-identifier`) — same list
   * `BookDetailsPanel` shows in the reader, minus generic placeholder
   * values it also filters (see `isGenericDefaultIdentifier`, applied
   * by the Library's own details flyout). `undefined` for books imported
   * before this field existed. */
  readonly identifiers: readonly BookIdentifier[] | undefined;
  /** EPUB Accessibility 1.1 metadata (see `AccessibilityMetadata`) —
   * `undefined` for books imported before this field existed, or that
   * declare none. */
  readonly accessibility: AccessibilityMetadata | undefined;
  readonly narrationNoticeDismissed?: boolean;
}

/** Where a reader last left off in a given book — a CFI, since it's the
 * one position representation that survives across sessions, layout
 * changes, and (per the CFI design) even re-parses of the book. See the
 * `resume-reading` work item. */
export interface ReadingProgress {
  readonly bookId: string;
  readonly cfi: string;
  readonly updatedAt: number;
  /** Whole-book completion, 0–1, computed from `bookPageIndex`/
   * `bookPageCount` at save time (see `ReaderController.saveProgress`).
   * `undefined` for progress saved before this field existed, or while
   * `bookPagination` hasn't finished measuring the book yet — callers
   * should just omit a percentage rather than show a stale/wrong one. */
  readonly fractionComplete: number | undefined;
}

/** A reader-created bookmark: a saved position (via CFI, same
 * locator concept `ReadingProgress` uses) plus a human-readable label
 * (chapter + page, when known) so a bookmarks list reads as more than
 * an opaque timestamp. Deliberately not a toggleable "is this exact
 * page bookmarked" concept — each explicit "Add Bookmark" action
 * creates its own list entry, managed (and removed) from the
 * bookmarks list itself; this sidesteps the fragile problem of
 * deciding whether a *reflowed* page (after a font-size/margin change)
 * still "is" the same page a bookmark was created on. */
export interface Bookmark {
  readonly id: string;
  readonly bookId: string;
  readonly cfi: string;
  readonly label: string;
  readonly createdAt: number;
}

/** A reader-created highlight: a saved text range (via two point CFIs
 * marking the start/end — see the doc comment on why this isn't the
 * spec's single comma-joined range-CFI string) plus its visual style
 * (see `HighlightStyle`) and a snapshot of the highlighted text itself,
 * so a highlights list can show a readable excerpt without
 * re-resolving/re-extracting from the DOM. `note` is reserved for the
 * annotations feature (attaching a note to a highlight) — always
 * `undefined` until that lands, kept here now so adding it later
 * doesn't need its own store migration. */
export interface Highlight {
  readonly id: string;
  readonly bookId: string;
  /** Redundant with what `startCfi`'s package steps already encode, but
   * kept as its own field so listing "this spine item's highlights"
   * (applying them to a freshly-opened content document) doesn't need
   * to parse every stored CFI first. */
  readonly spineIndex: number;
  /**
   * A true EPUB CFI range is a single string with a shared prefix and
   * two comma-separated divergent suffixes (spec §3.4) — a real,
   * non-trivial grammar in its own right. Since nothing outside this
   * app ever needs to read one of these CFIs back (no interop/export
   * requirement), storing two independent, ordinary *point* CFIs here
   * is functionally equivalent for every actual use (generate both via
   * the exact same `LocatorResolver.generate` used everywhere else,
   * resolve both via `resolveInDocument`) while reusing the entire
   * existing, tested point-CFI engine as-is — not worth building and
   * maintaining a second parser/resolver for the canonical range-CFI
   * string format when nothing needs it.
   */
  readonly startCfi: string;
  readonly endCfi: string;
  readonly style: HighlightStyle;
  readonly text: string;
  readonly note: string | undefined;
  readonly createdAt: number;
}

interface BlobRecord {
  readonly id: string;
  readonly blob: Blob;
}

interface CoverRecord extends BlobRecord {
  /** Optional, lazily generated derived data: no schema upgrade or original replacement. */
  readonly libraryCoverV1?: Blob | "original";
}

export interface LibraryCoverBlobs {
  readonly original: Blob;
  readonly card: Blob | undefined;
}

/** App-global preference rows, retained for compatibility with existing data.
 * Book typography lives in a typed record in BOOK_SETTINGS_STORE. */
interface PreferenceRecord {
  readonly key: string;
  readonly value: unknown;
}

const DB_NAME = "ambra-library";
const DB_VERSION = 7;
const BOOKS_STORE = "books";
const CONTENT_HASH_INDEX = "contentHash";
const FILES_STORE = "bookFiles";
const COVERS_STORE = "bookCovers";
const PROGRESS_STORE = "readingProgress";
const PREFERENCES_STORE = "preferences";
const BOOKMARKS_STORE = "bookmarks";
const HIGHLIGHTS_STORE = "highlights";
const BOOK_SETTINGS_STORE = "bookReadingSettings";

interface BookReadingSettingsRecord {
  readonly bookId: string;
  readonly settings: BookReadingSettings;
}

const VIEW_MODE_PREFERENCE_KEY = "defaultViewMode";
const FONT_SCALE_PREFERENCE_KEY = "defaultFontScale";
const LINE_SPACING_PREFERENCE_KEY = "defaultLineSpacing";
const LETTER_SPACING_PREFERENCE_KEY = "defaultLetterSpacing";
const CONTENT_WIDTH_PREFERENCE_KEY = "defaultContentWidth";
const PAGE_THEME_PREFERENCE_KEY = "defaultPageTheme";
const BRIGHTNESS_PREFERENCE_KEY = "defaultBrightness";
const FONT_FAMILY_PREFERENCE_KEY = "defaultFontFamily";
const CHROME_THEME_PREFERENCE_KEY = "defaultChromeTheme";
const PAGE_TURN_ANIMATION_STYLE_PREFERENCE_KEY = "defaultPageTurnAnimationStyle";
const LOCALE_PREFERENCE_KEY = "localePreference";
const LIBRARY_SORT_PREFERENCE_KEY = "defaultLibrarySort";
const SHORTCUT_PREFERENCES_KEY = "readerKeyboardShortcuts";
const LEGACY_BOOK_SETTING_KEYS = {
  fontScale: FONT_SCALE_PREFERENCE_KEY,
  fontFamily: FONT_FAMILY_PREFERENCE_KEY,
  lineSpacing: LINE_SPACING_PREFERENCE_KEY,
  letterSpacing: LETTER_SPACING_PREFERENCE_KEY,
  contentWidthEm: CONTENT_WIDTH_PREFERENCE_KEY,
  pageTheme: PAGE_THEME_PREFERENCE_KEY,
} satisfies Record<keyof BookReadingSettings, string>;
const GLOBAL_SETTING_KEYS = {
  viewMode: VIEW_MODE_PREFERENCE_KEY,
  brightness: BRIGHTNESS_PREFERENCE_KEY,
  chromeTheme: CHROME_THEME_PREFERENCE_KEY,
  pageTurnAnimationStyle: PAGE_TURN_ANIMATION_STYLE_PREFERENCE_KEY,
} satisfies Record<keyof GlobalReadingSettings, string>;

function settingsFromPreferences<T extends object>(
  defaults: T,
  keys: Record<keyof T, string>,
  records: readonly PreferenceRecord[],
): T {
  const result = { ...defaults };
  for (const key of Object.keys(keys) as (keyof T)[]) {
    const value = records.find((record) => record.key === keys[key])?.value;
    if (value !== undefined) result[key] = value as T[typeof key];
  }
  return result;
}

async function hashBookFile(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The extension's local book library: book metadata, the original EPUB
 * file bytes, an optional cover image, per-book reading progress, and
 * reader-wide preferences, each in their own IndexedDB object store so
 * listing the library doesn't have to touch the large blobs. All
 * local-only in v1, no cloud sync — see the wave-1 plan's storage
 * section.
 */
export class LibraryDatabase {
  private static readonly preferenceListeners = new Map<() => void, LibraryDatabase>();
  private readonly subscriptions = new Set<() => void>();
  private readonly preferenceSender = crypto.randomUUID();
  private constructor(private readonly db: IDBDatabase) {}

  /** A rough read on how much disk this origin is using/has available
   * (`navigator.storage.estimate()`), for a simple "X of Y used" display
   * in the Library page — not a hard enforcement mechanism (the
   * manifest's own `unlimitedStorage` permission means Chrome doesn't
   * apply its usual ~10%-of-disk quota to this origin at all, so
   * `quotaBytes` here typically reflects free disk space rather than
   * any real ceiling this app should warn a reader is "close to").
   * `undefined` in any browsing context where the Storage API itself
   * isn't available (very old Chromium, or a context that doesn't
   * expose `navigator.storage` at all) rather than throwing — this is
   * purely informational, never a precondition for the library to
   * function. */
  public static async estimateStorageUsage(): Promise<{ usageBytes: number; quotaBytes: number | undefined } | undefined> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      return undefined;
    }
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.usage === undefined) {
        return undefined;
      }
      return { usageBytes: estimate.usage, quotaBytes: estimate.quota };
    } catch {
      return undefined;
    }
  }

  public static open(): Promise<LibraryDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let blocked = false;

      request.onblocked = () => {
        blocked = true;
        reject(
          new Error(
            "Ambra needs to update its library. Close or reload other Ambra tabs, then reload this page.",
          ),
        );
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BOOKS_STORE)) {
          db.createObjectStore(BOOKS_STORE, { keyPath: "id" });
        }
        const books = request.transaction!.objectStore(BOOKS_STORE);
        if (!books.indexNames.contains(CONTENT_HASH_INDEX)) {
          // Existing duplicate records may have independent annotations:
          // retain all of them rather than merging/deleting user data.
          books.createIndex(CONTENT_HASH_INDEX, "contentHash");
        }
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          db.createObjectStore(FILES_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(COVERS_STORE)) {
          db.createObjectStore(COVERS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
          db.createObjectStore(PROGRESS_STORE, { keyPath: "bookId" });
        }
        if (!db.objectStoreNames.contains(PREFERENCES_STORE)) {
          db.createObjectStore(PREFERENCES_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(BOOKMARKS_STORE)) {
          db.createObjectStore(BOOKMARKS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(HIGHLIGHTS_STORE)) {
          db.createObjectStore(HIGHLIGHTS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(BOOK_SETTINGS_STORE)) {
          const settingsStore = db.createObjectStore(BOOK_SETTINGS_STORE, { keyPath: "bookId" });
          const preferences = request.transaction!.objectStore(PREFERENCES_STORE);
          const saved = preferences.getAll();
          saved.onsuccess = () => {
            const settings = settingsFromPreferences(
              DEFAULT_BOOK_READING_SETTINGS, LEGACY_BOOK_SETTING_KEYS, saved.result as PreferenceRecord[],
            );
            const cursorRequest = books.openCursor();
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (!cursor) return;
              settingsStore.put({ bookId: (cursor.value as BookMetadata).id, settings } satisfies BookReadingSettingsRecord);
              cursor.continue();
            };
            // Copy and removal share the upgrade transaction: an aborted migration
            // leaves both the old settings and every existing book untouched.
            for (const key of Object.values(LEGACY_BOOK_SETTING_KEYS)) preferences.delete(key);
          };
        }
      };

      request.onsuccess = () => {
        // IndexedDB cannot cancel a blocked open request. If the old tab
        // closes later, do not leak a connection from the rejected promise.
        if (blocked) {
          request.result.close();
          return;
        }
        resolve(new LibraryDatabase(request.result));
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open the Ambra library database."));
    });
  }

  /** Reuses the oldest identical archive's id without rewriting any user
   * data or metadata; otherwise adds a new book atomically. The index check
   * and writes share a transaction so imports in separate tabs cannot race. */
  public async addBook(
    fileBlob: Blob,
    metadata: Omit<BookMetadata, "id" | "addedAt" | "contentHash">,
    coverBlob: Blob | undefined,
  ): Promise<string> {
    const contentHash = await hashBookFile(fileBlob);
    await this.indexLegacyBooks();

    return this.transaction<string>(
      [BOOKS_STORE, FILES_STORE, COVERS_STORE],
      "readwrite",
      "Failed to import the book into the library.",
      (tx, setResult) => {
        const books = tx.objectStore(BOOKS_STORE);
        const request = books.index(CONTENT_HASH_INDEX).getAll(contentHash);
        request.onsuccess = () => {
          const matches = request.result as BookMetadata[];
          matches.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id));
          const existing = matches[0];
          if (existing) {
            setResult(existing.id);
            return;
          }
          const id = crypto.randomUUID();
          books.add({ ...metadata, id, addedAt: Date.now(), contentHash } satisfies BookMetadata);
          tx.objectStore(FILES_STORE).add({ id, blob: fileBlob });
          if (coverBlob) {
            tx.objectStore(COVERS_STORE).add({ id, blob: coverBlob });
          }
          setResult(id);
        };
      },
    );
  }

  /** Lazy, resumable migration: hash stored archives only when importing,
   * preserving every existing id. Hashing must happen outside an IndexedDB
   * transaction; reread metadata inside the write transaction to avoid
   * overwriting concurrent enrichment or resurrecting a deleted book.
   * Errors propagate to the import UI — never guess identity from metadata. */
  private async indexLegacyBooks(): Promise<void> {
    for (const book of await this.listBooks()) {
      if (book.contentHash !== undefined) {
        continue;
      }
      const file = await this.getBookFile(book.id);
      if (!file) {
        throw new Error(`Cannot identify "${book.title}": its stored EPUB file is missing.`);
      }
      const contentHash = await hashBookFile(file);
      await this.updateBookMetadata(book.id, (current) => ({
        ...current,
        contentHash: current.contentHash ?? contentHash,
      }));
    }
  }

  public listBooks(): Promise<BookMetadata[]> {
    return this.getAll<BookMetadata>(BOOKS_STORE);
  }

  /** A single book's own library record (title/creator/identifier/
   * fileName/addedAt) — used by the reader's Book Details panel, which
   * needs this alongside the richer metadata already available from the
   * open `PackageDocument` (description, publisher, every identifier). */
  public getBookMetadata(id: string): Promise<BookMetadata | undefined> {
    return this.get<BookMetadata>(BOOKS_STORE, id);
  }

  public dismissNarrationNotice(bookId: string): Promise<void> {
    return this.updateBookMetadata(bookId, (record) => ({
      ...record,
      narrationNoticeDismissed: true,
    }));
  }

  /** Persists the outcome of one description-fetch attempt (see
   * `BookDescriptionEnrichment.fetchBookDescription`, triggered from
   * `ReaderController`) — either a found description (with its source,
   * for attribution) or nothing, in which case only the attempt counter
   * advances so a book with no discoverable description eventually stops
   * being retried (see `MAX_DESCRIPTION_FETCH_ATTEMPTS`). A no-op if the
   * book has since been removed from the library. */
  public async recordDescriptionFetchResult(
    bookId: string,
    result:
      | { description: string; sourceName: "Open Library" | "Wikipedia"; sourceUrl: string }
      | undefined,
  ): Promise<void> {
    await this.updateBookMetadata(bookId, (record) => ({
      ...record,
      fetchedDescription: result?.description ?? record.fetchedDescription,
      fetchedDescriptionSourceName: result?.sourceName ?? record.fetchedDescriptionSourceName,
      fetchedDescriptionSourceUrl: result?.sourceUrl ?? record.fetchedDescriptionSourceUrl,
      descriptionFetchAttempts: (record.descriptionFetchAttempts ?? 0) + (result ? 0 : 1),
    }));
  }

  public async getBookFile(id: string): Promise<Blob | undefined> {
    return (await this.get<BlobRecord>(FILES_STORE, id))?.blob;
  }

  public async getCoverBlob(id: string): Promise<Blob | undefined> {
    return (await this.get<BlobRecord>(COVERS_STORE, id))?.blob;
  }

  public async getLibraryCoverBlobs(id: string): Promise<LibraryCoverBlobs | undefined> {
    const record = await this.get<CoverRecord>(COVERS_STORE, id);
    if (!record) return undefined;
    if (record.libraryCoverV1 !== undefined) {
      return { original: record.blob, card: record.libraryCoverV1 === "original" ? record.blob : record.libraryCoverV1 };
    }
    const card = await createLibraryCover(record.blob);
    // A failed decode/encode can be transient. Cache the title fallback only
    // in the mounted LibrarySession, allowing another visit to retry.
    if (!card) return { original: record.blob, card: undefined };
    // Decoding cannot keep an IndexedDB transaction alive. Reread before
    // writing so a concurrent deletion is never resurrected.
    return this.transaction<LibraryCoverBlobs | undefined>(
      [COVERS_STORE], "readwrite", "Failed to save the library cover.",
      (tx, setResult) => {
        const store = tx.objectStore(COVERS_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
          const current = request.result as CoverRecord | undefined;
          if (!current) {
            setResult(undefined);
            return;
          }
          const cached = current.libraryCoverV1 !== undefined
            ? current.libraryCoverV1
            : card === record.blob ? "original" : card;
          if (current.libraryCoverV1 === undefined) {
            store.put({ ...current, libraryCoverV1: cached } satisfies CoverRecord);
          }
          setResult({ original: current.blob, card: cached === "original" ? current.blob : cached });
        };
      },
    ).catch(async (error: unknown) => {
      console.warn("Ambra could not save a library cover thumbnail. A temporary cover will be used when available.", error);
      // A decorative cache must not block reading on quota-full/read-only
      // storage. Reread after rollback so a concurrent deletion still wins;
      // genuine read failures continue through the existing Library error UI.
      const current = await this.get<CoverRecord>(COVERS_STORE, id);
      return current ? {
        original: current.blob,
        card: current.libraryCoverV1 === "original" ? current.blob : current.libraryCoverV1 ?? card,
      } : undefined;
    });
  }

  /** Records `cfi` as `bookId`'s current reading position, overwriting
   * any previous one. `fractionComplete` is opportunistic — pass
   * `undefined` when the caller doesn't have a reliable whole-book
   * fraction yet (see its doc comment on `ReadingProgress`). */
  public async saveProgress(bookId: string, cfi: string, fractionComplete: number | undefined): Promise<void> {
    const record: ReadingProgress = { bookId, cfi, updatedAt: Date.now(), fractionComplete };
    await this.put(PROGRESS_STORE, record);
  }

  public getProgress(bookId: string): Promise<ReadingProgress | undefined> {
    return this.get<ReadingProgress>(PROGRESS_STORE, bookId);
  }

  /** All saved reading-progress records, keyed by book id — used by the
   * Library page to show a completion percentage per book without a
   * separate round trip for each one. */
  public async getAllProgress(): Promise<ReadonlyMap<string, ReadingProgress>> {
    const all = await this.getAll<ReadingProgress>(PROGRESS_STORE);
    return new Map(all.map((record) => [record.bookId, record]));
  }

  /** The reader's UI language preference (issue #50) — either an
   * explicit locale a reader picked in settings, or `"system"` (detect
   * from the browser — see `Locale.ts`'s `detectBrowserLocale`), the
   * default until they ever change it. Shared between the library page
   * and the reader page (both need it, and both already share this same
   * `LibraryDatabase`), unlike the reading-specific preferences above. */
  public async getLocalePreference(): Promise<LocalePreference | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, LOCALE_PREFERENCE_KEY);
    return record?.value as LocalePreference | undefined;
  }

  public async setLocalePreference(preference: LocalePreference): Promise<void> {
    const record: PreferenceRecord = { key: LOCALE_PREFERENCE_KEY, value: preference };
    await this.put(PREFERENCES_STORE, record);
  }

  public async getShortcutPreferences(): Promise<ShortcutPreferences | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, SHORTCUT_PREFERENCES_KEY);
    return record ? parseShortcutPreferences(record.value) : undefined;
  }

  public async setShortcutPreferences(preferences: ShortcutPreferences): Promise<void> {
    const value = parseShortcutPreferences(preferences);
    await this.put(PREFERENCES_STORE, { key: SHORTCUT_PREFERENCES_KEY, value });
  }

  /** How the Library page's own book grid is ordered (see
   * `LibrarySortOption`) — a library-page-only preference (the reader
   * itself has no notion of book ordering), but stored in this same
   * shared database/store for consistency with every other preference
   * here. `undefined` if never set, in which case callers should fall
   * back to `DEFAULT_LIBRARY_SORT`. */
  public async getDefaultLibrarySort(): Promise<LibrarySortOption | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, LIBRARY_SORT_PREFERENCE_KEY);
    return record?.value as LibrarySortOption | undefined;
  }

  public async setDefaultLibrarySort(sort: LibrarySortOption): Promise<void> {
    const record: PreferenceRecord = { key: LIBRARY_SORT_PREFERENCE_KEY, value: sort };
    await this.put(PREFERENCES_STORE, record);
  }

  public async deleteBook(id: string): Promise<void> {
    const keyedStores = [BOOKS_STORE, FILES_STORE, COVERS_STORE, PROGRESS_STORE, BOOK_SETTINGS_STORE];
    await this.transaction(
      [...keyedStores, BOOKMARKS_STORE, HIGHLIGHTS_STORE],
      "readwrite",
      "Failed to remove the book from the library.",
      (tx) => {
        for (const name of keyedStores) {
          tx.objectStore(name).delete(id);
        }
        for (const name of [BOOKMARKS_STORE, HIGHLIGHTS_STORE]) {
          const request = tx.objectStore(name).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if ((cursor.value as Bookmark | Highlight).bookId === id) cursor.delete();
            cursor.continue();
          };
        }
      },
    );
  }

  /** Creates a new bookmark for `bookId` at `cfi` (see `Bookmark`'s doc
   * comment on why this always creates a fresh entry rather than
   * toggling one at the "same" position) and returns the full record,
   * including its generated `id`/`createdAt`. */
  public async addBookmark(bookId: string, cfi: string, label: string): Promise<Bookmark> {
    const bookmark: Bookmark = { id: crypto.randomUUID(), bookId, cfi, label, createdAt: Date.now() };
    await this.put(BOOKMARKS_STORE, bookmark);
    return bookmark;
  }

  public async removeBookmark(id: string): Promise<void> {
    await this.removeBookmarks([id]);
  }

  public async removeBookmarks(ids: readonly string[]): Promise<void> {
    await this.transaction(BOOKMARKS_STORE, "readwrite", "Failed to remove bookmarks.", (tx) => {
      const bookmarks = tx.objectStore(BOOKMARKS_STORE);
      for (const id of ids) bookmarks.delete(id);
    });
  }

  /** All bookmarks for `bookId`, in book reading order (see
   * `EpubCfi.compare`, and issue #49 — previously sorted by creation
   * order, which reads oddly once a reader has jumped around adding
   * bookmarks out of sequence) — fetches every bookmark in the store and
   * filters client-side rather than via an IndexedDB index, which is
   * simpler and plenty fast at the scale a single reader's bookmark list
   * actually reaches. */
  public async listBookmarksForBook(bookId: string): Promise<Bookmark[]> {
    const all = await this.getAll<Bookmark>(BOOKMARKS_STORE);
    return all
      .filter((bookmark) => bookmark.bookId === bookId)
      .sort((a, b) => compareByCfiThenCreatedAt(a.cfi, b.cfi, a.createdAt, b.createdAt));
  }

  /** Creates a new highlight (see `Highlight`'s doc comment) and returns
   * the full record, including its generated `id`/`createdAt`. */
  public async addHighlight(
    highlight: Omit<Highlight, "id" | "createdAt">,
  ): Promise<Highlight> {
    const record: Highlight = { ...highlight, id: crypto.randomUUID(), createdAt: Date.now() };
    await this.put(HIGHLIGHTS_STORE, record);
    return record;
  }

  public async removeHighlight(id: string): Promise<void> {
    await this.delete(HIGHLIGHTS_STORE, id);
  }

  /** Updates an existing highlight record in place — used for attaching/
   * editing/clearing a note (see the annotations feature). Takes the
   * full, already-modified record (the caller — `ReaderController`,
   * which keeps every highlight in memory anyway — builds it) rather
   * than a partial patch, since IndexedDB's `put` always replaces the
   * whole record regardless. */
  public async updateHighlight(highlight: Highlight): Promise<void> {
    await this.put(HIGHLIGHTS_STORE, highlight);
  }

  /** Merge only changed fields against the committed record. A deleted
   * highlight stays deleted; an explicit undefined note clears the note. */
  public patchHighlight(
    id: string,
    patch: { note?: string | undefined; style?: HighlightStyle },
  ): Promise<Highlight | undefined> {
    return this.transaction<Highlight | undefined>(
      HIGHLIGHTS_STORE,
      "readwrite",
      "Failed to update the highlight.",
      (tx, setResult) => {
        const highlights = tx.objectStore(HIGHLIGHTS_STORE);
        const request = highlights.get(id);
        request.onsuccess = () => {
          const current = request.result as Highlight | undefined;
          if (!current) {
            setResult(undefined);
            return;
          }
          const updated = { ...current, ...patch };
          highlights.put(updated);
          setResult(updated);
        };
      },
    );
  }

  /** All highlights for `bookId`, in book reading order — same "fetch
   * all, filter client-side" approach and book-order sort as
   * `listBookmarksForBook`, for the same reasons. */
  public async listHighlightsForBook(bookId: string): Promise<Highlight[]> {
    const all = await this.getAll<Highlight>(HIGHLIGHTS_STORE);
    return all
      .filter((highlight) => highlight.bookId === bookId)
      .sort((a, b) => compareByCfiThenCreatedAt(a.startCfi, b.startCfi, a.createdAt, b.createdAt));
  }

  public close(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.db.close();
  }

  public async getBookReadingSettings(bookId: string): Promise<BookReadingSettings> {
    const record = await this.get<BookReadingSettingsRecord>(BOOK_SETTINGS_STORE, bookId);
    return { ...DEFAULT_BOOK_READING_SETTINGS, ...record?.settings };
  }

  /** Read/merge/write in one transaction; independent tabs cannot lose fields,
   * and a late reader write cannot recreate a deleted book's settings. */
  public patchBookReadingSettings(bookId: string, patch: Partial<BookReadingSettings>): Promise<void> {
    return this.transaction([BOOKS_STORE, BOOK_SETTINGS_STORE], "readwrite", "Failed to save book settings.", (tx) => {
      const exists = tx.objectStore(BOOKS_STORE).getKey(bookId);
      exists.onsuccess = () => {
        if (exists.result === undefined) return;
        const store = tx.objectStore(BOOK_SETTINGS_STORE);
        const request = store.get(bookId);
        request.onsuccess = () => {
          const record = request.result as BookReadingSettingsRecord | undefined;
          store.put({
            bookId, settings: { ...DEFAULT_BOOK_READING_SETTINGS, ...record?.settings, ...patch },
          } satisfies BookReadingSettingsRecord);
        };
      };
    });
  }

  public async getGlobalReadingSettings(): Promise<GlobalReadingSettings> {
    return settingsFromPreferences(
      DEFAULT_GLOBAL_READING_SETTINGS, GLOBAL_SETTING_KEYS,
      await this.getAll<PreferenceRecord>(PREFERENCES_STORE),
    );
  }

  public async patchGlobalReadingSettings(patch: Partial<GlobalReadingSettings>): Promise<void> {
    await this.transaction(PREFERENCES_STORE, "readwrite", "Failed to save app settings.", (tx) => {
      for (const key of Object.keys(patch) as (keyof GlobalReadingSettings)[]) {
        tx.objectStore(PREFERENCES_STORE).put({ key: GLOBAL_SETTING_KEYS[key], value: patch[key] });
      }
    });
    this.preferencesChanged();
  }

  /** Invalidate after commit, both within this page and across extension tabs.
   * Consumers reread IndexedDB rather than trusting potentially stale payloads. */
  public subscribePreferences(listener: () => void): () => void {
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("ambra-preferences");
    if (channel) channel.onmessage = (event) => {
      if (event.data !== this.preferenceSender) listener();
    };
    LibraryDatabase.preferenceListeners.set(listener, this);
    const unsubscribe = () => {
      channel?.close();
      LibraryDatabase.preferenceListeners.delete(listener);
      this.subscriptions.delete(unsubscribe);
    };
    this.subscriptions.add(unsubscribe);
    return unsubscribe;
  }

  private preferencesChanged(): void {
    for (const [listener, owner] of LibraryDatabase.preferenceListeners) {
      if (owner !== this) listener();
    }
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("ambra-preferences");
      channel.postMessage(this.preferenceSender);
      channel.close();
    }
  }

  /** Metadata updates and identity backfills must not overwrite each
   * other's fields or recreate a concurrently deleted record. */
  private updateBookMetadata(
    id: string,
    update: (book: BookMetadata) => BookMetadata,
  ): Promise<void> {
    return this.transaction(BOOKS_STORE, "readwrite", "Failed to update book metadata.", (tx) => {
      const books = tx.objectStore(BOOKS_STORE);
      const request = books.get(id);
      request.onsuccess = () => {
        const current = request.result as BookMetadata | undefined;
        if (current) {
          books.put(update(current));
        }
      };
    });
  }

  private async put(storeName: string, value: unknown): Promise<void> {
    await this.transaction(
      storeName, "readwrite", `Failed to write to the "${storeName}" store.`,
      (tx) => { tx.objectStore(storeName).put(value); },
    );
    if (storeName === PREFERENCES_STORE) this.preferencesChanged();
  }

  private get<T>(storeName: string, key: string): Promise<T | undefined> {
    return this.transaction<T | undefined>(
      storeName, "readonly", `Failed to read from the "${storeName}" store.`,
      (tx, setResult) => {
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => setResult(request.result as T | undefined);
      },
    );
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return this.transaction<T[]>(
      storeName, "readonly", `Failed to read from the "${storeName}" store.`,
      (tx, setResult) => {
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => setResult(request.result as T[]);
      },
    );
  }

  private delete(storeName: string, key: string): Promise<void> {
    return this.transaction(
      storeName, "readwrite", `Failed to delete from the "${storeName}" store.`,
      (tx) => { tx.objectStore(storeName).delete(key); },
    );
  }

  /** Request success is not durability: publish results only on commit,
   * and settle aborts even when no individual request emitted an error. */
  private transaction<T = void>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    failureMessage: string,
    queueRequests: (tx: IDBTransaction, setResult: (value: T) => void) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeNames, mode);
      let result: T;
      let requestError: DOMException | null = null;
      let queueError: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(queueError ?? tx.error ?? requestError ?? new Error(failureMessage));
      // A request error bubbles before IndexedDB's default abort action;
      // tx.error may still be null, and rollback has not finished yet.
      tx.onerror = (event) => {
        requestError ??= (event.target as IDBRequest).error;
      };
      try {
        queueRequests(tx, (value) => { result = value; });
      } catch (error) {
        queueError = error;
        tx.abort();
      }
    });
  }
}
