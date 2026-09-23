import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLibraryImportTab, openLibraryTab } from "../navigation.js";
import { registerEpubDirectImport } from "./epubDirectImport.js";
import { registerEpubDownloadDetection } from "./epubDownloadDetection.js";

vi.mock("../navigation.js", () => ({
  openLibraryImportTab: vi.fn().mockResolvedValue(undefined),
  openLibraryTab: vi.fn().mockResolvedValue(undefined),
}));

describe("EPUB download handoff", () => {
  let onCreated: (item: chrome.downloads.DownloadItem) => void;
  let onChanged: (delta: chrome.downloads.DownloadDelta) => void;
  let onClicked: (id: string) => void;
  let cancelCallback: () => void;
  let lastError: chrome.runtime.LastError | undefined;
  const searches: Array<(items: chrome.downloads.DownloadItem[]) => void> = [];
  const cancel = vi.fn();
  const erase = vi.fn();
  const search = vi.fn();
  const notify = vi.fn();
  const clear = vi.fn();
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
    erase.mockResolvedValue([42]);
    notify.mockResolvedValue("ambra-epub-download-42");
    clear.mockResolvedValue(true);
    vi.mocked(openLibraryImportTab).mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("chrome", {
      runtime: { get lastError() { return lastError; }, getURL: (path: string) => `extension://${path}` },
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
    expect(cancel).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
  });

  it("erases only confirmed cancellations, after the import tab opens", async () => {
    onCreated(originalItem);
    expect(erase).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
    completeCancel();
    expect(erase).not.toHaveBeenCalled();
    answerSearch({ state: "interrupted", error: "USER_CANCELED" });
    await vi.waitFor(() => expect(erase).toHaveBeenCalledExactlyOnceWith({
      id: 42, state: "interrupted", error: "USER_CANCELED",
    }));
    expect(openLibraryImportTab).toHaveBeenCalledExactlyOnceWith(originalItem.url);
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps failed cancellations and waits for completion before offering the file-picker fallback", () => {
    onCreated(originalItem);
    completeCancel("Download cannot be cancelled");
    expect(erase).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    onChanged({ id: 42, state: { current: "complete" } });
    answerSearch({ state: "complete" });
    expect(notify).toHaveBeenCalledWith("ambra-epub-download-42", expect.objectContaining({
      message: '"book.epub" looks like an EPUB. Click here to open your library and add it.',
    }));
    expect(erase).not.toHaveBeenCalled();
  });

  it("preserves a download that completed before a successful cancellation callback", () => {
    onCreated(originalItem);
    completeCancel();
    answerSearch({ state: "complete" });
    expect(erase).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
    onChanged({ id: 42, state: { current: "complete" } });
    answerSearch({ state: "complete" });
    expect(notify).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    { state: "in_progress" as const },
    { state: "interrupted" as const, error: "NETWORK_FAILED" as const },
  ])("preserves missing or non-cancelled download state: %j", (item) => {
    onCreated(originalItem);
    completeCancel();
    answerSearch(item);
    expect(erase).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
  });

  it("does not erase history when checking the cancellation state fails", () => {
    onCreated(originalItem);
    completeCancel();
    answerSearch(undefined, "Search failed");
    expect(erase).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
  });

  it("keeps the cancelled entry when opening the import tab fails", async () => {
    vi.mocked(openLibraryImportTab).mockRejectedValueOnce(new Error("Tab creation failed"));
    onCreated(originalItem);
    completeCancel();
    answerSearch({ state: "interrupted", error: "USER_CANCELED" });
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce());
    expect(erase).not.toHaveBeenCalled();
  });

  it("handles a history-erase failure without rejecting the background event", async () => {
    erase.mockRejectedValueOnce(new Error("Erase failed"));
    onCreated(originalItem);
    completeCancel();
    answerSearch({ state: "interrupted", error: "USER_CANCELED" });
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledOnce());
    expect(openLibraryImportTab).toHaveBeenCalledOnce();
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
