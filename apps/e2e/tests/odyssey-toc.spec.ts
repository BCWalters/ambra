import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchReader } from "../harness.js";

function fixture(directory: string, direction: "ltr" | "rtl"): string {
  const source = path.join(directory, "source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
  const xhtml = (body: string) =>
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Chapter targeting</title></head><body>${body}</body></html>`;
  const entries = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:odyssey-toc-${direction}</dc:identifier><dc:title>Chapter targeting</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="${direction}"><itemref idref="first"/><itemref idref="second"/></spine></package>`,
    "EPUB/nav.xhtml": xhtml('<nav epub:type="toc"><ol><li><a href="first.xhtml">BOOK I</a></li><li><a href="second.xhtml#chapter">BOOK II</a></li><li><a href="second.xhtml#chap02">Empty heading anchor</a></li></ol></nav>'),
    "EPUB/first.xhtml": xhtml("<h2>BOOK I</h2><p>A short opening chapter allows a merged spread with the next chapter.</p>"),
    // Match Gutenberg's wrapper/empty-anchor structure, without copying its text.
    "EPUB/second.xhtml": xhtml(`<div class="chapter" id="chapter"><h2><a id="chap02"></a>BOOK II</h2>${Array.from({ length: 90 }, (_, index) => `<p>Paragraph ${index + 1}. ${"This original test passage makes the chapter span many pages. ".repeat(6)}</p>`).join("")}</div>`),
  };
  for (const [name, content] of Object.entries(entries)) {
    fs.writeFileSync(path.join(source, name), content);
  }
  const book = path.join(directory, "odyssey-structure.epub");
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "EPUB"], { cwd: source });
  return book;
}

async function openTocEntry(page: Page, title: string) {
  await page.mouse.move(350, 2);
  await page.getByRole("button", { name: "Show contents", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Table of contents" });
  await navigation.getByRole("button")
    .filter({ has: page.locator("span").filter({ hasText: new RegExp(`^${title}$`) }) }).click();
  await expect(navigation).not.toBeVisible();
}

async function paintedChapterHeading(page: Page): Promise<boolean> {
  return page.evaluate(() => Array.from(document.querySelectorAll("iframe")).some(frame => {
    const doc = frame.contentDocument;
    const heading = Array.from(doc?.querySelectorAll("h2") ?? [])
      .find(element => element.textContent?.trim() === "BOOK II");
    if (!heading || !doc || !frame.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const range = doc.createRange();
    range.selectNodeContents(heading);
    const rect = range.getBoundingClientRect();
    const box = frame.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    // Hit-testing in both documents excludes translated-away text, clipping,
    // transparent staging hosts, and offscreen pagination-estimator frames.
    return rect.width > 0 && rect.height > 0 && [rect.top + 1, rect.bottom - 1].every(y =>
      heading.contains(doc.elementFromPoint(x, y)) &&
      document.elementFromPoint(box.left + x, box.top + y) === frame,
    );
  }));
}

for (const { width, direction } of [
  { width: 900, direction: "ltr" },
  { width: 1400, direction: "ltr" },
  { width: 1400, direction: "rtl" },
] as const) {
  test(`BOOK II container and empty TOC anchors show the first page (${width}px ${direction}, #152)`, async () => {
    const book = fixture(test.info().outputPath("fixture"), direction);
    const { context, readerPage } = await launchReader(book, { viewport: { width, height: 900 } });
    try {
      await readerPage.emulateMedia({ reducedMotion: "reduce" });
      for (const title of ["BOOK II", "Empty heading anchor", "BOOK II"]) {
        await openTocEntry(readerPage, title);
        await expect.poll(() => paintedChapterHeading(readerPage)).toBe(true);
        // Navigate away so the next click also exercises repositioning an
        // already-open chapter, rather than merely checking its retained DOM.
        for (let turn = 0; turn < 3; turn++) {
          await readerPage.keyboard.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight");
          await readerPage.waitForTimeout(350);
        }
        await expect.poll(() => paintedChapterHeading(readerPage)).toBe(false);
      }
    } finally {
      await context.close();
    }
  });
}

const realBook = process.env.AMBRA_ODYSSEY_BOOK;
test("published Gutenberg Odyssey BOOK II opens at its heading (#152)", async () => {
  test.skip(!realBook || !fs.existsSync(realBook), "Set AMBRA_ODYSSEY_BOOK to a local Gutenberg #1727 EPUB3.");
  const { context, readerPage } = await launchReader(realBook!);
  try {
    await openTocEntry(readerPage, "BOOK II");
    await expect.poll(() => paintedChapterHeading(readerPage)).toBe(true);
  } finally {
    await context.close();
  }
});
