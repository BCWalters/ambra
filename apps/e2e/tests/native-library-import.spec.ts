import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const initialBook = fileURLToPath(new URL("../fixtures/reading-entry.epub", import.meta.url));
const importedBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const secondImportedBook = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));

test("native popup hands Import book to a focused import window that survives focus loss", async () => {
  const { context, libraryPage: page, readerPage, extensionId } = await launchReader(initialBook, { viewport: null });
  try {
    const sourceWindow = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
    const worker = context.serviceWorkers()[0]!;
    await worker.evaluate(async () => {
      const [window] = await chrome.windows.getAll();
      if (window?.id === undefined) throw new Error("No browser window for native popup");
      await chrome.windows.update(window.id, { focused: true });
      await chrome.action.openPopup({ windowId: window.id });
    });
    await expect.poll(() => page.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0];
      const button = [...popup?.document.querySelectorAll("button") ?? []].find(item => item.textContent === "Import book");
      return button && !button.disabled;
    })).toBe(true);

    const cdp = await context.newCDPSession(page);
    const { targetInfos } = await cdp.send("Target.getTargets");
    const target = targetInfos.find(info => info.type === "page" && !info.attached && info.url.includes("/src/library/index.html"));
    expect(target, JSON.stringify(targetInfos)).toBeDefined();
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target!.targetId, flatten: false });
    let sequence = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let chooser: { backendNodeId: number } | undefined;
    cdp.on("Target.receivedMessageFromTarget", message => {
      if (message.sessionId !== sessionId) return;
      const response = JSON.parse(message.message) as {
        id?: number; method?: string; params?: { backendNodeId: number };
        error?: { message: string }; result?: unknown;
      };
      if (response.method === "Page.fileChooserOpened") chooser = response.params;
      const waiting = response.id === undefined ? undefined : pending.get(response.id);
      if (waiting) {
        pending.delete(response.id!);
        if (response.error) waiting.reject(new Error(response.error.message));
        else waiting.resolve(response.result);
      }
    });
    const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        void cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) })
          .catch(reject);
      });
    };
    await send("Page.enable");
    await send("Page.setInterceptFileChooserDialog", { enabled: true });
    {
      const point = await page.evaluate(() => {
        const popup = chrome.extension.getViews({ type: "popup" })[0]!;
        const bounds = popup.document.querySelector("main")!.getBoundingClientRect();
        return { x: bounds.x + 20, y: bounds.y + 20 };
      });
      for (const type of ["dragEnter", "dragOver", "drop"]) {
        await send("Input.dispatchDragEvent", { type, ...point,
          data: { items: [], files: [secondImportedBook], dragOperationsMask: 1 } });
      }
      await expect.poll(() => page.evaluate(() =>
        chrome.extension.getViews({ type: "popup" })[0]?.document.querySelector("[data-library-collection]")?.textContent,
      )).toContain("Ambra Two-Chapter Spread Test Fixture");
    }
    const buttonPoint = await page.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0]!;
      const button = [...popup.document.querySelectorAll("button")].find(item => item.textContent === "Import book")!;
      const bounds = button.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...buttonPoint });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...buttonPoint });
    const destinationOpened = context.waitForEvent("page");
    // Do not wait for a response from the popup after the release: creating the
    // import window can destroy that target before CDP delivers its acknowledgement.
    await cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({
      id: ++sequence, method: "Input.dispatchMouseEvent",
      params: { type: "mouseReleased", button: "left", clickCount: 1, ...buttonPoint },
    }) });
    const destination = await destinationOpened;
    let destinationChooserCount = 0;
    destination.on("filechooser", () => { destinationChooserCount++; });
    await expect(destination).toHaveURL(`chrome-extension://${extensionId}/src/library/index.html?view=import&sourceWindow=${sourceWindow}`);
    await expect(destination.getByRole("button", { name: "Choose EPUB files...", exact: true })).toBeFocused();
    await expect(destination.locator("[data-library-import-window]")).toBeVisible();
    await expect(destination.locator("[data-library-collection]")).toHaveCount(0);
    await expect(destination.locator("[data-review-invitation]")).toHaveCount(0);
    await expect(destination.getByText("You can also drop EPUB files here.", { exact: true }))
      .toHaveCount(1);
    const importerWindow = await destination.evaluate(async () => {
      const win = await chrome.windows.getCurrent();
      return { id: win.id, type: win.type };
    });
    expect(importerWindow.type).toBe("popup");
    expect(importerWindow.id).not.toBe(sourceWindow);
    expect(await destination.evaluate(() => document.documentElement.style.width)).toBe("");
    expect(chooser).toBeUndefined();
    expect(destinationChooserCount).toBe(0);

    // This is the lifecycle boundary the old intercepted-popup-chooser test missed:
    // assert the actual Chrome popup document AND its CDP target are gone before
    // selecting anything, rather than keeping it alive while injecting files.
    await expect.poll(() => page.evaluate(actionUrl =>
      chrome.extension.getViews({ type: "popup" }).some(view => view.location.href === actionUrl), target!.url,
    )).toBe(false);
    await expect.poll(async () => (await cdp.send("Target.getTargets")).targetInfos
      .some(info => info.targetId === target!.targetId)).toBe(false);
    await cdp.detach();
    await readerPage.close();
    await page.bringToFront();
    expect(destination.isClosed()).toBe(false);
    await expect(destination.locator("[data-library-import-window]")).toBeVisible();
    await destination.bringToFront();
    await destination.screenshot({ path: test.info().outputPath("import-window-empty.png") });

    // OS dialogs themselves cannot be driven by Playwright. Interception is safe
    // here because the chooser belongs to a persistent window, after action-popup destruction.
    const [cancelled] = await Promise.all([
      destination.waitForEvent("filechooser"),
      destination.getByRole("button", { name: "Choose EPUB files...", exact: true }).click(),
    ]);
    await cancelled.setFiles([]);
    await expect(destination.getByRole("button", { name: "Choose EPUB files...", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true })).toHaveCount(0);
    const [files] = await Promise.all([
      destination.waitForEvent("filechooser"),
      destination.getByRole("button", { name: "Choose EPUB files...", exact: true }).click(),
    ]);
    expect(files.isMultiple()).toBe(true);
    await files.setFiles([importedBook, secondImportedBook]);
    for (const title of ["Ambra Long Content Test Fixture", "Ambra Two-Chapter Spread Test Fixture"]) {
      await expect(destination.getByRole("button", { name: `Read now: ${title}`, exact: true })).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Ambra Two-Chapter Spread Test Fixture", exact: true })).toBeVisible();
    expect(destinationChooserCount).toBe(2);
    await destination.screenshot({ path: test.info().outputPath("import-window-complete.png") });

    const closed = destination.waitForEvent("close");
    const [openedReader] = await Promise.all([
      context.waitForEvent("page"),
      destination.getByRole("button", { name: "Read now: Ambra Long Content Test Fixture", exact: true }).click(),
    ]);
    await closed;
    expect(await openedReader.evaluate(async () => {
      const win = await chrome.windows.getCurrent();
      return { id: win.id, type: win.type };
    })).toEqual({ id: sourceWindow, type: "normal" });
    await expect(openedReader.getByRole("main").locator("iframe").first()).toBeVisible();
    await expect(openedReader.getByRole("progressbar")).toHaveCount(0);
  } finally { await context.close(); }
});

test("the in-reader compact Library still chooses files directly without a handoff tab", async () => {
  const { context, libraryPage, readerPage: page } = await launchReader(initialBook);
  try {
    const originalUrl = page.url();
    const originalPageCount = context.pages().length;
    await page.getByRole("button", { name: "Library", exact: true }).click();
    const panel = page.locator("[data-ambra-library-panel]");
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      panel.getByRole("button", { name: "Import book", exact: true }).click(),
    ]);
    await chooser.setFiles(importedBook);
    await expect(panel.getByRole("button", { name: "Read now: Ambra Long Content Test Fixture", exact: true })).toBeVisible();
    expect(page.url()).toBe(originalUrl);
    expect(context.pages()).toHaveLength(originalPageCount);
    await libraryPage.reload();
    await expect(libraryPage.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("focused importer accepts a drop and returns to the original Library window", async () => {
  const { context, libraryPage: page, extensionId } = await launchReader(initialBook);
  try {
    const sourceWindow = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
    const opened = context.waitForEvent("page");
    await page.evaluate(async ({ extensionId, sourceWindow }) => {
      await chrome.windows.create({ type: "popup", width: 480, height: 560,
        url: `chrome-extension://${extensionId}/src/library/index.html?view=import&sourceWindow=${sourceWindow}` });
    }, { extensionId, sourceWindow });
    const importer = await opened;
    await expect(importer.getByRole("button", { name: "Choose EPUB files...", exact: true })).toBeEnabled();
    await importer.setViewportSize({ width: 320, height: 600 });
    expect(await importer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cdp = await context.newCDPSession(importer);
    for (const type of ["dragEnter", "dragOver", "drop"] as const) {
      await cdp.send("Input.dispatchDragEvent", { type, x: 100, y: 150,
        data: { items: [], files: [importedBook], dragOperationsMask: 1 } });
    }
    await expect(importer.getByRole("button", { name: "Read now: Ambra Long Content Test Fixture", exact: true })).toBeVisible();
    expect(await importer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await importer.screenshot({ path: test.info().outputPath("import-window-narrow.png"), fullPage: true });
    await cdp.detach();
    const libraryOpened = context.waitForEvent("page");
    const closed = importer.waitForEvent("close");
    await importer.getByRole("button", { name: "Open library", exact: true }).click();
    const library = await libraryOpened;
    await closed;
    await expect(library).toHaveURL(/view=tab$/);
    await expect(library.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true })).toBeVisible();
    expect(await library.evaluate(async () => (await chrome.windows.getCurrent()).id)).toBe(sourceWindow);
    expect(page.isClosed()).toBe(false);
  } finally { await context.close(); }
});

test("closing an unused importer leaves the original browser window open", async () => {
  const { context, libraryPage: page, extensionId } = await launchReader(initialBook);
  try {
    const opened = context.waitForEvent("page");
    await page.evaluate(async extensionId => {
      await chrome.windows.create({ type: "popup", url: `chrome-extension://${extensionId}/src/library/index.html?view=import` });
    }, extensionId);
    const importer = await opened;
    const closed = importer.waitForEvent("close");
    await importer.getByRole("button", { name: "Close", exact: true }).click();
    await closed;
    expect(page.isClosed()).toBe(false);
    await expect(page.getByRole("button", { name: "Open Reading Entry", exact: true })).toBeVisible();
  } finally { await context.close(); }
});
