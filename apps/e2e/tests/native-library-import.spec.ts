import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const initialBook = fileURLToPath(new URL("../fixtures/reading-entry.epub", import.meta.url));
const importedBook = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const droppedBook = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));

test("native action popup Import book opens a chooser and imports the selected EPUB", async () => {
  const { context, libraryPage: page } = await launchReader(initialBook, { viewport: null });
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
    const buttonPoint = await page.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0]!;
      const button = [...popup.document.querySelectorAll("button")].find(item => item.textContent === "Import book")!;
      const bounds = button.getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...buttonPoint });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...buttonPoint });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...buttonPoint });
    await expect.poll(() => chooser).toBeDefined();
    await send("DOM.setFileInputFiles", { backendNodeId: chooser!.backendNodeId, files: [importedBook] });
    await expect.poll(() => page.evaluate(() => {
      const popup = chrome.extension.getViews({ type: "popup" })[0];
      return popup?.document.querySelector("[data-library-collection]")?.textContent;
    })).toContain("Ambra Long Content Test Fixture");
    if (process.env.VITE_AMBRA_LOCAL_FEATURES === "1") {
      const bounds = await page.evaluate(() => {
        const popup = chrome.extension.getViews({ type: "popup" })[0]!;
        const main = popup.document.querySelector("main")!.getBoundingClientRect();
        return { x: main.x + 20, y: main.y + 20 };
      });
      for (const type of ["dragEnter", "dragOver", "drop"]) {
        await send("Input.dispatchDragEvent", { type, ...bounds,
          data: { items: [], files: [droppedBook], dragOperationsMask: 1 } });
      }
      await expect.poll(() => page.evaluate(() =>
        chrome.extension.getViews({ type: "popup" })[0]?.document.querySelector("[data-library-collection]")?.textContent,
      )).toContain("Ambra Two-Chapter Spread Test Fixture");
    }
    await cdp.detach();
    await page.reload();
    await expect(page.getByRole("button", { name: "Open Ambra Long Content Test Fixture", exact: true })).toBeVisible();
  } finally { await context.close(); }
});
