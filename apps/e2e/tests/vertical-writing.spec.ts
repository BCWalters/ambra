import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import { launchReader } from "../harness.js";
import { exposeReaderController, isReaderElementPainted } from "../reader-controller.js";

async function dismissChrome(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    for (const frame of document.querySelectorAll("iframe")) {
      const doc = frame.contentDocument;
      if (!doc || !frame.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const box = frame.getBoundingClientRect();
      for (const fraction of [0.5, 0.3, 0.7]) {
        const x = frame.clientWidth / 2;
        const y = frame.clientHeight * fraction;
        const element = doc.elementFromPoint(x, y);
        if (!element || element.closest("a, button, input, textarea, select, summary, img, svg, video, audio, [contenteditable], [role=button]")) continue;
        const screen = { x: box.left + x * box.width / frame.clientWidth, y: box.top + y * box.height / frame.clientHeight };
        if (document.elementFromPoint(screen.x, screen.y) === frame) return screen;
      }
    }
    throw new Error("No visible non-interactive content point for dismissing reader chrome.");
  });
  await page.mouse.click(point.x, point.y);
}

function publication(info: TestInfo, mode: string, fixed = false): string {
  const text = "\u65e5\u672c\u8a9e\u306e\u7e26\u66f8\u304d\u3002\u4e2d\u6587\u6392\u7248\u6e2c\u8a66\u3002";
  const paragraphs = Array.from({ length: fixed ? 1 : 40 }, (_, index) =>
    `<p id="p${index}"><span id="text${index}">${text[0]}</span>${text.repeat(15)}<ruby>\u6f22<rt>\u304b\u3093</rt></ruby><span style="text-emphasis:filled sesame">${text}</span><span style="writing-mode:horizontal-tb;display:inline-block">ABC 123</span><a href="#text${fixed ? 0 : 30}">Target</a></p>`).join("");
  const entries = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    "EPUB/package.opf": strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:vertical-original</dc:identifier><dc:title>Original vertical writing</dc:title><dc:language>ja</dc:language>${fixed ? '<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">none</meta>' : ""}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="image" href="image.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="one"/></spine></package>`),
    "EPUB/nav.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Vertical chapter</a></li></ol></nav></body></html>'),
    "EPUB/one.xhtml": strToU8(`<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja" lang="ja" style="writing-mode:${mode}"><head><title>Vertical chapter</title>${fixed ? '<meta name="viewport" content="width=600,height=600"/>' : ""}<style>body{height:560px;padding-top:20px;box-sizing:border-box;font-family:"Noto Serif CJK JP",serif}p{margin:0 20px}img{width:40px;height:40px}</style></head><body>${paragraphs}<p id="imagePara"><img id="vertical-image" src="image.svg" alt="Original red square"/></p></body></html>`),
    "EPUB/image.svg": strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>'),
  };
  const file = info.outputPath(`original-${mode}.epub`);
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  return file;
}

for (const mode of ["vertical-rl", "vertical-lr"]) {
  test(`${mode} native scroll restores a painted CFI target and tracks horizontal reading movement (#333)`, async ({ browserName: _browserName }, info) => {
    const { context, readerPage: page } = await launchReader(publication(info, mode), { viewport: { width: 600, height: 720 } });
    try {
      await exposeReaderController(page);
      await page.evaluate(async () => { await Reflect.get(window, "__readerController").setViewMode("scroll"); });
      const result = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const before = controller.currentReadingCfi();
        await controller.goToBookmark("epubcfi(/6/2!/4/62[p30]/2[text30]/1:0)");
        const doc = controller.contentDocumentViews()[0].document as Document;
        const root = doc.scrollingElement!;
        const target = doc.getElementById("p30")!;
        const box = target.getBoundingClientRect();
        const glyph = doc.getElementById("text30")!;
        const glyphRange = doc.createRange();
        glyphRange.selectNodeContents(glyph);
        await controller.flushProgress(true);
        return {
          before, after: controller.currentReadingCfi(), error: controller.snapshot().error,
          left: box.left, right: box.right, width: doc.documentElement.clientWidth,
          scrollLeft: root.scrollLeft, scrollWidth: root.scrollWidth,
          mode: doc.defaultView!.getComputedStyle(doc.documentElement).writingMode,
          progress: (await controller.library.getProgress(controller.bookId))?.cfi,
          glyph: glyphRange.getBoundingClientRect().toJSON(),
          fontFamily: doc.defaultView!.getComputedStyle(glyph).fontFamily,
        };
      });
      await info.attach("vertical-restoration", { body: JSON.stringify(result), contentType: "application/json" });
      expect(result.error).toBeUndefined();
      expect(result.mode).toBe(mode);
      expect(result.glyph.height, "CJK font must supply a readable vertical glyph advance").toBeGreaterThan(10);
      expect(result.scrollWidth).toBeGreaterThan(result.width);
      expect(Math.abs(result.scrollLeft)).toBeGreaterThan(0);
      expect(result.right).toBeGreaterThan(0);
      expect(result.left).toBeLessThan(result.width);
      expect(result.after).not.toBe(result.before);
      expect(result.progress).toBe(result.after);
      await dismissChrome(page);
      await expect.poll(() => isReaderElementPainted(page, "text30"), { message: JSON.stringify(result) }).toBe(true);
      const beforeMovement = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc = controller.contentDocumentViews()[0].document as Document;
        return { cfi: controller.currentReadingCfi(), left: doc.scrollingElement!.scrollLeft };
      });
      await page.mouse.move(300, 500);
      await page.mouse.wheel(mode === "vertical-rl" ? -400 : 400, 0);
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi())).not.toBe(beforeMovement.cfi);
      const moved = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        const doc = controller.contentDocumentViews()[0].document as Document;
        const position = controller.host.currentPosition();
        Reflect.set(window, "__verticalMovementPosition", position);
        await controller.flushProgress(true);
        return { cfi: controller.currentReadingCfi(), left: doc.scrollingElement!.scrollLeft,
          progress: (await controller.library.getProgress(controller.bookId))?.cfi };
      });
      expect(Math.abs(moved.left - beforeMovement.left)).toBeGreaterThan(300);
      expect(moved.progress).toBe(moved.cfi);
      await page.setViewportSize({ width: 700, height: 800 });
      await expect.poll(() => page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        return controller.appliedWidth === 700 && controller.appliedHeight === 800 &&
          !controller.isApplyingLayout && !controller.pendingLayout && !controller.isLoadInFlight;
      })).toBe(true);
      const resized = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.flushProgress(true);
        const doc = controller.contentDocumentViews()[0].document as Document;
        const position = Reflect.get(window, "__verticalMovementPosition");
        const range = doc.createRange();
        range.setStart(position.node, position.offset);
        range.setEnd(position.node, position.offset + 1);
        const rect = range.getBoundingClientRect();
        return { cfi: controller.currentReadingCfi(), progress: (await controller.library.getProgress(controller.bookId))?.cfi,
          visible: rect.left >= -1 && rect.right <= doc.documentElement.clientWidth + 1 && rect.bottom > 0 && rect.top < doc.documentElement.clientHeight };
      });
      expect(resized.visible, "the previously read character must remain visible after reflow").toBe(true);
      expect(resized.progress).toBe(resized.cfi);
      const imageState = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.goToBookmark("epubcfi(/6/2!/4/82[imagePara]/2[vertical-image])");
        const doc = controller.contentDocumentViews()[0].document as Document;
        return { cfi: controller.currentReadingCfi(), error: controller.snapshot().error,
          image: doc.getElementById("vertical-image")?.getBoundingClientRect().toJSON(),
          scrollLeft: doc.scrollingElement!.scrollLeft, width: doc.documentElement.clientWidth };
      });
      await dismissChrome(page);
      await expect.poll(() => isReaderElementPainted(page, "vertical-image"), { message: JSON.stringify(imageState) }).toBe(true);
      const saved = await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.flushProgress(true);
        return controller.currentReadingCfi();
      });
      await page.reload();
      await expect(page.getByRole("main").locator("iframe").first()).toBeVisible();
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      await exposeReaderController(page);
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").currentReadingCfi())).toBe(saved);
    } finally { await context.close(); }
  });

  test(`${mode} fixed-layout paints original vertical text and image without reflow (#333)`, async ({ browserName: _browserName }, info) => {
    const { context, readerPage: page } = await launchReader(publication(info, mode, true), { viewport: { width: 700, height: 800 } });
    try {
      await dismissChrome(page);
      await expect.poll(() => isReaderElementPainted(page, "text0")).toBe(true);
      await expect.poll(() => isReaderElementPainted(page, "vertical-image")).toBe(true);
      await page.setViewportSize({ width: 900, height: 700 });
      await dismissChrome(page);
      const geometry = await page.evaluate(() => Array.from(document.querySelectorAll("iframe")).map(frame => {
        const doc = frame.contentDocument;
        const element = doc?.getElementById("text0");
        return { frame: frame.getBoundingClientRect().toJSON(), glyph: element?.getBoundingClientRect().toJSON(),
          scrollTop: doc?.scrollingElement?.scrollTop, scrollLeft: doc?.scrollingElement?.scrollLeft };
      }));
      await expect.poll(() => isReaderElementPainted(page, "text0"), { message: JSON.stringify(geometry) }).toBe(true);
      await expect.poll(() => isReaderElementPainted(page, "vertical-image")).toBe(true);
    } finally { await context.close(); }
  });
}
