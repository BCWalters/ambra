const READER_PAGE_URL = "src/reader/index.html";

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
