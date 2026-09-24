import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "..", "fixtures", "long-content.epub");
type Scenario = "success" | "network" | "http" | "parse" | "missing-access" | "closed-tab" | "completed-first";

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
 * Hold the native download open while its independent Library fetch finishes. */
async function startEpubServer(scenario: Scenario) {
  const bytes = fs.readFileSync(fixture);
  let nativeResponse: http.ServerResponse | undefined;
  let importResponse: http.ServerResponse | undefined;
  let importBytesSent = 0;
  let importRequests = 0;
  let requests = 0;
  const server = http.createServer((_req, res) => {
    if (++requests === 1) {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="test-book.epub"',
        "Content-Length": bytes.length,
      });
      if (scenario === "completed-first") res.end(bytes);
      else {
        nativeResponse = res;
        res.write(bytes.subarray(0, 64));
      }
      return;
    }
    importRequests++;
    if (scenario === "network") { res.destroy(); return; }
    if (scenario === "http") { res.writeHead(403); res.end("Forbidden"); return; }
    if (scenario === "parse") { res.end("<html>Sign in to download</html>"); return; }
    if (scenario === "success" || scenario === "closed-tab" || scenario === "completed-first") {
      importResponse = res;
      return;
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/test-book.epub`,
    importRequests: () => importRequests,
    releaseNative: () => nativeResponse?.end(bytes.subarray(64)),
    beginImport: () => {
      importResponse?.writeHead(200, { "Content-Type": "application/epub+zip", "Content-Length": bytes.length });
      importResponse?.write(bytes.subarray(0, 64));
      importBytesSent = 64;
    },
    releaseImport: () => importResponse?.end(bytes.subarray(importBytesSent)),
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

for (const outcome of ["success", "http-error"] as const) {
  test(`download import shows ongoing status without stealing focus: ${outcome} (#155)`, async ({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chrome extension download integration");
    const profile = testInfo.outputPath("profile");
    const downloadsPath = testInfo.outputPath("downloads");
    fs.mkdirSync(downloadsPath, { recursive: true });
    const server = await startEpubServer("success");
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: process.env.AMBRA_E2E_HEADLESS === "1",
        ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
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
      const importButton = library.getByRole("button", { name: "Import EPUB", exact: true });
      const openBook = library.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true });
      await expect(status).toContainText("Downloading test-book.epub");
      await expect(status).toContainText("Keep your library open");
      await expect(status).toHaveAttribute("aria-live", "polite");
      await expect(status.locator(".fui-Spinner")).toBeVisible();
      await expect(openBook).toHaveCount(0);
      await expect(library.getByRole("button", { name: /^Read now:/ })).toHaveCount(0);
      await expect(importButton).toBeEnabled();
      await importButton.focus();
      expect((await nativeRecords())[0]?.state).toBe("in_progress");
      expect((await nativeRecords())[0]?.paused).toBe(false);

      if (outcome === "success") {
        server.beginImport();
        await expect(status).toContainText("Downloading test-book.epub");
        await expect(importButton).toBeFocused();
        server.releaseImport();
        await expect(status).toContainText("Added Ambra Long Content Test Fixture to your library.");
        await expect(status).not.toContainText("test-book.epub");
        await expect(openBook).toBeVisible();
        await expect(library.getByRole("alert")).toHaveCount(0);
        await expect.poll(async () => (await nativeRecords()).length).toBe(0);
        expect(await download.failure()).toBeTruthy();
      } else {
        server.rejectImport();
        await expect(library.getByRole("alert")).toContainText("403");
        await expect(library.getByRole("alert")).toContainText("Import EPUB");
        await expect(status).toBeEmpty();
        await expect(openBook).toHaveCount(0);
        expect((await nativeRecords())[0]?.state).toBe("in_progress");
        server.releaseNative();
        await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
        expect(await download.failure()).toBeNull();
      }
      await expect(status).not.toContainText("Keep your library open");
      await expect(status.locator(".fui-Spinner")).toHaveCount(0);
      await expect(importButton).toBeFocused();
      if (outcome === "success") {
        const [reader] = await Promise.all([
          context.waitForEvent("page"),
          library.getByRole("button", { name: "Read now: Ambra Long Content Test Fixture", exact: true }).click(),
        ]);
        await reader.waitForURL(/\/reader\//);
        await reader.close();
      }
      if (outcome === "http-error") {
        // The native file remains usable via the existing manual-import picker.
        const downloadedFile = await download.path();
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
      await context?.close();
      await server.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  "success", "network", "http", "parse", "missing-access", "closed-tab", "completed-first",
] as const) {
  test(`direct EPUB import preserves the native fallback: ${scenario} (#153)`, async ({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "Chrome extension download integration");
    const profile = testInfo.outputPath("profile");
    const downloadsPath = testInfo.outputPath("downloads");
    fs.mkdirSync(downloadsPath, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, "manifest.json"), "utf8"));
    const sourceManifest = JSON.parse(fs.readFileSync(path.resolve(here, "../../extension/manifest.json"), "utf8"));
    expect(manifest.host_permissions).toEqual(sourceManifest.host_permissions);
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
      expect((await nativeRecords())[0]!.paused).toBe(false);

      if (scenario === "missing-access") {
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
        await expect.poll(server.importRequests).toBeGreaterThan(0);
        if (scenario === "closed-tab") {
          await library.close();
          server.releaseNative();
          await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
        } else if (scenario === "success" || scenario === "completed-first") {
          if (scenario === "completed-first") {
            await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
          }

          server.releaseImport();
          await expect(library.getByText("Ambra Long Content Test Fixture", { exact: true })).toBeVisible();
          if (scenario === "success") {
            await expect.poll(async () => (await nativeRecords()).length).toBe(0);
            expect(await download.failure()).toBeTruthy();
          } else {
            expect((await nativeRecords())[0]?.state).toBe("complete");
          }
        } else {
          await expect(library.getByRole("alert")).toContainText("Import EPUB");
          await expect(library.getByRole("alert")).not.toContainText("Failed to fetch");
          if (scenario === "http") await expect(library.getByRole("alert")).toContainText("403");
          expect((await nativeRecords())[0]?.state).toBe("in_progress");
          server.releaseNative();
          await expect.poll(async () => (await nativeRecords())[0]?.state).toBe("complete");
          // Recover through the existing picker using the actual native download.
          const downloadedFile = await download.path();
          expect(fs.readFileSync(downloadedFile!)).toEqual(fs.readFileSync(fixture));
          await library.locator('input[type="file"]').setInputFiles(downloadedFile!);
          await expect(library.getByText("Ambra Long Content Test Fixture", { exact: true })).toBeVisible();
        }
      }
      if (scenario !== "success") {
        expect(await download.failure()).toBeNull();
        expect((await nativeRecords())[0]?.paused).toBe(false);
      }
    } finally {
      await context?.close();
      await server.close();
      fs.rmSync(profile, { recursive: true, force: true });
      if (extensionPath !== EXTENSION_PATH) fs.rmSync(extensionPath, { recursive: true, force: true });
    }
  });
}
