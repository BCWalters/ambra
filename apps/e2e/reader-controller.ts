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

export async function isReaderElementPainted(page: Page, id: string): Promise<boolean> {
  return page.evaluate(targetId => Array.from(document.querySelectorAll("iframe")).some(frame => {
    const doc = frame.contentDocument;
    const element = doc?.getElementById(targetId);
    if (!element || !doc ||
      !frame.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const range = doc.createRange();
    range.selectNodeContents(element);
    const rect = element.localName === "img" ? element.getBoundingClientRect() : range.getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    return rect.width > 0 && rect.height > 0 && [rect.top + 1, rect.bottom - 1].every(y =>
      element.contains(doc.elementFromPoint(x, y)) &&
      document.elementFromPoint(box.left + x, box.top + y) === frame,
    );
  }), id);
}
