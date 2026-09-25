import { expect, test as base, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, type LaunchedReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixture = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const test = base.extend<{ reader: LaunchedReader }>({
  reader: async ({ browserName: _browserName }, use) => {
    const reader = await launchReader(fixture);
    try {
      await exposeReaderController(reader.readerPage);
      await reader.readerPage.evaluate(async () => {
        await Reflect.get(window, "__readerController").turnPage(1);
      });
      await reader.readerPage.mouse.move(350, 2);
      await reader.readerPage.getByRole("button", { name: "Book details", exact: true }).click();
      const panel = reader.readerPage.getByRole("complementary", { name: "Book details", exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("button", { name: "Save as…", exact: true })).toBeHidden();
      await panel.getByRole("button", { name: "Publication details", exact: true }).click();
      await expect(panel.getByText("long-content.epub", { exact: true })).toBeVisible();
      await reader.readerPage.evaluate(() => Promise.all(document.getAnimations()
        .map((animation) => animation.finished.catch(() => {}))));
      await use(reader);
    } finally {
      await reader.context.close();
    }
  },
});

async function readingPosition(page: Page) {
  return page.evaluate(() => {
    const snapshot = Reflect.get(window, "__readerController").snapshot();
    return {
      spineIndex: snapshot.spineIndex,
      currentSpinePath: snapshot.currentSpinePath,
      pageIndex: snapshot.pageIndex,
      bookPageIndex: snapshot.bookPageIndex,
      viewMode: snapshot.viewMode,
      documents: [...document.querySelectorAll("iframe")].map((frame) => ({
        text: frame.contentDocument?.body.textContent,
        scrollTop: frame.contentDocument?.documentElement.scrollTop,
        scrollLeft: frame.contentDocument?.documentElement.scrollLeft,
      })),
    };
  });
}

test("reader saves its original stored filename and bytes without navigation or focus loss", async ({
  reader: { context, readerPage: page },
}, testInfo) => {
  const before = await readingPosition(page);
  expect(before.pageIndex).toBeGreaterThan(0);
  expect(before.currentSpinePath).not.toBe("long-content.epub");
  const original = await fs.readFile(fixture);
  const directory = testInfo.outputPath("downloads");
  await fs.mkdir(directory, { recursive: true });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  const remoteRequests: string[] = [];
  context.on("request", (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
  });
  await context.route(/^https?:/, (route) => route.abort());
  await page.evaluate(() => {
    const download = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = ((options: chrome.downloads.DownloadOptions, callback: (id: number) => void) => {
      Reflect.set(window, "__readerSaveOptions", options);
      return download(options, callback);
    }) as typeof chrome.downloads.download;
  });
  const panel = page.getByRole("complementary", { name: "Book details", exact: true });
  const save = panel.getByRole("button", { name: "Save as…", exact: true });
  await expect(save).toHaveCSS("font-size", "12px");
  await expect(save).toHaveCSS("color", "rgb(122, 62, 0)");
  await panel.screenshot({ path: testInfo.outputPath("reader-save-as.png") });
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerSaveOptions")?.filename)).toBe("long-content.epub");
  expect(await page.evaluate(() => Reflect.get(window, "__readerSaveOptions")?.saveAs)).toBe(true);
  const [worker] = context.serviceWorkers();
  await expect.poll(async () => worker!.evaluate(async () =>
    (await chrome.downloads.search({ state: "complete" })).some((item) => item.byExtensionId === chrome.runtime.id),
  )).toBe(true);
  const savedPath = await worker!.evaluate(async () =>
    (await chrome.downloads.search({ state: "complete" })).find((item) => item.byExtensionId === chrome.runtime.id)!.filename);
  // CDP bypasses Chrome's picker and chooses a blob-derived name on disk;
  // the captured native API options above prove the original suggestion.
  expect(path.dirname(savedPath)).toBe(directory);
  expect(await fs.readFile(savedPath)).toEqual(original);
  await expect(save).toBeEnabled();
  await expect(save).toBeFocused();
  await expect(panel).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await readingPosition(page)).toEqual(before);
  expect(remoteRequests).toEqual([]);
});

test("reader Save-as failures use its standard error card without moving focus or reading position", async ({
  reader: { readerPage: page },
}, testInfo) => {
  const before = await readingPosition(page);
  await page.evaluate(() => {
    chrome.downloads.download = (() => { throw new Error("FILE_ACCESS_DENIED"); }) as typeof chrome.downloads.download;
  });
  const panel = page.getByRole("complementary", { name: "Book details", exact: true });
  const save = panel.getByRole("button", { name: "Save as…", exact: true });
  await save.focus();
  await page.keyboard.press("Enter");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Could not save a copy of this EPUB. FILE_ACCESS_DENIED");
  await expect(alert.getByRole("button", { name: "Copy diagnostics", exact: true })).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(save).toBeFocused();
  expect(await readingPosition(page)).toEqual(before);
  await panel.screenshot({ path: testInfo.outputPath("reader-save-as-error.png") });
  await alert.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(panel).toBeVisible();
  expect(await readingPosition(page)).toEqual(before);
});

test("canceling the reader destination picker is silent and leaves the current page alone", async ({
  reader: { readerPage: page },
}) => {
  const before = await readingPosition(page);
  // Only the native picker boundary is simulated; shared production handling
  // still reads IndexedDB, creates the blob URL, and classifies cancellation.
  await page.evaluate(() => {
    chrome.downloads.download = ((_options: chrome.downloads.DownloadOptions, callback: (id?: number) => void) => {
      Object.defineProperty(chrome.runtime, "lastError", { configurable: true, value: { message: "User canceled" } });
      callback();
      Reflect.deleteProperty(chrome.runtime, "lastError");
    }) as typeof chrome.downloads.download;
  });
  const save = page.getByRole("button", { name: "Save as…", exact: true });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(save).toBeEnabled();
  await expect(save).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await readingPosition(page)).toEqual(before);
});
