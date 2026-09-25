import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function fixture(info: TestInfo, rtl: boolean): string {
  const source = info.outputPath("edge-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:fixed-edges-${rtl}</dc:identifier><dc:title>Fixed artwork edges</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-25T00:00:00Z</meta><meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">none</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="art" href="art.svg" media-type="image/svg+xml"/>${[0, 1, 2].map(i => `<item id="p${i}" href="p${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine page-progression-direction="${rtl ? "rtl" : "ltr"}">${[0, 1, 2].map(i => `<itemref idref="p${i}"/>`).join("")}</spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="p0.xhtml">Start</a></li></ol></nav></body></html>`);
  fs.writeFileSync(path.join(source, "EPUB/art.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#ddeeff"/></svg>`);
  for (const i of [0, 1, 2]) {
    fs.writeFileSync(path.join(source, `EPUB/p${i}.xhtml`),
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${i}</title><meta name="viewport" content="width=1200,height=700"/><style>body{margin:0}img{position:absolute;width:1200px;height:700px}p{position:absolute;left:150px;top:350px;font-size:28px}.control{position:absolute;${rtl ? "left" : "right"}:0;width:80px;height:40px}</style></head><body><img src="art.svg" alt="Original synthetic artwork"/><p id="text">Selectable reading text on page ${i}.</p><button class="control" style="top:100px">Button</button><input class="control" style="top:160px" type="checkbox" aria-label="Check"/><details><summary class="control" style="top:220px">Details</summary><p>Detail text</p></details><a class="control" style="top:280px" href="p2.xhtml">Jump to last</a></body></html>`);
  }
  const target = info.outputPath("fixed-edges.epub");
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: source });
  return target;
}

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isTurningPage && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
  });
}

for (const rtl of [false, true]) {
  for (const width of [600, 1200]) {
    test(`${width}px ${rtl ? "RTL" : "LTR"}: bounded artwork edges preserve chrome, controls, selection and focus`, async () => {
      const { context, readerPage: page } = await launchReader(fixture(test.info(), rtl), {
        viewport: { width, height: 900 }, hasTouch: true,
      });
      try {
        await exposeReaderController(page);
        await page.evaluate(() => Reflect.get(window, "__readerController").setPageTurnAnimationStyle("none"));
        await settled(page);
        const spine = () => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex);
        const toolbar = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");
        await page.mouse.move(width / 2, 450);
        await expect(toolbar).toHaveCSS("opacity", "0");
        const rect = (await page.locator("iframe").boundingBox())!;
        expect(rect.x).toBeCloseTo(0);
        expect(rect.width).toBeCloseTo(width);
        expect(await page.locator("iframe").getAttribute("sandbox")).toBe("allow-same-origin");
        const band = Math.min(rect.width * 0.08, 64);
        const y = rect.y + rect.height * 0.8;
        const forwardX = rtl ? 5 : width - 5;
        const backwardX = rtl ? width - 5 : 5;
        for (const x of [band + 1, width / 2, width - band - 1]) {
          await page.mouse.click(x, y);
          expect(await spine()).toBe(0);
        }
        const input = await context.newCDPSession(page);
        const drag = async (startX: number, startY: number, endX: number, endY: number) => {
          await input.send("Input.dispatchMouseEvent", {
            type: "mousePressed", x: startX, y: startY, button: "left", buttons: 1, clickCount: 1,
          });
          await input.send("Input.dispatchMouseEvent", {
            type: "mouseMoved", x: endX, y: endY, button: "left", buttons: 1,
          });
          await input.send("Input.dispatchMouseEvent", {
            type: "mouseReleased", x: endX, y: endY, button: "left", buttons: 0, clickCount: 1,
          });
        };
        await drag(width - band - 2, y, width - band + 2, y);
        expect(await spine()).toBe(0);
        await drag(forwardX, y, forwardX, y + 20);
        await input.detach();
        expect(await spine()).toBe(0);

        const frame = page.frameLocator("iframe");
        await frame.getByRole("button", { name: "Button", exact: true }).click();
        expect(await spine()).toBe(0);
        await frame.getByRole("checkbox").check();
        await expect(frame.getByRole("checkbox")).toBeChecked();
        expect(await spine()).toBe(0);
        await frame.locator("summary").click();
        await expect(frame.locator("details")).toHaveAttribute("open", "");
        expect(await spine()).toBe(0);

        await page.locator("iframe").evaluate(frame => {
          const doc = (frame as HTMLIFrameElement).contentDocument!;
          const range = doc.createRange();
          range.selectNodeContents(doc.getElementById("text")!);
          doc.getSelection()!.removeAllRanges();
          doc.getSelection()!.addRange(range);
        });
        await page.mouse.click(forwardX, y);
        expect(await spine()).toBe(0);
        await page.locator("iframe").evaluate(frame =>
          (frame as HTMLIFrameElement).contentDocument!.getSelection()!.removeAllRanges());

        await page.mouse.move(10, 2);
        await expect(toolbar).toHaveCSS("opacity", "1");
        await page.mouse.click(forwardX, y);
        await expect(toolbar).toHaveCSS("opacity", "0");
        expect(await spine()).toBe(0);
        await page.touchscreen.tap(forwardX, y);
        await expect.poll(spine).toBe(1);
        await settled(page);
        expect(await page.evaluate(() => {
          const frame = document.querySelector("iframe")!;
          return document.activeElement === frame && frame.contentDocument!.activeElement?.isConnected;
        })).toBe(true);
        await page.mouse.click(backwardX, y);
        await expect.poll(spine).toBe(0);
        await settled(page);
        await frame.getByRole("link", { name: "Jump to last" }).click();
        await expect.poll(spine).toBe(2);
        await settled(page);
        const bookmark = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ });
        await bookmark.focus();
        await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(-1));
        await expect.poll(spine).toBe(1);
        await expect(bookmark).toBeFocused();
      } finally {
        await context.close();
      }
    });
  }
}

test("external wide fixed-layout sample turns from artwork edges", async () => {
  const book = process.env.AMBRA_WIDE_FXL_SAMPLE;
  test.skip(!book, "Opt-in local reproduction; public samples are never stored in the repository.");
  const { context, readerPage: page } = await launchReader(book!, {
    viewport: { width: 1200, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await page.evaluate(() => Reflect.get(window, "__readerController").setPageTurnAnimationStyle("none"));
    await settled(page);
    await page.mouse.move(600, 450);
    await expect(page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ })
      .locator("..")).toHaveCSS("opacity", "0");
    const rect = (await page.locator("iframe").boundingBox())!;
    expect(rect.x).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(1200);
    const spine = () => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex);
    expect(await spine()).toBe(0);
    await page.mouse.click(1190, 450);
    await expect.poll(spine).toBe(1);
    await settled(page);
    await page.mouse.click(10, 450);
    await expect.poll(spine).toBe(0);
  } finally {
    await context.close();
  }
});
