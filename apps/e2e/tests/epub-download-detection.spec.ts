import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { launchReader } from "../harness.js";

/**
 * Direct EPUB downloads are intercepted before completion. The notification
 * fallback handles downloads whose EPUB filename only becomes known later.
 */
test("a download identified as EPUB after creation surfaces an add-to-library notification", async ({
  browserName: _browserName,
}, testInfo) => {
  const { context } = await launchReader(path.resolve(__dirname, "../real-books/alice-in-wonderland.epub"));
  try {
    const [serviceWorker] = context.serviceWorkers();
    const page = await context.newPage();
    const downloadDirectory = testInfo.outputPath("downloads");
    await fs.mkdir(downloadDirectory, { recursive: true });
    // Playwright's default allowAndName replaces filenames with UUIDs,
    // hiding the late EPUB extension from chrome.downloads.search.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDirectory,
      eventsEnabled: true,
    });

    await page.setContent(
      `<a id="dl" download="late-detected.epub" href="data:application/octet-stream;base64,UEsDBA==">download</a>`,
    );
    await page.click("#dl");
    await expect.poll(() => serviceWorker!.evaluate(
      () => new Promise<string>((resolve) => chrome.downloads.search(
        { state: "complete" },
        (items) => resolve(items[0]?.filename ?? ""),
      )),
    )).toMatch(/late-detected\.epub$/);
    expect((await fs.stat(path.join(downloadDirectory, "late-detected.epub"))).size).toBe(4);

    await expect.poll(async () => {
      const notifications = await serviceWorker!.evaluate(
        () => new Promise<Record<string, boolean>>((resolve) => chrome.notifications.getAll(resolve)),
      );
      return Object.keys(notifications).some((id) => id.startsWith("ambra-epub-download-"));
    }).toBe(true);
  } finally {
    await context.close();
  }
});

test("a download that completes before cancellation keeps its history and uses the notification fallback", async ({
  browserName: _browserName,
}, testInfo) => {
  const { context } = await launchReader(path.resolve(__dirname, "../real-books/alice-in-wonderland.epub"));
  try {
    const [worker] = context.serviceWorkers();
    const initialLibraries = context.pages().filter((page) => page.url().includes("/library/")).length;
    await worker!.evaluate(() => {
      const cancel = chrome.downloads.cancel;
      chrome.downloads.cancel = ((id: number, callback: () => void) => {
        chrome.downloads.cancel = cancel;
        // Hold only the cancellation, not the real download or completion event.
        const completed = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== id || delta.state?.current !== "complete") return;
          chrome.downloads.onChanged.removeListener(completed);
          cancel(id, () => {
            callback();
            Reflect.set(globalThis, "__lateCancelReturned", true);
          });
        };
        chrome.downloads.onChanged.addListener(completed);
      }) as typeof chrome.downloads.cancel;
    });
    const page = await context.newPage();
    const directory = testInfo.outputPath("downloads");
    await fs.mkdir(directory, { recursive: true });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow", downloadPath: directory, eventsEnabled: true,
    });
    await page.setContent(
      '<a id="dl" download="late-cancel.epub" href="data:application/epub+zip;base64,UEsDBA==">download</a>',
    );
    await page.click("#dl");
    await expect.poll(() => worker!.evaluate(
      () => Reflect.get(globalThis, "__lateCancelReturned") === true,
    )).toBe(true);
    await expect.poll(() => worker!.evaluate(async () => {
      const items = await chrome.downloads.search({ state: "complete" });
      const download = items.find((item) => /late-cancel\.epub$/.test(item.filename));
      if (!download) return false;
      const notifications = await chrome.notifications.getAll();
      return !!notifications[`ambra-epub-download-${download.id}`];
    })).toBe(true);
    expect((await fs.stat(path.join(directory, "late-cancel.epub"))).size).toBe(4);
    expect(context.pages().filter((tab) => tab.url().includes("/library/"))).toHaveLength(initialLibraries);
  } finally {
    await context.close();
  }
});
