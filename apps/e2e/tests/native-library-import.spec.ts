import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const initialBook = fileURLToPath(new URL("../fixtures/reading-entry.epub", import.meta.url));
const importedBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const secondImportedBook = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));

test("native popup hands Import book to a persistent tab before the popup is destroyed", async () => {
  const { context, libraryPage: page, readerPage, extensionId } = await launchReader(initialBook, { viewport: null });
  try {
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
    if (process.env.VITE_AMBRA_LOCAL_FEATURES === "1") {
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
    // active tab can destroy that target before CDP delivers its acknowledgement.
    await cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({
      id: ++sequence, method: "Input.dispatchMouseEvent",
      params: { type: "mouseReleased", button: "left", clickCount: 1, ...buttonPoint },
    }) });
    const destination = await destinationOpened;
    let destinationChooserCount = 0;
    destination.on("filechooser", () => { destinationChooserCount++; });
    await expect(destination).toHaveURL(`chrome-extension://${extensionId}/src/library/index.html?view=tab`);
    await expect(destination.getByRole("button", { name: "Import book", exact: true })).toBeFocused();
    await expect(destination.getByRole("status").filter({ hasText: "Keep your library open." })).toBeVisible();
    expect(chooser).toBeUndefined();
    expect(destinationChooserCount).toBe(0);

    // This is the lifecycle boundary the old intercepted-popup-chooser test missed:
    // assert the actual Chrome popup document AND its CDP target are gone before
    // selecting anything, rather than keeping it alive while injecting files.
    await expect.poll(() => page.evaluate(() => chrome.extension.getViews({ type: "popup" }).length)).toBe(0);
    await expect.poll(async () => (await cdp.send("Target.getTargets")).targetInfos
      .some(info => info.targetId === target!.targetId)).toBe(false);
    await cdp.detach();
    await readerPage.close();
    await page.close();

    // OS dialogs themselves cannot be driven by Playwright. Interception is safe
    // here because the chooser now belongs to a normal tab, after popup destruction.
    const [cancelled] = await Promise.all([
      destination.waitForEvent("filechooser"),
      destination.getByRole("button", { name: "Import book", exact: true }).click(),
    ]);
    await cancelled.setFiles([]);
    await expect(destination.getByRole("button", { name: "Import book", exact: true })).toBeEnabled();
    await expect(destination.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true })).toHaveCount(0);
    const [files] = await Promise.all([
      destination.waitForEvent("filechooser"),
      destination.getByRole("button", { name: "Import book", exact: true }).click(),
    ]);
    expect(files.isMultiple()).toBe(true);
    await files.setFiles([importedBook, secondImportedBook]);
    for (const title of ["Ambra Long Content Test Fixture", "Ambra Two-Chapter Spread Test Fixture"]) {
      await expect(destination.getByRole("button", { name: `Read now: ${title}`, exact: true })).toBeVisible();
    }
    await destination.reload();
    await expect(destination.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true })).toBeVisible();
    await expect(destination.getByRole("button", { name: "Open Ambra Two-Chapter Spread Test Fixture", exact: true })).toBeVisible();
    expect(destinationChooserCount).toBe(2);

    const [openedReader] = await Promise.all([
      context.waitForEvent("page"),
      destination.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true }).click(),
    ]);
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
