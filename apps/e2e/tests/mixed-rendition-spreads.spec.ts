import { chromium, expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EXTENSION_PATH } from "../harness.js";

type Direction = "ltr" | "rtl";
const reflowMarkers = Array.from({ length: 48 }, (_, i) => `R${String(i + 1).padStart(3, "0")}`);

function fixture(directory: string, direction: Direction, packageSpread: "both" | "none"): string {
  const source = path.join(directory, "source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
  const chapters = [
    ["A", "rendition:spread-both"],
    ["B", "rendition:spread-both"],
    ["C", "rendition:spread-none"],
    ["R", "rendition:layout-reflowable"],
    ["D", "rendition:spread-both"],
    ["E", "rendition:spread-landscape"],
    ["F", "rendition:spread-none"],
    ["G", "rendition:spread-both"],
    ["H", "rendition:spread-both"],
  ];
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:mixed-rendition:${direction}</dc:identifier><dc:title>Mixed rendition ${direction}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta><meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">${packageSpread}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map(([id]) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine page-progression-direction="${direction}">${chapters.map(([id, properties]) => `<itemref idref="${id}" properties="${properties}"/>`).join("")}</spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters.map(([id]) => `<li><a href="${id}.xhtml">Chapter ${id}</a></li>`).join("")}</ol></nav></body></html>`);
  for (const [id] of chapters) {
    const content = id === "R"
      ? reflowMarkers.map(marker => `<p data-marker="${marker}">${marker} — Reflowable text between fixed pages.</p>`).join("")
      : `<p>Fixed page ${id}</p>`;
    fs.writeFileSync(path.join(source, `EPUB/${id}.xhtml`),
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${id}</title>${id === "R" ? "" : '<meta name="viewport" content="width=600,height=800"/>'}<style>${id === "R" ? "body{font-size:18px;line-height:32px}p{margin:0}" : "body{margin:0;background:#f5eddc}p{margin:100px 30px;font-size:48px}"}</style></head><body data-chapter="${id}">${content}</body></html>`);
  }
  const book = path.join(directory, "mixed-rendition.epub");
  for (const args of [["-q", "-X", "-0", book, "mimetype"], ["-q", "-X", "-r", book, "META-INF", "EPUB"]]) {
    const result = spawnSync("zip", args, { cwd: source, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "Could not create mixed-rendition fixture");
  }
  return book;
}

async function visible(page: Page, direction: Direction) {
  return page.evaluate((rtl) => {
    const frames = Array.from(document.querySelectorAll("iframe")).filter(frame => {
      const rect = frame.getBoundingClientRect();
      if (!frame.contentDocument?.body.dataset.chapter || rect.right <= 0 || rect.left >= innerWidth) return false;
      for (let element: Element | null = frame; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
      }
      return true;
    }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    if (rtl) frames.reverse();
    return {
      chapters: frames.map(frame => frame.contentDocument!.body.dataset.chapter!),
      widths: frames.map(frame => Math.round(frame.getBoundingClientRect().width)),
      markers: frames.flatMap(frame => {
        const doc = frame.contentDocument!;
        const outer = frame.getBoundingClientRect();
        return Array.from(doc.querySelectorAll("[data-marker]")).flatMap(element => {
          const range = doc.createRange();
          range.selectNodeContents(element);
          const rect = range.getBoundingClientRect();
          const x = rect.left + 8;
          const y = rect.top + rect.height / 2;
          return doc.elementFromPoint(x, y)?.closest("[data-marker]") === element &&
            document.elementFromPoint(outer.left + x, outer.top + y) === frame
            ? [element.getAttribute("data-marker")!] : [];
        });
      }),
    };
  }, direction === "rtl");
}

for (const [direction, packageSpread] of [["ltr", "both"], ["rtl", "none"]] as const) {
  test(`${direction}, package spread-${packageSpread}: per-item spreads cross FXL/reflowable boundaries and survive resize/reload`, async () => {
    test.setTimeout(120_000);
    const contention = [{ at: "start", loadAverage: os.loadavg(), logicalCpus: os.cpus().length }];
    const directory = test.info().outputPath("mixed-rendition");
    fs.mkdirSync(directory, { recursive: true });
    const book = fixture(directory, direction, packageSpread);
    const runtime = path.join(directory, "runtime");
    fs.mkdirSync(runtime, { recursive: true });
    const profile = path.join(directory, "profile");
    const context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
      viewport: { width: 1400, height: 900 },
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
      const expectChapters = async (chapters: string[]) => {
        await expect.poll(async () => (await visible(page, direction)).chapters).toEqual(chapters);
      };
      const turn = async (forward: boolean) => {
        await page.keyboard.press(forward === (direction === "ltr") ? "ArrowRight" : "ArrowLeft");
        await page.waitForTimeout(650);
      };
      await expectChapters(["A", "B"]);
      await turn(true);
      await expectChapters(["C"]);
      await turn(true);
      await expectChapters(["R", "R"]);
      const firstReflow = (await visible(page, direction)).markers;
      await turn(true);
      await expectChapters(["R"]);
      const lastReflow = (await visible(page, direction)).markers;
      expect([...firstReflow, ...lastReflow]).toEqual(reflowMarkers);

      const anchor = lastReflow[0]!;
      await page.setViewportSize({ width: 900, height: 1400 });
      await expectChapters(["R"]);
      await expect.poll(async () => (await visible(page, direction)).widths).toEqual([900]);
      await expect.poll(async () => (await visible(page, direction)).markers).toContain(anchor);
      await page.waitForTimeout(800);
      await page.reload();
      await expectChapters(["R"]);
      await expect.poll(async () => (await visible(page, direction)).markers).toContain(anchor);
      await page.setViewportSize({ width: 1400, height: 900 });
      await expect.poll(async () => (await visible(page, direction)).widths).toEqual([680]);
      await expect.poll(async () => (await visible(page, direction)).markers).toContain(anchor);
      await turn(true);
      await expectChapters(["D", "E"]);

      // D remains eligible in portrait, but its landscape-only neighbor does not.
      await page.setViewportSize({ width: 1400, height: 1600 });
      await expectChapters(["D"]);
      await page.setViewportSize({ width: 900, height: 1400 });
      await expectChapters(["D"]);
      await page.waitForTimeout(800);
      await page.reload();
      await expectChapters(["D"]);
      await turn(true);
      await expectChapters(["E"]);
      await turn(true);
      await expectChapters(["F"]);
      await turn(true);
      await expectChapters(["G", "H"]);
      await page.setViewportSize({ width: 600, height: 900 });
      await expectChapters(["G"]);
      await turn(true);
      await expectChapters(["H"]);
      await turn(false);
      await expectChapters(["G"]);
      await page.setViewportSize({ width: 1400, height: 900 });
      await expectChapters(["G", "H"]);
      await turn(false);
      await expectChapters(["F"]);
      await turn(false);
      await expectChapters(["D", "E"]);
      await turn(false);
      await expectChapters(["R"]);
      const backwardTail = (await visible(page, direction)).markers;
      await turn(false);
      await expectChapters(["R", "R"]);
      expect([...(await visible(page, direction)).markers, ...backwardTail]).toEqual(reflowMarkers);
      await turn(false);
      await expectChapters(["C"]);
      await turn(false);
      await expectChapters(["A", "B"]);
      await turn(false);
      await expectChapters(["A", "B"]);
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      contention.push({ at: "end", loadAverage: os.loadavg(), logicalCpus: os.cpus().length });
      const contentionPath = test.info().outputPath("cpu-contention.json");
      fs.writeFileSync(contentionPath, JSON.stringify(contention, null, 2));
      await test.info().attach("cpu-contention.json", {
        path: contentionPath,
        contentType: "application/json",
      });
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
