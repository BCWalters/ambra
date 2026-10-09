import { expect, test, type TestInfo } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const source = "EPUB/text/chapter.xhtml";
const imageBody = { type: "Image", id: "https://annotation-body.invalid/image.svg", custom: true };
const annotations = [
  {
    id: "css-recovery", type: "Annotation", created: "2026-10-09T00:00:00Z",
    motivation: ["commenting", "https://example.invalid/custom"], custom: { retained: true },
    target: { source, custom: true, selector: [
      { type: "FragmentSelector", value: "invalid-cfi", custom: true },
      { type: "CssSelector", value: "#target", refinedBy: { type: "TextPositionSelector", start: 1, end: 3, custom: true } },
    ] },
    body: [{ type: "TextualBody", value: "Recovered CSS note", custom: true },
      imageBody],
  },
  {
    id: "text-bookmark", type: "Annotation", created: "2026-10-09T00:00:00Z",
    motivation: "bookmarking",
    target: { source: "text/chapter.xhtml", selector: [
      { type: "CssSelector", value: "#missing" }, { type: "TextPositionSelector", start: 1, end: 3 },
    ] },
    body: { type: "Audio", id: "https://annotation-body.invalid/audio.mp3", custom: true },
  },
  {
    id: "unknown-body", type: "Annotation", created: "2026-10-09T00:00:00Z",
    motivation: "https://example.invalid/unknown",
    target: { source, selector: [{ type: "CssSelector", value: "[" }, { type: "UnknownSelector", value: { retained: true } },
      { type: "CssSelector", value: "#second" }] },
    body: "https://annotation-body.invalid/external",
  },
  {
    id: "unresolved-refinement", type: "Annotation", created: "2026-10-09T00:00:00Z",
    target: { source, selector: [{ type: "CssSelector", value: "#target", refinedBy: { type: "UnknownSelector" } }] },
    body: { type: "TextualBody", value: "Must not broaden this unresolved target" },
  },
];

function fixture(info: TestInfo, layout: string, collection: readonly unknown[] = annotations): string {
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:annotation-selectors:${layout}</dc:identifier><dc:title>Annotation selectors</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-09T00:00:00Z</meta><meta property="rendition:layout">${layout}</meta><meta property="rendition:spread">none</meta></metadata><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>
      <item id="annotations" href="annotations.json" media-type="application/ld+json" properties="annotations"/>
      </manifest><spine><itemref idref="chapter"/></spine></package>`,
    "EPUB/nav.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="text/chapter.xhtml">Annotation targets</a></li></ol></nav></body></html>',
    "EPUB/text/chapter.xhtml": '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Annotation targets</title><meta name="viewport" content="width=600,height=800"/></head><body><p id="target">A&#x1f600;B <b>&amp;C</b> tail</p><p id="second">Second target</p></body></html>',
    "EPUB/annotations.json": JSON.stringify(collection),
  };
  const target = info.outputPath("annotation-selectors.epub");
  fs.writeFileSync(target, zipSync(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text)]),
  ), { level: 0 }));
  return target;
}

for (const layout of ["reflowable", "pre-paginated", "roll"]) {
  test(`${layout}: publisher CSS/text selectors recover and navigate without fetching attachment bodies`, async ({ browserName: _browserName }, info) => {
    const requests: string[] = [];
    const { context, readerPage: page } = await launchReader(fixture(info, layout), {
      beforeBookImport: async library => {
        library.context().on("request", request => {
          if (request.url().includes("annotation-body.invalid")) requests.push(request.url());
        });
      },
    });
    try {
      await exposeReaderController(page);
      const views = await page.evaluate(() => Reflect.get(window, "__readerController").listEmbeddedAnnotations());
      expect(views).toHaveLength(3);
      expect(views.map((view: { id: string }) => view.id)).toEqual(["css-recovery", "text-bookmark", "unknown-body"]);
      expect(views.find((view: { id: string }) => view.id === "text-bookmark"))
        .toMatchObject({ kind: "bookmark", bodyUnavailable: true });
      await page.mouse.move(450, 20);
      await page.getByRole("button", { name: "Annotations", exact: true }).click();
      const panel = page.getByRole("navigation", { name: "Annotations", exact: true });
      await expect(panel.getByText("Attachment retained; not loaded", { exact: true })).toHaveCount(3);
      await expect(panel.getByText("Must not broaden this unresolved target")).toHaveCount(0);
      await panel.getByRole("button", { name: /Recovered CSS note/ }).click();
      await expect(panel).toBeHidden();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(requests).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("CSS/text imports retain mixed bodies and selector alternatives across reload, edits, exports and duplicate imports", async ({ browserName: _browserName }, info) => {
  const requests: string[] = [];
  const { context, readerPage: page } = await launchReader(fixture(info, "reflowable"), {
    beforeBookImport: async library => {
      library.context().on("request", request => {
        if (request.url().includes("annotation-body.invalid")) requests.push(request.url());
      });
    },
  });
  try {
    await exposeReaderController(page);
    const result = await page.evaluate(async json => Reflect.get(window, "__readerController")
      .importAnnotationsFile(new File([json], "annotations.json", { type: "application/json" })), JSON.stringify(annotations));
    expect(result).toEqual({
      importedHighlights: 2, importedBookmarks: 1, duplicateHighlights: 0, duplicateBookmarks: 0, skipped: 1,
    });
    let exported = await page.evaluate(async () => JSON.parse((await Reflect.get(window, "__readerController").exportAnnotations()).text));
    expect(exported).toEqual([annotations[0], annotations[2], annotations[1]]);
    const text = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      return controller.snapshot().highlights.map((highlight: { text: string }) => highlight.text);
    });
    expect(text).toEqual(["\u{1f600}B", "Second target"]);
    await page.reload();
    await expect(page.getByRole("main").locator("iframe").first()).toBeVisible();
    await exposeReaderController(page);
    exported = await page.evaluate(async () => JSON.parse((await Reflect.get(window, "__readerController").exportAnnotations()).text));
    expect(exported).toEqual([annotations[0], annotations[2], annotations[1]]);
    const duplicate = await page.evaluate(async json => Reflect.get(window, "__readerController")
      .importAnnotationsFile(new File([json], "annotations.json", { type: "application/json" })), JSON.stringify(annotations));
    expect(duplicate).toEqual({
      importedHighlights: 0, importedBookmarks: 0, duplicateHighlights: 2, duplicateBookmarks: 1, skipped: 1,
    });
    await page.mouse.move(450, 20);
    await page.getByRole("button", { name: "Annotations", exact: true }).click();
    const panel = page.getByRole("navigation", { name: "Annotations", exact: true });
    await expect(panel.getByText("Attachment retained; not loaded", { exact: true })).toHaveCount(6);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.setHighlightNote(controller.snapshot().highlights[0].id, "Edited note");
    });
    exported = await page.evaluate(async () => JSON.parse((await Reflect.get(window, "__readerController").exportAnnotations()).text));
    expect(exported[0]).toMatchObject({
      id: annotations[0]!.id, motivation: annotations[0]!.motivation,
      custom: annotations[0]!.custom, target: annotations[0]!.target,
      body: [{ type: "TextualBody", value: "Edited note", custom: true }, imageBody],
    });
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.setHighlightNote(controller.snapshot().highlights[0].id, undefined);
    });
    exported = await page.evaluate(async () => JSON.parse((await Reflect.get(window, "__readerController").exportAnnotations()).text));
    expect(exported[0].body).toEqual([imageBody]);
    expect(requests).toEqual([]);
  } finally {
    await context.close();
  }
});

test("unrefined CSS range CFIs preserve the exclusive end before the following paragraph", async ({ browserName: _browserName }, info) => {
  const collection = [{
    ...annotations[0]!, target: { source, custom: true, selector: [{ type: "CssSelector", value: "#target", custom: true }] },
  }];
  const { context, readerPage: page } = await launchReader(fixture(info, "reflowable", collection));
  try {
    await exposeReaderController(page);
    const result = await page.evaluate(async json => {
      const controller = Reflect.get(window, "__readerController");
      await controller.importAnnotationsFile(new File([json], "annotations.json", { type: "application/json" }));
      const highlight = controller.snapshot().highlights[0];
      const pair = await controller.locatorResolver.resolvePair({ cfi: highlight.startCfi }, { cfi: highlight.endCfi });
      const range = pair.document.createRange();
      if (pair.start.characterOffset === undefined) range.setStartBefore(pair.start.node);
      else range.setStart(pair.start.node, pair.start.characterOffset);
      if (pair.end.characterOffset === undefined) range.setEndAfter(pair.end.node);
      else range.setEnd(pair.end.node, pair.end.characterOffset);
      return { saved: highlight.text, live: range.toString() };
    }, JSON.stringify(collection));
    expect(result).toEqual({ saved: "A\u{1f600}B &C tail", live: "A\u{1f600}B &C tail" });
  } finally {
    await context.close();
  }
});
