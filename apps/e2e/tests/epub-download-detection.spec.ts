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
