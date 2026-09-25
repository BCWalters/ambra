import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookMetadata } from "./LibraryDatabase.js";
import { saveLibraryBookAs } from "./LibrarySaveAs.js";
import type { Translate } from "../i18n/translate.js";

describe("saving an original library EPUB", () => {
  const metadata = { id: "book", fileName: "Original édition.epub" } as BookMetadata;
  const blob = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0])], { type: "application/epub+zip" });
  const db = { getBookMetadata: vi.fn(), getBookFile: vi.fn() };
  const t = ((key: string) => key) as Translate;
  let listeners: Set<(delta: chrome.downloads.DownloadDelta) => void>;
  let download: ReturnType<typeof vi.fn>;
  let callback: (id?: number) => void;
  let runtime: { lastError?: { message: string } };
  const emit = (state: string, error?: string, id = 42) => {
    for (const listener of listeners) listener({
      id, state: { current: state }, ...(error ? { error: { current: error } } : {}),
    });
  };
  const start = async () => {
    const result = saveLibraryBookAs(db, "book", t);
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    return { result };
  };

  beforeEach(() => {
    db.getBookMetadata.mockResolvedValue(metadata);
    db.getBookFile.mockResolvedValue(blob);
    listeners = new Set();
    runtime = {};
    download = vi.fn((_options, done) => { callback = done; });
    vi.stubGlobal("chrome", {
      runtime,
      downloads: { download, onChanged: {
        addListener: (listener: (delta: chrome.downloads.DownloadDelta) => void) => listeners.add(listener),
        removeListener: (listener: (delta: chrome.downloads.DownloadDelta) => void) => listeners.delete(listener),
      } },
    });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Saving must not fetch"); }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:original");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("saves original bytes and filename with a destination picker and no mutations or network", async () => {
    const { result } = await start();
    expect(db.getBookMetadata).toHaveBeenCalledExactlyOnceWith("book");
    expect(db.getBookFile).toHaveBeenCalledExactlyOnceWith("book");
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
    expect(download).toHaveBeenCalledWith({
      url: "blob:original", filename: "Original édition.epub", saveAs: true,
    }, expect.any(Function));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    callback(42);
    emit("complete", undefined, 99);
    await Promise.resolve();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    emit("complete");
    await result;
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:original");
    expect(listeners.size).toBe(0);
    expect(metadata.fileName).toBe("Original édition.epub");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x50, 0x4b, 0x03, 0x04, 0xff, 0]);
  });

  it("handles completion racing the download callback", async () => {
    const { result } = await start();
    emit("complete");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    callback(42);
    await result;
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it.each(["User canceled", "User cancelled", "Download canceled.", "USER_CANCELED"])(
    "silently handles destination-picker cancellation: %s", async (message) => {
      const { result } = await start();
      runtime.lastError = { message };
      callback();
      await expect(result).resolves.toBeUndefined();
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
      expect(listeners.size).toBe(0);
    },
  );

  it("silently handles cancellation after the download started", async () => {
    const { result } = await start();
    callback(42);
    emit("interrupted", "USER_CANCELED");
    await expect(result).resolves.toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("propagates real download failures and releases resources", async () => {
    const { result } = await start();
    const failure = expect(result).rejects.toThrow("FILE_ACCESS_DENIED");
    callback(42);
    emit("interrupted", "FILE_ACCESS_DENIED");
    await failure;
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("propagates picker/start failures", async () => {
    const { result } = await start();
    const failure = expect(result).rejects.toThrow("Invalid filename");
    runtime.lastError = { message: "Invalid filename" };
    callback();
    await failure;
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("cleans up synchronous API failures", async () => {
    download.mockImplementation(() => { throw new Error("Unavailable"); });
    await expect(saveLibraryBookAs(db, "book", t)).rejects.toThrow("Unavailable");
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it("never downloads or refetches a missing file", async () => {
    db.getBookFile.mockResolvedValue(undefined);
    await expect(saveLibraryBookAs(db, "book", t)).rejects.toThrow("library.fileMissing");
    expect(download).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("propagates database failures without starting a download", async () => {
    db.getBookFile.mockRejectedValue(new Error("Storage unavailable"));
    await expect(saveLibraryBookAs(db, "book", t)).rejects.toThrow("Storage unavailable");
    expect(download).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("normalizes unsafe path characters without changing stored metadata", async () => {
    const unsafe = { ...metadata, fileName: "../folder:book.epub" };
    db.getBookMetadata.mockResolvedValue(unsafe);
    const { result } = await start();
    expect(download.mock.calls[0]![0].filename).toBe("__folder_book.epub");
    callback(42);
    emit("complete");
    await result;
    expect(unsafe.fileName).toBe("../folder:book.epub");
  });
});
