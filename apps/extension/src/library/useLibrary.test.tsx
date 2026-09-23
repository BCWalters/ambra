import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryDatabase, type BookMetadata } from "./LibraryDatabase.js";
import { importBook } from "./BookImporter.js";
import { useLibrary, type UseLibraryResult } from "./useLibrary.js";
import { LibraryApp } from "./LibraryApp.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";

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
    getGlobalReadingSettings: vi.fn().mockResolvedValue(DEFAULT_GLOBAL_READING_SETTINGS),
    patchGlobalReadingSettings: vi.fn().mockResolvedValue(undefined),
    subscribePreferences: vi.fn<LibraryDatabase["subscribePreferences"]>().mockReturnValue(vi.fn()),
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
    vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "test" }) } });
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
    expect(importBook).toHaveBeenCalledExactlyOnceWith(db.value, file);
    expect(latest.error).toBeUndefined();
  });

  it("disables the toolbar import and file input until initialization finishes", async () => {
    const opening = deferred<LibraryDatabase>();
    const preference = deferred<undefined>();
    vi.mocked(LibraryDatabase.open).mockReturnValue(opening.promise);
    db.methods.getDefaultLibrarySort.mockReturnValue(preference.promise);
    await act(async () => root.render(<LibraryApp />));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Import EPUB")!;
    expect(input.disabled).toBe(true);
    expect(button.disabled).toBe(true);
    await act(async () => { opening.resolve(db.value); });
    expect(input.disabled).toBe(true);
    expect(button.disabled).toBe(true);
    await act(async () => { preference.resolve(undefined); });
    expect(input.disabled).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("preserves initialization failure details and keeps every import entry disabled until remount recovery", async () => {
    vi.mocked(LibraryDatabase.open).mockRejectedValueOnce(new Error("Close other Ambra tabs, then reload."));
    await act(async () => root.render(<LibraryApp />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Close other Ambra tabs");
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent?.startsWith("Import"));
    expect(buttons).toHaveLength(2);
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
    expect((fetch.mock.calls[0]?.[1].signal as AbortSignal).aborted).toBe(false);
    expect(discarded.methods.close).toHaveBeenCalledOnce();
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
});
