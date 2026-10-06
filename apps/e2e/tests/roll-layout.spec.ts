import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const sizes = [
  { width: 400, height: 600 },
  { width: 400, height: 300 },
  { width: 400, height: 800 },
];

function fixture(info: TestInfo): string {
  const source = info.outputPath("roll-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(
    path.join(source, "META-INF/container.xml"),
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  fs.writeFileSync(
    path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:roll-layout</dc:identifier><dc:title>Roll layout</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-06T00:00:00Z</meta><meta property="rendition:layout">roll</meta><meta property="rendition:spread">both</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${sizes.map((_, index) => `<item id="c${index}" href="c${index}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine page-progression-direction="rtl"><itemref idref="c0" properties="rendition:layout-reflowable rendition:spread-none"/><itemref idref="c1" properties="rendition:layout-pre-paginated"/><itemref idref="c2" properties="rendition:orientation-landscape"/></spine></package>`,
  );
  fs.writeFileSync(
    path.join(source, "EPUB/nav.xhtml"),
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c0.xhtml">Top</a></li><li><a href="c1.xhtml">Middle</a></li><li><a href="c2.xhtml#target">Bottom</a></li></ol></nav></body></html>',
  );
  sizes.forEach((size, index) => {
    const link = index === 0 ? '<a id="to-bottom" href="c2.xhtml#target">Go to bottom</a>' : "";
    fs.writeFileSync(
      path.join(source, `EPUB/c${index}.xhtml`),
      `<html xmlns="http://www.w3.org/1999/xhtml" ${index === 2 ? 'dir="rtl"' : ""}><head><title>Roll ${index + 1}</title><meta name="viewport" content="width=${size.width},height=${size.height}"/><style>html,body{margin:0;width:${size.width}px;height:${size.height}px;overflow:hidden}body{background:rgb(${80 + index * 50},${120 + index * 30},${160 - index * 20});font:28px sans-serif}a{display:block;padding:40px;color:black}</style></head><body data-roll-chapter="${index}">${link}<p id="${index === 2 ? "target" : `page-${index}`}">Roll item ${index + 1}</p></body></html>`,
    );
  });
  const target = info.outputPath("roll-layout.epub");
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: source });
  return target;
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("[data-ambra-roll]");
    const frames = Array.from(scroller?.querySelectorAll("iframe") ?? []);
    return {
      scrollTop: scroller?.scrollTop ?? -1,
      width: scroller?.clientWidth ?? -1,
      frames: frames.map((frame) => {
        const rect = frame.getBoundingClientRect();
        return {
          chapter: frame.contentDocument?.body.dataset.rollChapter,
          dir: frame.contentDocument?.documentElement.dir,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }),
    };
  });
}

test("EPUB 3.4 roll is gapless, width-fitted, navigable, RTL-safe, and resize-stable", async ({
  page: unusedPage,
}, info) => {
  void unusedPage;
  const { context, readerPage: page } = await launchReader(fixture(info), {
    viewport: { width: 900, height: 700 },
  });
  try {
    await exposeReaderController(page);
    await expect.poll(async () => (await geometry(page)).frames.length).toBe(3);

    const initial = await geometry(page);
    expect(initial.frames.map((frame) => frame.chapter)).toEqual(["0", "1", "2"]);
    expect(initial.frames[2]?.dir).toBe("rtl");
    for (const frame of initial.frames) {
      expect(frame.width).toBeCloseTo(initial.width, 0);
      expect(frame.x).toBeCloseTo(initial.frames[0]!.x, 0);
    }
    for (let index = 1; index < initial.frames.length; index++) {
      const previous = initial.frames[index - 1]!;
      expect(initial.frames[index]!.y).toBeCloseTo(previous.y + previous.height, 0);
    }
    expect(initial.frames.map((frame) => Math.round((frame.height / frame.width) * 100))).toEqual([
      150, 75, 200,
    ]);
    const initialSnapshot = await page.evaluate(() =>
      Reflect.get(window, "__readerController").snapshot(),
    );
    expect(initialSnapshot).toMatchObject({
      viewMode: "scroll",
      isFixedLayout: true,
      fontScale: 1,
    });

    const firstFrame = (
      await Promise.all(
        page.frames().map(async (frame) => ({
          frame,
          matches: (await frame.locator("body[data-roll-chapter='0']").count()) > 0,
        })),
      )
    ).find((entry) => entry.matches)?.frame;
    if (!firstFrame) throw new Error("First roll frame was not found.");
    await firstFrame.locator("body").evaluate((body) => {
      body.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 1_500, bubbles: true, cancelable: true }),
      );
    });
    await expect.poll(async () => (await geometry(page)).scrollTop).toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex),
      )
      .toBe(1);
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>("[data-ambra-roll]");
      if (scroller) scroller.scrollTop = 0;
    });
    await firstFrame.locator("#to-bottom").click();
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex),
      )
      .toBe(2);
    await expect.poll(async () => (await geometry(page)).scrollTop).toBeGreaterThan(0);

    const beforeResize = await geometry(page);
    await page.setViewportSize({ width: 700, height: 700 });
    await expect.poll(async () => (await geometry(page)).width).toBeLessThan(initial.width);
    const afterResize = await geometry(page);
    expect(afterResize.scrollTop).toBeGreaterThan(0);
    expect(
      afterResize.frames.map((frame) => Math.round((frame.height / frame.width) * 100)),
    ).toEqual([150, 75, 200]);
    expect(beforeResize.frames.length).toBe(afterResize.frames.length);

    await page.evaluate(() => Reflect.get(window, "__readerController").flushProgress(true));
    await page.reload();
    await expect.poll(async () => (await geometry(page)).frames.length).toBe(3);
    await exposeReaderController(page);
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex),
      )
      .toBe(2);
  } finally {
    await context.close();
  }
});
