import { expect, test, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function fixture(info: TestInfo, layout: string): string {
  const source = info.outputPath("css-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB/styles/nested"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB/images"));
  const write = (file: string, value: string) => fs.writeFileSync(path.join(source, file), value);
  write("mimetype", "application/epub+zip");
  write("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  write("EPUB/package.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:css-resources:${layout}</dc:identifier><dc:title>CSS resources</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-06T00:00:00Z</meta><meta property="rendition:layout">${layout}</meta><meta property="rendition:spread">none</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="css" href="styles/main.css" media-type="text/css"/><item id="child" href="styles/nested/child.css" media-type="text/css"/><item id="image" href="images/a%20b.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
  write("EPUB/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">CSS graph</a></li></ol></nav></body></html>');
  write("EPUB/chapter.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>CSS graph</title><meta name="viewport" content="width=600,height=800"/><link rel="stylesheet" href="styles/main.css"/><style>#inline{background-image:url("images/a%20b.svg")} .box{width:120px;height:100px}</style></head><body><h1>CSS graph</h1><div id="linked" class="box">Nested CSS</div><div id="inline" class="box">Inline CSS</div><div id="attribute" class="box" style="background-image:url('images/a%20b.svg#view')">Style attribute</div><img src="missing.png" alt="Missing resource must not abort this chapter"/></body></html>`);
  write("EPUB/styles/main.css", '@import "nested/child.css" screen; .box{background-size:contain}');
  write("EPUB/styles/nested/child.css", '@import "../main.css"; @import "missing.css"; #linked{background-image:url("../../images/a\\20 b.svg");border-left:7px solid rgb(0,128,0)}');
  write("EPUB/images/a b.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><view id="view" viewBox="0 0 80 60"/><rect width="80" height="60" fill="green"/></svg>');
  const target = info.outputPath("css-resources.epub");
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: source });
  return target;
}

for (const layout of ["reflowable", "pre-paginated", "roll"]) {
  test(`${layout}: resolves linked, nested, inline and attribute CSS without aborting missing resources`, async ({ page: unusedPage }, info) => {
    void unusedPage;
    const { context, readerPage: page } = await launchReader(fixture(info, layout));
    try {
      await exposeReaderController(page);
      const result = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document = controller.contentDocumentViews()[0].document;
        const view = doc.defaultView!;
        const backgrounds = [];
        for (const id of ["linked", "inline", "attribute"]) {
          const element = doc.getElementById(id)!;
          const style = view.getComputedStyle(element);
          const source = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
          if (!source) throw new Error(`Missing CSS image for ${id}: ${style.backgroundImage}`);
          const image = doc.createElement("img");
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error(`CSS image did not decode: ${id}`));
            image.src = source;
          });
          backgrounds.push({ id, source, width: image.naturalWidth, height: image.naturalHeight });
        }
        return {
          backgrounds,
          border: view.getComputedStyle(doc.getElementById("linked")!).borderLeftWidth,
          hasContent: doc.body.textContent?.includes("CSS graph"),
        };
      });
      expect(result.hasContent).toBe(true);
      expect(result.border).toBe("7px");
      expect(result.backgrounds.map(image => [image.width, image.height])).toEqual([
        [80, 60], [80, 60], [80, 60],
      ]);
      expect(result.backgrounds.every(image => image.source.startsWith("blob:"))).toBe(true);
      expect(result.backgrounds[2]?.source).toMatch(/#view$/);
    } finally {
      await context.close();
    }
  });
}
