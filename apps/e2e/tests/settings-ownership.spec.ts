import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH, launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const otherBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));

async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "Text and page options", exact: true })).toBeVisible();
  await exposeReaderController(page);
}

async function settings(page: Page) {
  return page.evaluate(async () => {
    const controller = Reflect.get(window, "__readerController");
    return controller.library.getBookReadingSettings(controller.bookId) as Promise<{
      fontScale: number; fontFamily: string; lineSpacing: number; letterSpacing: number;
      contentWidthEm: number; pageTheme: string;
    }>;
  });
}

test("books keep independent Text options on reopen; newly imported books use built-in defaults", async () => {
  const { context, libraryPage, readerPage: first } = await launchReader(book);
  try {
    await ready(first);
    const defaults = await settings(first);
    await first.getByRole("button", { name: "Text and page options", exact: true }).click();
    await first.getByRole("menuitem", { name: "Text", exact: true }).press("ArrowRight");
    await first.getByRole("menuitemradio", { name: "Georgia", exact: true }).click();
    await first.keyboard.press("Escape");
    await first.getByRole("menuitem", { name: "Page", exact: true }).press("ArrowRight");
    await first.getByRole("menuitemradio", { name: "Sepia", exact: true }).click();
    await first.keyboard.press("Escape");
    await first.keyboard.press("Escape");
    await first.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await Promise.all([
        controller.setFontScale(1.25), controller.setLineSpacing(1.15),
        controller.setLetterSpacing(0.02), controller.setContentWidth(30),
      ]);
    });
    const firstSettings = {
      fontScale: 1.25, fontFamily: "georgia", lineSpacing: 1.15,
      letterSpacing: 0.02, contentWidthEm: 30, pageTheme: "sepia",
    };
    expect(await settings(first)).toEqual(firstSettings);

    await libraryPage.locator('input[type="file"]').setInputFiles(otherBook);
    const open = libraryPage.getByRole("button", { name: /^Open Ambra Long Content/ });
    await expect(open).toBeVisible();
    const opened = context.waitForEvent("page");
    await open.click();
    const second = await opened;
    await ready(second);
    expect(await settings(second)).toEqual(defaults);
    expect(await second.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      return {
        fontScale: c.fontScale, fontFamily: c.fontFamily, lineSpacing: c.lineSpacing,
        letterSpacing: c.letterSpacing, contentWidthEm: c.contentWidthEm, pageTheme: c.pageTheme,
      };
    })).toEqual(defaults);
    await second.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.setFontScale(1.5);
      await controller.setPageTheme("dark");
    });
    expect(await settings(first)).toEqual(firstSettings);
    await first.reload();
    await ready(first);
    expect(await settings(first)).toEqual(firstSettings);
    expect(await first.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      return { fontScale: c.snapshot().fontScale, pageTheme: c.snapshot().pageTheme };
    })).toEqual({ fontScale: 1.25, pageTheme: "sepia" });
    await second.reload();
    await ready(second);
    expect(await settings(second)).toEqual({ ...defaults, fontScale: 1.5, pageTheme: "dark" });
  } finally {
    await context.close();
  }
});

test("Library settings fit at 360px and propagate live both ways, including language and reading mode", async () => {
  const { context, libraryPage: library, readerPage: reader } = await launchReader(book);
  try {
    await ready(reader);
    await library.setViewportSize({ width: 360, height: 800 });
    const settingsButton = library.getByRole("button", { name: "Settings", exact: true });
    await expect(settingsButton).toBeVisible();
    const fits = await library.evaluate(() => {
      const title = [...document.querySelectorAll("span, h2")].find(el => el.textContent === "Ambra" && el.querySelector("svg"));
      const header = title?.parentElement;
      if (!header) throw new Error("Library header missing");
      const boxes = [...header.querySelectorAll("button")].map(el => el.getBoundingClientRect());
      return boxes.every(box => box.x >= 0 && box.right <= 360) &&
        document.documentElement.scrollWidth <= 360 &&
        boxes.every((box, index) => index === 0 || box.left >= boxes[index - 1]!.right);
    });
    expect(fits).toBe(true);
    await settingsButton.click();
    await library.getByRole("menuitemradio", { name: "Blue", exact: true }).click();
    await library.getByRole("menuitemradio", { name: "Film strip", exact: true }).click();
    const brightness = library.getByRole("slider", { name: "Brightness", exact: true });
    await brightness.focus();
    await brightness.press("ArrowLeft");
    await library.getByRole("menuitemradio", { name: "Scroll", exact: true }).click();
    await expect(library.getByRole("menuitemradio", { name: "Slide", exact: true })).toBeDisabled();
    await expect.poll(() => reader.evaluate(() => {
      const s = Reflect.get(window, "__readerController").snapshot();
      return { chromeTheme: s.chromeTheme, viewMode: s.viewMode, brightness: s.brightness, animation: s.pageTurnAnimationStyle };
    })).toEqual({ chromeTheme: "blue", viewMode: "scroll", brightness: 0.95, animation: "scroll" });
    await library.getByRole("menuitem", { name: /Language/ }).press("ArrowRight");
    await library.getByRole("menuitemradio", { name: "Français", exact: true }).click();
    await expect(reader.locator("html")).toHaveAttribute("lang", "fr");
    await expect(library.locator("html")).toHaveAttribute("lang", "fr");
    await library.keyboard.press("Escape");
    await library.keyboard.press("Escape");
    await reader.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      await c.setChromeTheme("green");
      await c.setViewMode("paginated");
    });
    await library.getByRole("button", { name: "Paramètres", exact: true }).click();
    await expect(library.getByRole("menuitemradio", { name: "Vert", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(library.getByRole("menuitemradio", { name: "Paginé", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(library.getByRole("alert")).toHaveCount(0);
    await expect(reader.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("atomic per-book patches merge across connections, roll back on abort, and cannot recreate deleted settings", async () => {
  const { context, readerPage: page } = await launchReader(book);
  try {
    await ready(page);
    const result = await page.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      const db = c.library;
      const other = await db.constructor.open();
      try {
        await Promise.all([
          db.patchBookReadingSettings(c.bookId, { fontScale: 1.5 }),
          other.patchBookReadingSettings(c.bookId, { pageTheme: "sepia" }),
          db.patchBookReadingSettings(c.bookId, { lineSpacing: 1.2 }),
        ]);
        const merged = await db.getBookReadingSettings(c.bookId);
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          const result = put.apply(this, args);
          if (this.name === "bookReadingSettings") this.transaction.abort();
          return result;
        };
        let rejected = false;
        try {
          await db.patchBookReadingSettings(c.bookId, { fontScale: 2, pageTheme: "dark" });
        } catch {
          rejected = true;
        } finally {
          IDBObjectStore.prototype.put = put;
        }
        const afterAbort = await db.getBookReadingSettings(c.bookId);
        const originalTheme = c.snapshot().chromeTheme;
        IDBObjectStore.prototype.put = function (...args) {
          const result = put.apply(this, args);
          if (this.name === "preferences") this.transaction.abort();
          return result;
        };
        let globalRejected = false;
        try {
          await c.setChromeTheme("blue");
        } catch {
          globalRejected = true;
        } finally {
          IDBObjectStore.prototype.put = put;
        }
        const globalUnchanged = c.snapshot().chromeTheme === originalTheme &&
          (await db.getGlobalReadingSettings()).chromeTheme === originalTheme;
        await db.deleteBook(c.bookId);
        await other.patchBookReadingSettings(c.bookId, { fontScale: 2 });
        const raw = await new Promise<unknown>((resolve, reject) => {
          const request = db.db.transaction("bookReadingSettings").objectStore("bookReadingSettings").get(c.bookId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return { merged, afterAbort, rejected, globalRejected, globalUnchanged, deleted: raw === undefined };
      } finally {
        other.close();
      }
    });
    expect(result.merged).toMatchObject({ fontScale: 1.5, pageTheme: "sepia", lineSpacing: 1.2 });
    expect(result.afterAbort).toEqual(result.merged);
    expect(result.rejected).toBe(true);
    expect(result.globalRejected).toBe(true);
    expect(result.globalUnchanged).toBe(true);
    expect(result.deleted).toBe(true);
  } finally {
    await context.close();
  }
});

test("v6 migration preserves existing books and reading data while later imports start with built-in defaults", async ({ playwright }, testInfo) => {
  const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath("profile"), {
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const origin = `chrome-extension://${worker.url().split("/")[2]}`;
    const page = await context.newPage();
    await page.goto(`${origin}/manifest.json`);
    const bytes = Array.from(await readFile(book));
    await page.evaluate(async (bytes) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ambra-library", 6);
        request.onupgradeneeded = () => {
          for (const [name, keyPath] of [
            ["books", "id"], ["bookFiles", "id"], ["bookCovers", "id"], ["readingProgress", "bookId"],
            ["preferences", "key"], ["bookmarks", "id"], ["highlights", "id"],
          ]) request.result.createObjectStore(name!, { keyPath: keyPath! });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([...db.objectStoreNames], "readwrite");
        for (const id of ["legacy-a", "legacy-b"]) {
          tx.objectStore("books").put({ id, title: id, identifier: id, addedAt: 123 });
          tx.objectStore("bookFiles").put({ id, blob: new Blob([new Uint8Array(bytes)]) });
          tx.objectStore("readingProgress").put({ bookId: id, cfi: "epubcfi(/6/2!/4/2/1:0)", updatedAt: 321, fractionComplete: 0.25 });
          tx.objectStore("bookmarks").put({ id, bookId: id, cfi: "saved", label: "Keep bookmark", createdAt: 456 });
          tx.objectStore("highlights").put({ id, bookId: id, text: "Keep highlight", note: "Keep note" });
        }
        for (const [key, value] of Object.entries({
          defaultFontScale: 1.25, defaultFontFamily: "georgia", defaultLineSpacing: 1.15,
          defaultLetterSpacing: 0.02, defaultContentWidth: 30, defaultPageTheme: "sepia",
          defaultViewMode: "scroll", defaultBrightness: 0.8, defaultChromeTheme: "blue",
          defaultPageTurnAnimationStyle: "none", localePreference: "en", defaultLibrarySort: "titleAsc",
        })) tx.objectStore("preferences").put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, bytes);
    // Abort the real upgrade after its first per-book write. Neither the
    // copied records nor legacy-preference removals may escape the rollback.
    await page.evaluate(() => sessionStorage.setItem("abort-settings-upgrade", "yes"));
    await page.addInitScript(() => {
      if (sessionStorage.getItem("abort-settings-upgrade") !== "yes") return;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.name === "bookReadingSettings") this.transaction.abort();
        return request;
      };
    });
    await page.goto(`${origin}/src/library/index.html?view=tab`);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto(`${origin}/manifest.json`);
    const rolledBack = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("ambra-library");
        request.onsuccess = () => resolve(request.result);
      });
      try {
        const value = await new Promise<unknown>((resolve) => {
          const request = db.transaction("preferences").objectStore("preferences").get("defaultFontScale");
          request.onsuccess = () => resolve(request.result.value);
        });
        return { version: db.version, settingsStore: db.objectStoreNames.contains("bookReadingSettings"), fontScale: value };
      } finally {
        db.close();
        sessionStorage.removeItem("abort-settings-upgrade");
      }
    });
    expect(rolledBack).toEqual({ version: 6, settingsStore: false, fontScale: 1.25 });
    await page.goto(`${origin}/src/library/index.html?view=tab`);
    await expect(page.getByRole("button", { name: /^Open legacy-a/ })).toBeVisible();
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("ambra-library");
        request.onsuccess = () => resolve(request.result);
      });
      try {
        return await Promise.all(["bookReadingSettings", "readingProgress", "bookmarks", "highlights", "preferences"].map(name =>
          new Promise<Array<Record<string, unknown>>>((resolve) => {
            const request = db.transaction(name).objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
          })));
      } finally {
        db.close();
      }
    });
    expect(stored[0]).toEqual(["legacy-a", "legacy-b"].map(bookId => ({
      bookId, settings: { fontScale: 1.25, fontFamily: "georgia", lineSpacing: 1.15, letterSpacing: 0.02, contentWidthEm: 30, pageTheme: "sepia" },
    })));
    expect(stored[1]).toEqual(["legacy-a", "legacy-b"].map(bookId => ({
      bookId, cfi: "epubcfi(/6/2!/4/2/1:0)", updatedAt: 321, fractionComplete: 0.25,
    })));
    expect(stored[2]).toEqual(["legacy-a", "legacy-b"].map(id => ({
      id, bookId: id, cfi: "saved", label: "Keep bookmark", createdAt: 456,
    })));
    expect(stored[3]).toEqual(["legacy-a", "legacy-b"].map(id => ({
      id, bookId: id, text: "Keep highlight", note: "Keep note",
    })));
    expect(Object.fromEntries(stored[4]!.map(row => [row.key, row.value]))).toEqual({
      defaultViewMode: "scroll", defaultBrightness: 0.8, defaultChromeTheme: "blue",
      defaultPageTurnAnimationStyle: "none", localePreference: "en", defaultLibrarySort: "titleAsc",
    });
    await page.locator('input[type="file"]').setInputFiles(otherBook);
    const opened = context.waitForEvent("page");
    await page.getByRole("button", { name: /^Open Ambra Long Content/ }).click();
    const reader = await opened;
    await ready(reader);
    expect(await settings(reader)).toMatchObject({
      fontScale: 1, lineSpacing: 1, letterSpacing: 0, contentWidthEm: 34, pageTheme: "white",
    });
    expect(await reader.evaluate(() => {
      const s = Reflect.get(window, "__readerController").snapshot();
      return { viewMode: s.viewMode, chromeTheme: s.chromeTheme, brightness: s.brightness };
    })).toEqual({ viewMode: "scroll", chromeTheme: "blue", brightness: 0.8 });
  } finally {
    await context.close();
  }
});
