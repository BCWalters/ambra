import { act, StrictMode } from "react";
import { ZipFormatError } from "@ambra/engine";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryDatabase, type BookMetadata } from "./LibraryDatabase.js";
import { importBook } from "./BookImporter.js";
import { useLibrary, type UseLibraryResult } from "./useLibrary.js";
import { LibraryApp } from "./LibraryApp.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";
import { LocaleProvider, useLocale } from "../i18n/LocaleContext.js";
import { EPUB_IMPORT_ACTIVE, EPUB_IMPORT_CANCEL, EPUB_IMPORT_RESULT } from "../epubImportHandoff.js";

vi.mock("./BookImporter.js", () => ({ importBook: vi.fn().mockResolvedValue("book") }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function makeDatabase() {
  const methods = {
    close: vi.fn(),
    listBooks: vi.fn().mockResolvedValue([{ id: "book", title: "Book" } as BookMetadata]),
    getAllProgress: vi.fn().mockResolvedValue(new Map()),
    getLibraryCoverBlobs: vi.fn().mockImplementation(async () => {
      const blob = new Blob(["cover"]);
      return { original: blob, card: blob };
    }),
    getGlobalReadingSettings: vi.fn().mockResolvedValue(DEFAULT_GLOBAL_READING_SETTINGS),
    patchGlobalReadingSettings: vi.fn().mockResolvedValue(undefined),
    subscribePreferences: vi.fn<LibraryDatabase["subscribePreferences"]>().mockReturnValue(vi.fn()),
    subscribeBooks: vi.fn<LibraryDatabase["subscribeBooks"]>().mockReturnValue(vi.fn()),
    getDefaultLibrarySort: vi.fn().mockResolvedValue(undefined),
    deleteBook: vi.fn().mockResolvedValue(undefined),
    setDefaultLibrarySort: vi.fn().mockResolvedValue(undefined),
    getLocalePreference: vi.fn().mockResolvedValue("en"),
    setLocalePreference: vi.fn().mockResolvedValue(undefined),
  };
  return { methods, value: methods as unknown as LibraryDatabase };
}

describe("useLibrary ownership and failures", () => {
  let root: Root;
  let container: HTMLDivElement;
  let mounted: boolean;
  let latest: UseLibraryResult;
  let db: ReturnType<typeof makeDatabase>;
  const resultMessages = () => vi.mocked(chrome.runtime.sendMessage).mock.calls.flatMap((args) => {
    const message: unknown = args[0];
    return message && typeof message === "object" && "type" in message && message.type === EPUB_IMPORT_RESULT
      ? [message] : [];
  });

  function Harness() {
    latest = useLibrary();
    return null;
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => ({ version: "test" }), sendMessage: vi.fn().mockResolvedValue({ received: true }) },
      permissions: { contains: vi.fn().mockResolvedValue(true) },
    });
    window.history.replaceState(null, "", "/?view=tab");
    db = makeDatabase();
    vi.spyOn(LibraryDatabase, "open").mockResolvedValue(db.value);
    vi.spyOn(LibraryDatabase, "estimateStorageUsage").mockResolvedValue(undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cover");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(importBook).mockReset().mockResolvedValue("book");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });
  afterEach(() => {
    if (mounted) act(() => root.unmount());
    vi.useRealTimers();
    container.remove();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(strict = false) {
    await act(async () => root.render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />));
  }

  it("reports an attempted import while database opening is withheld, then supports retry", async () => {
    const opening = deferred<LibraryDatabase>();
    vi.mocked(LibraryDatabase.open).mockReturnValue(opening.promise);
    await render();
    const file = new File(["book"], "book.epub");
    await act(async () => latest.importFiles([file]));
    expect(importBook).not.toHaveBeenCalled();
    expect(latest.error).toContain("isn't ready");
    await act(async () => { opening.resolve(db.value); });
    await act(async () => latest.importFiles([file]));
    expect(importBook).toHaveBeenCalledExactlyOnceWith(db.value, file, expect.any(Function));
    expect(latest.error).toBeUndefined();
  });

  it("hides import choices and disables the file input until initialization finishes", async () => {
    const opening = deferred<LibraryDatabase>();
    const preference = deferred<undefined>();
    vi.mocked(LibraryDatabase.open).mockReturnValue(opening.promise);
    db.methods.getDefaultLibrarySort.mockReturnValue(preference.promise);
    await act(async () => root.render(<LibraryApp />));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const importButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Import EPUB");
    expect(input.disabled).toBe(true);
    expect(importButton()).toBeUndefined();
    expect(container.textContent).not.toContain("What will you read first?");
    await act(async () => { opening.resolve(db.value); });
    expect(input.disabled).toBe(true);
    expect(importButton()).toBeUndefined();
    await act(async () => { preference.resolve(undefined); });
    expect(input.disabled).toBe(false);
    expect(importButton()?.disabled).toBe(false);
  });

  it("preserves initialization failure details and keeps every import entry disabled until remount recovery", async () => {
    vi.mocked(LibraryDatabase.open).mockRejectedValueOnce(new Error("Close other Ambra tabs, then reload."));
    await act(async () => root.render(<LibraryApp />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Close other Ambra tabs");
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent?.includes("Choose EPUB files..."));
    expect(buttons).toHaveLength(1);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<LibraryApp />));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(false);
  });

  it("does not replace a database-open failure with a generic invalid-import error", async () => {
    vi.mocked(LibraryDatabase.open).mockRejectedValueOnce(new Error("Database upgrade blocked; reload."));
    await render();
    await act(async () => latest.importFiles([new File(["book"], "book.epub")]));
    expect(latest.error).toBe("Database upgrade blocked; reload.");
    expect(importBook).not.toHaveBeenCalled();
  });

  it("closes the live database and revokes displayed covers on unmount", async () => {
    await render();
    expect(latest.books).toHaveLength(1);
    act(() => root.unmount());
    mounted = false;
    expect(db.methods.close).toHaveBeenCalledOnce();
    expect(db.methods.subscribePreferences.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(db.methods.subscribeBooks.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cover");
  });

  it("closes a late StrictMode open without taking ownership from the live connection", async () => {
    const discarded = makeDatabase();
    const late = deferred<LibraryDatabase>();
    vi.mocked(LibraryDatabase.open).mockReturnValueOnce(late.promise).mockResolvedValueOnce(db.value);
    await render(true);
    expect(latest.books).toHaveLength(1);
    await act(async () => { late.resolve(discarded.value); });
    expect(discarded.methods.close).toHaveBeenCalledOnce();
    expect(db.methods.close).not.toHaveBeenCalled();
    act(() => root.unmount());
    mounted = false;
    expect(db.methods.close).toHaveBeenCalledOnce();
  });

  it("reports a failed removal without losing the card or its cover", async () => {
    db.methods.deleteBook.mockRejectedValueOnce(new Error("Deletion failed"));
    await render();
    await act(async () => latest.removeBook("book"));
    expect(latest.error).toBe("Deletion failed");
    expect(latest.books[0]?.id).toBe("book");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    db.methods.listBooks.mockResolvedValue([]);
    await act(async () => latest.removeBook("book"));
    expect(latest.error).toBeUndefined();
    expect(latest.books).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("uses a specific headline for invalid EPUBs without losing the technical message", async () => {
    await render();
    vi.mocked(importBook).mockRejectedValueOnce(new ZipFormatError("Not a valid ZIP archive"));
    await act(async () => latest.importFiles([new File(["bad"], "bad.epub")]));
    expect(latest.errorHeadline).toBe("Oh dear, that doesn't look like a valid EPUB file.");
    expect(latest.error).toBe("Not a valid ZIP archive");
    vi.mocked(importBook).mockRejectedValueOnce(new Error("Storage unavailable"));
    await act(async () => latest.importFiles([new File(["book"], "book.epub")]));
    expect(latest.errorHeadline).toBeUndefined();
    expect(latest.error).toBe("Storage unavailable");
  });

  it("refreshes peer book changes and storage usage without replacing local import status", async () => {
    await render();
    await act(async () => latest.importFiles([new File(["book"], "book.epub")]));
    const activities = latest.importActivities;
    const notify = db.methods.subscribeBooks.mock.calls[0]![0];
    const estimates = vi.mocked(LibraryDatabase.estimateStorageUsage).mock.calls.length;
    db.methods.listBooks.mockResolvedValue([]);
    await act(async () => notify());
    expect(latest.books).toEqual([]);
    expect(latest.importActivities).toBe(activities);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:cover");
    expect(LibraryDatabase.estimateStorageUsage).toHaveBeenCalledTimes(estimates + 1);
    db.methods.listBooks.mockResolvedValue([{ id: "other", title: "Other book" } as BookMetadata]);
    await act(async () => notify());
    expect(latest.books.map(book => book.id)).toEqual(["other"]);
  });

  it("surfaces peer refresh errors and recovers on a later notification", async () => {
    await render();
    const notify = db.methods.subscribeBooks.mock.calls[0]![0];
    db.methods.listBooks.mockRejectedValueOnce(new Error("Peer refresh failed"));
    await act(async () => notify());
    expect(latest.error).toBe("Peer refresh failed");
    expect(latest.books).toHaveLength(1);
    db.methods.listBooks.mockResolvedValue([]);
    await act(async () => notify());
    expect(latest.books).toEqual([]);
  });

  it.each(["remove", "import"] as const)("reports refresh failure after %s without an unhandled rejection", async (action) => {
    await render();
    db.methods.listBooks.mockRejectedValueOnce(new Error("Refresh failed"));
    await act(async () => {
      if (action === "remove") await latest.removeBook("book");
      else await latest.importFiles([new File(["book"], "book.epub")]);
    });
    expect(latest.error).toBe("Refresh failed");
  });

  it("aborts the direct-import fetch on unmount and ignores its late response", async () => {
    const response = deferred<Response>();
    const fetch = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState(null, "", "/?view=tab&importUrl=https%3A%2F%2Fexample.com%2Fbook.epub");
    await render();
    expect(fetch).toHaveBeenCalledOnce();
    const signal = fetch.mock.calls[0]?.[1].signal as AbortSignal;
    act(() => root.unmount());
    mounted = false;
    expect(signal.aborted).toBe(true);
    await act(async () => { response.resolve(new Response("epub")); });
    expect(importBook).not.toHaveBeenCalled();
  });

  it("waits for readiness before fetching an automatic import, including in StrictMode", async () => {
    const preference = deferred<undefined>();
    const discarded = makeDatabase();
    vi.mocked(LibraryDatabase.open).mockResolvedValueOnce(discarded.value).mockResolvedValueOnce(db.value);
    db.methods.getDefaultLibrarySort.mockReturnValue(preference.promise);
    const fetch = vi.fn().mockResolvedValue(new Response("epub"));
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState(null, "", "/?view=tab&importUrl=https%3A%2F%2Fexample.com%2Fbook.epub");
    await render(true);
    expect(latest.canImport).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { preference.resolve(undefined); });
    expect(latest.canImport).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(importBook).toHaveBeenCalledOnce();
    expect(latest.importActivities).toEqual([{ id: 1, fileName: "book.epub", phase: "complete", bookId: "book" }]);
    expect((fetch.mock.calls[0]?.[1].signal as AbortSignal).aborted).toBe(false);
    expect(discarded.methods.close).toHaveBeenCalledOnce();
  });

  function setDirectImportUrl(url = "https://example.com/book.epub") {
    window.history.replaceState(null, "", `/?view=tab&importUrl=${encodeURIComponent(url)}&importToken=handoff`);
  }

  it("aborts pending response headers and cancels the Chrome handoff without a failed RESULT or error", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal!;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })));
    setDirectImportUrl();
    await render();
    const id = latest.importActivities[0]!.id;
    expect(latest.cancelDownload(id + 1)).toBe(false);
    await act(async () => { expect(latest.cancelDownload(id)).toBe(true); });
    expect(signal.aborted).toBe(true);
    expect(latest.cancelDownload(id)).toBe(false);
    expect(latest.importActivities).toEqual([]);
    expect(latest.error).toBeUndefined();
    expect(importBook).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: EPUB_IMPORT_CANCEL, token: "handoff" });
    expect(resultMessages()).toEqual([]);
  });

  it("cancels a partially received response body without importing its bytes", async () => {
    const cancel = vi.fn();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream({
      start(controller) { stream = controller; },
      cancel,
    }), { headers: { "content-length": "100" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    setDirectImportUrl();
    await render();
    await act(async () => { stream.enqueue(new Uint8Array([1, 2, 3])); });
    expect(latest.importActivities[0]?.download?.receivedBytes).toBe(3);
    await act(async () => { expect(latest.cancelDownload(latest.importActivities[0]!.id)).toBe(true); });
    expect(cancel).toHaveBeenCalledOnce();
    expect(importBook).not.toHaveBeenCalled();
    expect(latest.importActivities).toEqual([]);
    expect(latest.error).toBeUndefined();
    expect(resultMessages()).toEqual([]);
  });

  it.each(["headers", "body"])("does not import when cancellation wins a %s-completion race", async (stage) => {
    const headers = deferred<Response>();
    const body = deferred<Blob>();
    const response = new Response(null);
    vi.spyOn(response, "blob").mockReturnValue(body.promise);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(headers.promise));
    setDirectImportUrl();
    await render();
    const id = latest.importActivities[0]!.id;
    if (stage === "body") await act(async () => headers.resolve(response));
    await act(async () => {
      if (stage === "headers") headers.resolve(response);
      body.resolve(new Blob(["epub"]));
      expect(latest.cancelDownload(id)).toBe(true);
    });
    expect(importBook).not.toHaveBeenCalled();
    expect(resultMessages()).toEqual([]);
    expect(latest.error).toBeUndefined();
    expect(latest.importActivities).toEqual([]);
  });

  it("rejects a stale downloading action before React renders processing, and throughout saving and completion", async () => {
    const response = deferred<Response>();
    const saving = deferred<string>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    setDirectImportUrl();
    await render();
    const id = latest.importActivities[0]!.id;
    const cancelDownload = latest.cancelDownload;
    vi.mocked(importBook).mockImplementationOnce(() => {
      expect(latest.importActivities[0]?.phase).toBe("downloading");
      expect(cancelDownload(id)).toBe(false);
      return saving.promise;
    });
    await act(async () => response.resolve(new Response("epub")));
    expect(latest.importActivities[0]?.phase).toBe("processing");
    expect(cancelDownload(id)).toBe(false);
    act(() => vi.mocked(importBook).mock.calls[0]?.[2]?.("saving"));
    expect(latest.importActivities[0]?.phase).toBe("saving");
    expect(cancelDownload(id)).toBe(false);
    await act(async () => saving.resolve("book"));
    expect(cancelDownload(id)).toBe(false);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: EPUB_IMPORT_CANCEL }));
    expect(resultMessages()).toEqual([{ type: EPUB_IMPORT_RESULT, token: "handoff", imported: true }]);
  });

  it("does not cancel queued or processing imports chosen from the device", async () => {
    const saving = deferred<string>();
    vi.mocked(importBook).mockReturnValueOnce(saving.promise);
    await render();
    let importing!: Promise<void>;
    act(() => {
      importing = latest.importFiles([new File(["one"], "one.epub"), new File(["two"], "two.epub")]);
    });
    expect(latest.importActivities.map(({ phase }) => phase)).toEqual(["processing", "queued"]);
    for (const { id } of latest.importActivities) expect(latest.cancelDownload(id)).toBe(false);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    await act(async () => { saving.resolve("book"); await importing; });
    expect(importBook).toHaveBeenCalledTimes(2);
  });

  it("cancels a tokenless URL download without sending any Chrome handoff messages", async () => {
    const response = deferred<Response>();
    const fetch = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState(null, "", "/?view=tab&importUrl=https%3A%2F%2Fexample.com%2Fbook.epub");
    await render();
    await act(async () => { expect(latest.cancelDownload(latest.importActivities[0]!.id)).toBe(true); });
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
    await act(async () => response.resolve(new Response("epub")));
    expect(importBook).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(latest.importActivities).toEqual([]);
    expect(latest.error).toBeUndefined();
  });

  it.each(["acknowledged", "rejected", "unacknowledged", "timeout"])(
    "clears heartbeat and acknowledgement timers after %s cancellation, never sending RESULT", async (outcome) => {
      vi.useFakeTimers();
      const headers = deferred<Response>();
      const acknowledgement = deferred<{ received: boolean }>();
      vi.stubGlobal("fetch", vi.fn().mockReturnValue(headers.promise));
      vi.mocked(chrome.runtime.sendMessage).mockImplementation((message: unknown) => {
        if (!message || typeof message !== "object" || !("type" in message) || message.type !== EPUB_IMPORT_CANCEL) {
          return Promise.resolve({ received: true });
        }
        if (outcome === "rejected") return Promise.reject(new Error("Worker unavailable"));
        if (outcome === "unacknowledged") return Promise.resolve({ received: false });
        return acknowledgement.promise;
      });
      setDirectImportUrl();
      await render();
      await act(async () => { expect(latest.cancelDownload(latest.importActivities[0]!.id)).toBe(true); });
      await act(async () => headers.resolve(new Response("epub")));
      expect(importBook).not.toHaveBeenCalled();
      expect(resultMessages()).toEqual([]);
      if (outcome === "acknowledged") await act(async () => acknowledgement.resolve({ received: true }));
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
      expect(resultMessages()).toEqual([]);
      expect(latest.importActivities).toEqual([]);
      if (outcome === "acknowledged") expect(latest.error).toBeUndefined();
      else expect(latest.error).toContain("Open Chrome Downloads");
      // Even a late worker reply must not turn an intentional cancellation into
      // a normal failed import or restart the heartbeat.
      await act(async () => acknowledgement.resolve({ received: true }));
      expect(resultMessages()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([true, false])("restores focus to the import action after cancelling a focused row (empty=%s)", async (empty) => {
    if (empty) db.methods.listBooks.mockResolvedValue([]);
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    setDirectImportUrl();
    await act(async () => root.render(<LibraryApp />));
    const cancel = container.querySelector<HTMLButtonElement>('[aria-label="Cancel download: book.epub"]')!;
    const importButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => empty ? button.textContent?.includes("Choose EPUB files...") : button.textContent === "Import EPUB")!;
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    await act(async () => cancel.click());
    expect(cancel.isConnected).toBe(false);
    expect(document.activeElement).toBe(importButton);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => response.resolve(new Response("epub")));
    expect(resultMessages()).toEqual([]);
  });

  it("does not move unrelated focus when a download is cancelled", async () => {
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    setDirectImportUrl();
    await act(async () => root.render(<LibraryApp />));
    const cancel = container.querySelector<HTMLButtonElement>('[aria-label^="Cancel download:"]')!;
    const other = container.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!;
    other.focus();
    await act(async () => cancel.click());
    expect(document.activeElement).toBe(other);
    await act(async () => response.resolve(new Response("epub")));
  });

  it("presents an unacknowledged cancellation in the standard library error alert", async () => {
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((message: unknown) =>
      Promise.resolve({
        received: !message || typeof message !== "object" || !("type" in message) || message.type !== EPUB_IMPORT_CANCEL,
      }));
    setDirectImportUrl();
    await act(async () => root.render(<LibraryApp />));
    const cancel = container.querySelector<HTMLButtonElement>('[aria-label^="Cancel download:"]')!;
    await act(async () => cancel.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Open Chrome Downloads");
    expect(cancel.isConnected).toBe(false);
    act(() => root.unmount());
    mounted = false;
    await act(async () => response.resolve(new Response("epub")));
    expect(resultMessages()).toEqual([]);
  });

  it("clears the download heartbeat when normal import finishes", async () => {
    vi.useFakeTimers();
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    setDirectImportUrl();
    await render();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => response.resolve(new Response("epub")));
    expect(latest.importActivities[0]?.phase).toBe("complete");
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(resultMessages()).toEqual([{ type: EPUB_IMPORT_RESULT, token: "handoff", imported: true }]);
  });

  it("acknowledges only after the book is persisted and strips handoff parameters", async () => {
    const saving = deferred<string>();
    vi.mocked(importBook).mockReturnValueOnce(saving.promise);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("epub")));
    setDirectImportUrl();
    await render();
    expect(importBook).toHaveBeenCalledOnce();
    expect(resultMessages()).toEqual([]);
    expect(window.location.search).toBe("?view=tab");
    expect(latest.importActivities).toEqual([{ id: 1, fileName: "book.epub", phase: "processing" }]);
    await act(async () => saving.resolve("book"));
    expect(resultMessages()).toEqual([{
      type: EPUB_IMPORT_RESULT, token: "handoff", imported: true,
    }]);
    expect(latest.importActivities[0]?.phase).toBe("complete");
  });

  it("shows downloading while headers and the entire body are pending, then processing and saving through refresh", async () => {
    const response = deferred<Response>();
    const body = deferred<Blob>();
    const saving = deferred<string>();
    const refreshing = deferred<BookMetadata[]>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    vi.mocked(importBook).mockImplementationOnce((_db, _file, onPhase) => {
      onPhase?.("processing");
      return saving.promise;
    });
    setDirectImportUrl();
    await render();
    expect(latest.importActivities[0]?.phase).toBe("downloading");
    const pendingBody = new Response(null);
    vi.spyOn(pendingBody, "blob").mockReturnValue(body.promise);
    await act(async () => response.resolve(pendingBody));
    expect(latest.importActivities[0]?.phase).toBe("downloading");
    expect(importBook).not.toHaveBeenCalled();
    await act(async () => body.resolve(new Blob(["epub"])));
    expect(latest.importActivities[0]?.phase).toBe("processing");
    act(() => vi.mocked(importBook).mock.calls[0]?.[2]?.("saving"));
    expect(latest.importActivities[0]?.phase).toBe("saving");
    expect(latest.importActivities[0]?.bookId).toBeUndefined();
    expect(resultMessages()).toEqual([]);
    db.methods.listBooks.mockReturnValueOnce(refreshing.promise);
    await act(async () => saving.resolve("book"));
    expect(latest.importActivities[0]?.phase).toBe("saving");
    expect(resultMessages()).toEqual([]);
    await act(async () => refreshing.resolve([{ id: "book", title: "Saved" } as BookMetadata]));
    expect(latest.importActivities[0]?.phase).toBe("complete");
    expect(latest.importActivities[0]?.bookId).toBe("book");
    expect(latest.books[0]?.title).toBe("Saved");
    expect(latest.error).toBeUndefined();
    act(() => latest.dismissCompletedImports());
    expect(latest.importActivities).toEqual([]);
  });

  it("keeps automatic and overlapping manual batches independently busy, including queued files and partial failure", async () => {
    const response = deferred<Response>();
    const first = deferred<string>();
    const second = deferred<string>();
    const third = deferred<string>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    vi.mocked(importBook)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
      .mockRejectedValueOnce(new Error("Fourth book is malformed"));
    setDirectImportUrl();
    await render();
    let batch!: Promise<void>;
    let other!: Promise<void>;
    act(() => {
      batch = latest.importFiles([new File(["1"], "first.epub"), new File(["3"], "third.epub"), new File(["4"], "fourth.epub")]);
      other = latest.importFiles([new File(["2"], "second.epub")]);
    });
    expect(latest.importActivities.map(({ fileName, phase }) => [fileName, phase])).toEqual([
      ["book.epub", "downloading"], ["first.epub", "processing"], ["third.epub", "queued"],
      ["fourth.epub", "queued"], ["second.epub", "processing"],
    ]);
    await act(async () => { second.resolve("2"); await other; });
    act(() => latest.dismissCompletedImports());
    expect(latest.importActivities.map(({ fileName }) => fileName)).not.toContain("second.epub");
    expect(latest.importActivities[0]?.phase).toBe("downloading");
    await act(async () => first.resolve("1"));
    expect(latest.importActivities.find(({ fileName }) => fileName === "third.epub")?.phase).toBe("processing");
    await act(async () => { third.resolve("3"); await batch; });
    expect(latest.error).toBe("Fourth book is malformed");
    expect(latest.importActivities.map(({ fileName, phase }) => [fileName, phase])).toEqual([
      ["book.epub", "downloading"], ["first.epub", "complete"], ["third.epub", "complete"],
    ]);
    expect(latest.canImport).toBe(true);
    await act(async () => response.resolve(new Response("epub")));
    expect(latest.importActivities.every(({ phase }) => phase === "complete")).toBe(true);
    expect(latest.error).toBe("Fourth book is malformed");
  });

  it("keeps the status visible in the empty library without blocking manual import or moving focus", async () => {
    const response = deferred<Response>();
    db.methods.listBooks.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    setDirectImportUrl();
    await act(async () => root.render(<LibraryApp />));
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((entry) => entry.textContent?.includes("Choose EPUB files..."))!;
    button.focus();
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("Downloading book.epub");
    expect(status.textContent).toContain("Keep your library open");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.hasAttribute("aria-busy")).toBe(false);
    expect(container.textContent).toContain("What will you read first?");
    expect(button.disabled).toBe(false);
    await act(async () => response.resolve(new Response("epub")));
    expect(status.textContent).toContain("Added book.epub to your library");
    expect(status.textContent).not.toContain("Keep your library open");
    expect(document.activeElement).toBe(button);
  });

  it("names the available first-run import action in download errors", async () => {
    db.methods.listBooks.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    setDirectImportUrl();
    await render();
    expect(latest.error).toContain("Choose EPUB files...");
    expect(latest.error).not.toContain("Import EPUB");
    expect(latest.importActivities).toEqual([]);
    expect(latest.canImport).toBe(true);
  });

  it.each(["network", "http", "body", "parse", "quota"])(
    "reports an actionable %s failure without acknowledging success", async (failure) => {
      const fetch = vi.fn().mockResolvedValue(new Response("epub"));
      if (failure === "network") fetch.mockRejectedValue(new TypeError("Failed to fetch"));
      if (failure === "http") fetch.mockResolvedValue(new Response("", { status: 403 }));
      if (failure === "body") {
        const response = new Response(null);
        vi.spyOn(response, "blob").mockRejectedValue(new Error("Disconnected"));
        fetch.mockResolvedValue(response);
      }
      if (failure === "parse") vi.mocked(importBook).mockRejectedValueOnce(new Error("Invalid EPUB: missing OEBPS/chapter.xhtml"));
      if (failure === "quota") vi.mocked(importBook).mockRejectedValueOnce(new DOMException("Full", "QuotaExceededError"));
      vi.stubGlobal("fetch", fetch);
      setDirectImportUrl();
      await render();
      expect(latest.error).toBeTruthy();
      expect(latest.importActivities).toEqual([]);
      expect(latest.error).not.toContain("Failed to fetch");
      if (failure === "quota") expect(latest.error).toContain("storage");
      else expect(latest.error).toContain("Import EPUB");
      if (failure === "http") expect(latest.error).toContain("403");
      if (failure === "parse") expect(latest.error).toContain("Invalid EPUB: missing OEBPS/chapter.xhtml");
      expect(resultMessages()).toEqual([{
        type: EPUB_IMPORT_RESULT, token: "handoff", imported: false,
      }]);
    },
  );

  it.each(["permission", "api-unavailable", "unsupported"])(
    "does not fetch when access is unavailable: %s", async (reason) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      if (reason === "permission") vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
      if (reason === "api-unavailable") vi.mocked(chrome.permissions.contains).mockRejectedValue(new Error("No API"));
      setDirectImportUrl(reason === "unsupported" ? "blob:https://example.com/id" : undefined);
      await render();
      expect(fetch).not.toHaveBeenCalled();
      expect(latest.error).toContain("Import EPUB");
      expect(latest.importActivities).toEqual([]);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ imported: false }));
    },
  );

  it("keeps a successfully imported book if the worker no longer owns its handoff", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(new Error("No receiver"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("epub")));
    setDirectImportUrl();
    await render();
    expect(importBook).toHaveBeenCalledOnce();
    expect(latest.error).toBeUndefined();
    expect(latest.books).toHaveLength(1);
    expect(latest.importActivities[0]?.phase).toBe("complete");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("could not report the EPUB import result"), expect.any(Error));
  });

  it("logs an unacknowledged handoff without presenting a persisted import as failed", async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("epub")));
    setDirectImportUrl();
    await render();
    expect(latest.error).toBeUndefined();
    expect(latest.books).toHaveLength(1);
    expect(latest.importActivities[0]?.phase).toBe("complete");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("did not acknowledge the EPUB import result"));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("handoff");
  });

  it("retains engine file diagnostics when the actionable import error is retranslated", async () => {
    let changeLocale!: ReturnType<typeof useLocale>["setPreference"];
    function LocalizedHarness() {
      changeLocale = useLocale().setPreference;
      return <Harness />;
    }
    vi.mocked(importBook).mockRejectedValueOnce(new Error("Missing OEBPS/chapter.xhtml"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("epub")));
    setDirectImportUrl();
    await act(async () => root.render(<LocaleProvider><LocalizedHarness /></LocaleProvider>));
    expect(latest.error).toContain("Import EPUB");
    expect(latest.error).toContain("Missing OEBPS/chapter.xhtml");
    await act(async () => changeLocale("fr"));
    expect(latest.error).toContain("Importer un EPUB");
    expect(latest.error).toContain("Missing OEBPS/chapter.xhtml");
    expect(importBook).toHaveBeenCalledOnce();
  });

  it("does not acknowledge success when the library closes during persistence", async () => {
    const saving = deferred<string>();
    vi.mocked(importBook).mockReturnValueOnce(saving.promise);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("epub")));
    setDirectImportUrl();
    await render();
    act(() => root.unmount());
    mounted = false;
    await act(async () => saving.resolve("book"));
    expect(resultMessages()).toEqual([{
      type: EPUB_IMPORT_RESULT, token: "handoff", imported: false,
    }]);
  });

  it("renews the paused-download lease only while the importing page is active", async () => {
    vi.useFakeTimers();
    const response = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise));
    setDirectImportUrl();
    await render();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: EPUB_IMPORT_ACTIVE, token: "handoff" });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(resultMessages()).toEqual([]);
    act(() => root.unmount());
    mounted = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    await act(async () => response.resolve(new Response("epub")));
    expect(importBook).not.toHaveBeenCalled();
    expect(resultMessages()).toEqual([{ type: EPUB_IMPORT_RESULT, token: "handoff", imported: false }]);
  });

  it("loads global settings and refreshes them after an atomic patch or external change", async () => {
    await render();
    const blue = { ...DEFAULT_GLOBAL_READING_SETTINGS, chromeTheme: "blue" as const };
    db.methods.getGlobalReadingSettings.mockResolvedValue(blue);
    await act(async () => latest.setSettings({ chromeTheme: "blue" }));
    expect(db.methods.patchGlobalReadingSettings).toHaveBeenCalledExactlyOnceWith({ chromeTheme: "blue" });
    expect(latest.chromeTheme).toBe("blue");
    const external = { ...blue, viewMode: "scroll" as const, brightness: 0.8 };
    db.methods.getGlobalReadingSettings.mockResolvedValue(external);
    await act(async () => db.methods.subscribePreferences.mock.calls[0]![0]());
    expect(latest.settings).toEqual(external);
  });

  it("does not let a stale settings read replace a newer external change", async () => {
    await render();
    const stale = deferred<typeof DEFAULT_GLOBAL_READING_SETTINGS>();
    db.methods.getGlobalReadingSettings.mockReturnValueOnce(stale.promise);
    const notify = db.methods.subscribePreferences.mock.calls[0]![0];
    act(() => notify());
    const latestSettings = { ...DEFAULT_GLOBAL_READING_SETTINGS, chromeTheme: "green" as const };
    db.methods.getGlobalReadingSettings.mockResolvedValueOnce(latestSettings);
    await act(async () => notify());
    await act(async () => stale.resolve(DEFAULT_GLOBAL_READING_SETTINGS));
    expect(latest.settings).toEqual(latestSettings);
  });

  it("retains saved settings on persistence failure and ignores setters after unmount", async () => {
    await render();
    db.methods.patchGlobalReadingSettings.mockRejectedValueOnce(new Error("Settings could not be saved"));
    await act(async () => latest.setSettings({ chromeTheme: "blue" }));
    expect(latest.error).toBe("Settings could not be saved");
    expect(latest.settings).toEqual(DEFAULT_GLOBAL_READING_SETTINGS);
    act(() => root.unmount());
    mounted = false;
    latest.setSettings({ brightness: 0.5 });
    expect(db.methods.patchGlobalReadingSettings).toHaveBeenCalledOnce();
  });

  it("retranslates app-owned errors without reopening the database or restarting an import on language change", async () => {
    let changeLocale!: ReturnType<typeof useLocale>["setPreference"];
    function LocalizedHarness() {
      changeLocale = useLocale().setPreference;
      return <Harness />;
    }
    const downloading = deferred<Response>();
    const fetch = vi.fn().mockReturnValue(downloading.promise);
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState(null, "", "/?importUrl=https%3A%2F%2Fexample.com%2Fbook.epub");
    await act(async () => root.render(<LocaleProvider><LocalizedHarness /></LocaleProvider>));
    const opens = vi.mocked(LibraryDatabase.open).mock.calls.length;
    const importFiles = latest.importFiles;
    const openInspector = latest.openInspectionSession;
    vi.mocked(importBook).mockRejectedValueOnce(new DOMException("Raw quota detail", "QuotaExceededError"));
    await act(async () => latest.importFiles([new File(["book"], "original-name.epub")]));
    expect(latest.error).toContain("your device appears to be out of storage space");
    await act(async () => changeLocale("fr"));
    expect(latest.error).toContain("votre appareil semble manquer d’espace");
    expect(latest.error).toContain("original-name.epub");
    expect(LibraryDatabase.open).toHaveBeenCalledTimes(opens);
    expect(latest.importFiles).toBe(importFiles);
    expect(latest.openInspectionSession).toBe(openInspector);
    expect(fetch).toHaveBeenCalledOnce();
    expect((fetch.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(false);
  });
});
