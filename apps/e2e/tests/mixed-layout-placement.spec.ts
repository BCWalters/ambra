import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function publication(directory: string): string {
  const source = path.join(directory, "source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(
    path.join(source, "META-INF/container.xml"),
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  const properties = [
    "",
    "rendition:layout-reflowable page-spread-left",
    "",
    "rendition:layout-reflowable",
    "page-spread-left",
  ];
  fs.writeFileSync(
    path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:mixed-layout-placement</dc:identifier><dc:title>3.1.7 Mixed-layout clipping and placement</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-09T00:00:00Z</meta><meta property="rendition:layout">pre-paginated</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${properties.map((_, i) => `<item id="p${i}" href="p${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${properties.map((property, i) => `<itemref idref="p${i}" properties="${property}"/>`).join("")}</spine></package>`,
  );
  fs.writeFileSync(
    path.join(source, "EPUB/nav.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${properties.map((_, i) => `<li><a href="p${i}.xhtml">Page ${i + 1}</a></li>`).join("")}</ol></nav></body></html>`,
  );
  for (let i = 0; i < 5; i++) {
    const paragraphs =
      i === 1
        ? Array.from(
            { length: 5 },
            (_, p) =>
              `<p>${Array.from({ length: 100 }, (_, w) => `M${p}_${String(w).padStart(3, "0")}`).join(" ")}</p>`,
          ).join("")
        : `<p>Page ${i + 1}. Preserve this authored mixed-layout item.</p>`;
    fs.writeFileSync(
      path.join(source, `EPUB/p${i}.xhtml`),
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${i + 1}</title><meta name="viewport" content="width=900,height=600"/><style>body{width:1200px;height:600px;max-height:600px;margin:0;overflow:hidden;background:lightpink}p{font:20px monospace;margin:0;padding:0;${i === 1 ? "" : "position:absolute;left:40px;top:80px;width:800px"}}</style></head><body>${paragraphs}</body></html>`,
    );
  }
  const book = path.join(directory, "3.1.7-mixed-layout-placement.epub");
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "EPUB"], { cwd: source });
  return book;
}

async function presentation(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return (
      c?.host && !c.isLoadInFlight && !c.isTurningPage && !c.isApplyingLayout && !c.pendingLayout
    );
  });
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const views: readonly {
      document: Document;
      spineIndex: number;
      physicalSide: string;
      page?: { index: number };
    }[] = c.contentDocumentViews();
    return {
      host: c.host.constructor.name,
      index: c.snapshot().spineIndex,
      pageIndex: c.snapshot().pageIndex,
      pageCount: c.snapshot().pageCount,
      views: views.map((view) => {
        const doc = view.document;
        const frame = [...document.querySelectorAll("iframe")].find(
          (frame) => frame.contentDocument === doc,
        )!;
        const outer = frame.getBoundingClientRect();
        const scale = outer.width / frame.clientWidth;
        const painted: string[] = [];
        const source: string[] = [];
        [...doc.querySelectorAll("body > p")].forEach((paragraph, p) => {
          const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
          let textIndex = 0;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? "";
            for (const match of text.matchAll(/\S+/g)) {
              const token = `${p}:${textIndex}:${match.index}:${match[0]}`;
              source.push(token);
              const range = doc.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              const rect = range.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;
              if (
                rect.width &&
                rect.height &&
                doc.elementFromPoint(x, y)?.closest("p") === paragraph &&
                document.elementFromPoint(outer.left + x * scale, outer.top + y * scale) === frame
              )
                painted.push(token);
            }
            textIndex++;
          }
        });
        const style = doc.defaultView!.getComputedStyle(doc.body);
        return {
          index: view.spineIndex,
          side: view.physicalSide,
          page: view.page?.index,
          x: outer.left,
          width: outer.width,
          painted,
          source,
          bodyWidth: style.width,
          bodyHeight: style.height,
          overflow: style.overflow,
        };
      }),
    };
  });
}

for (const original of [false, true]) {
  test(`${original ? "original W3C" : "3.1.7 source-bound"} mixed layout paints every paragraph with no empty navigable pages (#381)`, async () => {
    const originalPath = process.env.AMBRA_MIXED_LAYOUT_EPUB;
    test.skip(
      original && !originalPath,
      "Set AMBRA_MIXED_LAYOUT_EPUB to the original assessment EPUB.",
    );
    const book = original ? originalPath! : publication(test.info().outputPath("fixture"));
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 1600, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      let previous = "";
      const sequence = [];
      const sourceWords = new Map<number, Set<string>>();
      const paintedWords = new Map<number, Set<string>>();
      let reflowTail = 0;
      for (let step = 0; step < 30; step++) {
        const state = await presentation(page);
        const key = JSON.stringify(state.views.map((view) => [view.index, view.page]));
        if (key === previous) break;
        previous = key;
        for (const view of state.views) {
          sourceWords.set(view.index, new Set(view.source));
          const painted = paintedWords.get(view.index) ?? new Set<string>();
          view.painted.forEach((word) => painted.add(word));
          paintedWords.set(view.index, painted);
        }
        if (state.index === 1) reflowTail = Math.max(reflowTail, state.pageIndex);
        sequence.push({
          host: state.host,
          index: state.index,
          page: state.pageIndex,
          count: state.pageCount,
          views: state.views.map((view) => ({
            ...view,
            source: view.source.length,
            painted: view.painted.length,
          })),
        });
        await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
      }
      await test.info().attach("painted-reading-sequence", {
        body: JSON.stringify(sequence, null, 2),
        contentType: "application/json",
      });
      expect(sequence.every((state) => state.views.some((view) => view.painted > 0))).toBe(true);
      expect([...sourceWords.keys()]).toEqual([0, 1, 2, 3, 4]);
      for (const [index, words] of sourceWords) expect(paintedWords.get(index)).toEqual(words);
      const firstReflow = sequence.find((state) => state.index === 1)!;
      expect(firstReflow.views[0]!.side).toBe("left");
      const tailIndex = sequence.findLastIndex((state) => state.index === 1);
      expect(sequence[tailIndex]!.views).toHaveLength(1);
      expect(sequence[tailIndex]!.views[0]!.side).toBe("left");
      expect(sequence[tailIndex + 1]!.index).toBe(2);
      if (original) expect(sourceWords.get(1)!.size).toBe(595);
      const finalFixed = sequence.at(-1)!.views[0]!;
      expect(finalFixed.index).toBe(4);
      expect(finalFixed.side).toBe("left");
      expect(finalFixed.x + finalFixed.width).toBeLessThanOrEqual(801);
      for (const state of sequence)
        for (const view of state.views) {
          const reflowable = view.index === 1 || view.index === 3;
          expect(view.overflow).toBe(reflowable ? "visible" : "hidden");
          if (!reflowable) expect(view.bodyHeight).toBe("600px");
        }
      for (let step = sequence.length - 2; step >= 0; step--) {
        await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(-1));
        const state = await presentation(page);
        expect(state.views.map((view) => [view.index, view.page])).toEqual(
          sequence[step]!.views.map((view) => [view.index, view.page]),
        );
        expect(state.views.some((view) => view.painted.length > 0)).toBe(true);
      }
      await page.evaluate(async (tail) => {
        const c = Reflect.get(window, "__readerController");
        await c.goToNavPoint(c.navigation.toc.items[1]);
        for (let step = 0; step < tail && c.snapshot().pageIndex < tail; step++) {
          await c.turnPage(1);
        }
        await c.flushProgress();
      }, reflowTail);
      const beforeReload = await presentation(page);
      await page.reload();
      await page.waitForFunction(() => !!document.querySelector("iframe")?.contentDocument?.body);
      await exposeReaderController(page);
      await expect
        .poll(async () => (await presentation(page)).pageIndex)
        .toBe(beforeReload.pageIndex);
      expect(
        (await presentation(page)).views.some(
          (view) => view.index === 1 && view.painted.length > 0,
        ),
      ).toBe(true);
      await page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        return c.goToNavPoint(c.navigation.toc.items[4]);
      });
      await page.evaluate(() => Reflect.get(window, "__readerController").setFixedZoom(1.25));
      await page.setViewportSize({ width: 600, height: 900 });
      await expect.poll(async () => (await presentation(page)).views[0]!.side).toBe("single");
      expect(
        await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().fixedZoom),
      ).toBe(1.25);
      await page.setViewportSize({ width: 1600, height: 900 });
      await expect.poll(async () => (await presentation(page)).views[0]!.side).toBe("left");
      expect((await presentation(page)).views[0]!.index).toBe(4);
      expect(
        await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().fixedZoom),
      ).toBe(1.25);
      await page.evaluate(() => Reflect.get(window, "__readerController").setFixedZoom(1));
      const refitted = (await presentation(page)).views[0]!;
      expect(refitted.x + refitted.width).toBeLessThanOrEqual(801);
    } finally {
      await context.close();
    }
  });
}
