import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { getTranslate } from "../../extension/src/i18n/translate.js";
import { SUPPORTED_LOCALES, type Locale } from "../../extension/src/i18n/Locale.js";
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
  await expect(full).toHaveAccessibleName(t("library.fullLibrary"));
  expect(await full.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const footer = (await page.getByRole("contentinfo").boundingBox())!;
  expect(footer.y + footer.height).toBeLessThanOrEqual(height + 1);
  expect((await full.boundingBox())!.y).toBeGreaterThanOrEqual(footer.y);
  expect(await page.evaluate(() => ({
    scrollY, overflow: document.documentElement.scrollWidth > innerWidth,
  }))).toEqual({ scrollY: 0, overflow: false });
}

for (const width of [320, 360]) {
  test(`${width}px compact library has a readable list and reachable fixed chrome in all nine languages (#297)`, async ({ browserName: _browserName }, testInfo) => {
    const { context, libraryPage: page } = await launchReader(book, {
      viewport: { width, height: 480 }, showScrollbars: true,
    });
    try {
      await seedLayoutMetadata(page);
      await expect(page.getByRole("main").getByRole("button", { name: /^Open / })).toHaveCount(12);
      const firstRows = await page.getByRole("main").getByRole("button", { name: /^Open / }).evaluateAll((nodes) =>
        nodes.slice(0, 4).map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }));
      expect(firstRows[1]!.y).toBeGreaterThan(firstRows[0]!.y);
      expect(firstRows[2]!.y).toBeGreaterThan(firstRows[1]!.y);
      expect(firstRows[3]!.y).toBeGreaterThan(firstRows[0]!.y);
      expect(firstRows[0]!.width).toBe(56);
      expect(firstRows[0]!.width / firstRows[0]!.height).toBeCloseTo(2 / 3, 2);
      await page.screenshot({ path: testInfo.outputPath(`compact-list-${width}.png`) });

      let locale: Locale = "en";
      for (const next of SUPPORTED_LOCALES) {
        const t = getTranslate(locale);
        await page.getByRole("button", { name: t("settings.ambraTitle"), exact: true }).click();
        await page.getByRole("combobox", { name: t("settings.language"), exact: true }).selectOption(next);
        await page.keyboard.press("Escape");
        locale = next;
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expectFixedChrome(page, locale, 480);
        await expect(page.getByRole("button", { name: getTranslate(locale)("library.sort"), exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: getTranslate(locale)("library.findBooks"), exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: getTranslate(locale)("library.importEpub"), exact: true })).toBeVisible();
      }
      const main = page.getByRole("main");
      const mainBox = (await main.boundingBox())!;
      await page.mouse.move(mainBox.x + mainBox.width / 2, mainBox.y + mainBox.height / 2);
      await page.mouse.wheel(0, 1500);
      await expect.poll(() => main.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      await expectFixedChrome(page, locale, 480);
      await expect(page.getByRole("button", { name: getTranslate(locale)("library.sort"), exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`compact-scrolled-${width}.png`) });

      const t = getTranslate(locale);
      const opened = context.waitForEvent("page");
      await page.getByRole("button", { name: t("library.fullLibrary"), exact: true }).press("Enter");
      const full = await opened;
      await expect(full).toHaveURL(/\?view=tab$/);
      await expect(full.getByRole("button", { name: t("library.fullLibrary"), exact: true })).toHaveCount(0);
      const cover = full.locator("[data-library-collection]").getByRole("button", { name: t("library.openBook", { title: "Compact layout 1" }), exact: true });
      await expect(cover).toBeVisible();
      expect((await cover.boundingBox())!.width).toBe(140);
      await expect(cover.getByText("Compact layout 1", { exact: true })).toHaveCSS("-webkit-line-clamp", "4");
      await expect(cover.getByText("Layout author", { exact: true })).toBeVisible();
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
      const covers = [...main.querySelectorAll<HTMLButtonElement>("[data-book-open]")];
      return {
        language: view.document.documentElement.lang,
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
    expect(initial.rows[1]).toBeGreaterThan(initial.rows[0]!);
    expect(initial.rows[2]).toBeGreaterThan(initial.rows[1]!);
    expect(initial.rows[3]).toBeGreaterThan(initial.rows[0]!);
    let locale: Locale = "en";
    for (const next of SUPPORTED_LOCALES) {
      await page.evaluate((label) => {
        const view = chrome.extension.getViews({ type: "popup" })[0]!;
        const trigger = [...view.document.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.getAttribute("aria-label") === label)!;
        trigger.click();
      }, getTranslate(locale)("settings.ambraTitle"));
      await expect.poll(() => page.evaluate(() =>
        chrome.extension.getViews({ type: "popup" })[0]!.document.querySelectorAll("select").length)).toBe(6);
      await page.evaluate((nextLocale) => {
        const view = chrome.extension.getViews({ type: "popup" })[0]!;
        const language = view.document.querySelectorAll("select")[1]!;
        language.value = nextLocale;
        language.dispatchEvent(new Event("change", { bubbles: true }));
        language.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      }, next);
      locale = next;
      await expect.poll(geometry).toMatchObject({
        language: next, width: 360, height: 480, footerBottom: 480, bodyScroll: 0, covers: 12,
      });
      const labels = [getTranslate(next)("library.importEpub"), getTranslate(next)("library.findBooks"), getTranslate(next)("library.sort")];
      expect(await page.evaluate((labels) => {
        const view = chrome.extension.getViews({ type: "popup" })[0]!;
        return labels.every((label) => {
          const button = [...view.document.querySelectorAll<HTMLButtonElement>("button")]
            .find((node) => node.getAttribute("aria-label") === label || node.textContent === label);
          const box = button?.getBoundingClientRect();
          return box && box.top >= 0 && box.bottom <= view.innerHeight && box.right <= view.innerWidth;
        });
      }, labels)).toBe(true);
    }
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
    await expect(full.locator("[data-library-collection] [data-book-open]")).toHaveCount(12);
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
      const opened = page.context().waitForEvent("page");
      await page.getByRole("button", { name: "Find books", exact: true }).click();
      const full = await opened;
      await expect(full).toHaveURL(/\?view=tab&discover=1$/);
      const link = full.getByRole("link", { name: "eBooks.com", exact: true });
      await link.focus();
      await expect(link).toBeFocused();
      const main = (await full.getByRole("dialog", { name: "Find books", exact: true }).boundingBox())!;
      const bounds = (await link.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(main.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(main.y + main.height);
      await expectFixedChrome(page, "en", 600);
      await page.screenshot({ path: testInfo.outputPath("compact-first-run-discovery.png") });
      await full.getByRole("button", { name: "Close", exact: true }).click();
      await expect(full.getByRole("heading", { name: "No books yet" })).toBeVisible();
      await full.close();
    },
  });
  await context.close();
});
