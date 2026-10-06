import { expect, test, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import { launchReader } from "../harness.js";
import { exposeReaderController, isReaderElementPainted } from "../reader-controller.js";

function publication(info: TestInfo): string {
  const paragraphs = Array.from(
    { length: 60 },
    (_, index) =>
      `<p>Original paragraph ${index + 1}. This original locator fixture supplies enough
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
