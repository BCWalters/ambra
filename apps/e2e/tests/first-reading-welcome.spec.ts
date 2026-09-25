import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const otherBook = fileURLToPath(new URL("../fixtures/reading-entry.epub", import.meta.url));
const rtlBook = fileURLToPath(new URL("../fixtures/fxl-spread-rtl.epub", import.meta.url));
const welcome = (page: Page) => page.getByRole("dialog", { name: "Make yourself at home", exact: true });

async function preference(page: Page, key = "readingWelcomeVersion"): Promise<unknown> {
  return page.evaluate(key => new Promise((resolve, reject) => {
    const request = indexedDB.open("ambra-library");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("preferences");
      const value = tx.objectStore("preferences").get(key);
      value.onsuccess = () => resolve(value.result?.value);
      value.onerror = () => reject(value.error);
      tx.oncomplete = () => db.close();
    };
  }), key);
}

async function seed(page: Page, records: { key: string; value: unknown }[]) {
  await page.evaluate(records => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("ambra-library");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("preferences", "readwrite");
      for (const record of records) tx.objectStore("preferences").put(record);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), records);
}

async function position(page: Page) {
  return page.evaluate(() => {
    const snapshot = Reflect.get(window, "__readerController").snapshot();
    return { spine: snapshot.spineIndex, page: snapshot.pageIndex };
  });
}

async function reopen(page: Page) {
  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("menuitem", { name: "Help & About", exact: true }).click();
  await page.getByRole("button", { name: "Reading tips", exact: true }).click();
  await expect(welcome(page)).toBeVisible();
}

// eslint-disable-next-line no-empty-pattern
test("first successful reading only; acknowledge once, reload, reopen, and open another book", async ({}, info) => {
  const app = await launchReader(book, {
    firstReadingWelcome: true,
    viewport: { width: 1100, height: 850 },
    beforeBookImport: async library => {
      await expect(welcome(library)).toHaveCount(0);
      expect(await preference(library)).toBeUndefined();
      const failed = await library.context().newPage();
      await failed.goto(library.url().replace("/library/", "/reader/") + "?bookId=missing");
      await expect(failed.getByText(/could not be found in your library/)).toBeVisible();
      await expect(welcome(failed)).toHaveCount(0);
      expect(await preference(library)).toBeUndefined();
      await failed.close();
      await seed(library, [{ key: "welcome-unrelated-test", value: { preserve: true } }]);
    },
  });
  try {
    const page = app.readerPage;
    await expect(welcome(page)).toBeVisible();
    await expect(page.locator("iframe").first()).toBeAttached();
    await exposeReaderController(page);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().isLoading)).toBe(false);
    expect(await preference(page)).toBeUndefined();
    const before = await position(page);
    await page.keyboard.press("ArrowRight");
    expect(await position(page)).toEqual(before);
    await expect(welcome(page).getByText("Right arrow: forward. Left arrow: back.")).toBeVisible();
    await page.screenshot({ path: info.outputPath("welcome-desktop.png") });
    await welcome(page).getByRole("button", { name: "Start reading", exact: true }).click();
    await expect(welcome(page)).toHaveCount(0);
    await expect.poll(() => preference(page)).toBe(1);
    expect(await preference(page, "welcome-unrelated-test")).toEqual({ preserve: true });
    expect(await position(page)).toEqual(before);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
    await page.reload();
    await expect(page.locator("iframe").first()).toBeAttached();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await expect(welcome(page)).toHaveCount(0);
    await reopen(page);
    await page.screenshot({ path: info.outputPath("welcome-reopened.png") });
    await page.keyboard.press("Escape");
    await expect(welcome(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
    await app.libraryPage.locator('input[type="file"]').setInputFiles(otherBook);
    await expect(app.libraryPage.getByRole("button", { name: /^Open /i })).toHaveCount(2);
    const firstUrl = page.url();
    await page.close();
    await app.libraryPage.getByRole("button", { name: /^Open /i }).first().click();
    await expect.poll(() => app.context.pages().filter(p => p.url().includes("/reader/")).length).toBe(1);
    const nextReader = app.context.pages().find(p => p.url().includes("/reader/"))!;
    await expect(nextReader.locator("iframe").first()).toBeAttached();
    expect(nextReader.url()).not.toBe(firstUrl);
    await expect(welcome(nextReader)).toHaveCount(0);
  } finally { await app.context.close(); }
});

test("Escape is an acknowledgement, while reloading an undismissed welcome is not", async () => {
  const app = await launchReader(book, { firstReadingWelcome: true });
  try {
    const page = app.readerPage;
    await expect(welcome(page)).toBeVisible();
    await page.reload();
    await expect(welcome(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(welcome(page)).toHaveCount(0);
    await expect.poll(() => preference(page)).toBe(1);
    await page.reload();
    await expect(page.locator("iframe").first()).toBeAttached();
    await expect(welcome(page)).toHaveCount(0);
  } finally { await app.context.close(); }
});

// eslint-disable-next-line no-empty-pattern
test("touch-width welcome reflows, traps focus, survives forced colors and offers Library", async ({}, info) => {
  const app = await launchReader(book, {
    firstReadingWelcome: true, hasTouch: true, viewport: { width: 320, height: 700 },
  });
  try {
    const page = app.readerPage;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(welcome(page)).toBeVisible();
    const dialog = welcome(page);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.locator("svg.reading-welcome-art")).toHaveAttribute("aria-hidden", "true");
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: "Start reading" }).focus();
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await dialog.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath("welcome-narrow.png") });
    // A 1280×800 desktop at 400% has a 320×200 CSS-pixel viewport.
    await page.setViewportSize({ width: 320, height: 200 });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "Start reading" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Start reading" }).scrollIntoViewIfNeeded();
    await page.emulateMedia({ forcedColors: "active" });
    await expect(dialog.locator("svg.reading-welcome-art")).toBeHidden();
    await dialog.getByRole("button", { name: "Library", exact: true }).click();
    await expect(page).toHaveURL(/\/library\/index\.html/);
    await expect.poll(() => preference(page)).toBe(1);
    await expect(welcome(page)).toHaveCount(0);
  } finally { await app.context.close(); }
});

test("scroll mode offers native scrolling, not margin turns; disabled keys are not advertised", async () => {
  const app = await launchReader(book, {
    firstReadingWelcome: true,
    beforeBookImport: library => seed(library, [
      { key: "defaultViewMode", value: "scroll" },
      { key: "readerKeyboardShortcuts", value: { enabled: false } },
    ]),
  });
  try {
    const page = app.readerPage;
    await expect(welcome(page)).toBeVisible();
    await expect(welcome(page).getByRole("heading", { name: "Read at your pace" })).toBeVisible();
    await expect(welcome(page).getByText(/outer margin|arrow:/)).toHaveCount(0);
    await welcome(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect.poll(() => preference(page)).toBe(1);
    expect(await preference(page, "readerKeyboardShortcuts")).toEqual({ enabled: false });
  } finally { await app.context.close(); }
});

test("fixed-layout RTL tips match forward/back direction, without turning a page on dismissal", async () => {
  const app = await launchReader(rtlBook, { firstReadingWelcome: true });
  try {
    const page = app.readerPage;
    await expect(welcome(page)).toBeVisible();
    await expect(welcome(page).getByText(/left outer margin to go forward/)).toBeVisible();
    await expect(welcome(page).getByText("Left arrow: forward. Right arrow: back.")).toBeVisible();
    await exposeReaderController(page);
    const before = await position(page);
    await welcome(page).getByRole("button", { name: "Start reading" }).click();
    await expect(welcome(page)).toHaveCount(0);
    expect(await position(page)).toEqual(before);
  } finally { await app.context.close(); }
});

test("experienced harness profile skips the welcome without changing other settings", async () => {
  const app = await launchReader(book);
  try {
    await expect(app.readerPage.locator("iframe").first()).toBeAttached();
    await expect(welcome(app.readerPage)).toHaveCount(0);
    expect(await preference(app.readerPage)).toBe(1);
  } finally { await app.context.close(); }
});

test("disabled shortcuts keep paginated touch tips without advertising arrow keys", async () => {
  const app = await launchReader(book, {
    firstReadingWelcome: true,
    beforeBookImport: library => seed(library, [{ key: "readerKeyboardShortcuts", value: { enabled: false } }]),
  });
  try {
    const page = app.readerPage;
    await expect(welcome(page)).toBeVisible();
    await expect(welcome(page).getByText(/right outer margin to go forward/)).toBeVisible();
    await expect(welcome(page).getByText(/arrow:/)).toHaveCount(0);
    await welcome(page).getByRole("button", { name: "Start reading" }).click();
    expect(await preference(page, "readerKeyboardShortcuts")).toEqual({ enabled: false });
  } finally { await app.context.close(); }
});
