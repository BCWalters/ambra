import type { PageTheme, FontFamilyChoice } from "@ambra/engine";
import type { ViewMode } from "../reader/ViewMode.js";
import type { ChromeThemeChoice } from "../reader/chromeTheme.js";
import type { PageTurnAnimationStyle } from "../reader/PageTurnAnimationStyle.js";

/** Book metadata as stored in the library — small enough to list in bulk
 * without touching the (potentially large) book file/cover blobs, which
 * live in their own object stores. */
export interface BookMetadata {
  readonly id: string;
  readonly title: string;
  readonly creator: string | undefined;
  readonly identifier: string;
  readonly addedAt: number;
  /** The original file's own name (e.g. `moby-dick.epub`) at import time
   * — shown in the Book Details panel. `undefined` for books imported
   * before this field existed; not worth a migration for a single,
   * purely-informational display field. */
  readonly fileName: string | undefined;
}

/** Where a reader last left off in a given book — a CFI, since it's the
 * one position representation that survives across sessions, layout
 * changes, and (per the CFI design) even re-parses of the book. See the
 * `resume-reading` work item. */
export interface ReadingProgress {
  readonly bookId: string;
  readonly cfi: string;
  readonly updatedAt: number;
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
const DB_VERSION = 3;
const BOOKS_STORE = "books";
const FILES_STORE = "bookFiles";
const COVERS_STORE = "bookCovers";
const PROGRESS_STORE = "readingProgress";
const PREFERENCES_STORE = "preferences";

const VIEW_MODE_PREFERENCE_KEY = "defaultViewMode";
const FONT_SCALE_PREFERENCE_KEY = "defaultFontScale";
const LINE_SPACING_PREFERENCE_KEY = "defaultLineSpacing";
const LETTER_SPACING_PREFERENCE_KEY = "defaultLetterSpacing";
const CONTENT_WIDTH_PREFERENCE_KEY = "defaultContentWidth";
const PAGE_THEME_PREFERENCE_KEY = "defaultPageTheme";
const FONT_FAMILY_PREFERENCE_KEY = "defaultFontFamily";
const CHROME_THEME_PREFERENCE_KEY = "defaultChromeTheme";
const PAGE_TURN_ANIMATION_STYLE_PREFERENCE_KEY = "defaultPageTurnAnimationStyle";

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
        if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
          db.createObjectStore(PROGRESS_STORE, { keyPath: "bookId" });
        }
        if (!db.objectStoreNames.contains(PREFERENCES_STORE)) {
          db.createObjectStore(PREFERENCES_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(new LibraryDatabase(request.result));
      request.onerror = () => reject(request.error ?? new Error("Failed to open the Ambra library database."));
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

  /** A single book's own library record (title/creator/identifier/
   * fileName/addedAt) — used by the reader's Book Details panel, which
   * needs this alongside the richer metadata already available from the
   * open `PackageDocument` (description, publisher, every identifier). */
  public getBookMetadata(id: string): Promise<BookMetadata | undefined> {
    return this.get<BookMetadata>(BOOKS_STORE, id);
  }

  public async getBookFile(id: string): Promise<Blob | undefined> {
    return (await this.get<BlobRecord>(FILES_STORE, id))?.blob;
  }

  public async getCoverBlob(id: string): Promise<Blob | undefined> {
    return (await this.get<BlobRecord>(COVERS_STORE, id))?.blob;
  }

  /** Records `cfi` as `bookId`'s current reading position, overwriting
   * any previous one. */
  public async saveProgress(bookId: string, cfi: string): Promise<void> {
    const record: ReadingProgress = { bookId, cfi, updatedAt: Date.now() };
    await this.put(PROGRESS_STORE, record);
  }

  public getProgress(bookId: string): Promise<ReadingProgress | undefined> {
    return this.get<ReadingProgress>(PROGRESS_STORE, bookId);
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

  public async deleteBook(id: string): Promise<void> {
    await this.delete(BOOKS_STORE, id);
    await this.delete(FILES_STORE, id);
    await this.delete(COVERS_STORE, id);
    await this.delete(PROGRESS_STORE, id);
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
