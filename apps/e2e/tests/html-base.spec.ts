import { expect, test, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function fixture(info: TestInfo, layout: string, base = "../assets/"): string {
  const files: Record<string, string> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:html-base:${layout}:${base}</dc:identifier><dc:title>HTML base</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-09T00:00:00Z</meta><meta property="rendition:layout">${layout}</meta><meta property="rendition:spread">none</meta></metadata><manifest>
      <item id="nav" href="nav/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>
      <item id="next" href="text/next.xhtml" media-type="application/xhtml+xml"/>
      <item id="image" href="assets/image%20one.svg" media-type="image/svg+xml"/>
      <item id="main" href="assets/main.css" media-type="text/css"/>
      <item id="child-css" href="assets/nested/child.css" media-type="text/css"/>
      <item id="frame" href="assets/child.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine><itemref idref="chapter"/><itemref idref="next"/></spine></package>`,
    "EPUB/nav/nav.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title><base href="../text/"/></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Base chapter</a></li><li><a href="next.xhtml#target">Base destination</a></li></ol></nav></body></html>',
    "EPUB/text/chapter.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>HTML base</title><meta name="viewport" content="width=600,height=800"/>
      <base target="_blank"/><base href="${base}"/><base href="https://ignored-base.invalid/"/>
      <link rel="stylesheet" href="main.css"/>
      <style>.box{width:64px;height:48px}#inline{background-image:url("image%20one.svg")}</style></head><body id="base-content">
      <h1>Base resources</h1><img id="image" src="image%20one.svg" srcset="image%20one.svg 1x" alt="Base image"/>
      <div id="linked" class="box"/><div id="inline" class="box"/><div id="attribute" class="box" style="background-image:url('image%20one.svg')"/>
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><image id="svg-image" href="image%20one.svg" width="64" height="48"/></svg>
      <object id="object" data="image%20one.svg" width="64" height="48">Image fallback</object>
      <iframe id="child" src="child.xhtml" width="180" height="60"/>
      <p><a id="next-link" href="../text/next.xhtml#target">Go to base destination</a></p>
      </body></html>`,
    "EPUB/text/next.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Destination</title><meta name="viewport" content="width=600,height=800"/></head><body><h1 id="target">Base destination reached</h1></body></html>',
    "EPUB/assets/image one.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="green"/></svg>',
    "EPUB/assets/main.css": '@import "nested/child.css";',
    "EPUB/assets/nested/child.css": '#linked{background-image:url("../image%20one.svg");border-left:7px solid green}',
    "EPUB/assets/child.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Child base</title><base href="./"/></head><body><img id="child-image" src="image%20one.svg" width="64" height="48"/></body></html>',
  };
  const target = info.outputPath("html-base.epub");
  fs.writeFileSync(target, zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  ), { level: 0 }));
  return target;
}

for (const layout of ["reflowable", "pre-paginated", "roll"]) {
  test(`${layout}: HTML bases resolve resources, nested CSS/documents and real reader navigation`, async ({ browserName: _browserName }, info) => {
    const { context, readerPage: page } = await launchReader(fixture(info, layout));
    try {
      await exposeReaderController(page);
      if (layout === "roll") await expect(page.locator("[data-ambra-roll]")).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document | undefined = controller.contentDocumentViews()
          .find((view: { document: Document }) => view.document.getElementById("base-content"))?.document;
        return (doc?.getElementById("image") as HTMLImageElement | null)?.naturalWidth;
      })).toBe(64);
      const state = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document = controller.contentDocumentViews()
          .find((view: { document: Document }) => view.document.getElementById("base-content")).document;
        const backgrounds = [];
        for (const id of ["linked", "inline", "attribute"]) {
          const style = doc.defaultView!.getComputedStyle(doc.getElementById(id)!);
          const url = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
          if (!url) throw new Error(`Missing base-aware background: ${id}`);
          const image = doc.createElement("img");
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error(`Base-aware background did not decode: ${id}`));
            image.src = url;
          });
          backgrounds.push(image.naturalWidth);
        }
        const frame = doc.getElementById("child") as HTMLIFrameElement;
        const childSource = await (await fetch(frame.src)).text();
        return {
          backgrounds, base: doc.querySelector("base")?.outerHTML ?? null,
          border: doc.defaultView!.getComputedStyle(doc.getElementById("linked")!).borderLeftWidth,
          svg: doc.getElementById("svg-image")?.getAttribute("href"),
          object: (doc.getElementById("object") as HTMLImageElement)?.naturalWidth,
          srcset: doc.getElementById("image")?.getAttribute("srcset"),
          childSource, childSandbox: frame.getAttribute("sandbox"),
          href: doc.getElementById("next-link")?.getAttribute("href"),
          toc: controller.navigation.toc.items.map((item: { path: string }) => item.path),
        };
      });
      expect(state.backgrounds).toEqual([64, 64, 64]);
      expect(state.border).toBe("7px");
      expect(state.base).toBeNull();
      expect(state.svg).toMatch(/^blob:/);
      expect(state.object).toBe(64);
      expect(state.srcset).toMatch(/^blob:.* 1x$/);
      expect(state.childSandbox).toBe("");
      expect(state.childSource).toContain('src="data:image/svg+xml;base64,');
      expect(state.childSource).not.toContain("<base");
      expect(state.href).toBe("/EPUB/text/next.xhtml#target");
      expect(state.toc).toEqual(["EPUB/text/chapter.xhtml", "EPUB/text/next.xhtml"]);
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document = controller.contentDocumentViews()
          .find((view: { document: Document }) => view.document.getElementById("base-content")).document;
        (doc.getElementById("next-link") as HTMLAnchorElement).click();
      });
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex)).toBe(1);
    } finally {
      await context.close();
    }
  });
}

for (const base of ["https://blocked-base.invalid/assets/", "file:///private/ambra-base/"]) {
  test(`HTML base ${base} stays unavailable without leaking automatic requests or aborting text`, async ({ browserName: _browserName }, info) => {
    const dispatched: string[] = [];
    const { context, readerPage: page } = await launchReader(fixture(info, "reflowable", base), {
      beforeBookImport: async library => {
        await library.context().route("**/*base.invalid/**", route => {
          dispatched.push(route.request().url());
          return route.abort();
        });
      },
    });
    try {
      await exposeReaderController(page);
      const state = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document = controller.contentDocumentViews()[0].document;
        return {
          text: doc.body.textContent, base: doc.querySelector("base"),
          image: doc.getElementById("image")?.getAttribute("src"),
          srcset: doc.getElementById("image")?.getAttribute("srcset"),
          frame: doc.getElementById("child")?.getAttribute("src"),
          style: doc.querySelector('link[rel="stylesheet"]')?.getAttribute("href"),
          href: doc.getElementById("next-link")?.getAttribute("href"),
          blocked: doc.getElementById("next-link")?.getAttribute("data-ambra-blocked-link"),
          severity: controller.snapshot().errorSeverity,
        };
      });
      expect(state.text).toContain("Base resources");
      expect(state.base).toBeNull();
      expect([state.image, state.srcset, state.frame, state.style]).toEqual([null, null, null, null]);
      expect(state.severity).not.toBe("blocking");
      expect(dispatched).toEqual([]);
      if (base.startsWith("file:")) expect(state.blocked).toBe("file");
      else expect(state.href).toBe("https://blocked-base.invalid/text/next.xhtml#target");
    } finally {
      await context.close();
    }
  });
}
