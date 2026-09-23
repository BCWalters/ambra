import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLibraryImportTab, openLibraryTab } from "../navigation.js";
import { EPUB_IMPORT_RESULT } from "../epubImportHandoff.js";
import { registerEpubDirectImport } from "./epubDirectImport.js";
import { registerEpubDownloadDetection } from "./epubDownloadDetection.js";

vi.mock("../navigation.js", () => ({
  openLibraryImportTab: vi.fn(),
  openLibraryTab: vi.fn().mockResolvedValue(undefined),
}));

describe("EPUB download handoff", () => {
  let onCreated: (item: chrome.downloads.DownloadItem) => void;
  let onChanged: (delta: chrome.downloads.DownloadDelta) => void;
  let onClicked: (id: string) => void;
  let onRemoved: (tabId: number) => void;
  let onMessage: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => void;
  let cancelCallback: () => void;
  let lastError: chrome.runtime.LastError | undefined;
  const searches: Array<(items: chrome.downloads.DownloadItem[]) => void> = [];
  const cancel = vi.fn();
  const erase = vi.fn();
  const search = vi.fn();
  const contains = vi.fn();
  const notify = vi.fn();
  const clear = vi.fn();
  const sender = {
    id: "ambra", tab: { id: 7 }, frameId: 0,
    url: "chrome-extension://ambra/src/library/index.html?view=tab",
  } as chrome.runtime.MessageSender;
  const originalItem = {
    id: 42, url: "https://example.com/book.epub", filename: "/private/downloads/book.epub",
    mime: "application/epub+zip", state: "in_progress",
  } as chrome.downloads.DownloadItem;

  beforeEach(() => {
    vi.clearAllMocks();
    lastError = undefined;
    searches.length = 0;
    cancel.mockImplementation((_id: number, callback: () => void) => { cancelCallback = callback; });
    search.mockImplementation((_query: unknown, callback: (items: chrome.downloads.DownloadItem[]) => void) => {
      searches.push(callback);
    });
    contains.mockResolvedValue(true);
    erase.mockResolvedValue([42]);
    notify.mockResolvedValue("ambra-epub-download-42");
    clear.mockResolvedValue(true);
    vi.mocked(openLibraryImportTab).mockResolvedValue({ id: 7 } as chrome.tabs.Tab);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("chrome", {
      runtime: {
        id: "ambra", get lastError() { return lastError; },
        getURL: (path: string) => `chrome-extension://ambra/${path}`,
        onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } },
      },
      permissions: { contains },
      tabs: { onRemoved: { addListener: (listener: typeof onRemoved) => { onRemoved = listener; } } },
      downloads: {
        cancel, erase, search,
        onCreated: { addListener: (listener: typeof onCreated) => { onCreated = listener; } },
        onChanged: { addListener: (listener: typeof onChanged) => { onChanged = listener; } },
      },
      notifications: {
        create: notify, clear,
        onClicked: { addListener: (listener: typeof onClicked) => { onClicked = listener; } },
      },
    });
    registerEpubDirectImport();
    registerEpubDownloadDetection();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function start() {
    onCreated(originalItem);
    await vi.waitFor(() => expect(openLibraryImportTab).toHaveBeenCalledOnce());
    return vi.mocked(openLibraryImportTab).mock.calls[0]![1];
  }

  function acknowledge(token: string, imported = true, from = sender) {
    onMessage({ type: EPUB_IMPORT_RESULT, token, imported }, from, vi.fn());
  }

  function completeCancel(error?: string) {
    lastError = error ? { message: error } : undefined;
    cancelCallback();
    lastError = undefined;
  }

  function answerSearch(item?: Partial<chrome.downloads.DownloadItem>, error?: string) {
    lastError = error ? { message: error } : undefined;
    searches.shift()!(item ? [{ ...originalItem, ...item }] : []);
    lastError = undefined;
  }

  it("ignores non-EPUB downloads", () => {
    onCreated({ ...originalItem, url: "https://example.com/a.pdf", filename: "a.pdf", mime: "application/pdf" });
    expect(contains).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
  });

  it.each(["blob:https://example.com/id", "file:///book.epub", "data:application/epub+zip,abc"])(
    "leaves non-replayable links to Chrome: %s", async (url) => {
      onCreated({ ...originalItem, url });
      await Promise.resolve();
      expect(contains).not.toHaveBeenCalled();
      expect(openLibraryImportTab).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it.each(["denied", "api-error"])("keeps ordinary downloads on missing host access: %s", async (mode) => {
    if (mode === "denied") contains.mockResolvedValue(false);
    else contains.mockRejectedValue(new Error("Extension unavailable"));
    onCreated(originalItem);
    await vi.waitFor(() => expect(contains).toHaveBeenCalled());
    expect(openLibraryImportTab).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(erase).not.toHaveBeenCalled();
    if (mode === "api-error") {
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("could not check EPUB host access"), expect.any(Error));
    } else {
      expect(console.warn).not.toHaveBeenCalled();
    }
    onChanged({ id: 42, state: { current: "complete" } });
    answerSearch({ state: "complete" });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("requires access to the original and known redirect destinations", async () => {
    contains.mockResolvedValue(false);
    onCreated({ ...originalItem, finalUrl: "https://cdn.example.org/book.epub" });
    await vi.waitFor(() => expect(contains).toHaveBeenCalledExactlyOnceWith({
      origins: ["https://example.com/*", "https://cdn.example.org/*"],
    }));
    expect(openLibraryImportTab).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not cancel on tab creation; erases only after persistence and confirmed cancellation", async () => {
    const token = await start();
    expect(contains).toHaveBeenCalledWith({ origins: ["https://example.com/*"] });
    expect(openLibraryImportTab).toHaveBeenCalledWith(originalItem.url, token);
    expect(cancel).not.toHaveBeenCalled();
    expect(erase).not.toHaveBeenCalled();
    acknowledge(token);
    answerSearch({ state: "in_progress" });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42, expect.any(Function));
    expect(erase).not.toHaveBeenCalled();
    completeCancel();
    answerSearch({ state: "interrupted", error: "USER_CANCELED" });
    expect(erase).toHaveBeenCalledExactlyOnceWith({ id: 42, state: "interrupted", error: "USER_CANCELED" });
    acknowledge(token);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps the native download on failed import, without a retry loop", async () => {
    const token = await start();
    acknowledge(token, false);
    acknowledge(token);
    expect(search).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(erase).not.toHaveBeenCalled();
    expect(openLibraryImportTab).toHaveBeenCalledOnce();
  });

  it.each(["tab-closed", "worker-restarted"] as const)("keeps the native download when %s", async (event) => {
    const token = await start();
    if (event === "tab-closed") onRemoved(7);
    else registerEpubDirectImport();
    acknowledge(token);
    expect(search).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("ignores an unrelated tab, frame, origin, token or malformed result", async () => {
    const token = await start();
    acknowledge(token, true, { ...sender, tab: { id: 8 } as chrome.tabs.Tab });
    acknowledge(token, true, { ...sender, frameId: 1 });
    acknowledge(token, true, { ...sender, id: "other-extension" });
    acknowledge(token, true, { ...sender, url: "https://example.com/" });
    acknowledge("unknown");
    onMessage({ type: EPUB_IMPORT_RESULT, token, imported: "true" }, sender, vi.fn());
    expect(search).not.toHaveBeenCalled();
    acknowledge(token);
    expect(search).toHaveBeenCalledOnce();
  });

  it.each(["complete", "interrupted", "missing", "search-error"])(
    "preserves native state after successful import: %s", async (state) => {
      acknowledge(await start());
      answerSearch(state === "missing" ? undefined : {
        state: state === "complete" ? "complete" : "interrupted",
      }, state === "search-error" ? "Search failed" : undefined);
      expect(cancel).not.toHaveBeenCalled();
      expect(erase).not.toHaveBeenCalled();
    },
  );

  it("preserves a download that completes during cancellation", async () => {
    acknowledge(await start());
    answerSearch({ state: "in_progress" });
    completeCancel();
    answerSearch({ state: "complete" });
    expect(erase).not.toHaveBeenCalled();
  });

  it("preserves history if cancellation or its state check fails", async () => {
    acknowledge(await start());
    answerSearch({ state: "in_progress" });
    completeCancel("Download cannot be cancelled");
    expect(erase).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledOnce();
  });

  it("leaves the download alone when opening the import tab fails", async () => {
    vi.mocked(openLibraryImportTab).mockRejectedValueOnce(new Error("Tab creation failed"));
    onCreated(originalItem);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce());
    expect(cancel).not.toHaveBeenCalled();
    expect(erase).not.toHaveBeenCalled();
  });

  it("logs the pending-handoff limit without cancelling or retrying downloads", async () => {
    for (let id = 0; id < 100; id++) onCreated({ ...originalItem, id });
    await vi.waitFor(() => expect(openLibraryImportTab).toHaveBeenCalledTimes(100));
    onCreated({ ...originalItem, id: 101 });
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("too many handoffs are pending"),
    ));
    expect(openLibraryImportTab).toHaveBeenCalledTimes(100);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("handles a history-erase failure without rejecting the background event", async () => {
    erase.mockRejectedValueOnce(new Error("Erase failed"));
    acknowledge(await start());
    answerSearch({ state: "in_progress" });
    completeCancel();
    answerSearch({ state: "interrupted", error: "USER_CANCELED" });
    await Promise.resolve();
    expect(erase).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("could not clean up cancelled-download history"), expect.any(Error));
  });

  it("does not advertise a missing, incomplete, or unreadable completed-download record", () => {
    for (const item of [undefined, { state: "interrupted" as const }]) {
      onChanged({ id: 42, state: { current: "complete" } });
      answerSearch(item);
    }
    onChanged({ id: 42, state: { current: "complete" } });
    answerSearch(undefined, "Search failed");
    expect(notify).not.toHaveBeenCalled();
  });

  it("opens the file-picker library, not another URL fetch, when the fallback notification is clicked", () => {
    onClicked("unrelated-notification");
    expect(openLibraryTab).not.toHaveBeenCalled();
    onClicked("ambra-epub-download-42");
    expect(clear).toHaveBeenCalledExactlyOnceWith("ambra-epub-download-42");
    expect(openLibraryTab).toHaveBeenCalledOnce();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
  });
});
