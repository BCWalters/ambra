import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryDatabase, type BookMetadata } from "./LibraryDatabase.js";
import { importBook } from "./BookImporter.js";
import { useLibrary, type UseLibraryResult } from "./useLibrary.js";

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
    getCoverBlob: vi.fn().mockResolvedValue(new Blob(["cover"])),
    getDefaultChromeTheme: vi.fn().mockResolvedValue(undefined),
    getDefaultLibrarySort: vi.fn().mockResolvedValue(undefined),
    deleteBook: vi.fn().mockResolvedValue(undefined),
    setDefaultLibrarySort: vi.fn().mockResolvedValue(undefined),
  };
  return { methods, value: methods as unknown as LibraryDatabase };
}

describe("useLibrary ownership and failures", () => {
  let root: Root;
  let container: HTMLDivElement;
  let mounted: boolean;
  let latest: UseLibraryResult;
  let db: ReturnType<typeof makeDatabase>;

  function Harness() {
    latest = useLibrary();
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState(null, "", "/?view=tab");
    db = makeDatabase();
    vi.spyOn(LibraryDatabase, "open").mockResolvedValue(db.value);
    vi.spyOn(LibraryDatabase, "estimateStorageUsage").mockResolvedValue(undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cover");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(importBook).mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });
  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(strict = false) {
    await act(async () => root.render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />));
  }

  it("closes the live database and revokes displayed covers on unmount", async () => {
    await render();
    expect(latest.books).toHaveLength(1);
    act(() => root.unmount());
    mounted = false;
    expect(db.methods.close).toHaveBeenCalledOnce();
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
});
