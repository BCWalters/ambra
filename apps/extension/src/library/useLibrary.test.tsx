import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryDatabase, type BookMetadata } from "./LibraryDatabase.js";
import { importBook } from "./BookImporter.js";
import { useLibrary, type UseLibraryResult } from "./useLibrary.js";
import { LibraryApp } from "./LibraryApp.js";
import { DEFAULT_GLOBAL_READING_SETTINGS } from "./ReadingSettings.js";
import { LocaleProvider, useLocale } from "../i18n/LocaleContext.js";
import { EPUB_IMPORT_RESULT } from "../epubImportHandoff.js";

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
    expect(latest.importActivities).toEqual([{ id: 1, fileName: "book.epub", phase: "complete" }]);
    expect((fetch.mock.calls[0]?.[1].signal as AbortSignal).aborted).toBe(false);
    expect(discarded.methods.close).toHaveBeenCalledOnce();
  });

  function setDirectImportUrl(url = "https://example.com/book.epub") {
    window.history.replaceState(null, "", `/?view=tab&importUrl=${encodeURIComponent(url)}&importToken=handoff`);
  }

  it("acknowledges only after the book is persisted and strips handoff parameters", async () => {
    const saving = deferred<string>();
    vi.mocked(importBook).mockReturnValueOnce(saving.promise);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("epub")));
    setDirectImportUrl();
    await render();
    expect(importBook).toHaveBeenCalledOnce();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?view=tab");
    expect(latest.importActivities).toEqual([{ id: 1, fileName: "book.epub", phase: "processing" }]);
    await act(async () => saving.resolve("book"));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: EPUB_IMPORT_RESULT, token: "handoff", imported: true,
    });
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
    await act(async () => response.resolve({ ok: true, blob: () => body.promise } as Response));
    expect(latest.importActivities[0]?.phase).toBe("downloading");
    expect(importBook).not.toHaveBeenCalled();
    await act(async () => body.resolve(new Blob(["epub"])));
    expect(latest.importActivities[0]?.phase).toBe("processing");
    act(() => vi.mocked(importBook).mock.calls[0]?.[2]?.("saving"));
    expect(latest.importActivities[0]?.phase).toBe("saving");
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    db.methods.listBooks.mockReturnValueOnce(refreshing.promise);
    await act(async () => saving.resolve("book"));
    expect(latest.importActivities[0]?.phase).toBe("saving");
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    await act(async () => refreshing.resolve([{ id: "book", title: "Saved" } as BookMetadata]));
    expect(latest.importActivities[0]?.phase).toBe("complete");
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
      .find((entry) => entry.textContent === "Import EPUB")!;
    button.focus();
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("Downloading book.epub");
    expect(status.textContent).toContain("Keep this library open");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.hasAttribute("aria-busy")).toBe(false);
    expect(container.textContent).not.toContain("Your library is empty");
    expect(button.disabled).toBe(false);
    await act(async () => response.resolve(new Response("epub")));
    expect(status.textContent).toContain("Added book.epub to your library");
    expect(status.textContent).not.toContain("Keep this library open");
    expect(document.activeElement).toBe(button);
  });

  it.each(["network", "http", "body", "parse", "quota"])(
    "reports an actionable %s failure without acknowledging success", async (failure) => {
      const fetch = vi.fn().mockResolvedValue(new Response("epub"));
      if (failure === "network") fetch.mockRejectedValue(new TypeError("Failed to fetch"));
      if (failure === "http") fetch.mockResolvedValue(new Response("", { status: 403 }));
      if (failure === "body") fetch.mockResolvedValue({ ok: true, blob: () => Promise.reject(new Error("Disconnected")) });
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
      expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
        type: EPUB_IMPORT_RESULT, token: "handoff", imported: false,
      });
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
    expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: EPUB_IMPORT_RESULT, token: "handoff", imported: false,
    });
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
