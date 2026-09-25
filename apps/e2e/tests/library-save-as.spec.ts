import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const fixture = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const title = "Ambra Long Content Test Fixture";

const test = base.extend<{ library: { context: BrowserContext; page: Page } }>({
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
      const input = page.locator('input[type="file"]');
      await expect(input).toBeEnabled();
      await input.setInputFiles(fixture);
      await expect(page.getByRole("button", { name: `Open ${title}`, exact: true })).toBeVisible();
      await page.getByText(title, { exact: true }).first().hover();
      await page.getByRole("button", { name: `${title} details`, exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Book details", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save as…", exact: true })).toBeHidden();
      await page.getByRole("button", { name: "Publication details", exact: true }).click();
      await expect(page.getByRole("button", { name: "Save as…", exact: true })).toBeVisible();
      await settleAnimations(page);
      await use({ context, page });
    } finally {
      await context.close();
    }
  },
});

async function settleAnimations(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .map((animation) => animation.finished.catch(() => {}))));
}

async function librarySnapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ambra-library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const snapshot = [];
      for (const name of ["books", "bookFiles", "readingProgress", "bookmarks", "highlights"]) {
        const rows = await new Promise<Array<Record<string, unknown> & { blob?: Blob }>>((resolve, reject) => {
          const request = db.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        snapshot.push({ name, rows: await Promise.all(rows.map(async (row) => ({
          ...row,
          ...(row.blob ? { blob: Array.from(new Uint8Array(await row.blob.arrayBuffer())) } : {}),
        }))) });
      }
      return snapshot;
    } finally {
      db.close();
    }
  });
}

test("Book details Save as writes the original local EPUB without refetching or changing library data", async ({
  library: { context, page },
}, testInfo) => {
  const original = await fs.readFile(fixture);
  const directory = testInfo.outputPath("downloads");
  await fs.mkdir(directory, { recursive: true });
  const cdp = await context.newCDPSession(page);
  // CDP supplies a test destination, but the production call still sends saveAs:true.
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  const before = await librarySnapshot(page);
  const remoteRequests: string[] = [];
  context.on("request", (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
  });
  await context.route(/^https?:/, (route) => route.abort());
  await page.evaluate(() => {
    const download = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = ((options: chrome.downloads.DownloadOptions, callback: (id: number) => void) => {
      Reflect.set(globalThis, "__saveAsOptions", options);
      return download(options, callback);
    }) as typeof chrome.downloads.download;
    const revoke = URL.revokeObjectURL;
    Reflect.set(globalThis, "__saveAsRevocations", []);
    URL.revokeObjectURL = (url) => {
      (Reflect.get(globalThis, "__saveAsRevocations") as string[]).push(url);
      revoke(url);
    };
  });
  const save = page.getByRole("button", { name: "Save as…", exact: true });
  await expect(save).toBeVisible();
  const filename = page.getByRole("dialog", { name: "Book details", exact: true }).getByText("long-content.epub", { exact: true });
  await expect(save).toHaveCSS("font-size", "12px");
  await expect(save).toHaveCSS("color", "rgb(122, 62, 0)");
  expect(await save.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe(await filename.evaluate((element) => getComputedStyle(element).fontSize));
  await page.getByRole("dialog", { name: "Book details", exact: true })
    .screenshot({ path: testInfo.outputPath("save-as-ambra.png") });
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "__saveAsOptions")?.filename)).toBe("long-content.epub");
  const options = await page.evaluate(() => Reflect.get(globalThis, "__saveAsOptions") as chrome.downloads.DownloadOptions);
  expect(options).toMatchObject({ filename: "long-content.epub", saveAs: true });
  expect(options.url).toMatch(/^blob:chrome-extension:/);
  const [worker] = context.serviceWorkers();
  await expect.poll(async () => worker!.evaluate(async () => {
    const items = await chrome.downloads.search({ state: "complete" });
    return items.some((item) => item.byExtensionId === chrome.runtime.id);
  }), { timeout: 15_000 }).toBe(true);
  const savedPath = await worker!.evaluate(async () => {
    const items = await chrome.downloads.search({ state: "complete" });
    return items.find((item) => item.byExtensionId === chrome.runtime.id)!.filename;
  });
  // Headless CDP bypasses the native picker and derives a name from the blob URL
  // rather than honoring the dialog's suggestion; assert that suggestion above.
  expect(path.dirname(savedPath)).toBe(directory);
  expect(await fs.readFile(savedPath)).toEqual(original);
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "__saveAsRevocations") as string[])).toContain(options.url);
  await expect(save).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await librarySnapshot(page)).toEqual(before);
  expect(remoteRequests).toEqual([]);
  const notifications = await worker!.evaluate(() => chrome.notifications.getAll());
  expect(Object.keys(notifications).filter((id) => id.startsWith("ambra-epub-download-"))).toEqual([]);
});

test("compact Save as follows the selected theme rather than the context default", async ({
  library: { page },
}, testInfo) => {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Reader theme/ }).press("ArrowRight");
  await page.getByRole("menuitemradio", { name: "Blue", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Settings", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await page.getByText(title, { exact: true }).first().hover();
  await page.getByRole("button", { name: `${title} details`, exact: true }).click();
  const save = page.getByRole("button", { name: "Save as…", exact: true });
  await expect(save).toBeHidden();
  await page.getByRole("button", { name: "Publication details", exact: true }).click();
  await expect(save).toHaveCSS("font-size", "12px");
  await expect(save).toHaveCSS("color", "rgb(21, 71, 128)");
  await expect(save).toHaveCSS("border-top-color", "rgb(29, 90, 168)");
  await settleAnimations(page);
  await save.focus();
  await expect(save).toBeFocused();
  await page.getByRole("dialog", { name: "Book details", exact: true })
    .screenshot({ path: testInfo.outputPath("save-as-blue.png") });
});

test("a pending Save-as URL is document-owned until the browser acquires its bytes", async ({
  library: { context, page },
}) => {
  // Hold only the browser API boundary, simulating an undecided destination
  // picker. This deliberately does not claim to automate Chrome's native dialog.
  await page.evaluate(() => {
    chrome.downloads.download = ((options: chrome.downloads.DownloadOptions) => {
      Reflect.set(globalThis, "__pendingSaveAs", options);
    }) as typeof chrome.downloads.download;
  });
  await page.getByRole("button", { name: "Save as…", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, "__pendingSaveAs")?.saveAs)).toBe(true);
  const url = await page.evaluate(() => Reflect.get(globalThis, "__pendingSaveAs").url as string);
  const [worker] = context.serviceWorkers();
  const bytes = await worker!.evaluate(async (source) =>
    Array.from(new Uint8Array(await (await fetch(source)).arrayBuffer())), url);
  expect(Buffer.from(bytes)).toEqual(await fs.readFile(fixture));
  await page.close();
  // Once the source document closes, an unacquired object URL is no longer
  // readable, even by Ambra's still-running service worker.
  await expect.poll(() => worker!.evaluate(async (source) => {
    try { await fetch(source); return true; } catch { return false; }
  }, url)).toBe(false);
});
