import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/long-content.epub");

for (const width of [1000, 360]) {
  test(`Book details preserve readable metadata in both surfaces at ${width}px`, async () => {
    const { context, libraryPage, readerPage } = await launchReader(book, {
      viewport: { width, height: 800 },
    });
    const identifier = `urn:example:${"long-identifier".repeat(30)}`;
    const metadata = {
      title: "ALongBookTitleWithoutSpaces".repeat(8),
      publisher: "Example Publisher",
      rights: "Copyright 2026 Example Publisher",
      description: "A readable book description.\nWith a second paragraph.",
      identifiers: [{ value: identifier }],
      fileName: `${"long-file-name".repeat(30)}.epub`,
    };
    try {
      await exposeReaderController(readerPage);
      await readerPage.evaluate(async (metadata) => {
        const controller = Reflect.get(window, "__readerController");
        const details = await controller.getBookDetails();
        controller.getBookDetails = async () => ({ ...details, ...metadata });
        const library = controller.library;
        const stored = await library.getBookMetadata(controller.bookId);
        if (!stored) throw new Error("Fixture book metadata not found");
        await new Promise<void>((resolve, reject) => {
          const transaction = library.db.transaction("books", "readwrite");
          transaction.objectStore("books").put({ ...stored, ...metadata });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      }, metadata);
      await libraryPage.reload();
      const trigger = libraryPage.getByRole("button", { name: /details$/ });
      await trigger.focus();
      await trigger.press("Enter");
      await readerPage.mouse.move(150, 2);
      await readerPage.getByRole("button", { name: "Book details", exact: true }).click();

      for (const panel of [
        libraryPage.getByRole("dialog", { name: "Book details" }),
        readerPage.getByRole("complementary", { name: "Book details" }),
      ]) {
        await expect(panel.getByRole("heading", { name: metadata.title })).toBeVisible();
        await expect(panel.getByText(metadata.description)).toHaveCSS("font-size", "14px");
        await expect(panel.getByText(metadata.rights, { exact: true })).toBeVisible();
        await expect(panel.getByText(metadata.rights, { exact: true })).toHaveCSS("font-size", "12px");
        await expect(panel.getByText(metadata.publisher, { exact: true })).toHaveCSS("font-size", "14px");
        await expect(panel.getByText("Copyright", { exact: true })).toHaveCount(0);
        await expect(panel.locator("img")).toHaveCSS("object-fit", "contain");
        const disclosure = panel.getByRole("button", { name: "Publication details" });
        await expect(panel.getByText(identifier, { exact: true })).toBeHidden();
        await disclosure.focus();
        await disclosure.press("Space");
        await expect(disclosure).toHaveAttribute("aria-expanded", "true");
        await expect(panel.getByText(identifier, { exact: true })).toBeVisible();
        // Fluent focus rings extend beyond buttons; measure text and scroll areas instead.
        await expect.poll(() => panel.evaluate(element =>
          Math.max(...[element, ...element.querySelectorAll("*")]
            .filter(child => child === element || child.matches("p, h2") || getComputedStyle(child).overflowY === "auto")
            .map(child => child.clientWidth > 0 ? child.scrollWidth - child.clientWidth : 0)),
        )).toBeLessThanOrEqual(1);
      }
      await expect(readerPage.getByRole("heading", { name: "Reading tools" })).toBeVisible();
      await expect(libraryPage.getByText(metadata.fileName, { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test(`Library flyout close buttons stay at the right edge at ${width}px`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { context, libraryPage, readerPage } = await launchReader(book, { viewport: { width, height: 800 } });
    try {
      const brand = libraryPage.getByText("Ambra", { exact: true });
      const libraryHeader = brand.locator("..");
      const readerSettings = readerPage.getByRole("button", { name: "Settings", exact: true });
      await expect(libraryHeader).toHaveCSS("min-height", "56px");
      if (width === 1000) await expect(libraryHeader).toHaveCSS("height", "56px");
      expect(await libraryHeader.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll("button")).every(button =>
          button.getBoundingClientRect().bottom <= bounds.bottom,
        );
      })).toBe(true);
      await expect(readerSettings.locator("..")).toHaveCSS("height", "56px");
      await expect(libraryPage.getByRole("button", { name: "Settings", exact: true }).locator("svg")).toHaveCSS("width", "20px");
      await expect(readerSettings.locator("svg")).toHaveCSS("width", "20px");
      await expect(brand.locator("svg")).toHaveAttribute("aria-hidden", "true");
      expect(await brand.evaluate(element => element.closest("button, a, [tabindex]"))).toBeNull();
      expect(await brand.locator("button, a, [tabindex]").count()).toBe(0);
      await expect.poll(() => brand.locator("..").evaluate(element =>
        element.scrollWidth - element.clientWidth,
      )).toBeLessThanOrEqual(1);
      for (const title of ["Book details", "About Ambra"]) {
        const trigger = title === "Book details"
          ? libraryPage.getByRole("button", { name: /details$/ })
          : libraryPage.getByRole("button", { name: title, exact: true });
        await trigger.focus();
        await trigger.press("Enter");
        const dialog = libraryPage.getByRole("dialog", { name: title });
        const close = dialog.getByRole("button", { name: "Close", exact: true });
        if (title === "About Ambra") {
          expect(await dialog.locator("svg linearGradient").getAttribute("id"))
            .not.toBe(await brand.locator("svg linearGradient").getAttribute("id"));
        }
        await expect(close).toBeFocused();
        await expect.poll(async () => {
          const panel = await dialog.boundingBox();
          return panel ? Math.abs(panel.x + panel.width - width) : Infinity;
        }).toBeLessThan(1);
        await expect.poll(async () => {
          const panel = await dialog.boundingBox();
          const button = await close.boundingBox();
          if (!panel || !button) return Infinity;
          return Math.abs(panel.x + panel.width - button.x - button.width);
        }).toBeLessThanOrEqual(16);
        await libraryPage.screenshot({ path: testInfo.outputPath(`${title}.png`) });
        await close.click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
      for (const [trigger, role, name] of [
        ["Show contents", "navigation", "Table of contents"],
        ["Search", "navigation", "Search"],
        ["Bookmarks and highlights", "navigation", "Bookmarks and highlights"],
        ["Book details", "complementary", "Book details"],
      ] as const) {
        await readerPage.mouse.move(150, 2);
        await readerPage.getByRole("button", { name: trigger, exact: true }).click();
        const panel = readerPage.getByRole(role, { name, exact: true });
        await expect(panel).toBeVisible();
        const bounds = await panel.boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(56);
        if (name === "Table of contents") {
          await expect(panel.locator('[aria-current="location"]').first()).toHaveCSS("font-weight", "600");
        }
        await panel.press("Escape");
        await expect(panel).toBeHidden();
      }
    } finally {
      await context.close();
    }
  });
}
