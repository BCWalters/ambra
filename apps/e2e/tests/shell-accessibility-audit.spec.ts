import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

// These assertions cover DOM focus and browser accessibility semantics, not
// VoiceOver's independent spoken/browse cursor or actual announcements.
test("Library exposes structure and supports keyboard-only modal entry and return", async () => {
  const { context, libraryPage } = await launchReader(book);
  try {
    await libraryPage.bringToFront();
    await expect(libraryPage.getByRole("main", { name: "Ambra — Library" })).toBeVisible();
    const heading = libraryPage.getByRole("heading", { name: "Ambra", level: 1, exact: true });
    await expect(heading).toHaveCSS("color", "rgb(122, 62, 0)");
    const cover = libraryPage.getByRole("button", { name: /^Open / }).first();
    await cover.focus();
    await cover.press("Tab");
    const details = libraryPage.getByRole("button", { name: / details$/ }).first();
    await expect(details).toBeFocused();
    await expect(details).toHaveCSS("opacity", "1");
    await details.press("Enter");
    const dialog = libraryPage.getByRole("dialog", { name: "Book details", exact: true });
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeFocused();
    await close.press("Shift+Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await libraryPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(details).toBeFocused();
  } finally {
    await context.close();
  }
});

test("Search status and empty annotation tabpanels remain named and keyboard reachable", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await readerPage.getByRole("button", { name: "Search", exact: true }).click();
    const search = readerPage.getByRole("navigation", { name: "Search", exact: true });
    const input = search.getByRole("searchbox", { name: "Search this book…" });
    await input.fill("zzznomatch");
    await expect(search.getByRole("status")).toHaveText("No matches found.");
    await expect(search.getByRole("status").locator("p")).toHaveCSS("opacity", "1");
    await input.press("Escape");
    await expect(search).toBeHidden();
    await readerPage.getByRole("button", { name: "Bookmarks and highlights", exact: true }).click();
    const bookmarks = readerPage.getByRole("tab", { name: "Bookmarks", exact: true });
    await bookmarks.focus();
    await bookmarks.press("ArrowRight");
    const highlights = readerPage.getByRole("tab", { name: "Highlights", exact: true });
    await expect(highlights).toBeFocused();
    await highlights.press("Enter");
    await expect(highlights).toHaveAttribute("aria-selected", "true");
    const panel = readerPage.getByRole("tabpanel", { name: "Highlights", exact: true });
    await expect(panel).toContainText("No highlights");
    await highlights.press("Tab");
    await expect(panel).toBeFocused();
  } finally {
    await context.close();
  }
});

test("Inspector tabs expose named panels, row headers, current file and reading focus return", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await readerPage.getByRole("button", { name: "Book details", exact: true }).click();
    const trigger = readerPage.getByRole("button", { name: "EPUB Inspector", exact: true });
    await trigger.click();
    const dialog = readerPage.getByRole("dialog", { name: "EPUB Inspector", exact: true });
    const files = dialog.getByRole("tab", { name: /^Files/ });
    await files.focus();
    await files.press("ArrowRight");
    const metadata = dialog.getByRole("tab", { name: "Metadata", exact: true });
    await expect(metadata).toBeFocused();
    await metadata.press("Enter");
    const panel = dialog.getByRole("tabpanel", { name: "Metadata", exact: true });
    await metadata.press("Tab");
    await expect(panel).toBeFocused();
    await expect(panel.getByRole("rowheader", { name: "File name", exact: true })).toBeVisible();
    await files.click();
    const current = dialog.locator('[data-file-path][aria-current="true"]');
    await expect(current).toHaveCount(1);
    // Pick a different resource using DOM attributes, not its decorative icon/name.
    const previous = await current.getAttribute("data-file-path");
    const other = dialog.locator('[data-file-path]:not([aria-current="true"])').first();
    await other.focus();
    await other.press("Enter");
    await expect(current).not.toHaveAttribute("data-file-path", previous!);
    await readerPage.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => readerPage.evaluate(() => {
      const frame = document.activeElement;
      return frame instanceof HTMLIFrameElement &&
        frame.contentDocument?.activeElement?.hasAttribute("data-ambra-reading-focus");
    })).toBe(true);
  } finally {
    await context.close();
  }
});

test("root overflow containment preserves native book and long flyout scrolling", async () => {
  const longBook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/long-content.epub");
  const { context, readerPage } = await launchReader(longBook, {
    viewport: { width: 1000, height: 650 }, showScrollbars: true,
  });
  try {
    await exposeReaderController(readerPage);
    const shell = readerPage.locator('div[style*="height: 100vh"]').first();
    expect(await shell.evaluate(element => {
      element.scrollTo(301, 88);
      return { x: element.scrollLeft, y: element.scrollTop };
    })).toEqual({ x: 0, y: 0 });
    await readerPage.getByRole("button", { name: "Settings", exact: true }).click();
    const scroll = readerPage.getByRole("menuitemradio", { name: "Scroll", exact: true });
    await scroll.click();
    await expect(scroll).toHaveAttribute("aria-checked", "true");
    await scroll.press("Escape");
    await expect.poll(() => readerPage.evaluate(() => {
      const doc = document.querySelector("iframe")?.contentDocument;
      return !!doc?.scrollingElement && doc.scrollingElement.scrollHeight > doc.scrollingElement.clientHeight;
    })).toBe(true);
    const iframe = readerPage.locator("iframe").first();
    const bounds = await iframe.boundingBox();
    await readerPage.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await readerPage.mouse.wheel(0, 600);
    await expect.poll(() => iframe.evaluate(element =>
      (element as HTMLIFrameElement).contentDocument?.scrollingElement?.scrollTop ?? 0,
    )).toBeGreaterThan(100);
    await expect(readerPage.locator("html")).toHaveCSS("overflow", "hidden");
    await expect(readerPage.locator("body")).toHaveCSS("overflow", "hidden");
    expect(await readerPage.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: 0, y: 0 });

    await readerPage.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const details = await controller.getBookDetails();
      controller.getBookDetails = async () => ({
        ...details, description: Array.from({ length: 80 }, (_, index) => `Long description paragraph ${index + 1}.`).join("\n\n"),
        identifiers: Array.from({ length: 30 }, (_, index) => ({
          scheme: "Fixture", value: `Publication identifier ${index + 1}.`,
        })),
      });
    });
    await readerPage.mouse.move(400, 2);
    await readerPage.getByRole("button", { name: "Book details", exact: true }).click();
    const panel = readerPage.getByRole("complementary", { name: "Book details", exact: true });
    await expect(panel).toContainText("Long description paragraph 1.");
    await expect(panel).not.toContainText("Long description paragraph 80.");
    await panel.getByRole("button", { name: "Publication details", exact: true }).click();
    const scroller = panel.locator(":scope > div").filter({ hasText: "Publication identifier 30." });
    await expect(scroller).toHaveCount(1);
    await expect(scroller).toContainText("Publication identifier 30.");
    const help = panel.getByRole("button", { name: "Help & About", exact: true });
    await expect(help).toBeInViewport({ ratio: 1 });
    await expect.poll(() => panel.evaluate(element => Math.abs(element.getBoundingClientRect().right - window.innerWidth)))
      .toBeLessThan(1);
    const panelBounds = await scroller.boundingBox();
    await readerPage.mouse.move(panelBounds!.x + panelBounds!.width / 2, panelBounds!.y + panelBounds!.height / 2);
    const scrollBefore = await scroller.evaluate(element => element.scrollTop);
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeGreaterThan(100);
    await readerPage.mouse.wheel(0, 600);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollBefore);
    await readerPage.mouse.wheel(0, 100_000);
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThanOrEqual(1);
    await expect(panel.getByText("Publication identifier 30.", { exact: true })).toBeInViewport();
    await expect(help).toBeInViewport({ ratio: 1 });
    expect(await readerPage.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: 0, y: 0 });
    expect(await shell.evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop }))).toEqual({ x: 0, y: 0 });
  } finally {
    await context.close();
  }
});
