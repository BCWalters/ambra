import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLibraryImportTab, openLibraryTab } from "../navigation.js";
import { EPUB_IMPORT_ACTIVE, EPUB_IMPORT_CANCEL, EPUB_IMPORT_RESULT } from "../epubImportHandoff.js";
import { registerEpubDirectImport } from "./epubDirectImport.js";
import { registerEpubDownloadDetection } from "./epubDownloadDetection.js";

vi.mock("../navigation.js", () => ({
  openLibraryImportTab: vi.fn(),
  openLibraryTab: vi.fn().mockResolvedValue(undefined),
}));

const KEY = "epubPausedImports.v1";
const ALARM = "ambra:epub-import-recovery";

describe("EPUB download handoff", () => {
  let onCreated: (item: chrome.downloads.DownloadItem) => void;
  let onChanged: (delta: chrome.downloads.DownloadDelta) => void;
  let onClicked: (id: string) => void;
  let onRemoved: (tabId: number) => void;
  let onUpdated: (tabId: number, change: { status?: "loading" | "complete" }) => void;
  let onAlarm: (alarm: { name: string }) => void;
  let onStartup: () => void;
  let onInstalled: () => void;
  let onMessage: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => boolean | undefined;
  let journal: Record<string, { downloadId: number; tabId?: number; documentId?: string; updatedAt: number; started?: boolean; imported?: boolean; cancelled?: boolean }>;
  let items: Map<number, chrome.downloads.DownloadItem>;
  const pause = vi.fn(), resume = vi.fn(), cancel = vi.fn(), erase = vi.fn(), search = vi.fn();
  const contains = vi.fn(), notify = vi.fn(), clear = vi.fn();
  const storageGet = vi.fn(), storageSet = vi.fn(), alarmCreate = vi.fn(), alarmClear = vi.fn(), tabGet = vi.fn();
  const getContexts = vi.fn();
  const sender = {
    id: "ambra", tab: { id: 7 }, frameId: 0, documentId: "import-document",
    url: "chrome-extension://ambra/src/library/index.html?view=tab",
  } as chrome.runtime.MessageSender;
  const originalItem = {
    id: 42, url: "https://example.com/book.epub", filename: "/private/downloads/book.epub",
    mime: "application/epub+zip", state: "in_progress", paused: false,
  } as chrome.downloads.DownloadItem;

  beforeEach(() => {
    vi.resetAllMocks();
    journal = {};
    items = new Map([[42, { ...originalItem }]]);
    pause.mockImplementation(async (id: number) => { items.get(id)!.paused = true; });
    resume.mockImplementation(async (id: number) => { items.get(id)!.paused = false; });
    cancel.mockImplementation(async (id: number) => {
      Object.assign(items.get(id)!, { paused: false, state: "interrupted", error: "USER_CANCELED" });
    });
    erase.mockImplementation(async ({ id }: { id: number }) => { items.delete(id); return [id]; });
    search.mockImplementation((query: { id: number }, callback?: (result: chrome.downloads.DownloadItem[]) => void) => {
      const item = items.get(query.id);
      const result = item ? [{ ...item }] : [];
      if (callback) callback(result);
      else return Promise.resolve(result);
    });
    contains.mockResolvedValue(true);
    notify.mockResolvedValue("ambra-epub-download-42");
    clear.mockResolvedValue(true);
    storageGet.mockImplementation(async () => ({ [KEY]: structuredClone(journal) }));
    storageSet.mockImplementation(async (value) => { journal = structuredClone(value[KEY]); });
    alarmCreate.mockResolvedValue(undefined);
    alarmClear.mockResolvedValue(true);
    tabGet.mockResolvedValue({ id: 7, url: sender.url });
    getContexts.mockResolvedValue([{ documentId: "import-document" }]);
    vi.mocked(openLibraryImportTab).mockResolvedValue({ id: 7 } as chrome.tabs.Tab);
    vi.mocked(openLibraryTab).mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("chrome", {
      runtime: {
        id: "ambra", getURL: (path: string) => `chrome-extension://ambra/${path}`,
        getContexts,
        onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } },
        onStartup: { addListener: (listener: typeof onStartup) => { onStartup = listener; } },
        onInstalled: { addListener: (listener: typeof onInstalled) => { onInstalled = listener; } },
      },
      storage: { local: { get: storageGet, set: storageSet } },
      alarms: {
        create: alarmCreate, clear: alarmClear,
        onAlarm: { addListener: (listener: typeof onAlarm) => { onAlarm = listener; } },
      },
      permissions: { contains },
      tabs: {
        get: tabGet,
        onRemoved: { addListener: (listener: typeof onRemoved) => { onRemoved = listener; } },
        onUpdated: { addListener: (listener: typeof onUpdated) => { onUpdated = listener; } },
      },
      downloads: {
        pause, resume, cancel, erase, search,
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
    const token = vi.mocked(openLibraryImportTab).mock.calls[0]![1];
    await vi.waitFor(() => expect(journal[token]?.tabId).toBe(7));
    return token;
  }

  function send(token: string, imported?: boolean, from = sender): Promise<unknown> {
    return new Promise((resolve) => {
      const asynchronous = onMessage(imported === undefined
        ? { type: EPUB_IMPORT_ACTIVE, token }
        : { type: EPUB_IMPORT_RESULT, token, imported }, from, resolve);
      if (!asynchronous) resolve(undefined);
    });
  }

  function cancelImport(token: string, from = sender): Promise<unknown> {
    return new Promise(resolve => {
      if (!onMessage({ type: EPUB_IMPORT_CANCEL, token }, from, resolve)) resolve(undefined);
    });
  }

  it("journals and schedules recovery before pausing, and pauses before opening the import", async () => {
    const token = await start();
    expect(pause).toHaveBeenCalledExactlyOnceWith(42);
    expect(storageSet.mock.invocationCallOrder[0]).toBeLessThan(pause.mock.invocationCallOrder[0]!);
    expect(alarmCreate.mock.invocationCallOrder[0]).toBeLessThan(pause.mock.invocationCallOrder[0]!);
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(openLibraryImportTab).mock.invocationCallOrder[0]!);
    expect(items.get(42)?.paused).toBe(true);
    expect(await send(token, true)).toEqual({ received: true });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42);
    expect(erase).toHaveBeenCalledExactlyOnceWith({ id: 42, state: "interrupted", error: "USER_CANCELED" });
    expect(journal).toEqual({});
    expect(alarmClear).toHaveBeenCalledWith(ALARM);
    expect(await send(token, true)).toEqual({ received: false });
  });

  it("resumes on failed import without cancelling or refetching", async () => {
    expect(await send(await start(), false)).toEqual({ received: true });
    expect(resume).toHaveBeenCalledExactlyOnceWith(42);
    expect(cancel).not.toHaveBeenCalled();
    expect(items.get(42)?.paused).toBe(false);
    expect(journal).toEqual({});
    expect(openLibraryImportTab).toHaveBeenCalledOnce();
  });

  it("cancels intentionally without ever resuming the native fallback", async () => {
    const token = await start();
    expect(await cancelImport(token)).toEqual({ received: true });
    expect(cancel).toHaveBeenCalledExactlyOnceWith(42);
    expect(resume).not.toHaveBeenCalled();
    expect(journal).toEqual({});
    expect(await send(token, false)).toEqual({ received: false });
    expect(resume).not.toHaveBeenCalled();
  });

  it("retains cancellation across native API failure and restart, even if a late failure result arrives", async () => {
    const token = await start();
    cancel.mockRejectedValueOnce(new Error("Downloads unavailable"));
    expect(await cancelImport(token)).toEqual({ received: false });
    expect(journal[token]?.cancelled).toBe(true);
    expect(resume).not.toHaveBeenCalled();
    registerEpubDirectImport();
    await send(token, false);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
    expect(resume).not.toHaveBeenCalled();
    expect(journal).toEqual({});
  });

  it("authenticates cancellation just like import results", async () => {
    const token = await start();
    expect(await cancelImport(token, { ...sender, tab: { id: 8 } as chrome.tabs.Tab })).toEqual({ received: false });
    expect(await cancelImport("unknown")).toEqual({ received: false });
    expect(cancel).not.toHaveBeenCalled();
    expect(items.get(42)?.paused).toBe(true);
  });

  it.each(["closed", "reloaded", "startup", "installed"])("restores the paused fallback when %s", async (event) => {
    const token = await start();
    await send(token);
    if (event === "closed") onRemoved(7);
    else if (event === "reloaded") {
      getContexts.mockResolvedValue([]);
      onUpdated(7, { status: "complete" });
    }
    else if (event === "startup") onStartup();
    else onInstalled();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledExactlyOnceWith(42));
    await vi.waitFor(() => expect(journal).toEqual({}));
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not treat the import tab's initial load as abandonment", async () => {
    const token = await start();
    onUpdated(7, { status: "loading" });
    await send(token);
    expect(resume).not.toHaveBeenCalled();
    expect(journal[token]?.started).toBe(true);
  });

  it("keeps same-document history and hash navigation paused after import starts", async () => {
    const token = await start();
    await send(token);
    onUpdated(7, { status: "loading" });
    onUpdated(7, { status: "complete" });
    await send(token);
    expect(getContexts).toHaveBeenCalledWith({ documentIds: ["import-document"] });
    expect(journal[token]?.documentId).toBe("import-document");
    expect(resume).not.toHaveBeenCalled();
    expect(items.get(42)?.paused).toBe(true);
  });

  it("retains a healthy handoff across worker restart and authenticates its eventual result", async () => {
    const token = await start();
    await send(token);
    registerEpubDirectImport();
    expect(await send(token)).toEqual({ received: true });
    expect(resume).not.toHaveBeenCalled();
    expect(await send(token, true)).toEqual({ received: true });
    expect(cancel).toHaveBeenCalledOnce();
    expect(journal).toEqual({});
  });

  it("recovers a crash after pause but before tab creation", async () => {
    await start();
    for (const entry of Object.values(journal)) delete entry.tabId;
    registerEpubDirectImport();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(journal).toEqual({}));
  });

  it("renews active leases, but resumes expired imports on the alarm", async () => {
    const token = await start();
    const clock = vi.spyOn(Date, "now");
    const created = journal[token]!.updatedAt;
    clock.mockReturnValue(created + 4 * 60_000);
    await send(token);
    expect(journal[token]!.updatedAt).toBe(created + 4 * 60_000);
    onAlarm({ name: ALARM });
    await send(token);
    expect(resume).not.toHaveBeenCalled();
    clock.mockReturnValue(created + 10 * 60_000);
    onAlarm({ name: ALARM });
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
  });

  it("recovers a tab that disappeared while the worker was stopped", async () => {
    await start();
    tabGet.mockRejectedValue(new Error("No tab with id: 7"));
    registerEpubDirectImport();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
  });

  it("retries a failed resume without losing the durable ownership record", async () => {
    const token = await start();
    resume.mockRejectedValueOnce(new Error("Chrome temporarily unavailable"));
    expect(await send(token, false)).toEqual({ received: false });
    expect(journal[token]?.imported).toBe(false);
    onAlarm({ name: ALARM });
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(journal).toEqual({}));
    expect(console.warn).toHaveBeenCalled();
  });

  it("retains an acknowledged success through a transient download-state query failure", async () => {
    const token = await start();
    search.mockRejectedValueOnce(new Error("Downloads unavailable"));
    expect(await send(token, true)).toEqual({ received: false });
    expect(journal[token]?.imported).toBe(true);
    onAlarm({ name: ALARM });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(resume).not.toHaveBeenCalled();
  });

  it("recovers a journal update failure after pausing", async () => {
    const save = storageSet.getMockImplementation()!;
    storageSet.mockImplementationOnce(save).mockRejectedValueOnce(new Error("Cannot save tab ID"));
    onCreated(originalItem);
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(journal).toEqual({}));
    expect(cancel).not.toHaveBeenCalled();
  });

  it("finishes cancellation, rather than resuming, after a persisted success and worker crash", async () => {
    const token = await start();
    journal[token]!.imported = true;
    registerEpubDirectImport();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(resume).not.toHaveBeenCalled();
  });

  it.each(["journal", "alarm"])("never pauses unless %s setup succeeds", async (failure) => {
    if (failure === "journal") storageSet.mockRejectedValue(new Error("Storage unavailable"));
    else alarmCreate.mockRejectedValue(new Error("Alarm unavailable"));
    onCreated(originalItem);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(pause).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
  });

  it("restores the native fallback when opening the Library fails", async () => {
    vi.mocked(openLibraryImportTab).mockRejectedValue(new Error("No tab"));
    onCreated(originalItem);
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(journal).toEqual({}));
    expect(cancel).not.toHaveBeenCalled();
  });

  it("does not start a second transfer if Chrome refuses to pause", async () => {
    pause.mockRejectedValueOnce(new Error("Cannot pause"));
    onCreated(originalItem);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    await vi.waitFor(() => expect(journal).toEqual({}));
    expect(openLibraryImportTab).not.toHaveBeenCalled();
    expect(items.get(42)?.paused).toBe(false);
  });

  it.each(["complete", "interrupted", "missing"] as const)("preserves terminal native state on import success: %s", async (state) => {
    const token = await start();
    if (state === "missing") items.delete(42);
    else items.get(42)!.state = state;
    await send(token, true);
    expect(cancel).not.toHaveBeenCalled();
    expect(erase).not.toHaveBeenCalled();
  });

  it("preserves a native download that completes before pausing or during cancellation", async () => {
    pause.mockImplementationOnce(async () => { items.get(42)!.state = "complete"; throw new Error("Finished"); });
    await send(await start(), true);
    expect(cancel).not.toHaveBeenCalled();
    expect(erase).not.toHaveBeenCalled();
  });

  it("does not erase a download that wins the cancellation race", async () => {
    cancel.mockImplementationOnce(async () => { items.get(42)!.state = "complete"; });
    await send(await start(), true);
    expect(erase).not.toHaveBeenCalled();
  });

  it("resumes if cancellation fails after a successful import", async () => {
    cancel.mockRejectedValueOnce(new Error("Cannot cancel"));
    await send(await start(), true);
    expect(resume).toHaveBeenCalledOnce();
    expect(erase).not.toHaveBeenCalled();
  });

  it("reports history cleanup errors without resuming a cancelled download", async () => {
    erase.mockRejectedValueOnce(new Error("Cannot erase"));
    await send(await start(), true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("cancelled-download history"), expect.any(Error));
    expect(resume).not.toHaveBeenCalled();
    expect(journal).toEqual({});
  });

  it("ignores an unrelated tab, frame, origin, token or malformed result", async () => {
    const token = await start();
    for (const from of [
      { ...sender, tab: { id: 8 } as chrome.tabs.Tab }, { ...sender, frameId: 1 },
      { ...sender, id: "other-extension" }, { ...sender, url: "https://example.com/" },
    ]) await send(token, true, from);
    await send("unknown", true);
    expect(onMessage({ type: EPUB_IMPORT_RESULT, token, imported: "true" }, sender, vi.fn())).toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
    await send(token, true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["blob:https://example.com/id", "file:///book.epub", "data:application/epub+zip,abc"])(
    "leaves non-replayable links to Chrome: %s", async (url) => {
      onCreated({ ...originalItem, url });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(contains).not.toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
    },
  );

  it("does not take ownership of a user's already paused download or a non-EPUB", () => {
    onCreated({ ...originalItem, paused: true });
    onCreated({ ...originalItem, url: "https://example.com/a.pdf", filename: "a.pdf", mime: "application/pdf" });
    expect(contains).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it("does not re-import or advertise EPUB copies saved by Ambra itself", () => {
    onCreated({ ...originalItem, byExtensionId: "ambra" });
    Object.assign(items.get(42)!, { state: "complete", byExtensionId: "ambra" });
    onChanged({ id: 42, state: { current: "complete" } });
    expect(pause).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("leaves missing host access to Chrome and retains the completed-file notification", async () => {
    contains.mockResolvedValue(false);
    onCreated({ ...originalItem, finalUrl: "https://cdn.example.org/book.epub" });
    await vi.waitFor(() => expect(contains).toHaveBeenCalledWith({
      origins: ["https://example.com/*", "https://cdn.example.org/*"],
    }));
    expect(pause).not.toHaveBeenCalled();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
    items.get(42)!.state = "complete";
    onChanged({ id: 42, state: { current: "complete" } });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("bounds pending handoffs without claiming more downloads", async () => {
    for (let id = 100; id < 200; id++) {
      const item = { ...originalItem, id };
      items.set(id, item);
      onCreated(item);
    }
    await vi.waitFor(() => expect(openLibraryImportTab).toHaveBeenCalledTimes(100));
    onCreated(originalItem);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("too many handoffs")));
    expect(pause).toHaveBeenCalledTimes(100);
  });

  it("opens the file picker, not another URL fetch, when the fallback notification is clicked", () => {
    onClicked("unrelated-notification");
    expect(openLibraryTab).not.toHaveBeenCalled();
    onClicked("ambra-epub-download-42");
    expect(clear).toHaveBeenCalledExactlyOnceWith("ambra-epub-download-42");
    expect(openLibraryTab).toHaveBeenCalledOnce();
    expect(openLibraryImportTab).not.toHaveBeenCalled();
  });
});
