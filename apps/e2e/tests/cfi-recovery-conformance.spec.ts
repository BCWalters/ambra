import { expect, test, type TestInfo } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import fs from "node:fs";
import { launchReader } from "../harness.js";
import { exposeReaderController, isReaderElementPainted } from "../reader-controller.js";

function publication(info: TestInfo): string {
  const paragraphs = Array.from(
    { length: 60 },
    (_, index) =>
      `<p${index === 0 ? ' id="first"' : ""}>Original paragraph ${index + 1}. This original locator fixture supplies enough
    text to verify a real paginated landing rather than only a successful parse.</p>`,
  ).join("");
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "EPUB/package.opf": strToU8(
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:original-cfi-recovery</dc:identifier><dc:title>Original CFI recovery</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
    ),
    "EPUB/nav.xhtml": strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Original chapter</a></li></ol></nav></body></html>',
    ),
    "EPUB/one.xhtml": strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Original chapter</title></head><body>${paragraphs}<p id="target">Original target after inserted paragraphs.</p></body></html>`,
    ),
  };
  const file = info.outputPath("original-cfi-recovery.epub");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  return file;
}

function flowPublication(info: TestInfo): string {
  const entries = unzipSync(fs.readFileSync(publication(info)));
  entries["EPUB/one.xhtml"] = strToU8(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page affinity</title></head><body><p id="flow">${
      "Original readable words for checking exact line and page affinity. ".repeat(180)
    }</p></body></html>`,
  );
  const file = info.outputPath("cfi-page-affinity.epub");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  return file;
}

for (const spread of [false, true]) {
test(`CFI side bias selects the preceding or following natural ${spread ? "spread" : "page"} at a text break (#340)`, async ({ browserName: _browserName }, info) => {
  const { context, readerPage: page } = await launchReader(flowPublication(info), {
    viewport: { width: spread ? 1280 : 600, height: 720 },
  });
  try {
    await exposeReaderController(page);
    await expect.poll(() => page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const primary = controller.host?.primary ?? controller.host;
      return !controller.snapshot().isLoading && primary?.pages?.length > 2;
    })).toBe(true);
    const target = await page.evaluate(spread => {
      const controller = Reflect.get(window, "__readerController");
      const primary = controller.host.primary ?? controller.host;
      const natural = primary.pages.find((candidate: { index: number; startBreak: { node: Node; offset: number } }) =>
        candidate.index > 0 && (!spread || candidate.index % 2 === 0) &&
          candidate.startBreak.node.nodeType === 3 && candidate.startBreak.offset > 0,
      );
      if (!natural) throw new Error("Expected a natural page break within the fixture's single text node.");
      const cfi = controller.locatorResolver.generate(0, natural.startBreak.node, natural.startBreak.offset).cfi as string;
      return { cfi, after: natural.index, before: natural.index - (spread ? 2 : 1) };
    }, spread);
    for (const bias of ["b", "a"] as const) {
      await page.evaluate(async ({ cfi, bias }) => {
        await Reflect.get(window, "__readerController").goToBookmark(cfi.replace(/\)$/, `[;s=${bias}])`));
      }, { cfi: target.cfi, bias });
      const result = await page.evaluate(({ cfi, bias }) => {
        const controller = Reflect.get(window, "__readerController");
        const primary = controller.host.primary ?? controller.host;
        const painted = controller.contentDocumentViews().some((view: { spineIndex: number; document: Document }) => {
          if (view.spineIndex !== 0) return false;
          const doc = view.document;
          const frame = doc.defaultView!.frameElement as HTMLIFrameElement;
          const point = controller.locatorResolver.resolveInDocument({ cfi }, 0, doc);
          const offset = point.characterOffset as number;
          const glyph = doc.createRange();
          glyph.setStart(point.node, bias === "b" ? offset - 1 : offset);
          glyph.setEnd(point.node, bias === "b" ? offset : offset + 1);
          const rect = glyph.getBoundingClientRect();
          const clip = frame.style.clipPath.match(/^inset\(([\d.]+)(?:px)? (?:0|0px) ([\d.]+)(?:px)?(?: (?:0|0px))?\)$/);
          if (!clip) throw new Error(`Expected the native page's explicit paint clip: ${frame.style.clipPath}`);
          return rect.height > 0 && rect.top >= Number(clip[1]) - 1 &&
            rect.bottom <= frame.clientHeight - Number(clip[2]) + 1;
        });
        return {
          index: primary.currentPageIndex, painted,
        };
      }, { cfi: target.cfi, bias });
      expect(result).toEqual({ index: bias === "b" ? target.before : target.after, painted: true });
    }
    const range = await page.evaluate(cfi => {
      const controller = Reflect.get(window, "__readerController");
      const doc = controller.contentDocumentViews()[0].document as Document;
      const point = controller.locatorResolver.resolveInDocument({ cfi }, 0, doc);
      const offset = point.characterOffset as number;
      const rangeCfi = cfi.replace(/:\d+\)$/, `,:${offset}[;s=b],:${offset + 8}[;s=a])`);
      if (rangeCfi === cfi) throw new Error("Expected a generated text offset.");
      const resolved = controller.locatorResolver.resolveRangeInDocument({ cfi: rangeCfi }, 0, doc);
      return {
        start: resolved.range.startOffset, end: resolved.range.endOffset,
        text: resolved.range.toString(), expected: point.node.textContent!.slice(offset, offset + 8),
        offset, sameNode: resolved.range.startContainer === point.node && resolved.range.endContainer === point.node,
      };
    }, target.cfi);
    expect(range).toEqual({
      start: range.offset, end: range.offset + 8, text: range.expected,
      expected: range.expected, offset: range.offset, sameNode: true,
    });
  } finally {
    await context.close();
  }
});
}

test("CFI side bias restores the preceding or following native scroll line (#340)", async ({ browserName: _browserName }, info) => {
  const { context, readerPage: page } = await launchReader(flowPublication(info));
  try {
    await exposeReaderController(page);
    await page.evaluate(async () => {
      await Reflect.get(window, "__readerController").setViewMode("scroll");
    });
    await expect.poll(() => page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      return !controller.snapshot().isLoading && controller.host?.engine?.measuredChunks.length > 20;
    })).toBe(true);
    const target = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const chunks = controller.host.engine.measuredChunks;
      const index = chunks.findIndex((chunk: { breakBefore: { node: Node; offset: number } }, index: number) =>
        index >= 20 && chunk.breakBefore.node.nodeType === 3 && chunk.breakBefore.offset > 0,
      );
      if (index === -1) throw new Error("Expected a measured text-line boundary.");
      const boundary = chunks[index].breakBefore;
      return {
        cfi: controller.locatorResolver.generate(0, boundary.node, boundary.offset).cfi as string,
        before: chunks[index - 1].top as number, after: chunks[index].top as number,
      };
    });
    for (const bias of ["b", "a"] as const) {
      await page.evaluate(async ({ cfi, bias }) => {
        await Reflect.get(window, "__readerController").goToBookmark(cfi.replace(/\)$/, `[;s=${bias}])`));
      }, { cfi: target.cfi, bias });
      const result = await page.evaluate(({ cfi, bias }) => {
        const controller = Reflect.get(window, "__readerController");
        const doc = controller.host.element.contentDocument as Document;
        const point = controller.locatorResolver.resolveInDocument({ cfi }, 0, doc);
        const offset = point.characterOffset as number;
        const glyph = doc.createRange();
        glyph.setStart(point.node, bias === "b" ? offset - 1 : offset);
        glyph.setEnd(point.node, bias === "b" ? offset : offset + 1);
        const rect = glyph.getBoundingClientRect();
        return {
          top: doc.scrollingElement!.scrollTop,
          painted: rect.height > 0 && rect.top >= -1 && rect.bottom <= doc.documentElement.clientHeight + 1,
        };
      }, { cfi: target.cfi, bias });
      expect(Math.abs(result.top - (bias === "b" ? target.before : target.after))).toBeLessThanOrEqual(1);
      expect(result.painted).toBe(true);
    }
  } finally {
    await context.close();
  }
});

test("CFI affinity at inline SVG text edges remains on the painted graphic (#340)", async ({ browserName: _browserName }, info) => {
  const entries = unzipSync(fs.readFileSync(publication(info)));
  const chapter = new TextDecoder().decode(entries["EPUB/one.xhtml"]!);
  entries["EPUB/one.xhtml"] = strToU8(chapter.replace('<p id="target">',
    '<svg id="inline" xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="green"/><text x="20" y="80">Words</text></svg><p id="target">'));
  const file = info.outputPath("inline-svg-cfi-affinity.epub");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  const { context, readerPage: page } = await launchReader(file, { viewport: { width: 600, height: 720 } });
  try {
    await exposeReaderController(page);
    const cfis = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const doc = (await controller.contentLoader.loadSpineDocument(0)).document as Document;
      const text = doc.querySelector("#inline text")!.firstChild!;
      return [0, 5].map(offset => controller.locatorResolver.generate(0, text, offset).cfi as string);
    });
    for (const [index, bias] of ["b", "a"].entries()) {
      await page.evaluate(async ({ cfi, bias }) => {
        await Reflect.get(window, "__readerController").goToBookmark(cfi.replace(/\)$/, `[;s=${bias}])`));
      }, { cfi: cfis[index]!, bias });
      await expect.poll(() => isReaderElementPainted(page, "inline")).toBe(true);
      const retained = await page.evaluate(() => {
        const point = Reflect.get(window, "__readerController").nativeReading.retainedForShell();
        return { id: point?.node.id, offset: point?.offset };
      });
      expect(retained).toEqual({ id: "inline", offset: 0 });
    }
  } finally {
    await context.close();
  }
});

test("image-alt CFI offsets navigate to a painted image and retain exact semantic offsets (#340)", async ({ browserName: _browserName }, info) => {
  const entries = unzipSync(fs.readFileSync(publication(info)));
  const chapter = new TextDecoder().decode(entries["EPUB/one.xhtml"]!);
  expect(chapter).toContain('<p id="target">');
  const src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="green"/></svg>')}`;
  entries["EPUB/one.xhtml"] = strToU8(chapter.replace('<p id="target">',
    `<img id="illustration" width="200" height="200" alt="A&#x1f600;Z alternative illustration" src="${src}"/><p id="target">`));
  const file = info.outputPath("image-alt-cfi.epub");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  const { context, readerPage: page } = await launchReader(file);
  try {
    await exposeReaderController(page);
    const cfi = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const doc = (await controller.contentLoader.loadSpineDocument(0)).document as Document;
      return controller.locatorResolver.generate(0, doc.getElementById("illustration"), 3).cfi as string;
    });
    await page.evaluate(async cfi => {
      await Reflect.get(window, "__readerController").goToBookmark(cfi);
    }, cfi);
    await expect.poll(() => isReaderElementPainted(page, "illustration")).toBe(true);
    const result = await page.evaluate(cfi => {
      const controller = Reflect.get(window, "__readerController");
      const doc = controller.contentDocumentViews()[0].document as Document;
      const resolved = controller.locatorResolver.resolveInDocument({ cfi }, 0, doc);
      const image = resolved.node as HTMLImageElement;
      return {
        id: image.id, alternativeTextOffset: resolved.alternativeTextOffset,
        childOffset: resolved.characterOffset, alt: image.alt,
        decoded: image.complete && image.naturalWidth === 200,
      };
    }, cfi);
    expect(result).toEqual({
      id: "illustration", alternativeTextOffset: 3, childOffset: undefined,
      alt: "A\u{1f600}Z alternative illustration", decoded: true,
    });
    const rangeBoundaries = await page.evaluate(cfi => {
      const controller = Reflect.get(window, "__readerController");
      const doc = controller.contentDocumentViews()[0].document as Document;
      const rangeCfi = cfi.replace(/:3\)$/, ",:1,:4)");
      if (rangeCfi === cfi) throw new Error("Expected the generated image-alt offset.");
      let failure: string;
      try {
        controller.locatorResolver.resolveRangeInDocument({ cfi: rangeCfi }, 0, doc);
        throw new Error("Nonzero alternative text must not become a DOM range.");
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "LocatorResolutionError") throw error;
        failure = error.message;
      }
      const zero = controller.locatorResolver.resolveRangeInDocument({
        cfi: cfi.replace(/:3\)$/, ",:0,:0)"),
      }, 0, doc).range as Range;
      return {
        failure, start: (zero.startContainer as Element).id, end: (zero.endContainer as Element).id,
        startOffset: zero.startOffset, endOffset: zero.endOffset, collapsed: zero.collapsed,
      };
    }, cfi);
    expect(rangeBoundaries).toEqual({
      failure: expect.stringContaining("alternative-text position"),
      start: "illustration", end: "illustration", startOffset: 0, endOffset: 0, collapsed: true,
    });
  } finally {
    await context.close();
  }
});

test("package CFI assertions recover the intended chapter and reject missing OPF IDs (#340)", async ({ browserName: _browserName }, info) => {
  const entries = unzipSync(fs.readFileSync(publication(info)));
  const opf = new TextDecoder().decode(entries["EPUB/package.opf"]!);
  expect(opf).toContain('<spine><itemref idref="one"/></spine>');
  entries["EPUB/package.opf"] = strToU8(opf
    .replace('<item id="one"', '<item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="one"')
    .replace('<spine><itemref idref="one"/></spine>',
      '<guide/><spine id="reading-order"><itemref id="earlier" idref="two"/><itemref id="later" idref="one"/></spine>'));
  entries["EPUB/two.xhtml"] = strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Earlier chapter</title></head><body><h1>Earlier chapter</h1></body></html>');
  const file = info.outputPath("package-cfi-recovery.epub");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  const { context, readerPage: page } = await launchReader(file);
  try {
    await exposeReaderController(page);
    const recovered = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const resolved = await controller.locatorResolver.resolve({
        cfi: "epubcfi(/8[reading-order]/2[later])",
      });
      return { spineIndex: resolved.spineIndex, title: resolved.node.ownerDocument.title };
    });
    expect(recovered).toEqual({ spineIndex: 1, title: "Original chapter" });
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.goToBookmark("epubcfi(/6[reading-order]/2[later]!/4/122[target]/1:0)");
    });
    await expect.poll(() => isReaderElementPainted(page, "target")).toBe(true);
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.goToBookmark("epubcfi(/8[reading-order]/4[later]!/4/0)");
    });
    await expect.poll(() => isReaderElementPainted(page, "first")).toBe(true);
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.goToBookmark("epubcfi(/8[reading-order]/4[later]!/4/124)");
    });
    await expect.poll(() => isReaderElementPainted(page, "target")).toBe(true);
    const invalid = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      try {
        await controller.locatorResolver.resolve({
          cfi: "epubcfi(/8[missing]/4[later])",
        });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "LocatorResolutionError") throw error;
        return error.message;
      }
      throw new Error("The missing package assertion must fail explicitly.");
    });
    expect(invalid).toContain("CFI package steps do not match any spine item");
  } finally {
    await context.close();
  }
});

test("CFI ID correction reaches the painted target; native ranges, text assertions and bias retain exact boundaries", async ({
  browserName: _browserName,
}, info) => {
  const { context, readerPage: page } = await launchReader(publication(info), {
    viewport: { width: 800, height: 700 },
  });
  try {
    await exposeReaderController(page);
    const cfi = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const doc = (await controller.contentLoader.loadSpineDocument(0)).document as Document;
      const text = doc.getElementById("target")!.firstChild!;
      const original = controller.locatorResolver.generate(0, text, 0).cfi as string;
      const shifted = original.replace(/\/\d+\[target\]/, "/2[target]");
      if (shifted === original) throw new Error("Original fixture must contain a shifted target.");
      await controller.goToBookmark(shifted);
      return { original, shifted };
    });
    await expect.poll(() => isReaderElementPainted(page, "target")).toBe(true);
    const evidence = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const resolver = controller.locatorResolver;
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = '<p id="stable">alpha <em>beta</em> gamma</p>';
      const paragraph = doc.getElementById("stable")!;
      const start = resolver.generate(0, paragraph.firstChild!, 2).cfi as string;
      const end = resolver.generate(0, paragraph.lastChild!, 4).cfi as string;
      const packagePart = start.slice(8, start.indexOf("!"));
      const rangeCfi = `epubcfi(${packagePart}!/4/2[stable],/1:2,/3:4)`;
      const range = resolver.resolveRangeInDocument({ cfi: rangeCfi }, 0, doc);
      const virtual = resolver.resolveRangeInDocument({
        cfi: `epubcfi(${packagePart}!/4,/0,/4)`,
      }, 0, doc);
      const virtualCases = [
        { markup: "leading <p>middle</p> trailing", index: 4 },
        { markup: "<p>middle</p>", index: 4 },
        { markup: "Only text", index: 2 },
        { markup: "", index: 2 },
        { markup: "<!--ignored-->leading <p>middle</p> trailing<!--ignored-->", index: 4 },
      ].map(({ markup, index }) => {
        const provided = document.implementation.createHTMLDocument();
        provided.body.innerHTML = markup;
        const range = resolver.resolveRangeInDocument({
          cfi: `epubcfi(${packagePart}!/4,/0,/${index})`,
        }, 0, provided).range;
        return {
          text: range.toString(),
          startBody: range.startContainer === provided.body,
          endBody: range.endContainer === provided.body,
          start: range.startOffset,
          end: range.endOffset,
        };
      });
      const shifted = document.implementation.createHTMLDocument();
      shifted.body.innerHTML =
        '<p id="stable">Inserted Unique <em>original</em>\n \t target string.</p>';
      const asserted = `epubcfi(${packagePart}!/4/2[stable]/1:16[original ,target;s=a])`;
      const recovered = resolver.resolveInDocument({ cfi: asserted }, 0, shifted);
      const biased = document.implementation.createHTMLDocument();
      biased.body.innerHTML = "<p>before<!--split-->after</p>";
      const before = resolver.resolveInDocument(
        {
          cfi: `epubcfi(${packagePart}!/4/2/1:6[;s=b])`,
        },
        0,
        biased,
      );
      const after = resolver.resolveInDocument(
        {
          cfi: `epubcfi(${packagePart}!/4/2/1:6[;s=a])`,
        },
        0,
        biased,
      );
      const native = await resolver.resolveRange({
        cfi: `epubcfi(${packagePart}!/4/122[target]/1,:0,:8)`,
      });
      return {
        start,
        end,
        rangeCfi,
        rangeText: range.range.toString(),
        virtualText: virtual.range.toString(),
        virtualCases,
        virtualStart: {
          body: virtual.range.startContainer === doc.body, offset: virtual.range.startOffset,
        },
        virtualEnd: {
          body: virtual.range.endContainer === doc.body, offset: virtual.range.endOffset,
        },
        startOffset: range.range.startOffset,
        endOffset: range.range.endOffset,
        sameDocument: range.start.node.ownerDocument === range.end.node.ownerDocument,
        recoveredText: recovered.node.textContent,
        recoveredOffset: recovered.characterOffset,
        expectedOffset: shifted.getElementById("stable")!.lastChild!.textContent!.indexOf("target"),
        before: { text: before.node.textContent, offset: before.characterOffset },
        after: { text: after.node.textContent, offset: after.characterOffset },
        loadedRangeText: native.range.toString(),
        loadedSameDocument: native.start.node.ownerDocument === native.end.node.ownerDocument,
      };
    });
    expect(evidence.rangeText).toBe("pha beta gam");
    expect(evidence.virtualText).toBe("alpha beta gamma");
    expect(evidence.virtualStart).toEqual({ body: true, offset: 0 });
    expect(evidence.virtualEnd).toEqual({ body: true, offset: 1 });
    expect(evidence.virtualCases).toEqual([
      { text: "leading middle trailing", startBody: true, endBody: true, start: 0, end: 3 },
      { text: "middle", startBody: true, endBody: true, start: 0, end: 1 },
      { text: "Only text", startBody: true, endBody: true, start: 0, end: 1 },
      { text: "", startBody: true, endBody: true, start: 0, end: 0 },
      { text: "leading middle trailing", startBody: true, endBody: true, start: 1, end: 4 },
    ]);
    expect(evidence.startOffset).toBe(2);
    expect(evidence.endOffset).toBe(4);
    expect(evidence.sameDocument).toBe(true);
    expect(evidence.recoveredText).toBe("\n \t target string.");
    expect(evidence.recoveredOffset).toBe(evidence.expectedOffset);
    expect(evidence.before).toEqual({ text: "before", offset: 6 });
    expect(evidence.after).toEqual({ text: "after", offset: 0 });
    expect(evidence.loadedRangeText).toBe("Original");
    expect(evidence.loadedSameDocument).toBe(true);
    await info.attach("cfi-conformance-evidence.json", {
      body: JSON.stringify({ ...cfi, ...evidence }),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
});
