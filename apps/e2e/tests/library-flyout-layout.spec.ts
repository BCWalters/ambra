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
        await expect(panel.getByRole("heading", { name: metadata.title, exact: true })).toBeVisible();
        await expect(panel.getByRole("heading", { name: metadata.title, exact: true })).toHaveCSS("overflow-wrap", "anywhere");
        await expect(panel.getByRole("button", { name: "Show more: Title", exact: true })).toHaveCount(0);
        await expect(panel.getByText(metadata.description)).toHaveCSS("font-size", "12px");
        await expect(panel.getByText(metadata.description)).toHaveCSS("line-height", "18px");
        await expect(panel.getByText(metadata.publisher, { exact: true })).toHaveCSS("font-size", "14px");
        await expect(panel.getByText("Copyright", { exact: true })).toHaveCount(0);
        await expect(panel.locator("img")).toHaveCSS("object-fit", "contain");
        const disclosure = panel.getByRole("button", { name: "Publication details" });
        await expect(panel.getByText(identifier, { exact: true })).toBeHidden();
        await disclosure.focus();
        await disclosure.press("Space");
        await expect(disclosure).toHaveAttribute("aria-expanded", "true");
        await expect(panel.getByText(metadata.rights, { exact: true })).toBeVisible();
        await expect(panel.getByText(metadata.rights, { exact: true })).toHaveCSS("font-size", "12px");
        const identifierDisclosure = panel.getByRole("button", { name: "Show more: Identifier", exact: true });
        await identifierDisclosure.press("Enter");
        await expect(panel.getByRole("button", { name: "Show less: Identifier", exact: true })).toHaveAttribute("aria-expanded", "true");
        await expect(panel.getByText(identifier, { exact: true })).toBeVisible();
        await panel.getByRole("button", { name: "Show more: File name", exact: true }).press("Enter");
        await expect(panel.getByText(metadata.fileName, { exact: true })).toBeVisible();
        // Fluent focus rings extend beyond buttons; measure text and scroll areas instead.
        await expect.poll(() => panel.evaluate(element =>
          Math.max(...[element, ...element.querySelectorAll("*")]
            .filter(child => child === element || child.matches("p, h2") || getComputedStyle(child).overflowY === "auto")
            .map(child => child.clientWidth > 0 ? child.scrollWidth - child.clientWidth : 0)),
        )).toBeLessThanOrEqual(1);
      }
      const readerDetails = readerPage.getByRole("complementary", { name: "Book details" });
      await expect(readerDetails.getByRole("button", { name: "Help & About", exact: true })).toBeVisible();
      await expect(readerDetails.getByRole("button", { name: "EPUB Inspector", exact: true })).toBeVisible();
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
      const libraryHeader = libraryPage.getByRole("toolbar", { name: "Library actions" });
      const readerSettings = readerPage.getByRole("button", { name: "Ambra settings", exact: true });
      await expect(libraryHeader).toHaveCSS("height", "56px");
      expect(await libraryHeader.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll("button")).every(button =>
          button.getBoundingClientRect().bottom <= bounds.bottom,
        );
      })).toBe(true);
      await expect(readerSettings.locator("..")).toHaveCSS("height", "56px");
      await expect(libraryPage.getByRole("button", { name: "Ambra settings", exact: true }).locator("svg")).toHaveCSS("width", "20px");
      await expect(readerSettings.locator("svg")).toHaveCSS("width", "20px");
      await expect(brand.locator("svg")).toHaveAttribute("aria-hidden", "true");
      expect(await brand.evaluate(element => element.closest("button, a"))).toBeNull();
      expect(await brand.locator("button, a, [tabindex]").count()).toBe(0);
      await expect.poll(() => brand.locator("..").evaluate(element =>
        element.scrollWidth - element.clientWidth,
      )).toBeLessThanOrEqual(1);
      for (const title of ["Book details", "Help & About"]) {
        const trigger = title === "Book details"
          ? libraryPage.getByRole("button", { name: /details$/ })
          : libraryPage.getByRole("button", { name: title, exact: true });
        await trigger.focus();
        await trigger.press("Enter");
        const dialog = libraryPage.getByRole("dialog", { name: title });
        const close = dialog.getByRole("button", { name: "Close", exact: true });
        await expect(close).toBeFocused();
        await expect.poll(async () => {
          const panel = await dialog.boundingBox();
          return panel ? title === "Book details"
            ? Math.abs(panel.x + panel.width - width)
            : Math.abs(panel.x + panel.width / 2 - width / 2) : Infinity;
        }).toBeLessThan(1);
        await expect.poll(async () => {
          const panel = await dialog.boundingBox();
          const button = await close.boundingBox();
          if (!panel || !button) return Infinity;
          return Math.abs(panel.x + panel.width - button.x - button.width);
        }).toBeLessThanOrEqual(20);
        await libraryPage.screenshot({ path: testInfo.outputPath(`${title}.png`) });
        await close.click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
      for (const [trigger, role, name] of [
        ["Contents", "navigation", "Table of contents"],
        ["Search", "navigation", "Search"],
        ["Annotations", "navigation", "Annotations"],
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
