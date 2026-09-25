import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

// These assertions cover DOM focus and browser accessibility semantics, not
// VoiceOver's independent spoken/browse cursor or actual announcements.
for (const tooltipName of [undefined, "Sort library", "Help & About", "Expand library into a full browser tab"]) {
  test(`Library Language selection closes one submenu level with Escape at 320px (${tooltipName ?? "pointer"})`, async () => {
    const { context, libraryPage: page } = await launchReader(book, { viewport: { width: 320, height: 600 } });
    try {
      await page.bringToFront();
      const trigger = page.getByRole("button", { name: "Settings", exact: true });
      if (tooltipName) {
        await page.getByRole("button", { name: tooltipName, exact: true }).hover();
        await expect(page.getByRole("tooltip", { name: tooltipName, exact: true })).toBeVisible();
        await trigger.press("Enter");
      } else {
        await trigger.click();
      }
      expect(await page.getByRole("tooltip").count()).toBe(0);
      const language = page.getByRole("menuitem", { name: /^Language/ });
      await language.press("ArrowRight");
      const english = page.getByRole("menuitemradio", { name: "English", exact: true });
      if (tooltipName) await english.press("Enter");
      else await english.click();
      await expect(english).toHaveAttribute("aria-checked", "true");
      expect(await page.getByRole("tooltip").count()).toBe(0);
      await page.mouse.move(0, 0);
      await english.press("Escape");
      await expect(language).toBeFocused();
      await expect(page.getByRole("menu")).toHaveCount(1);
      await expect(page.getByRole("menu", { name: /^Language/ })).toBeHidden();
      await language.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(page.getByRole("menu")).toHaveCount(0);
      if (tooltipName) {
        await page.getByRole("button", { name: tooltipName, exact: true }).hover();
        await expect(page.getByRole("tooltip", { name: tooltipName, exact: true })).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
}

test("Settings exposes named flyout menus, checked rows and focus in Chromium's accessibility tree", async () => {
  const { context, readerPage: page } = await launchReader(book, { forceAccessibility: true });
  try {
    const trigger = page.getByRole("button", { name: "Settings", exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    const menu = page.getByRole("menu", { name: "Settings", exact: true });
    const cdp = await context.newCDPSession(page);
    for (const [name, names] of [
      ["Page theme", ["White", "Sepia", "Dark"]],
      ["Reading mode", ["Paginated", "Scroll"]],
    ] as const) {
      const parent = menu.getByRole("menuitem", { name: new RegExp(`^${name}`) });
      await parent.press("ArrowRight");
      await expect(parent).toHaveAttribute("aria-expanded", "true");
      const submenu = page.getByRole("menu", { name: new RegExp(`^${name}`) });
      const selected = name === "Page theme" ? "Sepia" : "Paginated";
      const choice = submenu.getByRole("menuitemradio", { name: selected, exact: true });
      await choice.focus();
      await choice.press("Enter");
      await expect(choice).toHaveAttribute("aria-checked", "true");
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      const exposed = nodes.filter(node => !node.ignored);
      const submenuNode = exposed.find(node => node.role?.value === "menu" && String(node.name?.value).startsWith(name));
      expect(submenuNode).toBeDefined();
      const byId = new Map(nodes.map(node => [node.nodeId, node]));
      const radios = exposed.filter(node => node.role?.value === "menuitemradio" && names.some(name => name === node.name?.value));
      expect(radios.map(node => node.name?.value)).toEqual([...names]);
      for (const radio of radios) {
        const ancestors: string[] = [];
        for (let node = byId.get(radio.nodeId); node?.parentId; node = byId.get(node.parentId)) ancestors.push(node.parentId);
        expect(ancestors).toContain(submenuNode!.nodeId);
        const properties = new Map(radio.properties?.map(property => [property.name, property.value.value]));
        expect(properties.get("checked")).toBe(["Sepia", "Paginated"].includes(radio.name?.value) ? "true" : "false");
        if (radio.name?.value === selected) expect(properties.get("focused")).toBe(true);
      }
      await choice.press("Escape");
      await expect(parent).toBeFocused();
      await expect(submenu).toBeHidden();
    }
    await cdp.detach();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

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
    await readerPage.getByRole("menuitem", { name: /^Reading mode/ }).press("ArrowRight");
    const scroll = readerPage.getByRole("menuitemradio", { name: "Scroll", exact: true });
    await scroll.click();
    await expect(scroll).toHaveAttribute("aria-checked", "true");
    await scroll.press("Escape");
    await readerPage.keyboard.press("Escape");
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
