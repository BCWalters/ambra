import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { launchReader } from "../harness.js";

const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 110">
  <style>text{font-size:12px;fill:black}.synthetic-narration-active{background:#ffe082}</style>
  <defs><clipPath id="clip"><rect width="330" height="100"/></clipPath></defs>
  <g transform="translate(10,10)" clip-path="url(#clip)">
    <g id="c1-p1"><text x="0" y="15" style="filter:opacity(0.9);text-shadow:none!important">First narrated SVG passage.</text>
      <text x="0" y="28">A second line in the same passage.</text>
      <text id="clipped" x="340" y="15">Clipped</text></g>
    <text x="0" y="53"><tspan id="c1-p2">Second narrated passage.</tspan><tspan id="other" dx="5">Other.</tspan></text>
    <text id="c1-p3" x="0" y="78">Third narrated passage.</text>
  </g><script>document.documentElement.setAttribute('data-script-ran','true')</script></svg>`;

function fixture(info: TestInfo, fixed: boolean): string {
  const entries = unzipSync(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/media-overlay/narrated.epub")));
  entries["EPUB/chapter-1.svg"] = strToU8(source);
  delete entries["EPUB/chapter-1.xhtml"];
  entries["EPUB/package.opf"] = strToU8(new TextDecoder().decode(entries["EPUB/package.opf"]!)
    .replace("Synthetic narration narrated", `3.1.4 SVG narration (${fixed ? "fixed" : "reflowable"})`)
    .replace('href="chapter-1.xhtml" media-type="application/xhtml+xml"', 'href="chapter-1.svg" media-type="image/svg+xml"')
    .replace("</metadata>", `${fixed ? '<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">none</meta>' : ""}</metadata>`)
    .replace(fixed ? '<meta property="media:active-class">synthetic-narration-active</meta>' : "", ""));
  for (const file of ["EPUB/nav.xhtml", "EPUB/overlay-1.smil"]) {
    entries[file] = strToU8(new TextDecoder().decode(entries[file]!).replaceAll("chapter-1.xhtml", "chapter-1.svg"));
  }
  const book = info.outputPath(`3.1.4-svg-narration-${fixed ? "fixed" : "reflowable"}.epub`);
  fs.writeFileSync(book, zipSync(entries, { level: 0 }));
  return book;
}

async function bluePaint(page: Page, fragment: string): Promise<number> {
  const clip = await page.evaluate(fragment => {
    const views = Reflect.get(window, "__readerController").contentDocumentViews();
    const doc: Document | undefined = views.find((view: { document: Document }) =>
      view.document.documentElement.namespaceURI === "http://www.w3.org/2000/svg")?.document;
    const frame = doc?.defaultView?.frameElement;
    if (!doc || !(frame instanceof HTMLIFrameElement)) throw new Error("The original SVG reading frame is absent.");
    const rect = frame.getBoundingClientRect();
    const target = doc.getElementById(fragment);
    if (!target) throw new Error(`The narrated SVG target #${fragment} is absent.`);
    const bounds = target.getBoundingClientRect();
    const scaleX = rect.width / doc.defaultView!.innerWidth;
    const scaleY = rect.height / doc.defaultView!.innerHeight;
    const x = Math.max(0, Math.ceil(rect.left + bounds.left * scaleX - 8));
    const y = Math.max(0, Math.ceil(rect.top + bounds.top * scaleY - 8));
    return { x, y, width: Math.floor(Math.min(rect.left + bounds.right * scaleX + 8, rect.right, window.innerWidth) - x),
      height: Math.floor(Math.min(rect.top + bounds.bottom * scaleY + 8, rect.bottom, window.innerHeight) - y) };
  }, fragment);
  const png = await page.screenshot({ clip });
  return page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screenshot pixel decoding requires a 2D context.");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 2]! - pixels[index]! > 12 && pixels[index + 1]! - pixels[index]! > 8) count++;
    }
    image.close();
    return count;
  }, [...png]);
}

async function playAndPause(page: Page): Promise<void> {
  await page.mouse.move(350, 2);
  await page.getByRole("button", { name: "Play narration", exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    document.querySelector<HTMLAudioElement>("audio[data-ambra-narration-audio]")?.currentTime)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause narration", exact: true }).click();
}

for (const fixed of [false, true]) {
  test(`SVG narration paints actual glyph pixels and exact tspan targets with ${fixed ? "fixed/default" : "reflowable/authored"} styling (#378)`, async () => {
    const { readerPage: page, context } = await launchReader(fixture(test.info(), fixed), {
      viewport: { width: 900, height: 500 },
    });
    try {
      // Chromium's blue SVG focus outline is not narration paint.
      await page.getByRole("button", { name: "Play narration", exact: true }).focus();
      expect(await bluePaint(page, "c1-p1")).toBe(0);
      await playAndPause(page);
      expect(await bluePaint(page, "c1-p1")).toBeGreaterThan(20);
      expect(await bluePaint(page, "clipped")).toBe(0);
      const initial = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc: Document = controller.contentDocumentViews()[0].document;
        const first = doc.querySelector<SVGElement>("#c1-p1 text")!;
        return { fill: doc.defaultView!.getComputedStyle(first).fill,
          filter: first.style.getPropertyValue("filter"), viewBox: doc.documentElement.getAttribute("viewBox"),
          children: doc.getElementById("c1-p1")!.children.length,
          script: doc.documentElement.hasAttribute("data-script-ran") };
      });
      expect(initial).toEqual({ fill: "rgb(0, 0, 0)", filter: "opacity(0.9)", viewBox: "0 0 360 110",
        children: 3, script: false });
      await page.getByRole("button", { name: "Play narration", exact: true }).click();
      await expect.poll(() => page.evaluate(() =>
        document.querySelector<HTMLAudioElement>("audio[data-ambra-narration-audio]")?.paused)).toBe(false);
      await page.evaluate(() => {
        const audio = document.querySelector<HTMLAudioElement>("audio[data-ambra-narration-audio]");
        if (!audio) throw new Error("Native narration audio is absent.");
        audio.currentTime = 4.1;
        audio.dispatchEvent(new Event("timeupdate"));
      });
      await expect.poll(() => page.evaluate(() => {
        const doc: Document = Reflect.get(window, "__readerController").contentDocumentViews()[0].document;
        return doc.querySelector<SVGElement>("#c1-p2")!.style.getPropertyValue("text-shadow");
      })).toContain("rgb(185, 229, 255)");
      await page.getByRole("button", { name: "Pause narration", exact: true }).click();
      expect(await bluePaint(page, "c1-p2")).toBeGreaterThan(20);
      expect(await page.evaluate(() => {
        const doc: Document = Reflect.get(window, "__readerController").contentDocumentViews()[0].document;
        return { first: doc.querySelector<SVGElement>("#c1-p1 text")!.style.getPropertyValue("text-shadow"),
          priority: doc.querySelector<SVGElement>("#c1-p1 text")!.style.getPropertyPriority("text-shadow"),
          otherStyle: doc.getElementById("other")!.getAttribute("style") };
      })).toEqual({ first: "none", priority: "important", otherStyle: null });
      await page.setViewportSize({ width: 740, height: 620 });
      await page.waitForFunction(() => {
        const controller = Reflect.get(window, "__readerController");
        return controller.appliedWidth === 740 && !controller.isLoadInFlight &&
          !controller.isApplyingLayout && !controller.pendingLayout;
      });
      expect(await bluePaint(page, "c1-p2")).toBeGreaterThan(20);
      expect(await page.evaluate(async () => new TextDecoder().decode(
        await Reflect.get(window, "__readerController").contentLoader.loadResourceBytes("EPUB/chapter-1.svg")))).toBe(source);
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally { await context.close(); }
  });
}

for (const name of ["mol-timing-synchronization_svg", "mol-timing-synchronization_svg-fxl"]) {
  test(`original W3C ${name}: narration visibly paints SVG text without changing the publication (#378)`, async () => {
    const directory = process.env.AMBRA_SVG_NARRATION_EPUB_DIR;
    test.skip(!directory, "Set AMBRA_SVG_NARRATION_EPUB_DIR to the pinned media-overlay folder.");
    const { readerPage: page, context } = await launchReader(path.join(directory!, `${name}.epub`), {
      viewport: { width: 900, height: 500 },
    });
    try {
      await page.evaluate(() => Reflect.get(window, "__readerController").goToChapter(1));
      await playAndPause(page);
      expect(await bluePaint(page, "first")).toBeGreaterThan(20);
      expect(await page.evaluate(() => {
        const doc: Document = Reflect.get(window, "__readerController").contentDocumentViews()
          .find((view: { document: Document }) => view.document.documentElement.localName === "svg").document;
        return { viewBox: doc.documentElement.getAttribute("viewBox"),
          class: doc.getElementById("first")!.classList.contains("active-item"),
          textSize: doc.defaultView!.getComputedStyle(doc.querySelector("text")!).fontSize,
          body: doc.body };
      })).toEqual({ viewBox: "0 0 360 110", class: true, textSize: "5px", body: null });
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally { await context.close(); }
  });
}
