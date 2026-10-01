import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, type Locale } from "../../extension/src/i18n/Locale.js";
import type { BookMetadata } from "../../extension/src/library/LibraryDatabase.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/long-content.epub");

async function seedLayoutMetadata(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("ambra-library");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const transaction = db.transaction("books", "readwrite");
      const store = transaction.objectStore("books");
      const request: IDBRequest<BookMetadata[]> = store.getAll();
      request.onsuccess = () => {
        const source = request.result[0];
        if (!source) {
          reject(new Error("Original layout fixture metadata is missing"));
          transaction.abort();
          return;
        }
        for (let index = 1; index <= 11; index++) {
          store.put({ ...source, id: `compact-layout-${index}`, contentHash: undefined,
            title: `Compact layout ${index}`, creator: "Layout author", addedAt: source.addedAt + index });
        }
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
  await page.reload();
}

async function expectFixedChrome(page: Page, locale: Locale, height: number) {
  const t = getTranslate(locale);
  const toolbar = page.getByRole("toolbar", { name: t("library.toolbar") });
  const bounds = (await toolbar.boundingBox())!;
  expect(bounds.y).toBe(0);
  expect(bounds.height).toBeLessThanOrEqual(56);
  for (const button of await toolbar.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  const full = page.getByRole("button", { name: t("library.fullLibrary"), exact: true });
  await expect(full).toBeVisible();
  await expect(full).toHaveAccessibleDescription(t("library.expand"));
  expect(await full.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const footer = (await page.getByRole("contentinfo").boundingBox())!;
  expect(footer.y + footer.height).toBeLessThanOrEqual(height + 1);
  expect((await full.boundingBox())!.y).toBeGreaterThanOrEqual(footer.y);
  expect(await page.evaluate(() => ({
    scrollY, overflow: document.documentElement.scrollWidth > innerWidth,
  }))).toEqual({ scrollY: 0, overflow: false });
}

for (const width of [320, 360]) {
  test(`${width}px compact library has three columns and reachable fixed chrome in all nine languages (#270)`, async ({ browserName: _browserName }, testInfo) => {
    const { context, libraryPage: page } = await launchReader(book, {
      viewport: { width, height: 600 }, showScrollbars: true,
    });
    try {
      await seedLayoutMetadata(page);
      await expect(page.getByRole("main").getByRole("button", { name: /^Open / })).toHaveCount(12);
      const firstRows = await page.getByRole("main").getByRole("button", { name: /^Open / }).evaluateAll((nodes) =>
        nodes.slice(0, 4).map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }));
      expect(firstRows[1]!.y).toBe(firstRows[0]!.y);
      expect(firstRows[2]!.y).toBe(firstRows[0]!.y);
      expect(firstRows[3]!.y).toBeGreaterThan(firstRows[0]!.y);
      expect(firstRows[0]!.width).toBeGreaterThanOrEqual(88);
      expect(firstRows[0]!.width).toBeLessThan(140);
      expect(firstRows[0]!.width / firstRows[0]!.height).toBeCloseTo(0.7, 2);
      await page.screenshot({ path: testInfo.outputPath(`compact-grid-${width}.png`) });

      let locale: Locale = "en";
      for (const next of SUPPORTED_LOCALES) {
        const t = getTranslate(locale);
        await page.getByRole("button", { name: t("toolbar.settings"), exact: true }).click();
        await page.getByRole("menuitem", { name: t("settings.language") }).click();
        await page.getByRole("menuitemradio", { name: LOCALE_NATIVE_NAMES[next], exact: true }).click();
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        locale = next;
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expectFixedChrome(page, locale, 600);
      }
      const main = page.getByRole("main");
      const mainBox = (await main.boundingBox())!;
      await page.mouse.move(mainBox.x + mainBox.width / 2, mainBox.y + mainBox.height / 2);
      await page.mouse.wheel(0, 1500);
      await expect.poll(() => main.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      await expectFixedChrome(page, locale, 600);
      await page.screenshot({ path: testInfo.outputPath(`compact-scrolled-${width}.png`) });

      const t = getTranslate(locale);
      const opened = context.waitForEvent("page");
      await page.getByRole("button", { name: t("library.fullLibrary"), exact: true }).press("Enter");
      const full = await opened;
      await expect(full).toHaveURL(/\?view=tab$/);
      await expect(full.getByRole("button", { name: t("library.fullLibrary"), exact: true })).toHaveCount(0);
      const cover = full.getByRole("button", { name: t("library.openBook", { title: "Compact layout 1" }), exact: true });
      await expect(cover).toBeVisible();
      expect((await cover.boundingBox())!.width).toBe(140);
      await expect(cover.locator("span")).toHaveCSS("-webkit-line-clamp", "6");
      expect(await full.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
    }
  });
}

test("native Chrome action popup has stable preferred dimensions and keeps navigation reachable (#270)", async ({ browserName: _browserName }, testInfo) => {
  const { context, libraryPage: page } = await launchReader(book, { viewport: null });
  try {
    await seedLayoutMetadata(page);
    const worker = context.serviceWorkers()[0]!;
    await worker.evaluate(async () => {
      const [window] = await chrome.windows.getAll();
      if (window?.id === undefined) throw new Error("Native popup test has no browser window");
      await chrome.windows.update(window.id, { focused: true });
      await chrome.action.openPopup({ windowId: window.id });
    });
    // Chrome does not expose this action popup through Playwright's page event.
    const geometry = () => page.evaluate(() => {
      const view = chrome.extension.getViews({ type: "popup" })[0];
      const main = view?.document.querySelector("main");
      const footer = view?.document.querySelector("footer");
      if (!view || !main || !footer) return null;
      const covers = [...main.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
        .filter((button) => button.getAttribute("aria-label")?.startsWith("Open "));
      return {
        width: view.innerWidth, height: view.innerHeight,
        mainWidth: main.getBoundingClientRect().width,
        footerWidth: footer.getBoundingClientRect().width,
        footerBottom: footer.getBoundingClientRect().bottom,
        bodyScroll: view.scrollY, mainScroll: main.scrollTop,
        covers: covers.length,
        rows: covers.slice(0, 4).map((cover) => cover.getBoundingClientRect().y),
      };
    });
    await expect.poll(geometry).toMatchObject({
      width: 360, height: 480, mainWidth: 360, footerWidth: 360, footerBottom: 480,
      bodyScroll: 0, covers: 12,
    });
    const initial = (await geometry())!;
    expect(initial.rows[1]).toBe(initial.rows[0]);
    expect(initial.rows[2]).toBe(initial.rows[0]);
    expect(initial.rows[3]).toBeGreaterThan(initial.rows[0]!);
    await page.evaluate(() => {
      const main = chrome.extension.getViews({ type: "popup" })[0]!.document.querySelector("main")!;
      main.scrollTop = main.scrollHeight;
    });
    await expect.poll(async () => (await geometry())?.mainScroll ?? 0).toBeGreaterThan(0);
    await expect.poll(geometry).toMatchObject({
      width: 360, height: 480, footerWidth: 360, footerBottom: 480, bodyScroll: 0,
    });
    await testInfo.attach("native-popup-layout", { body: JSON.stringify(await geometry()), contentType: "application/json" });
    const opened = context.waitForEvent("page");
    await page.evaluate(() =>
      chrome.extension.getViews({ type: "popup" })[0]!.document.querySelector<HTMLButtonElement>("footer button")!.click());
    const full = await opened;
    await expect(full).toHaveURL(/\?view=tab$/);
    await expect(full.getByRole("main").getByRole("button", { name: /^Open / })).toHaveCount(12);
  } finally {
    await context.close();
  }
});

test("first-run discovery keeps a visible full-library action without covering links or keyboard focus (#270)", async ({ browserName: _browserName }, testInfo) => {
  const { context } = await launchReader(book, {
    viewport: { width: 360, height: 600 }, showScrollbars: true,
    beforeBookImport: async (page) => {
      await expectFixedChrome(page, "en", 600);
      await page.screenshot({ path: testInfo.outputPath("compact-first-run.png") });
      await page.getByRole("button", { name: "Find your next book Explore books" }).click();
      const link = page.getByRole("link", { name: "eBooks.com", exact: true });
      await link.focus();
      await expect(link).toBeFocused();
      const main = (await page.getByRole("main").boundingBox())!;
      const bounds = (await link.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(main.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(main.y + main.height);
      await expectFixedChrome(page, "en", 600);
      await page.screenshot({ path: testInfo.outputPath("compact-first-run-discovery.png") });
      const opened = page.context().waitForEvent("page");
      await page.getByRole("button", { name: "Open library in new tab", exact: true }).click();
      const full = await opened;
      await expect(full).toHaveURL(/\?view=tab$/);
      await expect(full.getByRole("heading", { name: "What will you read first?" })).toBeVisible();
      await full.close();
    },
  });
  await context.close();
});
