/**
 * Extension background service worker: minimal lifecycle glue. Opens the
 * full-tab reader page and hosts any future context-menu / file-association
 * entry points for `.epub` files.
 */

const READER_PAGE_URL = "src/reader/index.html";

chrome.runtime.onInstalled.addListener(() => {
  // TODO(library-storage): initialize IndexedDB schema on first install.
});

/**
 * Opens the dedicated reader tab for a given book. See the
 * `reader-shell-ui` and `resume-reading` work items — the reader page will
 * read the book id from the URL and restore the last-read Locator.
 */
export async function openReaderTab(bookId: string): Promise<void> {
  const url = chrome.runtime.getURL(`${READER_PAGE_URL}?bookId=${encodeURIComponent(bookId)}`);
  await chrome.tabs.create({ url });
}
