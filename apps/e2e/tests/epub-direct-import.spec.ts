import { test, expect, chromium } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");

/** Starts a tiny local HTTP server serving `LONG_CONTENT_EPUB`'s own
 * bytes with the same `Content-Type`/`Content-Disposition` headers a
 * real EPUB-hosting site (e.g. Project Gutenberg) would send — the
 * minimum needed to make Chrome actually try to *download* the
 * response rather than navigate to it, so this test exercises the real
 * "click a direct link to an EPUB" scenario issue #122 asked for, not
 * a shortcut around it. */
function startEpubServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const bytes = fs.readFileSync(LONG_CONTENT_EPUB);
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": 'attachment; filename="test-book.epub"',
      "Content-Length": bytes.length,
    });
    res.end(bytes);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/test-book.epub`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}

test("navigating directly to an EPUB download link imports it into the library instead of downloading it (issue #122)", async () => {
  const epubServer = await startEpubServer();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ambra-e2e-"));
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    viewport: { width: 900, height: 700 },
    acceptDownloads: true,
  });
  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    }
    // A brand new MV3 service worker can take a brief moment to finish
    // evaluating its top-level module code (which registers
    // `epubDirectImport.ts`'s own `chrome.downloads.onCreated`
    // listener) right after this test's own fresh profile/extension
    // load — confirmed directly while building this feature:
    // navigating too fast after context creation could race a real
    // download past the not-yet-registered listener. A real user
    // practically never hits this exact race (the service worker has
    // almost always already handled some earlier event by the time
    // they click a random EPUB link), so this settle delay reflects
    // realistic usage rather than masking a genuine bug — see
    // `epubDirectImport.ts`'s own doc comment for why the fallback
    // notification (not a synthetic delay in production code) is this
    // repo's actual answer to that race.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const browsingPage = await context.newPage();

    // Collected via a plain listener (not `context.waitForEvent`'s own
    // predicate form, which proved flaky here — likely evaluating
    // `page.url()` before Playwright's own frame bookkeeping for a
    // brand-new tab has caught up) attached *before* triggering the
    // navigation below, so there's no race between the interception
    // opening this tab and this test starting to listen for it.
    const newPages: Page[] = [];
    context.on("page", (page) => newPages.push(page));

    // The real interaction: navigating straight to a link that would
    // otherwise trigger a browser download.
    const navigation = browsingPage.goto(epubServer.url).catch(() => {
      // A canceled download often surfaces here as a navigation error
      // (net::ERR_ABORTED) rather than a normal response — expected,
      // not a test failure; what matters is what happens next.
    });

    let libraryTab: Page | undefined;
    for (let attempt = 0; attempt < 40 && !libraryTab; attempt++) {
      libraryTab = newPages.find((page) => page.url().includes("/library/") && page.url().includes("view=tab"));
      if (!libraryTab) {
        await browsingPage.waitForTimeout(250);
      }
    }
    await navigation;
    expect(libraryTab, "no library tab opened after navigating to the EPUB link").toBeTruthy();

    await expect(libraryTab!.getByText("Ambra Long Content Test Fixture")).toBeVisible({ timeout: 15_000 });

    // The book was intercepted before Chrome ever saved it — no real
    // download should be sitting in the browser's download list.
    const downloads = await serviceWorker.evaluate(
      () => new Promise((resolve) => chrome.downloads.search({}, resolve)),
    );
    const completedRealDownloads = (downloads as Array<{ state: string; filename: string }>).filter(
      (item) => item.state === "complete" && /test-book\.epub$/i.test(item.filename),
    );
    expect(
      completedRealDownloads,
      "the EPUB should have been intercepted and canceled, not actually downloaded to disk",
    ).toHaveLength(0);
  } finally {
    await context.close();
    await epubServer.close();
  }
});
