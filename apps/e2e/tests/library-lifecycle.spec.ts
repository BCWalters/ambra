import { expect, test as base, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { EXTENSION_PATH } from "../harness.js";

const test = base.extend<{ library: Page }>({
  library: async ({ playwright }, use, testInfo) => {
    const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath("profile"), {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    try {
      let [worker] = context.serviceWorkers();
      worker ??= await context.waitForEvent("serviceworker");
      const page = await context.newPage();
      await page.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html?view=tab`);
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
  await expect(library.getByText("Your library is empty", { exact: true })).toBeVisible();
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
