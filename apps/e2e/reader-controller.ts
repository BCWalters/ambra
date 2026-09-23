import type { Page } from "@playwright/test";

/** Inspect the mounted controller without shipping a production test global. */
export async function exposeReaderController(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("*")) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      if (!key) continue;
      for (let fiber = Reflect.get(element, key); fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const value = hook.memoizedState;
          if (value && typeof value.turnPage === "function" && typeof value.setFontScale === "function") {
            Reflect.set(window, "__readerController", value);
            return;
          }
        }
      }
    }
    throw new Error("Mounted ReaderController not found");
  });
}
