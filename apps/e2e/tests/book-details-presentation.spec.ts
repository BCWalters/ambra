import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { formatLibraryBytes } from "../../extension/src/library/LibraryFormatting.js";
import { strToU8, zipSync } from "fflate";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/reading-entry.epub");
const description = "An original book for testing continuous reading across page boundaries.";

test("metadata retains value-local language and bidi direction across Library, reader and Inspector (#332)", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const title = "\u0643\u062a\u0627\u0628 2026";
  const author = "\u05de\u05d7\u05d1\u05e8";
  const alternate = "\u06a9\u062a\u0627\u0628";
  const fixture = info.outputPath("metadata-localization.epub");
  fs.writeFileSync(fixture, zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    "EPUB/package.opf": strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="ar" dir="rtl">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="id">urn:ambra:metadata-localization</dc:identifier>
        <dc:title id="title">${title}</dc:title><dc:creator xml:lang="he">${author}</dc:creator>
        <dc:language>en</dc:language><meta property="alternate-script" refines="#title" xml:lang="fa">${alternate}</meta>
        <meta property="dcterms:modified">2026-09-24T00:00:00Z</meta>
      </metadata>
      <manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine page-progression-direction="ltr"><itemref idref="chapter"/></spine></package>`),
    "EPUB/nav.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body></html>'),
    "EPUB/chapter.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Original English chapter</h1><p>Package metadata must not supply this resource with a language or direction.</p></body></html>'),
  }));
  const { context, readerPage, libraryPage } = await launchReader(fixture);
  const check = async (value: import("@playwright/test").Locator, language: string) => {
    await expect(value).toHaveAttribute("lang", language);
    await expect(value).toHaveAttribute("dir", "rtl");
    await expect(value).toHaveCSS("direction", "rtl");
    await expect(value).toHaveCSS("unicode-bidi", "isolate");
  };
  try {
    const card = libraryPage.locator("[data-library-book]").first();
    await check(card.locator('[lang]:not([aria-hidden="true"] *)').filter({ hasText: title }), "ar");
    await check(card.locator('[lang]:not([aria-hidden="true"] *)').filter({ hasText: author }), "he");
    await expect(readerPage.frameLocator("iframe").first().getByRole("heading", { name: "Original English chapter", exact: true })).toBeVisible();
    await exposeReaderController(readerPage);
    const sourceContext = await readerPage.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const root = document.querySelector("iframe")?.contentDocument?.documentElement;
      return {
        progression: controller.snapshot().pageProgressionDirection,
        lang: root?.getAttribute("lang"),
        xmlLang: root?.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang"),
        dir: root?.getAttribute("dir"),
      };
    });
    expect(sourceContext).toEqual({ progression: "ltr", lang: null, xmlLang: null, dir: null });
    await readerPage.mouse.move(10, 10);
    await readerPage.getByRole("button", { name: "Book details", exact: true }).click();
    await check(readerPage.getByRole("heading", { name: title, exact: true }), "ar");
    await check(readerPage.locator("aside p").filter({ hasText: author }), "he");
    await readerPage.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
    await readerPage.getByRole("tab", { name: "Metadata", exact: true }).click();
    await check(readerPage.locator("td span").filter({ hasText: title }), "ar");
    await check(readerPage.getByText(alternate, { exact: true }), "fa");
  } finally {
    await context.close();
  }
});

test("Book Details shows archive file size and compact descriptions in reader and Library (#156/#159)", async () => {
  const { context, readerPage, libraryPage } = await launchReader(book);
  try {
    await exposeReaderController(readerPage);
    const fileSize = fs.statSync(book).size;
    expect(await readerPage.evaluate(async () =>
      (await Reflect.get(window, "__readerController").getBookDetails()).fileSizeBytes,
    )).toBe(fileSize);
    await readerPage.mouse.move(350, 2);
    const contents = readerPage.getByRole("button", { name: "Contents", exact: true });
    await expect(contents).toHaveText("Contents");
    await contents.click();
    const hideContents = readerPage.getByRole("button", { name: "Hide contents", exact: true });
    await expect(hideContents).toHaveText("Contents");
    await hideContents.click();
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
