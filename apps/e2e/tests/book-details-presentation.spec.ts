import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { formatLibraryBytes } from "../../extension/src/library/LibraryFormatting.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/reading-entry.epub");
const description = "An original book for testing continuous reading across page boundaries.";

test("Book Details shows archive file size and compact descriptions in reader and Library (#156/#159)", async () => {
  const { context, readerPage, libraryPage } = await launchReader(book);
  try {
    await exposeReaderController(readerPage);
    const fileSize = fs.statSync(book).size;
    expect(await readerPage.evaluate(async () =>
      (await Reflect.get(window, "__readerController").getBookDetails()).fileSizeBytes,
    )).toBe(fileSize);
    await readerPage.mouse.move(350, 2);
    await readerPage.getByRole("button", { name: "Book details", exact: true }).click();
    await expect(readerPage.getByText(description, { exact: true })).toHaveCSS("font-size", "12px");
    await expect(readerPage.getByText(description, { exact: true })).toHaveCSS("line-height", "18px");
    await readerPage.getByRole("button", { name: "Publication details", exact: true }).click();
    await expect(readerPage.getByText("EPUB file size", { exact: true })).toBeVisible();
    await expect(readerPage.getByText(formatLibraryBytes(fileSize, "en"), { exact: true })).toBeVisible();

    const details = libraryPage.getByRole("button", { name: "Reading Entry details", exact: true });
    await details.focus();
    await details.press("Enter");
    await expect(libraryPage.getByText(description, { exact: true })).toHaveCSS("font-size", "12px");
    await expect(libraryPage.getByText(description, { exact: true })).toHaveCSS("line-height", "18px");
  } finally {
    await context.close();
  }
});
