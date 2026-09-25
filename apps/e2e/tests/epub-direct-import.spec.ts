import { test, expect, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { EXTENSION_PATH } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "..", "fixtures", "long-content.epub");
type Scenario = "success" | "network" | "http" | "parse" | "missing-access" | "closed-tab" |
  "reloaded-tab" | "navigated-tab" | "completed-first" | "active-lease" | "expired-alarm";
const recoveryKey = "epubPausedImports.v1";
const recoveryAlarm = "ambra:epub-import-recovery";
type RecoveryRecord = { downloadId: number; tabId?: number; updatedAt: number; started?: boolean; imported?: boolean };

function recoveryRecords(worker: Worker): Promise<Record<string, RecoveryRecord>> {
  return worker.evaluate(async (key) =>
    ((await chrome.storage.local.get(key))[key] ?? {}) as Record<string, RecoveryRecord>, recoveryKey);
}

function withTitle(directory: string, title: string): string {
  const packagePath = execFileSync("unzip", ["-Z", "-1", fixture], { encoding: "utf8" })
    .split("\n").find(name => name.endsWith(".opf"))!;
  const opf = execFileSync("unzip", ["-p", fixture, packagePath], { encoding: "utf8" });
  fs.mkdirSync(path.dirname(path.join(directory, packagePath)), { recursive: true });
  fs.writeFileSync(path.join(directory, packagePath), opf.replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${title}</dc:title>`));
  const book = path.join(directory, "long-title.epub");
  fs.copyFileSync(fixture, book);
  execFileSync("zip", ["-q", "-X", book, packagePath], { cwd: directory });
  return book;
}

for (const mode of [
  "repeat-held", "repeat-fast-uncached", "repeat-fast-cacheable", "replace-state", "push-state", "hash",
  "cancel-held-headers", "cancel-partial-body",
] as const) {
  test(`direct EPUB pause investigation: ${mode}`, async ({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chrome extension download integration");
    const profile = testInfo.outputPath("profile");
    const server = await startEpubServer("success", fixture, mode === "repeat-fast-cacheable");
    const context = await chromium.launchPersistentContext(profile, {
      headless: process.env.AMBRA_E2E_HEADLESS === "1",
      ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
      acceptDownloads: true,
      downloadsPath: testInfo.outputPath("downloads"),
    });
    const warnings: string[] = [];
    context.on("console", message => {
      if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await expect.poll(() => worker.evaluate(() => chrome.downloads.onCreated.hasListeners())).toBe(true);
    const events = await worker.evaluateHandle(() => {
      const events: unknown[] = [];
      chrome.downloads.onCreated.addListener(item => events.push({ at: Date.now(), type: "created", item }));
      chrome.downloads.onChanged.addListener(delta => events.push({ at: Date.now(), type: "changed", delta }));
      chrome.tabs.onUpdated.addListener((tabId, change) => events.push({ at: Date.now(), type: "tab", tabId, change }));
      chrome.runtime.onMessage.addListener((message: unknown, sender) => {
        events.push({ at: Date.now(), type: "message", message, tabId: sender.tab?.id });
      });
      return events;
    });
    const snapshots: unknown[] = [];
    try {
      const mirrors: Page[] = [];
      if (mode === "repeat-held") {
        for (let index = 0; index < 2; index++) {
          const mirror = await context.newPage();
          await mirror.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html?view=tab`);
          await expect(mirror.locator('input[type="file"]')).toBeEnabled();
          mirrors.push(mirror);
        }
      }
      const browsingPage = await context.newPage();
      const repeat = mode.startsWith("repeat-");
      for (let iteration = 0; iteration < (repeat ? 3 : 1); iteration++) {
        server.setFastNative(iteration > 0 && mode !== "repeat-held");
        const nextPage = context.waitForEvent("page");
        const nextDownload = browsingPage.waitForEvent("download");
        await browsingPage.goto(server.url).catch(() => {});
        const download = await nextDownload;
        const library = await nextPage;
        await library.waitForURL(/\/src\/library\//);
        await expect.poll(server.importRequests).toBe(iteration + 1);
        const nativeRecords = () => worker.evaluate(url => chrome.downloads.search({ url }), server.url);
        await expect.poll(async () => Object.values(await recoveryRecords(worker)).some(entry => entry.started)).toBe(true);
        const [record] = Object.values(await recoveryRecords(worker));
        const native = async () => (await nativeRecords()).find(item => item.id === record!.downloadId);
        await expect(library.getByRole("status")).toContainText("Downloading");
        await expect(library.getByRole("heading", { name: "What will you read first?" })).toBeHidden();
        await expect(library.getByRole("button", { name: /Bring a book/ })).toBeHidden();
        await expect(library.getByRole("button", { name: /Find your next book/ })).toBeHidden();
        // useLibrary strips the handoff parameters before its first ACTIVE.
        expect(new URL(library.url()).searchParams.has("importUrl")).toBe(false);
        if (mode === "replace-state") {
          await library.evaluate(() => history.replaceState({}, "", `${location.pathname}?investigation=replace`));
        } else if (mode === "push-state") {
          await library.evaluate(() => history.pushState({}, "", `${location.pathname}?investigation=push`));
        } else if (mode === "hash") {
          await library.evaluate(() => { location.hash = "investigation"; });
        } else if (mode === "cancel-partial-body") {
          server.beginImport();
          await expect(library.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
        }
        // Observe beyond initial tab load/replaceState, with the import held.
        for (let sample = 0; sample < 30; sample++) {
          const item = await native();
          snapshots.push({ iteration, sample, at: Date.now(), item });
          if (iteration === 0 || mode === "repeat-held") {
            expect(item?.state).toBe("in_progress");
            expect(item?.paused).toBe(true);
          } else {
            expect(item?.state === "complete" || (item?.state === "in_progress" && item.paused)).toBe(true);
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const before = await native();
        if (mode === "cancel-held-headers" || mode === "cancel-partial-body") {
          const cancel = library.getByRole("button", { name: /^Cancel download/ });
          await expect(cancel).toBeVisible();
          await expect(cancel).toBeEnabled();
          await library.screenshot({ path: testInfo.outputPath("cancel-download-visible.png") });
          await cancel.click();
          await expect(library.getByRole("status")).toBeEmpty();
          await expect(library.getByTestId("library-import-illustration")).toHaveCount(0);
          await expect(cancel).toHaveCount(0);
          await expect(library.getByRole("progressbar")).toHaveCount(0);
          await expect(library.getByRole("alert")).toHaveCount(0);
          await expect(library.getByRole("heading", { name: "What will you read first?" })).toBeVisible();
          await expect(library.getByRole("button", { name: /Bring a book/ })).toBeFocused();
          await expect(library.getByRole("button", { name: /^Open Ambra Long Content Test Fixture/ })).toHaveCount(0);
          await expect.poll(async () => await native()).toBeUndefined();
          await expect.poll(async () => Object.keys(await recoveryRecords(worker)).length).toBe(0);
          await expect.poll(server.importAborts).toBe(1);
          expect(await download.failure()).toBeTruthy();
          const transitions = await events.jsonValue() as { delta?: {
            paused?: { current: boolean }; state?: { current: string }; error?: { current: string };
          } }[];
          expect(transitions.some(event => event.delta?.paused?.current === false)).toBe(false);
          expect(transitions.some(event => event.delta?.state?.current === "interrupted" &&
            event.delta.error?.current === "USER_CANCELED")).toBe(true);
          expect(server.importRequests()).toBe(1);
          await library.reload();
          await expect(library.getByRole("button", { name: /^Open Ambra Long Content Test Fixture/ })).toHaveCount(0);
          continue;
        }
        server.releaseImport();
        await expect(library.getByRole("status")).toContainText("Added");
        for (const mirror of mirrors) {
          await expect(mirror.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true }))
            .toHaveCount(1);
          await expect(mirror.getByRole("status")).toBeEmpty();
        }
        await expect.poll(async () => Object.keys(await recoveryRecords(worker)).length).toBe(0);
        if (before!.state === "complete") {
          expect((await native())?.state).toBe("complete");
          expect(await download.failure()).toBeNull();
          expect(fs.readFileSync((await download.path())!)).toEqual(fs.readFileSync(fixture));
        } else {
          await expect.poll(async () => await native()).toBeUndefined();
          expect(await download.failure()).toBeTruthy();
        }
        expect(server.importRequests()).toBe(iteration + 1);
        if (mode === "repeat-held" && iteration === 2) {
          await library.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true }).hover();
          await library.getByRole("button", { name: "Remove Ambra Long Content Test Fixture from library", exact: true }).click();
          for (const mirror of mirrors) {
            await expect(mirror.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true }))
              .toHaveCount(0);
            await expect(mirror.getByRole("heading", { name: "What will you read first?" })).toBeVisible();
          }
          await mirrors[0]!.locator('input[type="file"]').setInputFiles(fixture);
          for (const peer of [mirrors[1]!, library]) {
            await expect(peer.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true }))
              .toHaveCount(1);
          }
        }
        await library.close();
      }
    } finally {
      const evidence = testInfo.outputPath("pause-investigation.json");
      fs.writeFileSync(evidence, JSON.stringify({
        mode, requests: server.requests(), snapshots, warnings, events: await events.jsonValue(),
      }, null, 2));
      await testInfo.attach("pause-investigation", { path: evidence, contentType: "application/json" });
      await server.close();
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}

test("ReadBeyond's published EPUB imports through the real download handoff (#153)", async ({ browserName }, testInfo) => {
  test.skip(browserName !== "chromium" || process.env.AMBRA_VERIFY_READBEYOND_DOWNLOAD !== "1",
    "Opt in to the external ReadBeyond download in Chromium.");
  const profile = testInfo.outputPath("profile");
  const context = await chromium.launchPersistentContext(profile, {
    headless: process.env.AMBRA_E2E_HEADLESS === "1",
    ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    acceptDownloads: true,
    downloadsPath: testInfo.outputPath("downloads"),
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await expect.poll(() => worker.evaluate(() => chrome.downloads.onCreated.hasListeners())).toBe(true);
    expect(await worker.evaluate(() =>
      chrome.permissions.contains({ origins: ["https://www.readbeyond.it/*"] }),
    )).toBe(true);
    const browsingPage = await context.newPage();
    const importPage = context.waitForEvent("page");
    await browsingPage.setContent(
      '<a href="https://www.readbeyond.it/samples/1a62c8e6.epub">Download narrated EPUB</a>',
    );
    await browsingPage.getByRole("link", { name: "Download narrated EPUB" }).click();
    const library = await importPage;
    await expect(library.getByRole("button", { name: /^Open A Horseman In The Sky/ })).toBeVisible();
    await expect(library.getByRole("alert")).toHaveCount(0);
    await library.reload();
    await expect(library.getByRole("button", { name: /^Open A Horseman In The Sky/ })).toBeVisible();
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

/** No CORS headers: this requires real extension host access, like ReadBeyond.
 * Chromium's privileged extension GET has no Origin, just like its native
 * download, but uses Sec-Fetch-Mode: cors rather than navigate. Native retries
 * must remain native even when pausing disconnects the first response. */
async function startEpubServer(scenario: Scenario, book = fixture, cacheNative = false) {
  const bytes = fs.readFileSync(book);
  const nativeResponses = new Map<http.ServerResponse, number>();
  let nativeReleased = false;
  let importResponse: http.ServerResponse | undefined;
  let importBytesSent = 0;
  let importRequests = 0;
  let importAborts = 0;
  let fastNative = scenario === "completed-first";
  const requests: { mode?: string; range?: string; url?: string }[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ mode: req.headers["sec-fetch-mode"] as string | undefined, range: req.headers.range, url: req.url });
    if (req.headers["sec-fetch-mode"] !== "cors") {
      const range = req.headers.range?.match(/^bytes=(\d+)-$/);
      const start = range ? Number(range[1]) : 0;
      if (start >= bytes.length) {
        res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` });
        res.end();
        return;
      }
      res.writeHead(range ? 206 : 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="test-book.epub"',
        "Content-Length": bytes.length - start,
        "Accept-Ranges": "bytes",
        "ETag": '"ambra-test-book"',
        "Cache-Control": cacheNative ? "public, max-age=3600" : "no-store",
        ...(range ? { "Content-Range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}),
      });
      if (fastNative || nativeReleased) res.end(bytes.subarray(start));
      else {
        const end = Math.min(start + 64, bytes.length);
        nativeResponses.set(res, end);
        res.on("close", () => nativeResponses.delete(res));
        res.write(bytes.subarray(start, end));
      }
      return;
    }
    importRequests++;
    importBytesSent = 0;
    importResponse = res;
    res.setHeader("Cache-Control", "no-store");
    res.on("close", () => { if (!res.writableFinished) importAborts++; });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/test-book.epub`,
    importRequests: () => importRequests,
    importAborts: () => importAborts,
    requests: () => requests,
    setFastNative: (fast: boolean) => { fastNative = fast; },
    releaseNative: () => {
      nativeReleased = true;
      for (const [response, sent] of nativeResponses) response.end(bytes.subarray(sent));
    },
    beginImport: (knownSize = true) => {
      importResponse?.writeHead(200, {
        "Content-Type": "application/epub+zip", ...(knownSize ? { "Content-Length": bytes.length } : {}),
      });
      importBytesSent = Math.floor(bytes.length / 2);
      importResponse?.write(bytes.subarray(0, importBytesSent));
    },
    releaseImport: () => {
      if (scenario === "network") { importResponse?.destroy(); return; }
      if (scenario === "http") {
        importResponse?.writeHead(403);
        importResponse?.end("Forbidden");
        return;
      }
      if (scenario === "parse") {
        importResponse?.end("<html>Sign in to download</html>");
        return;
      }
      importResponse?.end(bytes.subarray(importBytesSent));
    },
    rejectImport: () => {
      importResponse?.writeHead(403);
      importResponse?.end("Forbidden");
    },
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

for (const outcome of ["success", "unknown-size", "http-error"] as const) {
  test(`download import shows ongoing status without stealing focus: ${outcome} (#155)`, async ({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chrome extension download integration");
    const profile = testInfo.outputPath("profile");
    const downloadsPath = testInfo.outputPath("downloads");
    fs.mkdirSync(downloadsPath, { recursive: true });
    const title = outcome === "success"
      ? "The Adventures of Sherlock Holmes - Adventure II - The Red-Headed League"
      : "Ambra Long Content Test Fixture";
    const book = outcome === "success" ? withTitle(testInfo.outputPath("long-title"), title) : fixture;
    const server = await startEpubServer("success", book);
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: process.env.AMBRA_E2E_HEADLESS === "1",
        ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
        reducedMotion: "no-preference",
        args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
        acceptDownloads: true,
        downloadsPath,
      });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      await expect.poll(() => worker.evaluate(() => chrome.downloads.onCreated.hasListeners())).toBe(true);
      const origin = `chrome-extension://${worker.url().split("/")[2]}`;
      const browsingPage = await context.newPage();
      const newPages: Page[] = [];
      context.on("page", (page) => newPages.push(page));
      const nativeDownload = browsingPage.waitForEvent("download");
      await browsingPage.goto(server.url).catch(() => {});
      const download = await nativeDownload;
      let library!: Page;
      await expect.poll(() => {
        library = newPages.find((page) => page.url().startsWith(`${origin}/src/library/`))!;
        return !!library;
      }).toBe(true);
      await expect.poll(server.importRequests).toBe(1);
      const nativeRecords = () => worker.evaluate((url) => chrome.downloads.search({ url }), server.url);
      const status = library.getByRole("status");
      const importButton = library.getByRole("button", { name: "Bring a book Choose EPUB files...", exact: true });
      const focusAnchor = library.getByRole("button", { name: "Help & About", exact: true });
      const openBook = library.getByRole("button", { name: `Open ${title}`, exact: true });
      await expect(status).toContainText("Downloading test-book.epub");
      await expect(status).toContainText("Keep your library open");
      await expect(status).toHaveAttribute("aria-live", "polite");
      const notification = library.getByTestId("library-import-status");
      const illustration = library.getByTestId("library-import-illustration");
      const arrivingBook = library.getByTestId("arriving-book");
      await expect(illustration).toBeVisible();
      await expect(illustration).toHaveAttribute("aria-hidden", "true");
      await expect(status.locator("svg[data-testid]")).toHaveCount(0);
      await expect(arrivingBook).toHaveCSS("animation-duration", "4.8s");
      await expect(arrivingBook).toHaveCSS("animation-iteration-count", "infinite");
      await expect.poll(() => arrivingBook.evaluate(el => el.getAnimations().length)).toBe(1);
      const initialTime = await arrivingBook.evaluate(el => Number(el.getAnimations()[0]!.currentTime));
      await expect.poll(() => arrivingBook.evaluate(el => Number(el.getAnimations()[0]!.currentTime)))
        .toBeGreaterThan(initialTime + 80);
      await expect(notification.getByRole("button", { name: /^Cancel download/ })).toBeVisible();
      await expect(notification.getByRole("button")).toHaveCount(1);
      await library.emulateMedia({ reducedMotion: "reduce" });
      await expect(arrivingBook).toHaveCSS("animation-name", "none");
      await expect(arrivingBook).toHaveCSS("opacity", "1");
      await expect(library.getByRole("button", { name: "Pause animation", exact: true })).toHaveCount(0);
      await library.emulateMedia({ reducedMotion: "no-preference" });
      await library.setViewportSize({ width: 1920, height: 1080 });
      const panel = await notification.boundingBox();
      const clientWidth = await library.evaluate(() => document.documentElement.clientWidth);
      expect(panel!.width).toBe(600);
      expect(Math.abs(panel!.x - (clientWidth - panel!.width) / 2)).toBeLessThan(1);
      const illustrationBounds = await illustration.boundingBox();
      expect(illustrationBounds!.width).toBe(220);
      expect(illustrationBounds!.height).toBe(128);
      expect(Math.abs(
        illustrationBounds!.x + illustrationBounds!.width / 2 - (panel!.x + panel!.width / 2),
      )).toBeLessThan(1);
      await expect.poll(() => arrivingBook.evaluate(el => {
        const time = Number(el.getAnimations()[0]!.currentTime) % 4800;
        return time >= 1800 && time < 3000;
      })).toBe(true);
      await notification.screenshot({ path: testInfo.outputPath("download-animation.png") });
      await expect(openBook).toHaveCount(0);
      await expect(library.getByRole("button", { name: /^Read now:/ })).toHaveCount(0);
      await expect(importButton).toBeHidden();
      await focusAnchor.focus();
      expect((await nativeRecords())[0]?.state).toBe("in_progress");
      await expect.poll(async () => (await nativeRecords())[0]?.paused).toBe(true);

      if (outcome !== "http-error") {
        server.beginImport(outcome !== "unknown-size");
        await expect(status).toContainText("Downloading test-book.epub");
        const progress = notification.getByRole("progressbar", { name: /^Downloading test-book\.epub/ });
        await expect(progress).toBeVisible();
        await expect(progress.locator("..")).toHaveAttribute("aria-live", "off");
        if (outcome === "success") {
          await expect(progress).toHaveAttribute("aria-valuenow", "50");
          await expect(progress).toHaveAttribute("aria-valuetext", /50%/);
          const track = await progress.boundingBox();
          const fill = await progress.locator("div").boundingBox();
          expect(fill!.width / track!.width).toBeCloseTo(0.5, 2);
        } else {
          await expect(progress).not.toHaveAttribute("aria-valuenow");
          await expect(progress).toHaveAttribute("aria-valuetext", /received/);
          await expect(progress).not.toHaveAttribute("aria-valuetext", /%/);
        }
        await notification.screenshot({ path: testInfo.outputPath("download-progress.png") });
        await expect(focusAnchor).toBeFocused();
        server.releaseImport();
        await expect(status).toContainText(`Added ${title} to your library.`);
        await expect(progress).toHaveCount(0);
        await expect(arrivingBook).toHaveCSS("animation-name", "none");
        await expect(arrivingBook).toHaveCSS("opacity", "1");
        const addedText = await status.locator(".fui-Body1").boundingBox();
        const readNow = await library.getByRole("button", { name: /^Read now:/ }).boundingBox();
        expect(Math.abs(readNow!.x - (addedText!.x + addedText!.width) - 12)).toBeLessThan(1);
        const expectCompletionRow = async () => {
          const [check, text, action, card] = await Promise.all([
            status.locator("svg").boundingBox(), status.locator(".fui-Body1").boundingBox(),
            library.getByRole("button", { name: /^Read now:/ }).boundingBox(), notification.boundingBox(),
          ]);
          expect(Math.abs(check!.y + check!.height / 2 - (text!.y + text!.height / 2))).toBeLessThan(1);
          expect(Math.abs(action!.y + action!.height / 2 - (text!.y + text!.height / 2))).toBeLessThan(1);
          expect(Math.abs(text!.x - (check!.x + check!.width) - 12)).toBeLessThan(1);
          expect(Math.abs(card!.x + card!.width - (action!.x + action!.width) - 19)).toBeLessThan(1);
        };
        await expectCompletionRow();
        if (outcome === "success") expect(addedText!.height).toBeGreaterThan(20);
        const dismiss = await notification.getByRole("button", { name: "Dismiss", exact: true }).boundingBox();
        expect(dismiss!.y - panel!.y).toBeLessThan(20);
        expect(panel!.x + panel!.width - (dismiss!.x + dismiss!.width)).toBeLessThan(24);
        await library.screenshot({ path: testInfo.outputPath("download-complete.png") });
        await library.setViewportSize({ width: 360, height: 740 });
        await expect(notification).toBeVisible();
        expect((await notification.boundingBox())!.width).toBeLessThan(360);
        expect(await library.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
        await expect(library.getByRole("button", { name: /^Read now:/ })).toBeVisible();
        await expectCompletionRow();
        await notification.screenshot({ path: testInfo.outputPath("completion-360px.png") });
        await expect(status).not.toContainText("test-book.epub");
        await expect(openBook).toBeVisible();
        await expect(library.getByRole("alert")).toHaveCount(0);
        await expect.poll(async () => (await nativeRecords()).length).toBe(0);
        expect(await download.failure()).toBeTruthy();
      } else {
        server.rejectImport();
        await expect(library.getByRole("alert")).toContainText("403");
        await expect(library.getByRole("alert")).toContainText("Choose EPUB files...");
        await expect(status).toBeEmpty();
        await expect(illustration).toHaveCount(0);
        await expect(openBook).toHaveCount(0);
        expect((await nativeRecords())[0]?.state).toBe("in_progress");
        await expect.poll(async () => (await nativeRecords())[0]?.paused).toBe(false);
        server.releaseNative();
        await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
        expect(await download.failure()).toBeNull();
      }
      await expect(status).not.toContainText("Keep your library open");
      await expect(status.locator(".fui-Spinner")).toHaveCount(0);
      await expect(focusAnchor).toBeFocused();
      if (outcome !== "http-error") {
        const [reader] = await Promise.all([
          context.waitForEvent("page"),
          library.getByRole("button", { name: `Read now: ${title}`, exact: true }).click(),
        ]);
        await reader.waitForURL(/\/reader\//);
        await reader.close();
      }
      if (outcome === "http-error") {
        // The native file remains usable via the existing manual-import picker.
        const downloadedFile = await download.path();
        expect(fs.readFileSync(downloadedFile!)).toEqual(fs.readFileSync(fixture));
        await library.locator('input[type="file"]').setInputFiles(downloadedFile!);
        await expect(openBook).toBeVisible();
        await expect(library.getByRole("alert")).toHaveCount(0);
        await expect(status.locator(".fui-Spinner")).toHaveCount(0);
      }
      await library.reload();
      await expect(openBook).toBeVisible();
      await expect(status).toBeEmpty();
      await expect(library.getByRole("alert")).toHaveCount(0);
      expect(server.importRequests()).toBe(1);
    } finally {
      await server.close();
      await context?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  "success", "network", "http", "parse", "missing-access", "closed-tab", "reloaded-tab",
  "navigated-tab", "completed-first", "active-lease", "expired-alarm",
] as const) {
  test(`direct EPUB import preserves the native fallback: ${scenario} (#153)`, async ({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chrome extension download integration");
    const profile = testInfo.outputPath("profile");
    const downloadsPath = testInfo.outputPath("downloads");
    fs.mkdirSync(downloadsPath, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, "manifest.json"), "utf8"));
    const sourceManifest = JSON.parse(fs.readFileSync(path.resolve(here, "../../extension/manifest.json"), "utf8"));
    expect(manifest.host_permissions).toEqual(sourceManifest.host_permissions);
    expect(manifest.permissions).toEqual(expect.arrayContaining(["storage", "alarms"]));
    let extensionPath = EXTENSION_PATH;
    if (scenario === "missing-access") {
      extensionPath = testInfo.outputPath("extension-without-host-access");
      fs.cpSync(EXTENSION_PATH, extensionPath, { recursive: true });
      delete manifest.host_permissions;
      fs.writeFileSync(path.join(extensionPath, "manifest.json"), JSON.stringify(manifest));
    }
    const server = await startEpubServer(scenario);
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: process.env.AMBRA_E2E_HEADLESS === "1",
        ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
        acceptDownloads: true,
        downloadsPath,
      });
      const worker = context.serviceWorkers()[0] ??
        await context.waitForEvent("serviceworker", { timeout: 15_000 });
      const origin = `chrome-extension://${worker.url().split("/")[2]}`;
      // Wait for the actual top-level listener, not an arbitrary startup delay.
      await expect.poll(() => worker.evaluate(() => chrome.downloads.onCreated.hasListeners())).toBe(true);
      const browsingPage = await context.newPage();
      const newPages: Page[] = [];
      context.on("page", (page) => newPages.push(page));
      const nativeDownload = browsingPage.waitForEvent("download");
      await browsingPage.goto(server.url).catch(() => {});
      const download = await nativeDownload;
      const nativeRecords = () => worker.evaluate(
        (url) => chrome.downloads.search({ url }), server.url,
      );
      await expect.poll(async () => (await nativeRecords()).length).toBe(1);

      if (scenario === "missing-access") {
        expect((await nativeRecords())[0]!.paused).toBe(false);
        expect(await worker.evaluate(
          () => chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] }),
        )).toBe(false);
        server.releaseNative();
        await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
        expect(server.importRequests()).toBe(0);
        expect(newPages.some((page) => page.url().startsWith(origin))).toBe(false);
      } else {
        let library!: Page;
        await expect.poll(() => {
          library = newPages.find((page) => page.url().startsWith(`${origin}/src/library/`))!;
          return !!library;
        }).toBe(true);
        await expect.poll(server.importRequests).toBe(1);
        let token: string | undefined;
        if (scenario !== "completed-first") {
          await expect.poll(async () => (await nativeRecords())[0]?.paused).toBe(true);
          expect((await nativeRecords())[0]?.state).toBe("in_progress");
          await expect.poll(async () => Object.keys(await recoveryRecords(worker)).length).toBe(1);
          const records = await recoveryRecords(worker);
          token = Object.keys(records)[0]!;
          expect(records[token]!.downloadId).toBe((await nativeRecords())[0]!.id);
          expect(records[token]!.updatedAt).toBeGreaterThan(Date.now() - 60_000);
          const tab = await library.evaluate(() => chrome.tabs.getCurrent());
          expect(records[token]!.tabId).toBe(tab!.id);
          expect(await worker.evaluate((name) => chrome.alarms.get(name), recoveryAlarm)).toBeTruthy();
        }
        if (scenario === "closed-tab" || scenario === "reloaded-tab" || scenario === "navigated-tab" ||
            scenario === "expired-alarm") {
          if (scenario === "closed-tab") await library.close();
          else if (scenario === "reloaded-tab") await library.reload();
          else if (scenario === "navigated-tab") await library.goto("about:blank");
          else {
            // Exercise the durable recovery path without waiting five minutes.
            // Keep the import tab alive so this specifically tests lease expiry.
            const originalClock = await worker.evaluateHandle(() => Date.now);
            try {
              await worker.evaluate(async ({ key, token, alarm }) => {
                const records = (await chrome.storage.local.get(key))[key] as Record<string, RecoveryRecord>;
                records[token].updatedAt = Date.now() - 6 * 60_000;
                await chrome.storage.local.set({ [key]: records });
                // Also expire this worker's already-loaded copy of the journal.
                const now = Date.now;
                Date.now = () => now() + 6 * 60_000;
                await chrome.alarms.create(alarm, { when: now() + 100 });
              }, { key: recoveryKey, token: token!, alarm: recoveryAlarm });
              await expect.poll(async () => (await nativeRecords())[0]?.paused).toBe(false);
            } finally {
              await originalClock.evaluate((now) => { Date.now = now; });
              await originalClock.dispose();
            }
          }
          await expect.poll(async () => (await nativeRecords())[0]?.paused).toBe(false);
          expect((await nativeRecords())[0]?.state).toBe("in_progress");
          server.releaseNative();
          await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
          if (!library.isClosed() && scenario !== "navigated-tab") {
            await expect(library.getByRole("button", { name: /^Open Ambra Long Content Test Fixture/ })).toHaveCount(0);
          }
        } else if (scenario === "success" || scenario === "completed-first" || scenario === "active-lease") {
          if (scenario === "completed-first") {
            // Completion may race the early pause. Either way, finish the
            // original before accepting import success and preserve its file.
            const [item] = await nativeRecords();
            if (item!.paused) await worker.evaluate(id => chrome.downloads.resume(id), item!.id);
            server.releaseNative();
            await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
          }
          if (scenario === "active-lease") {
            const record = (await recoveryRecords(worker))[token!]!;
            // Wait for the real library heartbeat, not a synthetic test message.
            expect(await worker.evaluate(({ token, tabId }) => new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => {
                chrome.runtime.onMessage.removeListener(onMessage);
                resolve(false);
              }, 40_000);
              function onMessage(message: unknown, sender: chrome.runtime.MessageSender) {
                if (typeof message !== "object" || message === null ||
                    !("type" in message) || message.type !== "ambra:epub-import-active" ||
                    !("token" in message) || message.token !== token || sender.tab?.id !== tabId) return;
                clearTimeout(timeout);
                chrome.runtime.onMessage.removeListener(onMessage);
                resolve(true);
              }
              chrome.runtime.onMessage.addListener(onMessage);
            }), { token: token!, tabId: record.tabId })).toBe(true);
            await expect.poll(async () => (await recoveryRecords(worker))[token!]?.updatedAt)
              .toBeGreaterThan(record.updatedAt);
            expect((await nativeRecords())[0]?.paused).toBe(true);
          }

          server.releaseImport();
          await expect(library.getByText("Ambra Long Content Test Fixture", { exact: true })).toBeVisible();
          if (scenario !== "completed-first") {
            await expect.poll(async () => (await nativeRecords()).length).toBe(0);
            expect(await download.failure()).toBeTruthy();
          } else {
            expect((await nativeRecords())[0]?.state).toBe("complete");
          }
        } else {
          server.releaseImport();
          await expect(library.getByRole("alert")).toContainText("Choose EPUB files...");
          await expect(library.getByRole("alert")).not.toContainText("Failed to fetch");
          if (scenario === "parse") {
            await expect(library.getByRole("alert")).toContainText("Oh dear, that doesn't look like a valid EPUB file.");
          } else {
            await expect(library.getByRole("alert")).not.toContainText("valid EPUB file");
          }
          if (scenario === "http") await expect(library.getByRole("alert")).toContainText("403");
          expect((await nativeRecords())[0]?.state).toBe("in_progress");
          await expect.poll(async () => (await nativeRecords())[0]?.paused).toBe(false);
          server.releaseNative();
          await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
          // Recover through the existing picker using the actual native download.
          const downloadedFile = await download.path();
          expect(fs.readFileSync(downloadedFile!)).toEqual(fs.readFileSync(fixture));
          await library.locator('input[type="file"]').setInputFiles(downloadedFile!);
          await expect(library.getByText("Ambra Long Content Test Fixture", { exact: true })).toBeVisible();
        }
      }
      await expect.poll(async () => Object.keys(await recoveryRecords(worker)).length).toBe(0);
      expect(server.importRequests()).toBe(scenario === "missing-access" ? 0 : 1);
      if (scenario !== "success" && scenario !== "active-lease") {
        expect(await download.failure()).toBeNull();
        expect((await nativeRecords())[0]?.paused).toBe(false);
        expect(fs.readFileSync((await download.path())!)).toEqual(fs.readFileSync(fixture));
      }
    } finally {
      await server.close();
      await context?.close();
      fs.rmSync(profile, { recursive: true, force: true });
      if (extensionPath !== EXTENSION_PATH) fs.rmSync(extensionPath, { recursive: true, force: true });
    }
  });
}
