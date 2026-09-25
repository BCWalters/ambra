import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function fixture(directory: string): string {
  const source = path.join(directory, "source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
  const xhtml = (body: string) =>
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Fragment sections</title></head><body>${body}</body></html>`;
  const passage = (label: string) => Array.from({ length: 22 }, (_, i) =>
    `<p>${label} passage ${i}. ${"Original regression text makes each section fill several pages. ".repeat(8)}</p>${i % 7 === 3 ? '<img src="panel.svg" width="360" height="540" alt="Original test illustration"/>' : ""}`).join("");
  const entries = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/package.opf": '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:toc-fragments</dc:identifier><dc:title>Fragment sections</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-25T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/><item id="panel" href="panel.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="cover"/><itemref idref="text"/></spine></package>',
    "EPUB/panel.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="540"><rect width="360" height="540" fill="#ccc"/><circle cx="180" cy="270" r="120" fill="#555"/></svg>',
    "EPUB/nav.xhtml": xhtml('<nav epub:type="toc"><ol><li><a href="text.xhtml#alpha">Alpha</a></li><li><a href="text.xhtml#beta">Beta</a><ol><li><a href="text.xhtml#beta-detail">Beta detail</a></li></ol></li><li><a href="text.xhtml#gamma">Gamma</a></li><li><a href="text.xhtml#contents">Table of contents</a></li></ol></nav>'),
    "EPUB/cover.xhtml": xhtml("<h1>Fragment sections</h1>"),
    "EPUB/text.xhtml": xhtml(`<h2 id="alpha">Alpha</h2>${passage("Alpha")}<div style="break-inside:avoid"><h2><a id="beta"></a>Beta</h2><h3 id="beta-detail">Beta detail</h3></div>${passage("Beta")}<div id="gamma"><h2>Gamma</h2>${passage("Gamma")}</div><h2 id="contents">Table of contents</h2><p>End matter.</p>`),
  };
  for (const [name, content] of Object.entries(entries)) fs.writeFileSync(path.join(source, name), content);
  const book = path.join(directory, "fragments.epub");
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "EPUB"], { cwd: source });
  return book;
}

interface TocEntry {
  label: string;
  target: string;
  page: number | undefined;
}

async function snapshot(page: Page): Promise<{
  section: string;
  target: string;
  currentPage: number;
  shownPages: number[];
  totalPages: number;
  entries: TocEntry[];
}> {
  return page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    const state = controller.snapshot();
    const flatten = (items: typeof state.toc): typeof state.toc =>
      items.flatMap((item: typeof state.toc[number]) => [item, ...flatten(item.children)]);
    return {
      section: state.currentChapterLabel as string,
      target: state.highlightedTocPath as string,
      currentPage: state.bookPageIndex as number,
      shownPages: (state.isSpread ? state.spreadPageNumbers : [state.bookPageIndex]) as number[],
      totalPages: state.bookPageCount as number,
      entries: flatten(state.toc).map((item: typeof state.toc[number]) => ({
        label: item.label as string, target: item.target as string,
        page: state.tocPageNumbers.get(item.target) as number | undefined,
      })),
    };
  });
}

async function openContents(page: Page) {
  await page.mouse.move(350, 2);
  await page.getByRole("button", { name: "Show contents", exact: true }).click();
  return page.getByRole("navigation", { name: "Table of contents" });
}

async function selectEntry(page: Page, label: string, keyboard = false) {
  const navigation = await openContents(page);
  const entry = navigation.getByRole("button").filter({
    has: page.locator("span").filter({ hasText: new RegExp(`^${label}$`) }),
  });
  if (keyboard) await entry.press("Enter");
  else await entry.click();
  await expect(navigation).not.toBeVisible();
  await expect.poll(async () => (await snapshot(page)).section).toBe(label);
}

for (const width of [900, 1400]) {
  test(`same-spine TOC fragments have distinct pages and track navigation (${width}px, #202)`, async () => {
    const book = fixture(test.info().outputPath("fixture"));
    const { context, readerPage: page } = await launchReader(book, { viewport: { width, height: 900 } });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await exposeReaderController(page);
      await expect.poll(async () => (await snapshot(page)).entries.every(entry => entry.page !== undefined)).toBe(true);
      const initial = await snapshot(page);
      const pages = Object.fromEntries(initial.entries.map(entry => [entry.label, entry.page!]));
      expect(pages.Alpha).toBe(2);
      expect(pages.Beta).toBeGreaterThan(pages.Alpha!);
      expect(pages.Gamma).toBeGreaterThan(pages.Beta!);
      expect(pages["Table of contents"]).toBeGreaterThan(pages.Gamma!);
      expect(pages["Beta detail"]).toBe(pages.Beta);
      expect(initial.totalPages).toBeGreaterThanOrEqual(pages["Table of contents"]!);

      for (const label of ["Gamma", "Alpha", "Beta", "Beta detail", "Table of contents"]) {
        await selectEntry(page, label, true);
        expect((await snapshot(page)).shownPages).toContain(pages[label]);
        const navigation = await openContents(page);
        await expect(navigation.locator('[aria-current="location"]')).toHaveCount(1);
        await expect(navigation.locator('[aria-current="location"]')).toContainText(label);
        const current = navigation.locator('[aria-current="location"]');
        await expect(current).toContainText(String(pages[label]));
        await page.keyboard.press("Escape");
      }
      await selectEntry(page, "Alpha");
      await page.keyboard.press("ArrowRight");
      await expect.poll(async () => (await snapshot(page)).section).toBe("Alpha");
      for (let turn = 0; turn < initial.totalPages && (await snapshot(page)).section === "Alpha"; turn++) {
        await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
      }
      // Ordinary turns choose the section at the reading position, including
      // the later of two headings sharing a page; they don't retain a click.
      await expect.poll(async () => (await snapshot(page)).section).toBe("Beta detail");
      for (let turn = 0; turn < 3 && (await snapshot(page)).section !== "Alpha"; turn++) {
        await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(-1));
      }
      await expect.poll(async () => (await snapshot(page)).section).toBe("Alpha");
      await selectEntry(page, "Gamma");
      await page.evaluate(() => Reflect.get(window, "__readerController").flushProgress());
      await page.reload();
      await page.waitForTimeout(1000);
      await exposeReaderController(page);
      await expect.poll(async () => (await snapshot(page)).section).toBe("Gamma");
      await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("scroll"));
      await selectEntry(page, "Beta");
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const document = controller.primaryContentDocument();
        document.getElementById("gamma").scrollIntoView();
      });
      await expect.poll(async () => (await snapshot(page)).section).toBe("Gamma");
      await selectEntry(page, "Alpha");
      await expect.poll(async () => (await snapshot(page)).section).toBe("Alpha");
      await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.setViewMode("paginated");
        await controller.setFontScale(1.3);
      });
      await expect.poll(async () => (await snapshot(page)).entries.every(entry => entry.page !== undefined)).toBe(true);
      const larger = await snapshot(page);
      expect(larger.entries.find(entry => entry.label === "Gamma")!.page).toBeGreaterThan(pages.Gamma!);
      expect(larger.totalPages).toBeGreaterThan(initial.totalPages);
      await selectEntry(page, "Gamma");
      expect((await snapshot(page)).shownPages).toContain(larger.entries.find(entry => entry.label === "Gamma")!.page);
    } finally {
      await context.close();
    }
  });
}

const realBook = process.env.AMBRA_GUTENBERG_10289_BOOK;
test("published Gutenberg #10289 fragments show their own page and section", async () => {
  test.skip(!realBook || !fs.existsSync(realBook), "Set AMBRA_GUTENBERG_10289_BOOK to the downloaded EPUB3.");
  test.setTimeout(120_000);
  const { context, readerPage: page } = await launchReader(realBook!);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await exposeReaderController(page);
    await expect.poll(async () => (await snapshot(page)).entries.every(entry => entry.page !== undefined), { timeout: 60_000 }).toBe(true);
    const initial = await snapshot(page);
    expect(new Set(initial.entries.map(entry => entry.page)).size).toBeGreaterThan(10);
    for (const [index, entry] of initial.entries.entries()) {
      await selectEntry(page, entry.label, true);
      const current = await snapshot(page);
      expect(current.target).toBe(entry.target);
      expect(current.shownPages).toContain(entry.page);
      expect(current.entries.find(item => item.target === entry.target)?.page).toBe(entry.page);
      if (index >= 4 && index <= 13) {
        await page.keyboard.press("ArrowRight");
        await expect.poll(async () => (await snapshot(page)).section).toBe(entry.label);
      }
    }
    console.log("Gutenberg #10289 measured TOC:", JSON.stringify(initial));
  } finally {
    await context.close();
  }
});
