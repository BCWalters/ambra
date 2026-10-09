import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function publication(directory: string, pairDirection?: "ltr" | "rtl"): string {
  const source = path.join(directory, "source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(
    path.join(source, "META-INF/container.xml"),
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const directives = ["", ",initial-scale=5", ",user-scalable=no", ",maximum-scale=1.1"];
  const extension = (index: number) => (pairDirection && index % 2 ? "svg" : "xhtml");
  fs.writeFileSync(
    path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:fixed-layout-zoom:${pairDirection ?? "single"}</dc:identifier><dc:title>3.1.6 Fixed-layout page zoom ${pairDirection ?? "single"}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-09T00:00:00Z</meta><meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">${pairDirection ? "both" : "none"}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${directives.map((_, i) => `<item id="p${i}" href="p${i}.${extension(i)}" media-type="${extension(i) === "svg" ? "image/svg+xml" : "application/xhtml+xml"}"/>`).join("")}</manifest><spine page-progression-direction="${pairDirection ?? "ltr"}">${directives.map((_, i) => `<itemref idref="p${i}"/>`).join("")}</spine></package>`,
  );
  fs.writeFileSync(
    path.join(source, "EPUB/nav.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${directives.map((_, i) => `<li><a href="p${i}.${extension(i)}">Page ${i + 1}</a></li>`).join("")}</ol></nav></body></html>`,
  );
  directives.forEach((directive, i) =>
    fs.writeFileSync(
      path.join(source, `EPUB/p${i}.${extension(i)}`),
      extension(i) === "svg"
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><title>Page ${i + 1}</title><rect width="600" height="900" fill="white"/><text x="100" y="220" style="font:40px sans-serif">Actual SVG artwork</text></svg>`
        : `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${i + 1}</title><meta name="viewport" content="width=900,height=600${directive}"/><style>body{margin:0;background:#fff}h1{position:absolute;left:100px;top:200px;font:40px sans-serif}p{position:absolute;left:600px;top:480px}</style></head><body><h1>Actual page artwork</h1><p>Far corner ${i + 1}</p></body></html>`,
    ),
  );
  const book = path.join(directory, `3.1.6-fixed-layout-zoom-${pairDirection ?? "single"}.epub`);
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "EPUB"], { cwd: source });
  return book;
}

async function geometry(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return (
      c?.host && !c.isLoadInFlight && !c.isTurningPage && !c.isApplyingLayout && !c.pendingLayout
    );
  });
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const doc: Document = c.primaryContentDocument();
    const frame = [...document.querySelectorAll("iframe")].find(
      (frame) => frame.contentDocument === doc,
    )!;
    const bounds = frame.getBoundingClientRect();
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector("h1")!);
    const text = range.getBoundingClientRect();
    return {
      index: c.snapshot().spineIndex,
      hostIndices: c.host.spineIndices,
      title: doc.title,
      zoom: c.snapshot().fixedZoom,
      logicalWidth: frame.clientWidth,
      logicalHeight: frame.clientHeight,
      paintedTextWidth: (text.width * bounds.width) / frame.clientWidth,
      paintedTextHeight: (text.height * bounds.height) / frame.clientHeight,
      pageWidth: bounds.width,
      pageHeight: bounds.height,
      scrollLeft: c.host.element.scrollLeft,
      scrollTop: c.host.element.scrollTop,
      toolbarWidth: document.querySelector("[data-ambra-page-band]")?.getBoundingClientRect().width,
    };
  });
}

for (const original of [false, true]) {
  test(`${original ? "original W3C viewport declarations" : "3.1.6 viewport declarations"} allow actual iframe-focused page magnification (#380)`, async () => {
    const info = test.info();
    const originalPath = process.env.AMBRA_VIEWPORT_META_EPUB;
    test.skip(
      original && !originalPath,
      "Set AMBRA_VIEWPORT_META_EPUB to the original assessment EPUB.",
    );
    const book = original ? originalPath! : publication(info.outputPath("fixture"));
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 600, height: 800 },
    });
    try {
      await exposeReaderController(page);
      const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));
      let fittedWidth: number | undefined;
      for (let index = 0; index < 4; index++) {
        await page.evaluate((i) => {
          const c = Reflect.get(window, "__readerController");
          return c.goToNavPoint(c.navigation.toc.items[i]);
        }, index);
        await expect.poll(async () => (await geometry(page)).index).toBe(index);
        const fitted = await geometry(page);
        expect(fitted.index).toBe(index);
        expect(fitted.logicalWidth).toBe(900);
        expect(fitted.logicalHeight).toBe(600);
        fittedWidth ??= fitted.pageWidth;
        expect(fitted.pageWidth).toBeCloseTo(fittedWidth, 0);
        await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
        await page.keyboard.press(`${mod}+Equal`);
        await expect
          .poll(async () => (await geometry(page)).paintedTextWidth)
          .toBeGreaterThan(fitted.paintedTextWidth * 1.2);
        const magnified = await geometry(page);
        expect(magnified.paintedTextHeight / fitted.paintedTextHeight).toBeCloseTo(1.25, 2);
        expect(magnified.index).toBe(index);
        expect(magnified.toolbarWidth).toBe(fitted.toolbarWidth);
        await page.keyboard.press(`${mod}+Minus`);
        await expect.poll(async () => (await geometry(page)).zoom).toBe(1);
        await page.keyboard.press(`${mod}+Shift+Equal`);
        await expect.poll(async () => (await geometry(page)).zoom).toBeCloseTo(1.25, 3);
        await page.keyboard.press(`${mod}+Digit0`);
        await expect
          .poll(async () => (await geometry(page)).pageWidth)
          .toBeCloseTo(fitted.pageWidth, 0);
      }
    } finally {
      await context.close();
    }
  });
}

test("3.1.6 book options, shell shortcuts, anchored pinch, panning and resize retain zoom without page turns (#380)", async () => {
  const { context, readerPage: page } = await launchReader(
    publication(test.info().outputPath("fixture")),
    { viewport: { width: 1200, height: 800 } },
  );
  try {
    await exposeReaderController(page);
    const fitted = await geometry(page);
    await page.mouse.move(350, 2);
    await page.getByRole("button", { name: "Text and page options", exact: true }).click();
    const zoomIn = page.getByRole("menuitem", { name: "Zoom in", exact: true });
    await zoomIn.click();
    await zoomIn.click();
    expect((await geometry(page)).zoom).toBeCloseTo(1.5625);
    await page.getByRole("menuitem", { name: "Zoom out", exact: true }).click();
    expect((await geometry(page)).zoom).toBeCloseTo(1.25);
    await page.getByRole("menuitem", { name: "Fit to window", exact: true }).click();
    expect((await geometry(page)).pageWidth).toBeCloseTo(fitted.pageWidth, 0);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      c.setFixedZoom(4);
      c.restoreContentFocus();
    });
    const magnified = await geometry(page);
    await page.mouse.move(600, 400);
    await page.mouse.wheel(110, 140);
    await expect
      .poll(async () => (await geometry(page)).scrollTop)
      .toBeGreaterThan(magnified.scrollTop + 100);
    const beforeDrag = await geometry(page);
    await page.mouse.down();
    await page.mouse.move(520, 340, { steps: 8 });
    await page.mouse.up();
    const dragged = await geometry(page);
    expect(dragged.scrollLeft).toBeGreaterThan(beforeDrag.scrollLeft + 70);
    expect(dragged.scrollTop).toBeGreaterThan(beforeDrag.scrollTop + 50);
    expect(dragged.index).toBe(0);
    await page.keyboard.press("ArrowDown");
    expect((await geometry(page)).scrollTop).toBeGreaterThan(dragged.scrollTop + 30);
    const anchor = await page.evaluate(() => {
      const doc = Reflect.get(window, "__readerController").primaryContentDocument();
      const frame = [...document.querySelectorAll("iframe")].find(
        (frame) => frame.contentDocument === doc,
      )!;
      const bounds = frame.getBoundingClientRect();
      return {
        x: ((520 - bounds.left) * frame.clientWidth) / bounds.width,
        y: ((340 - bounds.top) * frame.clientHeight) / bounds.height,
      };
    });
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -40);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await geometry(page)).zoom).toBeGreaterThan(4.5);
    const pinched = await geometry(page);
    const anchored = await page.evaluate((point) => {
      const doc = Reflect.get(window, "__readerController").primaryContentDocument();
      const frame = [...document.querySelectorAll("iframe")].find(
        (frame) => frame.contentDocument === doc,
      )!;
      const bounds = frame.getBoundingClientRect();
      return {
        x: bounds.left + (point.x * bounds.width) / frame.clientWidth,
        y: bounds.top + (point.y * bounds.height) / frame.clientHeight,
      };
    }, anchor);
    expect(Math.abs(anchored.x - 520)).toBeLessThanOrEqual(1);
    expect(Math.abs(anchored.y - 340)).toBeLessThanOrEqual(1);
    expect(pinched.paintedTextWidth).toBeGreaterThan(magnified.paintedTextWidth * 1.2);
    await page.setViewportSize({ width: 900, height: 650 });
    await expect.poll(async () => (await geometry(page)).zoom).toBeCloseTo(pinched.zoom, 3);
    expect((await geometry(page)).index).toBe(0);
    await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      return c.goToNavPoint(c.navigation.toc.items[1]);
    });
    expect((await geometry(page)).zoom).toBeCloseTo(pinched.zoom, 3);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.body.focus();
    });
    const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"));
    await page.keyboard.press(`${mod}+Digit0`);
    await expect.poll(async () => (await geometry(page)).zoom).toBe(1);
    const reset = await geometry(page);
    expect(reset.scrollLeft).toBe(0);
    expect(reset.scrollTop).toBe(0);
    expect(reset.index).toBe(1);
  } finally {
    await context.close();
  }
});

for (const direction of ["ltr", "rtl"] as const) {
  test(`3.1.6 ${direction} unequal XHTML/SVG spread magnifies actual artwork with a shared scale and no reload (#380)`, async () => {
    const { context, readerPage: page } = await launchReader(
      publication(test.info().outputPath("fixture"), direction),
      { viewport: { width: 1200, height: 800 } },
    );
    try {
      await exposeReaderController(page);
      const measure = () =>
        page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          const views: readonly { document: Document; spineIndex: number }[] =
            c.contentDocumentViews();
          return views.map((view) => {
            const doc = view.document;
            const frame = [...document.querySelectorAll("iframe")].find(
              (frame) => frame.contentDocument === doc,
            )!;
            const rect = frame.getBoundingClientRect();
            const range = doc.createRange();
            range.selectNodeContents(doc.querySelector("h1,text")!);
            return {
              index: view.spineIndex,
              x: rect.left,
              right: rect.right,
              scale: rect.width / frame.clientWidth,
              paintedTextWidth:
                (range.getBoundingClientRect().width * rect.width) / frame.clientWidth,
              root: doc.documentElement.localName,
            };
          });
        });
      const fitted = await measure();
      expect(fitted).toHaveLength(2);
      expect(fitted.map((frame) => frame.root)).toEqual(["html", "svg"]);
      await page.evaluate(() => {
        Reflect.set(
          window,
          "__zoomDocuments",
          Reflect.get(window, "__readerController").host.contentDocuments(),
        );
        Reflect.get(window, "__readerController").setFixedZoom(2);
      });
      const zoomed = await measure();
      zoomed.forEach((frame, i) => {
        expect(frame.paintedTextWidth / fitted[i]!.paintedTextWidth).toBeCloseTo(2, 2);
        expect(frame.scale).toBeCloseTo(zoomed[0]!.scale, 3);
      });
      const physical = [...zoomed].sort((a, b) => a.x - b.x);
      expect(physical[0]!.right).toBeCloseTo(physical[1]!.x, 0);
      expect(physical.map((frame) => frame.index)).toEqual(direction === "ltr" ? [0, 1] : [1, 0]);
      await page.setViewportSize({ width: 1500, height: 850 });
      await expect.poll(async () => (await geometry(page)).zoom).toBe(2);
      expect(
        await page.evaluate(() => {
          const originals: Document[] = Reflect.get(window, "__zoomDocuments");
          return Reflect.get(window, "__readerController")
            .host.contentDocuments()
            .every((doc: Document, i: number) => doc === originals[i]);
        }),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });
}
