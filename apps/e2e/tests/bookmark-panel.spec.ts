import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const chapterTitles = [
  "The geography of memory: a journey beyond the familiar horizon and into the quiet places between",
  "AnExtraordinarilyLongUnbrokenChapterTitleThatMustRemainReadableWithoutMakingTheBookmarkPanelWider".repeat(2),
];

function longTitleBook(directory: string): string {
  const source = path.join(directory, "source");
  fs.mkdirSync(source, { recursive: true });
  execFileSync("unzip", ["-q", path.join(fixtures, "two-chapter.epub"), "-d", source]);
  const navPath = path.join(source, "OEBPS/nav.xhtml");
  const nav = fs.readFileSync(navPath, "utf8")
    .replace("Chapter One", chapterTitles[0]!)
    .replace("Chapter Two", chapterTitles[1]!);
  fs.writeFileSync(navPath, nav);
  const book = path.join(directory, "bookmark-titles.epub");
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "OEBPS"], { cwd: source });
  return book;
}

async function measured(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const controller = Reflect.get(window, "__readerController");
    return controller.snapshot().bookPageCount > 0 && !controller.isLoadInFlight &&
      !controller.isTurningPage && !controller.isApplyingLayout && !controller.pendingLayout;
  });
}

async function openPanel(page: Page): Promise<void> {
  await page.mouse.move(10, 2);
  await page.getByRole("button", { name: "Bookmarks and highlights", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Bookmarks and highlights" })).toBeVisible();
}

interface BookmarkView {
  id: string;
  cfi: string;
  label: string;
  title: string;
  page: number;
}

async function bookmarkViews(page: Page): Promise<BookmarkView[]> {
  return page.evaluate(() => {
    const state = Reflect.get(window, "__readerController").snapshot();
    return state.bookmarks.map((bookmark: { id: string; cfi: string; label: string }) => ({
      ...bookmark,
      title: state.bookmarkLocations[bookmark.id].chapterTitle,
      page: state.bookmarkLocations[bookmark.id].page.number,
    }));
  });
}

for (const width of [1400, 320]) {
  test(`${width}px: bookmark cards keep full titles, measured pages and keyboard focus across reflow (#213)`, async () => {
    const info = test.info();
    const book = longTitleBook(info.outputPath("fixture"));
    const { context, readerPage: page } = await launchReader(book, { viewport: { width, height: 900 } });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await exposeReaderController(page);
      await measured(page);
      for (const fraction of [0.15, 0.45, 0.85]) {
        await page.evaluate(async fraction => {
          const controller = Reflect.get(window, "__readerController");
          await controller.seekToFraction(fraction);
          await controller.addBookmark();
        }, fraction);
        await measured(page);
      }
      await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const first = controller.snapshot().bookmarks[0];
        await controller.library.removeBookmark(first.id);
        await controller.library.addBookmark(controller.bookId, first.cfi, "Legacy personal label — Page 999");
        await controller.refreshBookmarks();
      });
      const initial = await bookmarkViews(page);
      expect(initial).toHaveLength(3);
      expect(new Set(initial.map(bookmark => bookmark.page)).size).toBe(3);
      expect(new Set(initial.map(bookmark => bookmark.title))).toEqual(new Set(chapterTitles));
      expect(initial[0]!.label).toBe("Legacy personal label — Page 999");
      await openPanel(page);
      const panel = page.getByRole("navigation", { name: "Bookmarks and highlights" });
      const cards = panel.locator("[data-bookmark-card]");
      await expect(cards).toHaveCount(3);
      for (const [index, bookmark] of initial.entries()) {
        const card = cards.nth(index);
        const title = card.locator("[data-bookmark-title]");
        const badge = card.locator("[data-bookmark-page]");
        await expect(title).toHaveText(bookmark.title);
        await expect(title).toHaveCSS("font-weight", "600");
        await expect(title).toHaveCSS("word-break", "normal");
        await expect(badge).toHaveText(`Page ${bookmark.page}`);
        await expect(badge).toBeInViewport({ ratio: 1 });
        await expect(card.locator("[data-bookmark-link]")).toHaveAccessibleDescription(`Page ${bookmark.page}`);
        const geometry = await title.evaluate(element => ({
          height: element.getBoundingClientRect().height,
          line: Number.parseFloat(getComputedStyle(element).lineHeight),
          overflowing: element.scrollHeight > element.clientHeight,
          cardOverflow: element.closest("li")!.scrollWidth > element.closest("li")!.clientWidth,
        }));
        expect(geometry.height).toBe(geometry.line * 2);
        expect(geometry.overflowing).toBe(true);
        expect(geometry.cardOverflow).toBe(false);
      }
      const overflow = await panel.evaluate(element => ({
        right: element.getBoundingClientRect().right,
        width: document.documentElement.clientWidth,
        overflow: element.scrollWidth > element.clientWidth,
      }));
      expect(overflow.right).toBeLessThanOrEqual(overflow.width);
      expect(overflow.overflow).toBe(false);
      await cards.first().locator("[data-bookmark-link]").hover();
      await expect(page.getByRole("tooltip", { name: chapterTitles[0], exact: true })).toBeVisible();
      await page.mouse.move(width - 5, 850);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      for (const theme of ["ambra", "silver", "purple"] as const) {
        await page.evaluate(async theme => {
          await Reflect.get(window, "__readerController").setChromeTheme(theme);
        }, theme);
        await expect.poll(() => page.evaluate(() =>
          Reflect.get(window, "__readerController").snapshot().chromeTheme)).toBe(theme);
        await page.screenshot({ path: info.outputPath(`bookmark-cards-${width}-${theme}.png`), animations: "disabled" });
      }

      if (width === 1400) {
        const paneWidth = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().paneWidth);
        const panelWidth = (await panel.boundingBox())!.width;
        await panel.getByRole("button", { name: "Pin bookmarks and highlights panel", exact: true }).click();
        await expect.poll(() => page.evaluate(() =>
          Reflect.get(window, "__readerController").snapshot().paneWidth)).toBe(paneWidth - panelWidth);
        await measured(page);
        const pinned = await bookmarkViews(page);
        await expect(cards.locator("[data-bookmark-page]")).toHaveText(pinned.map(bookmark => `Page ${bookmark.page}`));
        await panel.getByRole("button", { name: "Unpin bookmarks and highlights panel", exact: true }).click();
        await expect.poll(() => page.evaluate(() =>
          Reflect.get(window, "__readerController").snapshot().paneWidth)).toBe(paneWidth);
        await measured(page);
        await expect(cards.locator("[data-bookmark-page]")).toHaveText(initial.map(bookmark => `Page ${bookmark.page}`));
      }

      await cards.first().locator("[data-bookmark-link]").click();
      await expect(panel).toBeHidden();
      await measured(page);
      const destination = await page.evaluate(() => {
        const state = Reflect.get(window, "__readerController").snapshot();
        return { bookmarked: state.isBookmarked, pages: state.spreadPageNumbers ?? [state.bookPageIndex] };
      });
      expect(destination.bookmarked).toBe(true);
      expect(destination.pages).toContain(initial[0]!.page);

      await page.evaluate(async () => {
        await Reflect.get(window, "__readerController").setFontScale(1.4);
      });
      await measured(page);
      const reflowed = await bookmarkViews(page);
      expect(reflowed.map(({ cfi, label }) => ({ cfi, label })))
        .toEqual(initial.map(({ cfi, label }) => ({ cfi, label })));
      expect(reflowed.map(bookmark => bookmark.page)).not.toEqual(initial.map(bookmark => bookmark.page));
      for (const bookmark of reflowed) {
        await page.evaluate(async cfi => {
          await Reflect.get(window, "__readerController").goToBookmark(cfi);
        }, bookmark.cfi);
        await measured(page);
        const state = await page.evaluate(() => {
          const snapshot = Reflect.get(window, "__readerController").snapshot();
          return snapshot.spreadPageNumbers ?? [snapshot.bookPageIndex];
        });
        expect(state).toContain(bookmark.page);
      }
      await openPanel(page);
      await expect(cards.locator("[data-bookmark-page]"))
        .toHaveText(reflowed.map(bookmark => `Page ${bookmark.page}`));
      await page.evaluate(async () => {
        await Reflect.get(window, "__readerController").setViewMode("scroll");
      });
      await expect(cards.locator("[data-bookmark-page]"))
        .toHaveText(["Page unavailable", "Page unavailable", "Page unavailable"]);
      const remove = panel.getByRole("button", { name: /^Remove bookmark:/ });
      await remove.nth(1).focus();
      await page.keyboard.press("Enter");
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(1).locator("[data-bookmark-link]")).toBeFocused();
      await remove.nth(1).focus();
      await page.keyboard.press("Enter");
      await expect(cards).toHaveCount(1);
      await expect(cards.first().locator("[data-bookmark-link]")).toBeFocused();
      await remove.first().focus();
      await page.keyboard.press("Enter");
      await expect(cards).toHaveCount(0);
      await expect(panel.getByRole("tabpanel")).toBeFocused();
      await expect(panel.getByText(/No bookmarks yet/)).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test("publisher bookmarks keep measured page metadata and read-only navigation (#213)", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "embedded-annotations.epub"), {
    viewport: { width: 320, height: 800 },
  });
  try {
    await exposeReaderController(page);
    await measured(page);
    const embedded = await page.evaluate(() => Reflect.get(window, "__readerController").listEmbeddedAnnotations()[0]);
    expect(embedded.location.page.status).toBe("known");
    await openPanel(page);
    const card = page.locator("[data-bookmark-card]");
    await expect(card).toHaveCount(1);
    await expect(card.locator("[data-bookmark-title]")).toHaveText(embedded.label);
    await expect(card.locator("[data-bookmark-page]")).toHaveText(`Page ${embedded.location.page.number}`);
    await expect(card.getByText("Publisher note")).toBeVisible();
    await expect(card.getByRole("button", { name: /^Remove bookmark:/ })).toHaveCount(0);
    await card.locator("[data-bookmark-link]").focus();
    await page.keyboard.press("Enter");
    await measured(page);
    await expect(page.getByRole("navigation", { name: "Bookmarks and highlights" })).toBeHidden();
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageIndex))
      .toBe(embedded.location.page.number);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.embeddedAnnotations[0].target.selector[0].value = "epubcfi(/6/9998!/4/2/1:0)";
      controller.notify();
    });
    await openPanel(page);
    await expect(card.locator("[data-bookmark-page]")).toHaveText("Page unavailable");
    await expect(card.getByText("Publisher note")).toBeVisible();
  } finally {
    await context.close();
  }
});
