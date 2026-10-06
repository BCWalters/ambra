import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function fixture(info: TestInfo, layout: string): string {
  const source = info.outputPath("primary-order-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:primary-order:${layout}</dc:identifier>
    <dc:title>Primary reading order</dc:title><dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-10-06T00:00:00Z</meta><meta property="rendition:layout">${layout}</meta></metadata>
    <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${Array.from({ length: 5 }, (_, index) => `<item id="c${index}" href="c${index}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest>
    <spine>${Array.from({ length: 5 }, (_, index) => `<itemref idref="c${index}" linear="${index % 2 === 0 ? "no" : "yes"}"/>`).join("")}</spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
    <body><nav epub:type="toc"><ol>${Array.from({ length: 5 }, (_, index) =>
      `<li><a href="c${index}.xhtml">Item ${index}</a></li>`).join("")}</ol></nav></body></html>`);
  for (let index = 0; index < 5; index++) {
    fs.writeFileSync(path.join(source, `EPUB/c${index}.xhtml`),
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Item ${index}</title>
      <meta name="viewport" content="width=400,height=800"/></head><body data-primary-item="${index}">
      <h1 id="target">Item ${index}</h1><p>${index % 2 ? "Primary content." : "Supplemental content."}</p>
      ${index === 1 ? '<a id="supplement" href="c2.xhtml#target">Open supplement</a>' : ""}</body></html>`);
  }
  const target = info.outputPath("primary-order.epub");
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: source });
  return target;
}

async function state(page: Page) {
  return page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    const snapshot = controller.snapshot();
    return {
      current: snapshot.spineIndex,
      visible: controller.contentDocumentViews().map((view: { spineIndex: number }) => view.spineIndex),
      pages: snapshot.bookPageCount,
      currentPage: snapshot.bookPageIndex,
      firstPath: snapshot.firstSpinePath,
      error: snapshot.error,
    };
  });
}

for (const layout of ["reflowable", "pre-paginated", "roll"]) {
  test(`primary order skips supplements and preserves direct links and resume in ${layout}`, async ({
    page: unusedPage,
  }, info) => {
    void unusedPage;
    const { context, readerPage: page } = await launchReader(fixture(info, layout), {
      viewport: { width: 600, height: 700 },
    });
    try {
      await exposeReaderController(page);
      await expect.poll(async () => (await state(page)).current).toBe(1);
      await expect.poll(async () => (await state(page)).pages).toBe(2);
      expect((await state(page)).firstPath).toBe("EPUB/c1.xhtml");
      expect((await state(page)).visible.every((index: number) => index === 1 || index === 3)).toBe(true);

      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const view = controller.contentDocumentViews().find((view: { spineIndex: number }) => view.spineIndex === 1);
        const button = view.document.querySelector("[data-ambra-boundary]")?.shadowRoot?.querySelector("button");
        if (!button) throw new Error("Primary content boundary is missing");
        button.click();
      });
      await expect.poll(async () => (await state(page)).current).toBe(3);
      await page.evaluate(() => Reflect.get(window, "__readerController").goToChapter(-1));
      await expect.poll(async () => (await state(page)).current).toBe(1);

      await page.getByRole("main").frameLocator("iframe").first().locator("#supplement").click();
      await expect.poll(async () => (await state(page)).current).toBe(2);
      expect((await state(page)).currentPage).toBeUndefined();
      expect((await state(page)).visible).toEqual([2]);
      await page.reload();
      await page.getByRole("main").locator("iframe").first().waitFor();
      await exposeReaderController(page);
      await expect.poll(async () => (await state(page)).current).toBe(2);

      await page.evaluate(() => Reflect.get(window, "__readerController").goToChapter(1));
      await expect.poll(async () => (await state(page)).current).toBe(3);
      await page.evaluate(() => Reflect.get(window, "__readerController").goToChapter(1));
      expect((await state(page)).current).toBe(3);
      await page.evaluate(() => Reflect.get(window, "__readerController").seekToFraction(0));
      await expect.poll(async () => (await state(page)).current).toBe(1);
      await page.evaluate(() => Reflect.get(window, "__readerController").seekToFraction(1));
      await expect.poll(async () => (await state(page)).current).toBe(3);
      expect((await state(page)).error).toBeUndefined();
    } finally {
      await context.close();
    }
  });
}
