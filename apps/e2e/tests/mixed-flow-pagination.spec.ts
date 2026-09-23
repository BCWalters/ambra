import { chromium, expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EXTENSION_PATH } from "../harness.js";

function fixture(directory: string): { book: string; expected: string[]; atomicGroups: string[][] } {
  const source = path.join(directory, "source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
  const expected: string[] = [];
  const atomicGroups: string[][] = [];
  const marker = () => {
    const id = `M${String(expected.length + 1).padStart(3, "0")}`;
    expected.push(id);
    return `${id} visible text`;
  };
  let content = marker();
  for (let i = 0; i < 12; i++) {
    content += `<div>${marker()} <em>inline emphasis</em><p>${marker()}</p>${marker()}</div>`;
  }
  content += `<div>${Array.from({ length: 12 }, marker).join(" ")}<p>${marker()}</p>${Array.from({ length: 12 }, marker).join(" ")}</div>`;
  content += `<div>${marker()} <span>${marker()} <em>${marker()}</em></span><p>${marker()}</p>${marker()}</div>`;
  content += `<div style="display:contents">${marker()}<p>${marker()}</p>${marker()}</div>`;
  content += `<ul><li>${marker()}<p>${marker()}</p>${marker()}<ul><li>${marker()}</li></ul>${marker()}</li></ul>`;
  content += `<p>${marker()} <ruby>${marker()}<rt>pronunciation</rt></ruby></p>`;
  content += `<p>${marker()} <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math> ${marker()}</p>`;
  content += `<table><tbody><tr><td>${marker()}</td></tr><tr><td>${marker()}</td></tr></tbody></table>`;
  atomicGroups.push(expected.slice(-2));
  content += `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mfrac><mtext>${marker()}</mtext><mtext>${marker()}</mtext></mfrac></math>`;
  atomicGroups.push(expected.slice(-2));
  content += `<details><summary>${marker()}</summary><p>X001 must stay hidden</p></details>`;
  content += `<div hidden=""><p>X002 must stay hidden</p></div>`;
  content += `<details><p>X003 hidden behind the default summary</p></details>`;
  content += marker();
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:mixed-flow</dc:identifier><dc:title>Mixed flow</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Mixed flow</a></li></ol></nav></body></html>');
  fs.writeFileSync(path.join(source, "EPUB/chapter.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Mixed flow</title><style>body{font-size:18px;line-height:36px}p,ul{margin:0}table{border-spacing:0}td{padding:0}rt{font-size:10px}</style></head><body>${content}</body></html>`);
  const book = path.join(directory, "mixed-flow.epub");
  for (const args of [["-q", "-X", "-0", book, "mimetype"], ["-q", "-X", "-r", book, "META-INF", "EPUB"]]) {
    const result = spawnSync("zip", args, { cwd: source, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "Could not create mixed-flow fixture");
  }
  return { book, expected, atomicGroups };
}

async function paintedMarkers(page: Page) {
  return page.evaluate(() => {
    const markers: string[] = [];
    for (const frame of document.querySelectorAll("iframe")) {
      const doc = frame.contentDocument;
      if (!doc) continue;
      const box = frame.getBoundingClientRect();
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        for (const match of (node.textContent ?? "").matchAll(/[MX]\d{3}/g)) {
          const range = doc.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          const rect = range.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          if (
            rect.width > 0 && rect.height > 0 &&
            doc.elementFromPoint(x, y) === node.parentElement &&
            [rect.top + 1, y, rect.bottom - 1].every(sampleY =>
              document.elementFromPoint(box.left + x, box.top + sampleY) === frame,
            )
          ) {
            markers.push(match[0]);
          }
        }
      }
    }
    const position = document.querySelector('[role="slider"][aria-label="Position in book"]')
      ?.getAttribute("aria-valuetext");
    return { markers, position };
  });
}

async function traverse(page: Page, key: "ArrowRight" | "ArrowLeft") {
  const pages = [await paintedMarkers(page)];
  for (let turn = 0; turn < 30; turn++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(650);
    const next = await paintedMarkers(page);
    if (next.position === pages.at(-1)!.position) return pages;
    pages.push(next);
  }
  throw new Error("Mixed-flow navigation did not reach its boundary");
}

for (const width of [760, 1400]) {
  test(`${width}px: mixed inline/block text is painted exactly once, with atomic and hidden content preserved`, async () => {
    test.setTimeout(90_000);
    const directory = test.info().outputPath("mixed-flow");
    fs.mkdirSync(directory, { recursive: true });
    const { book, expected, atomicGroups } = fixture(directory);
    const runtime = path.join(directory, "runtime");
    fs.mkdirSync(runtime, { recursive: true });
    const context = await chromium.launchPersistentContext(path.join(directory, "profile"), {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
      viewport: { width, height: 700 },
      env: { ...process.env, TMPDIR: runtime },
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      const library = await context.newPage();
      await library.goto(`chrome-extension://${worker.url().split("/")[2]}/src/library/index.html`);
      await library.locator('input[type="file"]').setInputFiles(book);
      const opening = context.waitForEvent("page");
      await library.getByRole("button", { name: /^Open / }).click({ force: true });
      const page = await opening;
      await page.bringToFront();
      await expect.poll(async () => (await paintedMarkers(page)).position).toMatch(/Page 1 of \d+/);
      await page.mouse.move(0, 350);
      const forward = await traverse(page, "ArrowRight");
      const backward = await traverse(page, "ArrowLeft");
      await test.info().attach("painted-markers.json", {
        body: JSON.stringify({ expected, forward, backward }),
        contentType: "application/json",
      });
      expect(forward.length).toBeGreaterThan(1);
      expect(forward.flatMap(p => p.markers)).toEqual(expected);
      expect(backward.reverse().flatMap(p => p.markers)).toEqual(expected);
      for (const group of atomicGroups) {
        expect(forward.some(p => group.every(marker => p.markers.includes(marker)))).toBe(true);
      }
    } finally {
      await context.close();
      fs.rmSync(path.join(directory, "profile"), { recursive: true, force: true });
    }
  });
}
