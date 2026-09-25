import { openLibraryImportTab } from "../navigation.js";
import { EPUB_IMPORT_ACTIVE, EPUB_IMPORT_CANCEL, EPUB_IMPORT_RESULT, hasImportHostAccess } from "../epubImportHandoff.js";
import { isLikelyEpubDownload } from "./epubUrlHeuristic.js";

const STORAGE_KEY = "epubPausedImports.v1";
const RECOVERY_ALARM = "ambra:epub-import-recovery";
const LEASE_MS = 5 * 60_000;

interface PendingImport {
  downloadId: number;
  tabId?: number;
  documentId?: string;
  updatedAt: number;
  started?: boolean;
  imported?: boolean;
  cancelled?: boolean;
}

function isPendingImport(value: unknown): value is PendingImport {
  return !!value && typeof value === "object" &&
    "downloadId" in value && Number.isSafeInteger(value.downloadId) &&
    "updatedAt" in value && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) &&
    (!("tabId" in value) || Number.isSafeInteger(value.tabId)) &&
    (!("documentId" in value) || typeof value.documentId === "string") &&
    (!("started" in value) || typeof value.started === "boolean") &&
    (!("imported" in value) || typeof value.imported === "boolean") &&
    (!("cancelled" in value) || typeof value.cancelled === "boolean");
}

/** Persist ownership and schedule recovery before pausing any native download. */
export function registerEpubDirectImport(): void {
  const pending = new Map<string, PendingImport>();
  const loaded = (async () => {
    const saved: unknown = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (saved === undefined) return;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      throw new Error("Invalid EPUB download recovery journal.");
    }
    for (const [token, entry] of Object.entries(saved)) {
      if (!isPendingImport(entry)) throw new Error("Invalid EPUB download recovery entry.");
      pending.set(token, entry);
    }
  })();
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const task = tail.then(() => loaded).then(operation);
    tail = task.catch((error: unknown) => {
      console.warn("Ambra could not update an EPUB download handoff. The browser download may need attention.", error);
    });
    return task;
  };
  const persist = () => chrome.storage.local.set({ [STORAGE_KEY]: Object.fromEntries(pending) });
  const ensureRecovery = () => chrome.alarms.create(RECOVERY_ALARM, { periodInMinutes: 1 });
  const isLibraryUrl = (url?: string) =>
    url?.split(/[?#]/)[0] === chrome.runtime.getURL("src/library/index.html");

  async function hasImportDocument(entry: PendingImport): Promise<boolean | undefined> {
    if (!entry.documentId || !chrome.runtime.getContexts) return undefined;
    const contexts = await chrome.runtime.getContexts({ documentIds: [entry.documentId] });
    return contexts.length > 0;
  }

  async function settle(token: string, entry: PendingImport): Promise<void> {
    const [item] = await chrome.downloads.search({ id: entry.downloadId });
    if ((entry.imported || entry.cancelled) && item?.state === "in_progress") {
      try {
        await chrome.downloads.cancel(entry.downloadId);
      } catch (error) {
        if (entry.cancelled) throw error;
        console.warn("Ambra could not cancel the original download after import; restoring the browser fallback.", error);
        if (item.paused) await chrome.downloads.resume(entry.downloadId);
      }
      const [current] = await chrome.downloads.search({ id: entry.downloadId });
      // Completion can win the cancel race; never erase a completed file/history.
      if (current?.state === "interrupted" && current.error === "USER_CANCELED") {
        try {
          await chrome.downloads.erase({ id: entry.downloadId, state: "interrupted", error: "USER_CANCELED" });
        } catch (error) {
          console.warn("Ambra could not clean up cancelled-download history.", error);
        }
      }
    } else if (!entry.imported && !entry.cancelled && item &&
      ((item.state === "in_progress" && item.paused) ||
        (item.state === "interrupted" && item.canResume && item.error !== "USER_CANCELED"))) {
      await chrome.downloads.resume(entry.downloadId);
    } else if (!entry.imported && !entry.cancelled && item?.state === "interrupted" && item.error !== "USER_CANCELED") {
      console.warn("Chrome cannot resume the interrupted EPUB download. Retry it in Chrome Downloads.");
    }
    pending.delete(token);
    try {
      await persist();
    } catch (error) {
      pending.set(token, entry);
      throw error;
    }
    if (!pending.size) await chrome.alarms.clear(RECOVERY_ALARM);
  }

  async function recover(all = false): Promise<void> {
    for (const [token, entry] of pending) {
      let orphaned = all || entry.cancelled || entry.imported !== undefined || entry.tabId === undefined || Date.now() - entry.updatedAt > LEASE_MS;
      if (!orphaned && entry.tabId !== undefined) {
        try {
          const sameDocument = await hasImportDocument(entry);
          if (sameDocument !== undefined) orphaned = !sameDocument;
          else {
            const tab = await chrome.tabs.get(entry.tabId);
            orphaned = !!tab.url && !isLibraryUrl(tab.url) && !isLibraryUrl(tab.pendingUrl);
          }
        } catch (error) {
          console.warn("Ambra could not find the import tab; restoring its browser download.", error);
          orphaned = true;
        }
      }
      if (orphaned) {
        try {
          await settle(token, entry);
        } catch (error) {
          // Keep the durable record/alarm so a transient API failure can recover.
          console.warn("Ambra could not restore an EPUB download. Recovery will retry; you can also resume it in Chrome Downloads.", error);
        }
      }
    }
    if (!pending.size) await chrome.alarms.clear(RECOVERY_ALARM);
  }

  void enqueue(async () => {
    if (pending.size) {
      await ensureRecovery();
      await recover();
    }
  });

  chrome.downloads.onCreated.addListener((item) => {
    if (!isLikelyEpubDownload(item) || item.state !== "in_progress" || item.paused ||
      item.byExtensionId === chrome.runtime.id) return;
    void enqueue(async () => {
      if (!await hasImportHostAccess([item.url, item.finalUrl || item.url])) return;
      if (pending.size >= 100) {
        console.warn("Ambra skipped automatic EPUB import because too many handoffs are pending. The browser download was left running.");
        return;
      }
      const [current] = await chrome.downloads.search({ id: item.id });
      if (!current || current.paused || current.state === "interrupted") return;
      const token = crypto.randomUUID();
      const entry: PendingImport = { downloadId: item.id, updatedAt: Date.now() };
      await ensureRecovery();
      pending.set(token, entry);
      try {
        await persist();
      } catch (error) {
        pending.delete(token);
        throw error;
      }
      try {
        if (current.state === "in_progress") {
          try {
            await chrome.downloads.pause(item.id);
          } catch (error) {
            const [latest] = await chrome.downloads.search({ id: item.id });
            if (latest?.state !== "complete") throw error;
          }
        }
        const tab = await openLibraryImportTab(item.finalUrl || item.url, token);
        if (tab.id === undefined) throw new Error("The EPUB import tab has no ID.");
        entry.tabId = tab.id;
        await persist();
      } catch (error) {
        console.warn("Ambra could not start the EPUB import; restoring the browser download.", error);
        await settle(token, entry);
      }
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void enqueue(async () => {
      for (const [token, entry] of pending) if (entry.tabId === tabId) await settle(token, entry);
    });
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== "loading" && change.status !== "complete") return;
    void enqueue(async () => {
      for (const [token, entry] of pending) {
        // History/hash updates also report loading. Only an actual document
        // replacement abandons the import; older Chrome uses lease recovery.
        if (entry.tabId === tabId && entry.started && await hasImportDocument(entry) === false) {
          await settle(token, entry);
        }
      }
    });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECOVERY_ALARM) void enqueue(() => recover());
  });
  chrome.runtime.onStartup.addListener(() => { void enqueue(() => recover(true)); });
  chrome.runtime.onInstalled.addListener(() => { void enqueue(() => recover(true)); });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== "object" || !("type" in message) ||
      (message.type !== EPUB_IMPORT_RESULT && message.type !== EPUB_IMPORT_ACTIVE && message.type !== EPUB_IMPORT_CANCEL) ||
      !("token" in message) || typeof message.token !== "string" ||
      (message.type === EPUB_IMPORT_RESULT && (!("imported" in message) || typeof message.imported !== "boolean")) ||
      sender.id !== chrome.runtime.id || sender.frameId !== 0 || !isLibraryUrl(sender.url)) return;
    const token = message.token;
    void enqueue(async () => {
      const entry = pending.get(token);
      if (!entry || entry.tabId !== sender.tab?.id) return { received: false };
      if (message.type === EPUB_IMPORT_ACTIVE) {
        if (entry.cancelled) return { received: false };
        entry.started = true;
        if (sender.documentId) entry.documentId = sender.documentId;
        else if (!entry.documentId) {
          console.warn("Chrome did not identify the import document. Reload recovery will use the activity timeout.");
        }
        entry.updatedAt = Date.now();
        await persist();
      } else {
        if (message.type === EPUB_IMPORT_CANCEL) entry.cancelled = true;
        else if (!entry.cancelled) entry.imported = "imported" in message && message.imported === true;
        await persist();
        await settle(token, entry);
      }
      return { received: true };
    }).then(sendResponse, () => sendResponse({ received: false }));
    return true;
  });
}
