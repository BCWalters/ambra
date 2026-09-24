import { expect, test as base, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const test = base.extend<{ library: Page }>({
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
      await expect(page.locator('input[type="file"]')).toBeEnabled();
      await page.locator('input[type="file"]').setInputFiles(
        fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url)),
      );
      await expect(page.getByRole("button", { name: /^Open Ambra Long Content/ })).toBeVisible();
      await use(page);
    } finally {
      await context.close();
    }
  },
});

test("failed deletion stays visible, preserves the stored book, and can be retried", async ({ library }) => {
  await library.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      const request = original.call(this, key);
      if (this.name === "bookFiles") {
        IDBObjectStore.prototype.delete = original;
        request.addEventListener("success", () => this.transaction.abort(), { once: true });
      }
      return request;
    };
  });
  const cover = library.getByRole("button", { name: /^Open Ambra Long Content/ });
  await cover.hover();
  await library.getByRole("button", { name: /^Remove .* from library$/ }).click();
  await expect(library.getByRole("alert")).toContainText("aborted");
  await expect(cover).toBeVisible();
  await library.reload();
  await expect(cover).toBeVisible();
  await cover.hover();
  await library.getByRole("button", { name: /^Remove .* from library$/ }).click();
  await expect(library.getByText("What will you read first?", { exact: true })).toBeVisible();
  await expect(library.getByRole("alert")).toHaveCount(0);
});

test("inspector open failures return to details with a visible error and support retry", async ({ library }) => {
  await library.evaluate(() => {
    for (const element of document.querySelectorAll("*")) {
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
      if (!key) continue;
      for (let fiber = Reflect.get(element, key); fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const database = hook.memoizedState;
          if (typeof database?.patchHighlight !== "function") continue;
          const original = database.getBookFile;
          database.getBookFile = async () => {
            database.getBookFile = original;
            throw new Error("Inspection file read failed");
          };
          return;
        }
      }
    }
    throw new Error("Mounted database not found");
  });
  await library.getByRole("button", { name: /^Open Ambra Long Content/ }).hover();
  await library.getByRole("button", { name: /Test Fixture details$/ }).click();
  const details = library.getByRole("dialog", { name: "Book details", exact: true });
  const openInspector = details.getByRole("button", { name: "EPUB Inspector" });
  await openInspector.click();
  await expect(details.getByRole("alert")).toContainText("Inspection file read failed");
  await expect(library.getByRole("dialog", { name: "EPUB Inspector", exact: true })).toBeHidden();
  await openInspector.click();
  await expect(library.getByRole("tab", { name: /Files/ })).toBeVisible();
  await library.keyboard.press("Escape");
  await expect(details).toBeVisible();
  await expect(openInspector).toBeFocused();
  await expect(details.getByRole("alert")).toHaveCount(0);
});

test("standalone Inspector docks beside the Library without a hidden modal blocking it", async ({ library }) => {
  await library.getByRole("button", { name: /^Open Ambra Long Content/ }).hover();
  await library.getByRole("button", { name: /Test Fixture details$/ }).click();
  const details = library.getByRole("dialog", { name: "Book details", exact: true });
  await details.getByRole("button", { name: "EPUB Inspector" }).click();
  const inspector = library.getByRole("dialog", { name: "EPUB Inspector", exact: true });
  await expect(details).toBeHidden();
  await expect(inspector.getByRole("button", { name: "Show in book", exact: true })).toHaveCount(0);
  for (const side of ["left", "right"] as const) {
    await inspector.getByRole("button", { name: `Dock ${side}`, exact: true }).click();
    await expect(inspector).toHaveAttribute("data-inspector-view", `dock-${side}`);
    await expect.poll(async () => {
      const main = await library.getByRole("main").boundingBox();
      const dock = await inspector.boundingBox();
      return !!main && !!dock && (side === "left"
        ? main.x >= dock.x + dock.width - 1
        : main.x + main.width <= dock.x + 1);
    }).toBe(true);
    const importButton = library.getByRole("button", { name: "Import EPUB", exact: true });
    await importButton.focus();
    await expect(importButton).toBeFocused();
    await expect(inspector).toBeVisible();
  }
  await inspector.getByRole("button", { name: "Close EPUB Inspector", exact: true }).click();
  await expect(details).toBeVisible();
});

base("import controls wait for a withheld database open before accepting the first book", async ({ playwright }, testInfo) => {
  const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath("profile"), {
    headless: process.env.AMBRA_E2E_HEADLESS === "1",
    ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const page = await context.newPage();
    await page.addInitScript(() => {
      const open = indexedDB.open;
      const pending: Array<() => void> = [];
      let released = false;
      indexedDB.open = function (...args) {
        const request = open.apply(this, args);
        if (args[0] !== "ambra-library" || released) return request;
        Object.defineProperty(request, "onsuccess", {
          configurable: true,
          set(callback: IDBRequest["onsuccess"]) {
            request.addEventListener("success", (event) => {
              const deliver = () => callback?.call(request, event);
              if (released) deliver();
              else {
                pending.push(deliver);
                Reflect.set(window, "__heldLibraryOpens", pending.length);
              }
            }, { once: true });
          },
        });
        return request;
      };
      Reflect.set(window, "__releaseLibraryOpen", () => {
        released = true;
        indexedDB.open = open;
        for (const deliver of pending.splice(0)) deliver();
      });
    });
    await page.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html?view=tab`);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__heldLibraryOpens") ?? 0)).toBeGreaterThan(0);
    const input = page.locator('input[type="file"]');
    const button = page.getByRole("button", { name: "Bring a book Choose EPUB files...", exact: true });
    await expect(input).toBeDisabled();
    await expect(button).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What will you read first?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import EPUB", exact: true })).toHaveCount(0);
    await page.evaluate(() => Reflect.get(window, "__releaseLibraryOpen")());
    await expect(input).toBeEnabled();
    await expect(button).toBeEnabled();
    await input.setInputFiles(fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url)));
    await expect(page.getByRole("button", { name: /^Open Ambra Long Content/ })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
