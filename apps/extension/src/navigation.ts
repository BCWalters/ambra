import { LIBRARY_IMPORT_TOKEN_PARAM } from "./epubImportHandoff.js";

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
  await chrome.tabs.create({ url: readerTabUrl(bookId) });
}

export function readerTabUrl(bookId: string): string {
  return chrome.runtime.getURL(`${READER_PAGE_URL}?bookId=${encodeURIComponent(bookId)}`);
}

/** The query param `LibraryApp` checks (via `isRunningInFullTab`) to
 * decide whether it's the small toolbar popup or a full browser tab —
 * see `openLibraryTab`'s own doc comment for why this, rather than
 * something like inspecting `chrome.windows.getCurrent()`, is enough. */
export const LIBRARY_FULL_TAB_PARAM = "view";
export const LIBRARY_FULL_TAB_VALUE = "tab";

export const LIBRARY_IMPORT_VIEW_VALUE = "import";
const LIBRARY_IMPORT_SOURCE_PARAM = "sourceWindow";

/** A standalone browser window survives the native chooser stealing focus. */
export async function openLibraryImportWindow(): Promise<chrome.windows.Window> {
  const source = await chrome.windows.getCurrent();
  const sourceTab = await chrome.tabs.getCurrent();
  const params = new URLSearchParams({ [LIBRARY_FULL_TAB_PARAM]: LIBRARY_IMPORT_VIEW_VALUE });
  if (source.id !== undefined) params.set(LIBRARY_IMPORT_SOURCE_PARAM, String(source.id));
  const importer = await chrome.windows.create({
    url: chrome.runtime.getURL(`${LIBRARY_PAGE_URL}?${params}`),
    type: "popup", width: 480, height: 560, focused: true,
  });
  if (importer?.id === undefined) throw new Error("Could not open the import window.");
  // Opening a browser window does not reliably dismiss the action popup.
  if (sourceTab === undefined) window.close();
  return importer;
}

export async function closeLibraryImportWindow(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id === undefined) throw new Error("Could not identify the import window.");
  await chrome.tabs.remove(tab.id);
}

/** Read-now and Library actions leave the small importer for a normal browser window. */
export async function finishLibraryImport(url: string): Promise<void> {
  const source = new URLSearchParams(window.location.search).get(LIBRARY_IMPORT_SOURCE_PARAM);
  if (source !== null && (!/^[1-9]\d*$/.test(source) || !Number.isSafeInteger(Number(source)))) {
    throw new Error("Invalid import-window destination.");
  }
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const destination = windows.find(item => item.id === Number(source)) ??
    windows.find(item => item.focused) ?? windows[0];
  if (destination?.id !== undefined) {
    await chrome.tabs.create({ url, windowId: destination.id });
    await chrome.windows.update(destination.id, { focused: true });
  } else {
    await chrome.windows.create({ url, type: "normal", focused: true });
  }
  await closeLibraryImportWindow();
}

/** Full Library destination for the explicit new-tab action in popup and
 * embedded Library views; the reader's toolbar itself only opens its panel. */
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
 * it should fetch and import automatically (`epubDirectImport.ts`) — set once, read
 * once, then stripped from the URL so a later reload/back-navigation
 * never re-triggers the same import. */
export const LIBRARY_IMPORT_URL_PARAM = "importUrl";

/** Opens the Library import after its native fallback has been safely paused. */
export async function openLibraryImportTab(sourceUrl: string, token: string): Promise<chrome.tabs.Tab> {
  const params = new URLSearchParams({
    [LIBRARY_FULL_TAB_PARAM]: LIBRARY_FULL_TAB_VALUE,
    [LIBRARY_IMPORT_URL_PARAM]: sourceUrl,
    [LIBRARY_IMPORT_TOKEN_PARAM]: token,
  });
  return chrome.tabs.create({ url: chrome.runtime.getURL(`${LIBRARY_PAGE_URL}?${params.toString()}`) });
}
