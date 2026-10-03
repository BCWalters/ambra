import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

test.use({ actionTimeout: 10_000 });

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const toc = (page: Page) => page.getByRole("navigation", { name: "Table of contents", exact: true });
const annotations = (page: Page) => page.getByRole("navigation", { name: "Annotations", exact: true });
const search = (page: Page) => page.locator("[data-ambra-search-panel]");

async function toolbar(page: Page, name: string) {
  await page.mouse.move(10, 2);
  const label = name === "Contents" ? /^(Contents|Hide contents)$/
    : name === "Annotations" ? /^(Annotations|Hide annotations)$/ : name;
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function readingFits(page: Page) {
  await expect.poll(() => page.getByRole("main").evaluate(element => element.getBoundingClientRect().width))
    .toBeGreaterThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("opposite pinned panels coexist, same-side panels replace, and closing preserves reading focus", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await toolbar(page, "Contents");
    await toc(page).getByRole("button", { name: "Pin contents panel", exact: true }).click();
    await toolbar(page, "Annotations");
    await expect(toc(page)).toBeVisible();
    await expect(annotations(page)).toBeVisible();
    await expect(toc(page)).toHaveCSS("position", "relative");
    await expect(annotations(page)).toHaveCSS("position", "relative");
    await readingFits(page);

    await toolbar(page, "Book details");
    await expect(annotations(page)).toBeHidden();
    await expect(toc(page)).toBeVisible();
    await exposeReaderController(page);
    await page.waitForFunction(() => {
      const controller = Reflect.get(window, "__readerController");
      return !controller.isApplyingLayout && !controller.pendingLayout && !controller.isLoadInFlight;
    });
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const original = controller.openSpineItem;
      let resume!: () => void;
      const gate = new Promise<void>(resolve => { resume = resolve; });
      controller.openSpineItem = async (...args: unknown[]) => {
        await gate;
        return original.apply(controller, args);
      };
      const reopening = controller.reopenForCurrentSize();
      Reflect.set(window, "__finishCoexistenceReflow", async () => {
        controller.openSpineItem = original;
        resume();
        await reopening;
      });
    });
    await page.getByRole("button", { name: "Close book details panel", exact: true }).click();
    await page.evaluate(() => Reflect.get(window, "__finishCoexistenceReflow")());
    await expect(toc(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");

    await toolbar(page, "Search");
    await expect(search(page)).toBeVisible();
    await expect(toc(page)).toHaveCSS("position", "relative");
    await page.keyboard.press("Escape");
    await expect(search(page)).toBeHidden();
    await expect(toc(page)).toBeVisible();
    await toolbar(page, "Search");
    await page.mouse.click(700, 200);
    await expect(search(page)).toBeHidden();
    await expect(toc(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");

    await toolbar(page, "Annotations");
    await toolbar(page, "Library");
    await expect(toc(page)).toBeHidden();
    await expect(annotations(page)).toBeVisible();
    await page.locator("[data-ambra-library-panel]").getByRole("button", { name: "Close", exact: true }).click();
    await expect(annotations(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
  } finally {
    await context.close();
  }
});

test("narrow and zoom-equivalent rows keep pin intent, filters, drafts and focus without overflow", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await exposeReaderController(page);
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const doc = document.querySelector("iframe")!.contentDocument!;
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector("p")!);
      controller.pendingSelectionRange = range;
      await controller.addHighlight("yellow");
      await controller.setHighlightNote(controller.snapshot().highlights[0].id, "Original note");
    });
    await toolbar(page, "Annotations");
    await annotations(page).getByRole("button", { name: "Pin annotations panel", exact: true }).click();
    const filter = annotations(page).getByRole("combobox", { name: "Show", exact: true });
    await filter.selectOption("notes");
    await annotations(page).getByRole("button", { name: /^Edit note:/ }).click();
    const draft = annotations(page).locator("textarea");
    await draft.fill("Keep my unfinished note");
    await toolbar(page, "Contents");
    await expect(annotations(page)).toHaveCSS("position", "relative");
    await expect(toc(page)).toHaveCSS("position", "relative");
    await expect(draft).toHaveValue("Keep my unfinished note");

    for (const width of [900, 620, 600, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(toc(page)).toBeVisible();
      if (width >= 620) {
        await expect(annotations(page)).toHaveCSS("position", "relative");
        await expect(toc(page)).toHaveCSS("position", "absolute");
      } else {
        await expect(annotations(page)).toBeHidden();
        await expect(toc(page).getByRole("button", { name: "Pin contents panel", exact: true }))
          .toHaveAttribute("aria-disabled", "true");
      }
      await readingFits(page);
    }
    const chapter = toc(page).getByRole("button", { name: /Chapter One/ });
    await chapter.focus();
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(annotations(page)).toBeVisible();
    await expect(annotations(page)).toHaveCSS("position", "relative");
    await expect(toc(page)).toHaveCSS("position", "relative");
    await expect(chapter).toBeFocused();
    await expect(filter).toHaveValue("notes");
    await expect(draft).toHaveValue("Keep my unfinished note");
    await annotations(page).getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot().highlights[0].note)).toBe("Keep my unfinished note");
  } finally {
    await context.close();
  }
});

test("ordinary flyouts still replace across sides and keyboard Search retains a pinned Contents dock", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await exposeReaderController(page);
    await toolbar(page, "Contents");
    await toolbar(page, "Annotations");
    await expect(toc(page)).toBeHidden();
    await toolbar(page, "Contents");
    await expect(annotations(page)).toBeHidden();
    await toc(page).getByRole("button", { name: "Pin contents panel", exact: true }).click();
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.setShortcutPreferences({ enabled: true }, "mac");
      controller.restoreContentFocus();
    });
    await page.keyboard.press("Meta+f");
    await expect(search(page)).toBeVisible();
    await expect(toc(page)).toHaveCSS("position", "relative");
    const input = search(page).getByRole("searchbox");
    await expect(input).toBeFocused();
    await input.fill("chapter");
    await page.keyboard.press("Meta+f");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("chapter");
    await page.keyboard.press("Escape");
    await expect(search(page)).toBeHidden();
    await expect(toc(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
  } finally {
    await context.close();
  }
});

test("Inspector docking shares the reading budget and preserves the opposite pinned Contents", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await toolbar(page, "Contents");
    await toc(page).getByRole("button", { name: "Pin contents panel", exact: true }).click();
    await toolbar(page, "Book details");
    await page.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
    const inspector = page.getByRole("dialog", { name: "EPUB Inspector", exact: true });
    await inspector.getByRole("button", { name: "Dock right", exact: true }).click();
    await expect(toc(page)).toHaveCSS("position", "relative");
    await toolbar(page, "Annotations");
    await expect(toc(page)).toHaveCSS("position", "relative");
    await expect(annotations(page)).toHaveCSS("position", "absolute");
    await readingFits(page);
    await page.setViewportSize({ width: 1800, height: 900 });
    await expect(toc(page)).toHaveCSS("position", "relative");
    await expect(annotations(page)).toHaveCSS("position", "relative");
    await readingFits(page);
  } finally {
    await context.close();
  }
});

test("bookmark chooser handoff keeps pinned Contents and ordinary Annotations opens restore the manual filter", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await exposeReaderController(page);
    await toolbar(page, "Contents");
    await toc(page).getByRole("button", { name: "Pin contents panel", exact: true }).click();
    await page.waitForFunction(() => {
      const controller = Reflect.get(window, "__readerController");
      return !controller.isApplyingLayout && !controller.pendingLayout;
    });
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const view = controller.contentDocumentViews()[0];
      const text = view.document.querySelector("p").firstChild;
      for (let offset = 1; offset <= 6; offset++) {
        const cfi = controller.locatorResolver.generate(view.spineIndex, text, offset).cfi;
        await controller.library.addBookmark(controller.bookId, cfi, `Saved text position ${offset}`);
      }
      await controller.refreshBookmarks();
    });
    await toolbar(page, "Annotations");
    const filter = annotations(page).getByRole("combobox", { name: "Show", exact: true });
    await filter.selectOption("notes");
    await toolbar(page, "Annotations");
    await page.waitForFunction(() => {
      const controller = Reflect.get(window, "__readerController");
      return controller.snapshot().paneWidth === document.querySelector('[role="main"]')!.clientWidth &&
        !controller.isApplyingLayout && !controller.pendingLayout && !controller.isTurningPage;
    });
    await page.locator('[data-bookmark-marker][data-bookmark-count="6"]').click();
    const chooser = page.getByRole("dialog");
    await chooser.getByRole("button", { name: "Show all bookmarks", exact: true }).click();
    await expect(chooser).toHaveCount(0);
    await expect(toc(page)).toHaveCSS("position", "relative");
    await expect(filter).toHaveValue("bookmarks");
    await expect(filter).toBeFocused();
    await expect(annotations(page).locator("[data-bookmark-link]")).toHaveCount(6);
    await toolbar(page, "Annotations");
    await toolbar(page, "Annotations");
    await expect(filter).toHaveValue("notes");
    await expect(toc(page)).toBeVisible();
  } finally {
    await context.close();
  }
});
