import { EpubCfi } from "@ambra/engine";
import type { PageTheme, FontFamilyChoice, HighlightStyle, BookIdentifier, AccessibilityMetadata } from "@ambra/engine";
import type { ViewMode } from "../reader/ViewMode.js";
import type { ChromeThemeChoice } from "../reader/chromeTheme.js";
import type { PageTurnAnimationStyle } from "../reader/PageTurnAnimationStyle.js";
import type { LocalePreference } from "../i18n/Locale.js";
import type { LibrarySortOption } from "./LibrarySortOption.js";

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

/** A single key/value preference row — the default view mode (see
 * `view-mode-preference`) and default font-size scale (see
 * `ReadingTheme`/`toolbar-redesign`), modeled generically since more
 * reader-wide settings (theme, etc.) are likely to follow. */
interface PreferenceRecord {
  readonly key: string;
  readonly value: unknown;
}

const DB_NAME = "ambra-library";
const DB_VERSION = 6;
const BOOKS_STORE = "books";
const CONTENT_HASH_INDEX = "contentHash";
const FILES_STORE = "bookFiles";
const COVERS_STORE = "bookCovers";
const PROGRESS_STORE = "readingProgress";
const PREFERENCES_STORE = "preferences";
const BOOKMARKS_STORE = "bookmarks";
const HIGHLIGHTS_STORE = "highlights";

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

  /** The reader-wide default view mode (paginated/scroll) new books
   * should open in, persisted across sessions — see
   * `view-mode-preference`. `undefined` if never set, in which case
   * callers should fall back to the "paginated" default themselves. */
  public async getDefaultViewMode(): Promise<ViewMode | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, VIEW_MODE_PREFERENCE_KEY);
    return record?.value as ViewMode | undefined;
  }

  public async setDefaultViewMode(mode: ViewMode): Promise<void> {
    const record: PreferenceRecord = { key: VIEW_MODE_PREFERENCE_KEY, value: mode };
    await this.put(PREFERENCES_STORE, record);
  }

  /** The reader-wide default font-size scale (see `ReadingTheme`) new
   * chapters should open at, persisted across sessions the same way as
   * `getDefaultViewMode`. `undefined` if never set, in which case callers
   * should fall back to `1` (the theme's default) themselves. */
  public async getDefaultFontScale(): Promise<number | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, FONT_SCALE_PREFERENCE_KEY);
    return record?.value as number | undefined;
  }

  public async setDefaultFontScale(scale: number): Promise<void> {
    const record: PreferenceRecord = { key: FONT_SCALE_PREFERENCE_KEY, value: scale };
    await this.put(PREFERENCES_STORE, record);
  }

  /** The reader-wide default line-spacing multiplier (see
   * `ReadingTheme.LINE_SPACING_PROPERTY`), persisted the same way as
   * `getDefaultFontScale`. `undefined` if never set, in which case
   * callers should fall back to `ReadingTheme.DEFAULT_LINE_SPACING`. */
  public async getDefaultLineSpacing(): Promise<number | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, LINE_SPACING_PREFERENCE_KEY);
    return record?.value as number | undefined;
  }

  public async setDefaultLineSpacing(spacing: number): Promise<void> {
    const record: PreferenceRecord = { key: LINE_SPACING_PREFERENCE_KEY, value: spacing };
    await this.put(PREFERENCES_STORE, record);
  }

  /** The reader-wide default extra letter-spacing (see
   * `ReadingTheme.LETTER_SPACING_PROPERTY`), persisted the same way as
   * `getDefaultFontScale`. `undefined` if never set, in which case
   * callers should fall back to `ReadingTheme.DEFAULT_LETTER_SPACING`. */
  public async getDefaultLetterSpacing(): Promise<number | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, LETTER_SPACING_PREFERENCE_KEY);
    return record?.value as number | undefined;
  }

  public async setDefaultLetterSpacing(spacing: number): Promise<void> {
    const record: PreferenceRecord = { key: LETTER_SPACING_PREFERENCE_KEY, value: spacing };
    await this.put(PREFERENCES_STORE, record);
  }

  /** The reader-wide default reading column width in `em` (see
   * `ReadingTheme.CONTENT_WIDTH_PROPERTY` — what a reader thinks of as
   * "margins"), persisted the same way as `getDefaultFontScale`.
   * `undefined` if never set, in which case callers should fall back to
   * `ReadingTheme.DEFAULT_CONTENT_WIDTH_EM`. */
  public async getDefaultContentWidth(): Promise<number | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, CONTENT_WIDTH_PREFERENCE_KEY);
    return record?.value as number | undefined;
  }

  public async setDefaultContentWidth(widthEm: number): Promise<void> {
    const record: PreferenceRecord = { key: CONTENT_WIDTH_PREFERENCE_KEY, value: widthEm };
    await this.put(PREFERENCES_STORE, record);
  }

  /** The reader-wide default page color theme (see `ReadingTheme.PageTheme`)
   * new chapters should open at, persisted the same way as
   * `getDefaultFontScale`. `undefined` if never set, in which case
   * callers should fall back to `ReadingTheme.DEFAULT_PAGE_THEME`. */
  public async getDefaultPageTheme(): Promise<PageTheme | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, PAGE_THEME_PREFERENCE_KEY);
    return record?.value as PageTheme | undefined;
  }

  public async setDefaultPageTheme(theme: PageTheme): Promise<void> {
    const record: PreferenceRecord = { key: PAGE_THEME_PREFERENCE_KEY, value: theme };
    await this.put(PREFERENCES_STORE, record);
  }

  /** The reader-wide default page brightness multiplier (see
   * `ReadingTheme.MIN_BRIGHTNESS`, issue #92), persisted the same
   * way as `getDefaultFontScale`. `undefined` if never set, in which
   * case callers should fall back to `ReadingTheme.DEFAULT_BRIGHTNESS`. */
  public async getDefaultBrightness(): Promise<number | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, BRIGHTNESS_PREFERENCE_KEY);
    return record?.value as number | undefined;
  }

  public async setDefaultBrightness(brightness: number): Promise<void> {
    const record: PreferenceRecord = { key: BRIGHTNESS_PREFERENCE_KEY, value: brightness };
    await this.put(PREFERENCES_STORE, record);
  }

  /** The reader-wide default font family (see
   * `ReadingTheme.FontFamilyChoice`), persisted the same way as
   * `getDefaultFontScale`. `undefined` if never set, in which case
   * callers should fall back to `ReadingTheme.DEFAULT_FONT_FAMILY`. */
  public async getDefaultFontFamily(): Promise<FontFamilyChoice | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, FONT_FAMILY_PREFERENCE_KEY);
    return record?.value as FontFamilyChoice | undefined;
  }

  public async setDefaultFontFamily(family: FontFamilyChoice): Promise<void> {
    const record: PreferenceRecord = { key: FONT_FAMILY_PREFERENCE_KEY, value: family };
    await this.put(PREFERENCES_STORE, record);
  }

  /** The reader's own chrome color (see `ChromeThemeChoice`) — distinct
   * from `getDefaultPageTheme`, which is the book *page's* background,
   * not the toolbar/TOC/scrubber. Persisted the same way as the other
   * reader-wide preferences. `undefined` if never set, in which case
   * callers should fall back to `DEFAULT_CHROME_THEME`. */
  public async getDefaultChromeTheme(): Promise<ChromeThemeChoice | undefined> {
    const record = await this.get<PreferenceRecord>(PREFERENCES_STORE, CHROME_THEME_PREFERENCE_KEY);
    return record?.value as ChromeThemeChoice | undefined;
  }

  public async setDefaultChromeTheme(theme: ChromeThemeChoice): Promise<void> {
    const record: PreferenceRecord = { key: CHROME_THEME_PREFERENCE_KEY, value: theme };
    await this.put(PREFERENCES_STORE, record);
  }

  /** Which page-turn animation (see `PageTurnAnimationStyle`) to use for
   * click/drag-driven page turns. `undefined` if never set, in which case
   * callers should fall back to `DEFAULT_PAGE_TURN_ANIMATION_STYLE`. */
  public async getDefaultPageTurnAnimationStyle(): Promise<PageTurnAnimationStyle | undefined> {
    const record = await this.get<PreferenceRecord>(
      PREFERENCES_STORE,
      PAGE_TURN_ANIMATION_STYLE_PREFERENCE_KEY,
    );
    return record?.value as PageTurnAnimationStyle | undefined;
  }

  public async setDefaultPageTurnAnimationStyle(style: PageTurnAnimationStyle): Promise<void> {
    const record: PreferenceRecord = { key: PAGE_TURN_ANIMATION_STYLE_PREFERENCE_KEY, value: style };
    await this.put(PREFERENCES_STORE, record);
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
    const keyedStores = [BOOKS_STORE, FILES_STORE, COVERS_STORE, PROGRESS_STORE];
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
    this.db.close();
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

  private put(storeName: string, value: unknown): Promise<void> {
    return this.transaction(
      storeName, "readwrite", `Failed to write to the "${storeName}" store.`,
      (tx) => { tx.objectStore(storeName).put(value); },
    );
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
