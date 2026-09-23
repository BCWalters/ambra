import { openLibraryImportTab } from "../navigation.js";
import { EPUB_IMPORT_RESULT, hasImportHostAccess } from "../epubImportHandoff.js";
import { isLikelyEpubDownload } from "./epubUrlHeuristic.js";

/**
 * The native download keeps running until the library confirms persistence.
 * No pause, retry, or durable worker state is needed: closing a tab, losing a
 * message, or restarting this worker always leaves Chrome's download intact.
 * A download that finishes first stays on disk and in Chrome's history.
 */
export function registerEpubDirectImport(): void {
  const pending = new Map<string, { downloadId: number; tabId: number; createdAt: number }>();

  chrome.downloads.onCreated.addListener((item) => {
    if (!isLikelyEpubDownload(item) || item.state !== "in_progress") return;
    void (async () => {
      if (!await hasImportHostAccess([item.url, item.finalUrl || item.url])) return;
      for (const [token, entry] of pending) {
        if (Date.now() - entry.createdAt > 5 * 60_000) pending.delete(token);
      }
      if (pending.size >= 100) {
        console.warn("Ambra skipped automatic EPUB import because too many handoffs are pending. The browser download was left running.");
        return;
      }
      const token = crypto.randomUUID();
      const tab = await openLibraryImportTab(item.finalUrl || item.url, token);
      if (tab.id !== undefined) {
        pending.set(token, { downloadId: item.id, tabId: tab.id, createdAt: Date.now() });
      } else {
        console.warn("Ambra could not track the EPUB import tab. The browser download was left running.");
      }
    })().catch((error: unknown) => {
      console.warn("Ambra could not open the EPUB import. The browser download was left running.", error);
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [token, entry] of pending) {
      if (entry.tabId === tabId) pending.delete(token);
    }
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("type" in message) ||
        message.type !== EPUB_IMPORT_RESULT || !("token" in message) ||
        typeof message.token !== "string" || !("imported" in message) ||
        typeof message.imported !== "boolean") return;
    const entry = pending.get(message.token);
    if (!entry || sender.id !== chrome.runtime.id || sender.tab?.id !== entry.tabId ||
        sender.frameId !== 0 ||
        sender.url?.split("?")[0] !== chrome.runtime.getURL("src/library/index.html")) return;
    pending.delete(message.token);
    sendResponse({ received: true });
    if (!message.imported) return;
    chrome.downloads.search({ id: entry.downloadId }, (items) => {
      if (chrome.runtime.lastError) {
        console.warn("Ambra could not check the original download after EPUB import.", chrome.runtime.lastError.message);
        return;
      }
      if (items[0]?.state !== "in_progress") return;
      chrome.downloads.cancel(entry.downloadId, () => {
        if (chrome.runtime.lastError) {
          console.warn("Ambra could not cancel the original download after EPUB import. The imported book is saved.", chrome.runtime.lastError.message);
          return;
        }
        // Completion can win the cancel race; never erase a completed record.
        chrome.downloads.search({ id: entry.downloadId }, (current) => {
          if (chrome.runtime.lastError) {
            console.warn("Ambra could not verify download cancellation. Download history was left unchanged.", chrome.runtime.lastError.message);
            return;
          }
          if (current[0]?.state !== "interrupted" ||
              current[0].error !== "USER_CANCELED") return;
          void chrome.downloads.erase({
            id: entry.downloadId, state: "interrupted", error: "USER_CANCELED",
          }).catch((error: unknown) => {
            console.warn("Ambra could not clean up cancelled-download history. The imported book is saved.", error);
          });
        });
      });
    });
  });
}
