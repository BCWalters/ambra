const READER_PAGE_URL = "src/reader/index.html";
const LIBRARY_PAGE_URL = "src/library/index.html";

/**
 * Opens the dedicated full-tab reader for a given library book. Shared by
 * the background service worker (potential future context-menu/file-
 * association entry points) and the library page itself (the "open this
 * book" action on each book card) — both contexts have the same
 * `chrome.tabs`/`chrome.runtime` access, so this doesn't need to be a
 * background-only responsibility reached via message-passing.
 */
export async function openReaderTab(bookId: string): Promise<void> {
  const url = chrome.runtime.getURL(`${READER_PAGE_URL}?bookId=${encodeURIComponent(bookId)}`);
  await chrome.tabs.create({ url });
}

/** The query param `LibraryApp` checks (via `isRunningInFullTab`) to
 * decide whether it's the small toolbar popup or a full browser tab —
 * see `openLibraryTab`'s own doc comment for why this, rather than
 * something like inspecting `chrome.windows.getCurrent()`, is enough. */
export const LIBRARY_FULL_TAB_PARAM = "view";
export const LIBRARY_FULL_TAB_VALUE = "tab";

/** The library page's own URL, in its full-tab form (see
 * `LIBRARY_FULL_TAB_PARAM`) — shared by `openLibraryTab` (opens it in a
 * new tab) and the reader's Library toolbar button (issue #112, which
 * instead navigates the reader's *own* tab there directly via
 * `window.location`, rather than leaving the reader tab open behind a
 * second new one). */
export function libraryFullTabUrl(): string {
  return chrome.runtime.getURL(`${LIBRARY_PAGE_URL}?${LIBRARY_FULL_TAB_PARAM}=${LIBRARY_FULL_TAB_VALUE}`);
}

/**
 * Opens the exact same library page the toolbar popup shows, but as a
 * full, ordinary browser tab (issue: the popup's small fixed size is
 * fine for a handful of books, but cramped for a real library) — with a
 * `?view=tab` marker so the page itself knows to hide its own "open in
 * a new tab" button once it's already in one (see
 * `LIBRARY_FULL_TAB_PARAM`). A plain query-param flag rather than an
 * async `chrome.windows.getCurrent()` popup/type check — this module
 * fully controls both entry points (the popup URL in `manifest.json`
 * has no query string; every full-tab open goes through this one
 * function), so the flag is always accurate and needs no extra
 * permissions or round-trip.
 */
export async function openLibraryTab(): Promise<void> {
  await chrome.tabs.create({ url: libraryFullTabUrl() });
}

/** The query param `LibraryApp` checks on mount to find a source URL
 * it should fetch and import automatically (issue #122's proactive
 * EPUB-download interception, `epubDirectImport.ts`) — set once, read
 * once, then stripped from the URL so a later reload/back-navigation
 * never re-triggers the same import. */
export const LIBRARY_IMPORT_URL_PARAM = "importUrl";

/** Opens the library, in its full-tab form, with a source URL for it to
 * fetch and import right away (issue #122) — used only by
 * `epubDirectImport.ts`, right after cancelling a browser download that
 * looked like an EPUB. The library page does its own `fetch()` here
 * (rather than the background service worker fetching the bytes and
 * shipping them over via `chrome.runtime.sendMessage`) because a normal
 * page context needs nothing extra to turn a `Response` into the same
 * `File` its own manual file-picker import already knows how to
 * handle — no message-size limits or serialization to worry about for
 * a full EPUB's worth of bytes. */
export async function openLibraryImportTab(sourceUrl: string): Promise<void> {
  const params = new URLSearchParams({
    [LIBRARY_FULL_TAB_PARAM]: LIBRARY_FULL_TAB_VALUE,
    [LIBRARY_IMPORT_URL_PARAM]: sourceUrl,
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`${LIBRARY_PAGE_URL}?${params.toString()}`) });
}
