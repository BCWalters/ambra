import { expect, test as base } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import fs from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const fixture = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const title = "Ambra Long Content Test Fixture";
const stores = [
  "books",
  "bookFiles",
  "bookCovers",
  "readingProgress",
  "preferences",
  "bookmarks",
  "highlights",
];

const test = base.extend<{ library: { context: BrowserContext; page: Page; url: string } }>({
  library: async ({ playwright }, use, testInfo) => {
    const context = await playwright.chromium.launchPersistentContext(
      testInfo.outputPath("profile"),
      {
        headless: false,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
        ],
      },
    );
    try {
      let [worker] = context.serviceWorkers();
      worker ??= await context.waitForEvent("serviceworker");
      const origin = `chrome-extension://${worker.url().split("/")[2]}`;
      const page = await context.newPage();
      // Stay on an inert extension resource so migration tests can seed v5
      // before the library opens its first database connection.
      await page.goto(`${origin}/manifest.json`);
      await use({ context, page, url: `${origin}/src/library/index.html?view=tab` });
    } finally {
      await context.close();
    }
  },
});

async function snapshot(page: Page) {
  return page.evaluate(async (names) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ambra-library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await Promise.all(
        names.map(async (name) => {
          const rows = await new Promise<Array<Record<string, unknown> & { blob?: Blob }>>(
            (resolve, reject) => {
              const request = db.transaction(name).objectStore(name).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            },
          );
          return {
            name,
            rows: await Promise.all(
              rows.map(async (row): Promise<Record<string, unknown>> =>
                row.blob
                  ? { ...row, blob: Array.from(new Uint8Array(await row.blob.arrayBuffer())) }
                  : row,
              ),
            ),
          };
        }),
      );
    } finally {
      db.close();
    }
  }, stores);
}

async function addUserData(page: Page, bookId: string) {
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("ambra-library");
      request.onsuccess = () => resolve(request.result);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(
          ["readingProgress", "bookmarks", "highlights", "books"],
          "readwrite",
        );
        tx.objectStore("readingProgress").put({
          bookId: id,
          cfi: "epubcfi(/6/2!/4/2/1:20)",
          fractionComplete: 0.42,
          updatedAt: 123,
        });
        tx.objectStore("bookmarks").put({
          id: `bookmark-${id}`,
          bookId: id,
          cfi: "epubcfi(/6/2!/4/2/1:10)",
          label: "Keep this",
          createdAt: 124,
        });
        tx.objectStore("highlights").put({
          id: `highlight-${id}`,
          bookId: id,
          spineIndex: 0,
          startCfi: "epubcfi(/6/2!/4/2/1:10)",
          endCfi: "epubcfi(/6/2!/4/2/1:20)",
          style: "yellow",
          text: "Saved text",
          note: "Keep my note",
          createdAt: 125,
        });
        const books = tx.objectStore("books");
        const request = books.get(id);
        request.onsuccess = () =>
          books.put({
            ...request.result,
            fetchedDescription: "Keep enriched metadata",
            fetchedDescriptionSourceName: "Wikipedia",
            descriptionFetchAttempts: 2,
          });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, bookId);
}

// Observe the real import transaction finishing, not just the unchanged
// card count (which could pass before an asynchronous re-import even starts).
async function watchImports(page: Page) {
  await page.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      if (args[1] === "readwrite" && tx.objectStoreNames.contains("bookFiles")) {
        tx.addEventListener("complete", () => {
          document.documentElement.dataset.completedImports = String(
            Number(document.documentElement.dataset.completedImports ?? 0) + 1,
          );
        });
      }
      return tx;
    };
  });
}

async function imported(page: Page, count: number) {
  await expect(page.locator("html")).toHaveAttribute("data-completed-imports", String(count));
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("renamed manual re-import preserves all stored data; changed archive bytes stay separate", async ({
  library,
}) => {
  const { page, url } = library;
  await watchImports(page);
  await page.goto(url);
  const buffer = await fs.readFile(fixture);
  const input = page.locator('input[type="file"]:enabled');
  await input.setInputFiles({ name: "original.epub", mimeType: "application/epub+zip", buffer });
  await imported(page, 1);
  const original = (await snapshot(page))[0]!.rows[0]!;
  await addUserData(page, original.id as string);
  const before = await snapshot(page);
  await input.setInputFiles({
    name: "a-different-name.epub",
    mimeType: "application/epub+zip",
    buffer,
  });
  await imported(page, 2);
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByText(title, { exact: true })).toHaveCount(1);

  // Change only the ZIP comment: identical OPF identifier/title and chapter
  // content still do not authorize sharing identity when archive bytes differ.
  const revised = Buffer.from(buffer);
  revised.writeUInt16LE(7, revised.length - 2);
  await input.setInputFiles({
    name: "original.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.concat([revised, Buffer.from("revised")]),
  });
  await imported(page, 3);
  const after = await snapshot(page);
  expect(after[0]!.rows).toHaveLength(2);
  const other = after[0]!.rows.find((book) => book.id !== original.id)!;
  expect(other.identifier).toBe(original.identifier);
  expect(other.contentHash).not.toBe(original.contentHash);
  expect(after.slice(3)).toEqual(before.slice(3));
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toHaveCount(2);
  expect(await snapshot(page)).toEqual(after);
});

test("direct web imports from changed URLs and names reuse the manual import, including across tabs", async ({
  library,
}) => {
  const { page, context, url } = library;
  const bytes = await fs.readFile(fixture);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/epub+zip" });
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    await watchImports(page);
    await page.goto(url);
    await page.locator('input[type="file"]:enabled').setInputFiles(fixture);
    await imported(page, 1);
    const id = (await snapshot(page))[0]!.rows[0]!.id as string;
    await addUserData(page, id);
    const before = await snapshot(page);
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all(
      pages.map(async (tab, i) => {
        await watchImports(tab);
        const source = `http://127.0.0.1:${address.port}/${i === 0 ? "renamed" : "another-mirror"}.epub`;
        await tab.goto(`${url}&importUrl=${encodeURIComponent(source)}`);
        await imported(tab, 1);
        await expect(tab.getByText(title, { exact: true })).toHaveCount(1);
      }),
    );
    expect(await snapshot(page)).toEqual(before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("simultaneous first imports in separate tabs create only one book", async ({ library }) => {
  const { page, context, url } = library;
  const second = await context.newPage();
  await Promise.all(
    [page, second].map(async (tab) => {
      await watchImports(tab);
      await tab.goto(url);
    }),
  );
  await Promise.all(
    [page, second].map(async (tab) => {
      await tab.locator('input[type="file"]:enabled').setInputFiles(fixture);
      await imported(tab, 1);
    }),
  );
  const state = await snapshot(page);
  expect(state[0]!.rows).toHaveLength(1);
  expect(state[1]!.rows).toHaveLength(1);
});

async function seedLegacy(page: Page, missingFile = false) {
  const bytes = Array.from(await fs.readFile(fixture));
  await page.evaluate(
    async ({ bytes, names, missingFile }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ambra-library", 5);
        request.onupgradeneeded = () => {
          for (const name of names) {
            request.result.createObjectStore(name, {
              keyPath:
                name === "readingProgress" ? "bookId" : name === "preferences" ? "key" : "id",
            });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["books", "bookFiles"], "readwrite");
          for (const [id, addedAt] of [
            ["older", 1],
            ["newer", 2],
          ] as const) {
            tx.objectStore("books").put({
              id,
              title: "Legacy copy",
              identifier: "legacy-id",
              fileName: `${id}.epub`,
              addedAt,
            });
            if (!missingFile) {
              tx.objectStore("bookFiles").put({ id, blob: new Blob([new Uint8Array(bytes)]) });
            }
          }
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { bytes, names: stores, missingFile },
  );
}

test("v5 migration retains existing IDs, duplicate records, and annotations", async ({
  library,
}) => {
  const { page, url } = library;
  await seedLegacy(page);
  await addUserData(page, "older");
  await addUserData(page, "newer");
  const before = await snapshot(page);
  await watchImports(page);
  await page.goto(url);
  await page.locator('input[type="file"]:enabled').setInputFiles(fixture);
  await imported(page, 1);
  const after = await snapshot(page);
  expect(after[0]!.rows).toHaveLength(2);
  for (const book of after[0]!.rows) {
    expect(book.contentHash).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(after[0]!.rows.map(({ contentHash: _hash, ...book }) => book)).toEqual(before[0]!.rows);
  expect(after.slice(1)).toEqual(before.slice(1));
  await page.reload();
  await page.locator('input[type="file"]:enabled').setInputFiles(fixture);
  await imported(page, 1);
  expect(await snapshot(page)).toEqual(after);
});

test("a blocked v5 upgrade reports recovery steps, closes its late connection, and preserves data on reload", async ({
  library,
}) => {
  const { page: oldTab, context, url } = library;
  await seedLegacy(oldTab);
  await addUserData(oldTab, "older");
  const before = await snapshot(oldTab);
  const oldConnection = await oldTab.evaluateHandle(
    async () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("ambra-library", 5);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
  const page = await context.newPage();
  await page.addInitScript(() => {
    const close = IDBDatabase.prototype.close;
    IDBDatabase.prototype.close = function () {
      document.documentElement.dataset.closedDatabaseVersion = String(this.version);
      close.call(this);
    };
  });
  await page.goto(url);
  await expect(page.getByRole("alert")).toContainText(
    "Close or reload other Ambra tabs, then reload this page.",
  );
  await oldConnection.evaluate((db) => db.close());
  await oldConnection.dispose();
  await expect(page.locator("html")).toHaveAttribute("data-closed-database-version", "6");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Open Legacy copy/ })).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await watchImports(page);
  await page.reload();
  await page.locator('input[type="file"]:enabled').setInputFiles(fixture);
  await imported(page, 1);
  const after = await snapshot(page);
  expect(after[0]!.rows).toHaveLength(2);
  expect(after.slice(1)).toEqual(before.slice(1));
});

test("legacy identity failures are reported, never silently imported as a new book", async ({
  library,
}) => {
  const { page, url } = library;
  await seedLegacy(page, true);
  const before = await snapshot(page);
  await page.goto(url);
  await page.locator('input[type="file"]:enabled').setInputFiles(fixture);
  await expect(page.getByRole("alert")).toContainText("stored EPUB file is missing");
  expect(await snapshot(page)).toEqual(before);
});

test("hashing failure is reported without falling back to a new identity", async ({ library }) => {
  const { page, url } = library;
  await page.addInitScript(() => {
    crypto.subtle.digest = async () => {
      throw new Error("Content hashing unavailable");
    };
  });
  await page.goto(url);
  await page.locator('input[type="file"]:enabled').setInputFiles(fixture);
  await expect(page.getByRole("alert")).toContainText("Content hashing unavailable");
  expect((await snapshot(page))[0]!.rows).toHaveLength(0);
});
