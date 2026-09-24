import { expect, test as base, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const test = base.extend<{ library: Page }>({
  library: async ({ playwright }, use, testInfo) => {
    const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      headless: process.env.AMBRA_E2E_HEADLESS === "1",
      ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    try {
      let [worker] = context.serviceWorkers();
      worker ??= await context.waitForEvent("serviceworker");
      const page = await context.newPage();
      await page.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html?view=tab`);
      await expect(page.getByText("What will you read first?", { exact: true })).toBeVisible();
      // Exercise the mounted production database without a test-only export.
      await page.evaluate(() => {
        for (const element of document.querySelectorAll("*")) {
          const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
          if (!key) continue;
          for (let fiber = Reflect.get(element, key); fiber; fiber = fiber.return) {
            for (let hook = fiber.memoizedState; hook; hook = hook.next) {
              if (typeof hook.memoizedState?.patchHighlight === "function") {
                Reflect.set(window, "__libraryDatabase", hook.memoizedState);
                return;
              }
            }
          }
        }
        throw new Error("Mounted library database not found");
      });
      await use(page);
    } finally {
      await context.close();
    }
  },
});

test("concurrent highlight patches merge across connections, clear notes, and never resurrect deletes", async ({ library }) => {
  const result = await library.evaluate(async () => {
    const db = Reflect.get(window, "__libraryDatabase");
    const other = await db.constructor.open();
    try {
      const highlight = await db.addHighlight({
        bookId: "book", spineIndex: 0, startCfi: "epubcfi(/6/2!/4/2/1:0)",
        endCfi: "epubcfi(/6/2!/4/2/1:10)", text: "Keep this text", style: "yellow", note: "Before",
      });
      const patches = await Promise.all([
        db.patchHighlight(highlight.id, { note: "After" }),
        other.patchHighlight(highlight.id, { style: "green" }),
      ]);
      const merged = await db.listHighlightsForBook("book");
      const cleared = await other.patchHighlight(highlight.id, { note: undefined });
      const persistedClear = await db.listHighlightsForBook("book");
      const [, afterDelete] = await Promise.all([
        db.removeHighlight(highlight.id), other.patchHighlight(highlight.id, { note: "Too late" }),
      ]);
      const missing = await db.patchHighlight("missing", { style: "blue" });
      return { highlight, patches, merged, cleared, persistedClear, afterDelete, missing,
        remaining: await db.listHighlightsForBook("book") };
    } finally {
      other.close();
    }
  });
  const merged = { ...result.highlight, note: "After", style: "green" };
  expect(result.patches[0]).toEqual({ ...result.highlight, note: "After" });
  expect(result.patches[1]).toEqual(merged);
  expect(result.merged).toEqual([merged]);
  expect(result.cleared).toEqual({ ...merged, note: undefined });
  expect(result.persistedClear).toEqual([result.cleared]);
  expect(result.afterDelete).toBeUndefined();
  expect(result.missing).toBeUndefined();
  expect(result.remaining).toEqual([]);
});

test("book deletion rolls back every related store on abort, then deletes only that book", async ({ library }) => {
  const result = await library.evaluate(async () => {
    const db = Reflect.get(window, "__libraryDatabase");
    const ids: string[] = [];
    for (const title of ["Delete me", "Keep me"]) {
      const id = await db.addBook(new Blob([title]), { title, identifier: title }, new Blob(["cover"]));
      ids.push(id);
      await db.saveProgress(id, "epubcfi(/6/2!/4/2/1:0)", 0.5);
      await db.addBookmark(id, "epubcfi(/6/2!/4/2/1:0)", title);
      await db.addHighlight({
        bookId: id, spineIndex: 0, startCfi: "epubcfi(/6/2!/4/2/1:0)",
        endCfi: "epubcfi(/6/2!/4/2/1:10)", text: title, style: "yellow", note: title,
      });
    }
    await db.setDefaultLibrarySort("titleAsc");
    const snapshot = async () => Promise.all(ids.map(async (id) => ({
      metadata: await db.getBookMetadata(id),
      file: await (await db.getBookFile(id))?.text(),
      cover: await (await db.getCoverBlob(id))?.text(),
      progress: await db.getProgress(id),
      bookmarks: await db.listBookmarksForBook(id),
      highlights: await db.listHighlightsForBook(id),
    })));
    const before = await snapshot();
    const original = IDBCursor.prototype.delete;
    IDBCursor.prototype.delete = function () {
      const request = original.call(this);
      IDBCursor.prototype.delete = original;
      const tx = (this.source as IDBObjectStore).transaction;
      request.addEventListener("success", () => tx.abort(), { once: true });
      return request;
    };
    let rejected = false;
    try { await db.deleteBook(ids[0]); } catch { rejected = true; }
    finally { IDBCursor.prototype.delete = original; }
    const afterAbort = await snapshot();
    const other = await db.constructor.open();
    let latePatch;
    try {
      [, latePatch] = await Promise.all([
        db.deleteBook(ids[0]), other.patchHighlight(before[0].highlights[0].id, { note: "Too late" }),
      ]);
    } finally {
      other.close();
    }
    return { rejected, before, afterAbort, after: await snapshot(), latePatch,
      sort: await db.getDefaultLibrarySort() };
  });
  expect(result.rejected).toBe(true);
  expect(result.afterAbort).toEqual(result.before);
  expect(result.after[0]).toEqual({
    metadata: undefined, file: undefined, cover: undefined, progress: undefined,
    bookmarks: [], highlights: [],
  });
  expect(result.after[1]).toEqual(result.before[1]);
  expect(result.latePatch).toBeUndefined();
  expect(result.sort).toBe("titleAsc");
});

test("bookmark batch removal is atomic on abort and synchronous request failure", async ({ library }) => {
  const result = await library.evaluate(async () => {
    const db = Reflect.get(window, "__libraryDatabase");
    const bookmarks = await Promise.all(["one", "two", "keep"].map(
      (label) => db.addBookmark("book", "epubcfi(/6/2!/4/2/1:0)", label),
    ));
    const before = await db.listBookmarksForBook("book");
    const original = IDBObjectStore.prototype.delete;
    let calls = 0;
    IDBObjectStore.prototype.delete = function (key) {
      const request = original.call(this, key);
      if (this.name === "bookmarks" && ++calls === 2) {
        request.addEventListener("success", () => this.transaction.abort(), { once: true });
      }
      return request;
    };
    let rejected = false;
    try { await db.removeBookmarks(bookmarks.slice(0, 2).map((bookmark) => bookmark.id)); }
    catch { rejected = true; }
    finally { IDBObjectStore.prototype.delete = original; }
    const afterAbort = await db.listBookmarksForBook("book");
    let invalidRejected = false;
    try { await db.removeBookmarks([bookmarks[0].id, null]); }
    catch { invalidRejected = true; }
    const afterInvalid = await db.listBookmarksForBook("book");
    await db.removeBookmarks([bookmarks[0].id, bookmarks[1].id, bookmarks[1].id, "missing"]);
    await db.removeBookmarks([]);
    return { rejected, invalidRejected, bookmarks, before, afterAbort, afterInvalid,
      remaining: await db.listBookmarksForBook("book") };
  });
  expect(result.rejected).toBe(true);
  expect(result.invalidRejected).toBe(true);
  expect(result.afterAbort).toEqual(result.before);
  expect(result.afterInvalid).toEqual(result.before);
  expect(result.remaining).toEqual([result.bookmarks[2]]);
});

test("a real duplicate-key request preserves ConstraintError and rejects only after transaction abort", async ({ library }) => {
  const result = await library.evaluate(async () => {
    const db = Reflect.get(window, "__libraryDatabase");
    const original = IDBObjectStore.prototype.put;
    let transaction: IDBTransaction | undefined;
    let requestError: DOMException | null = null;
    let errorDuringRequest: string | null = "not observed";
    IDBObjectStore.prototype.put = function (value) {
      IDBObjectStore.prototype.put = original;
      transaction = this.transaction;
      const request = original.call(this, value);
      // A genuine IndexedDB request error, not a thrown JavaScript error.
      const duplicate = this.add(value);
      duplicate.addEventListener("error", () => {
        requestError = duplicate.error;
        errorDuringRequest = transaction?.error?.name ?? null;
      });
      return request;
    };
    let rejection: { name: string; isDomException: boolean; sameError: boolean; transactionError: string | null } | undefined;
    try { await db.saveProgress("book", "epubcfi(/6/2!/4/2/1:0)", 0.5); }
    catch (error) {
      rejection = {
        name: error instanceof DOMException ? error.name : String(error),
        isDomException: error instanceof DOMException,
        sameError: error === requestError,
        transactionError: transaction?.error?.name ?? null,
      };
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    return { rejection, errorDuringRequest, progress: await db.getProgress("book") };
  });
  expect(result.errorDuringRequest).toBeNull();
  expect(result.rejection).toEqual({
    name: "ConstraintError", isDomException: true, sameError: true, transactionError: "ConstraintError",
  });
  expect(result.progress).toBeUndefined();
});

test("quota failure starting an import keeps the storage-specific message and writes no book", async ({ library }) => {
  await library.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const names = typeof args[0] === "string" ? [args[0]] : Array.from(args[0]);
      if (args[1] === "readwrite" && names.includes("bookFiles")) {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException("Injected full-disk failure", "QuotaExceededError");
      }
      return Reflect.apply(original, this, args);
    };
  });
  await library.locator('input[type="file"]').setInputFiles(
    fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url)),
  );
  await expect(library.getByRole("alert")).toContainText("your device appears to be out of storage space");
  expect(await library.evaluate(() => Reflect.get(window, "__libraryDatabase").listBooks())).toEqual([]);
});

for (const operation of ["put", "delete", "patch", "get", "getAll"] as const) {
  test(`${operation} rejects an abort after request success instead of hanging or publishing success`, async ({ library }) => {
    const result = await library.evaluate(async (operation) => {
      const db = Reflect.get(window, "__libraryDatabase");
      const highlight = await db.addHighlight({
        bookId: "book", spineIndex: 0, startCfi: "epubcfi(/6/2!/4/2/1:0)",
        endCfi: "epubcfi(/6/2!/4/2/1:10)", text: "Text", style: "yellow", note: "Keep",
      });
      const method = operation === "patch" ? "put" : operation;
      const original = IDBObjectStore.prototype[method];
      Reflect.set(IDBObjectStore.prototype, method, function (this: IDBObjectStore, ...args: unknown[]) {
        const request: IDBRequest = Reflect.apply(original, this, args);
        Reflect.set(IDBObjectStore.prototype, method, original);
        request.addEventListener("success", () => this.transaction.abort(), { once: true });
        return request;
      });
      try {
        const actions = {
          put: () => db.saveProgress("book", "epubcfi(/6/2!/4/2/1:0)", 0.5),
          delete: () => db.removeHighlight(highlight.id),
          patch: () => db.patchHighlight(highlight.id, { note: "Lose" }),
          get: () => db.getProgress("book"),
          getAll: () => db.listBooks(),
        };
        const outcome = await Promise.race([
          actions[operation]().then(() => "resolved", () => "rejected"),
          new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 2000)),
        ]);
        return { outcome, highlights: await db.listHighlightsForBook("book"),
          highlight, progress: await db.getProgress("book") };
      } finally {
        Reflect.set(IDBObjectStore.prototype, method, original);
      }
    }, operation);
    expect(result.outcome).toBe("rejected");
    expect(result.highlights).toEqual([result.highlight]);
    expect(result.progress).toBeUndefined();
  });
}
