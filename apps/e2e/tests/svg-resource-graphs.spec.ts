import { expect, test, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function fixture(info: TestInfo, layout: string, local: boolean | "external-use" | "external-paint" = false): string {
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:svg-resource-graphs:${layout}</dc:identifier><dc:title>SVG resource graphs</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-09T00:00:00Z</meta><meta property="rendition:layout">${layout}</meta><meta property="rendition:spread">none</meta></metadata><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>
      <item id="main" href="art/main.svg" media-type="image/svg+xml"/>
      <item id="child" href="art/parts/child.svg" media-type="image/svg+xml"/>
      <item id="leaf" href="art/leaf.svg" media-type="image/svg+xml"/>
      </manifest><spine><itemref idref="chapter"/></spine></package>`,
    "EPUB/nav.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="text/chapter.xhtml">SVG dependencies</a></li></ol></nav></body></html>',
    "EPUB/text/chapter.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>SVG dependencies</title><meta name="viewport" content="width=600,height=800"/><style>#css{width:80px;height:40px;background-image:url("../art/main.svg")}</style></head><body><h1>Readable SVG chapter</h1><img id="graph" src="../art/main.svg" width="80" height="40" alt="Nested green artwork"/><div id="css"/></body></html>',
    "EPUB/art/main.svg": local === "external-use"
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/><use href="leaf.svg#shape"/></svg>'
      : local === "external-paint"
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="url(leaf.svg#paint) red"/></svg>'
      : local
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/><defs><linearGradient id="paint"><stop stop-color="green"/></linearGradient><rect id="shape" width="80" height="40" fill="url(./main.svg#paint)"/></defs><use href="main.svg#shape"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/><image href="parts/child.svg" width="80" height="40"/></svg>',
    "EPUB/art/parts/child.svg": '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink" width="80" height="40"><image xl:href="../leaf.svg" width="80" height="40"/></svg>',
    "EPUB/art/leaf.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><defs><linearGradient id="paint"><stop stop-color="green"/></linearGradient><rect id="shape" width="80" height="40" fill="green"/></defs><rect width="80" height="40" fill="green"/></svg>',
  };
  const target = info.outputPath("svg-resource-graphs.epub");
  fs.writeFileSync(target, zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  ), { level: 0 }));
  return target;
}

for (const layout of ["reflowable", "pre-paginated", "roll"]) {
  for (const local of [false, true, "external-use", "external-paint"] as const) {
  test(`${layout}: ${local === "external-use" ? "Chromium SVG images retain the background when external use cannot render" : `SVG images and CSS backgrounds paint ${typeof local === "string" ? local : local ? "qualified local use and paint-server references" : "nested packaged dependencies"}`}`, async ({ browserName: _browserName }, info) => {
    const { context, readerPage: page } = await launchReader(fixture(info, layout, local));
    try {
      await exposeReaderController(page);
      const { externalUseHref, ...pixels } = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const document: Document = controller.contentDocumentViews()
          .find((view: { document: Document }) => view.document.getElementById("graph")).document;
        const rendered = document.querySelector<HTMLImageElement>("img#graph");
        if (!rendered) throw new Error("SVG image is unavailable.");
        await rendered.decode();
        const assembled = new DOMParser().parseFromString(await (await fetch(rendered.currentSrc)).text(), "image/svg+xml");
        const externalUseHref = assembled.querySelector("use")?.getAttribute("href");
        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 40;
        const drawing = canvas.getContext("2d")!;
        drawing.drawImage(rendered, 0, 0);
        const direct = [...drawing.getImageData(40, 20, 1, 1).data];
        const css = document.getElementById("css")!;
        const background = document.defaultView!.getComputedStyle(css).backgroundImage;
        const match = /^url\(["']?(.*?)["']?\)$/.exec(background);
        if (!match) throw new Error(`SVG background is unavailable: ${background}`);
        const cssImage = new Image();
        cssImage.src = match[1]!;
        await cssImage.decode();
        drawing.clearRect(0, 0, 80, 40);
        drawing.drawImage(cssImage, 0, 0);
        return { direct, css: [...drawing.getImageData(40, 20, 1, 1).data], externalUseHref };
      });
      const expected = local === "external-use" ? [255, 0, 0, 255] : [0, 128, 0, 255];
      expect(pixels).toEqual({ direct: expected, css: expected });
      if (local === "external-use") expect(externalUseHref).toMatch(/^data:image\/svg\+xml;base64,.*#shape$/);
    } finally {
      await context.close();
    }
  });
  }
}
