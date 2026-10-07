import { test, expect, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function svgPublication(info: TestInfo, layout: "pre-paginated" | "reflowable"): string {
  const source = info.outputPath("svg-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:synthetic-svg-spine</dc:identifier><dc:title>SVG spine regression</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-25T00:00:00Z</meta><meta property="rendition:layout">${layout}</meta><meta property="rendition:spread">none</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${[0, 1, 2].map(i => `<item id="s${i}" href="s${i}.svg" media-type="image/svg+xml"/>`).join("")}</manifest><spine>${[0, 1, 2].map(i => `<itemref idref="s${i}"/>`).join("")}</spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${[0, 1, 2].map(i => `<li><a href="s${i}.svg">Page ${i + 1}</a></li>`).join("")}</ol></nav></body></html>`);
  for (const i of [0, 1, 2]) {
    fs.writeFileSync(path.join(source, `EPUB/s${i}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 600 800" aria-labelledby="title description"><title id="title">SVG page ${i + 1}</title><desc id="description">Original geometric reading test.</desc><defs><linearGradient id="fill"><stop stop-color="white"/><stop offset="1" stop-color="lightblue"/></linearGradient></defs><rect width="600" height="800" fill="url(#fill)"/><text x="20" y="80">SVG page ${i + 1}</text><script>document.documentElement.setAttribute('data-script-ran', 'true')</script></svg>`);
  }
  const book = info.outputPath("svg-spine.epub");
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "EPUB"], { cwd: source });
  return book;
}

test("standalone SVG spine opens, retains native focus and resumes without errors", async () => {
  const book = svgPublication(test.info(), "pre-paginated");
  const { context, readerPage } = await launchReader(book, { viewport: { width: 1672, height: 902 } });
  try {
    await exposeReaderController(readerPage);
    const inspect = () => readerPage.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const frame = [...document.querySelectorAll("iframe")].find(frame => frame.contentDocument?.documentElement.localName === "svg")!;
      const doc = frame.contentDocument!;
      const point = controller.host.currentPosition();
      return {
        spine: controller.snapshot().spineIndex,
        diagnostics: controller.getDiagnosticsText(),
        body: doc.body,
        size: [frame.style.width, frame.style.height],
        positionRoot: point?.node === doc.documentElement,
        focused: document.activeElement === frame,
        activeRoot: doc.activeElement === doc.documentElement,
        sandbox: frame.getAttribute("sandbox"),
        scriptRan: doc.documentElement.hasAttribute("data-script-ran"),
        title: doc.querySelector("title")?.textContent,
      };
    });
    const initial = await inspect();
    expect(initial.diagnostics).not.toContain("ERROR");
    expect(initial).toMatchObject({
      spine: 0, body: null, size: ["600px", "800px"], positionRoot: true,
      focused: true, activeRoot: true, sandbox: "allow-same-origin", scriptRan: false,
      title: "SVG page 1",
    });
    await readerPage.keyboard.press("ArrowRight");
    await expect.poll(async () => {
      const state = await inspect();
      return { spine: state.spine, focused: state.focused, activeRoot: state.activeRoot };
    }).toEqual({ spine: 1, focused: true, activeRoot: true });
    await expect.poll(() => readerPage.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      return controller.isTurningPage || controller.isLoadInFlight;
    })).toBe(false);
    await readerPage.evaluate(async () => Reflect.get(window, "__readerController").flushProgress());
    await readerPage.reload();
    await expect.poll(() => readerPage.evaluate(() =>
      [...document.querySelectorAll("iframe")].some(frame => frame.contentDocument?.documentElement.localName === "svg"),
    )).toBe(true);
    await exposeReaderController(readerPage);
    await expect.poll(async () => (await inspect()).spine).toBe(1);
    expect((await inspect()).diagnostics).not.toContain("ERROR");
    await readerPage.keyboard.press("ArrowLeft");
    await expect.poll(async () => {
      const state = await inspect();
      return { spine: state.spine, focused: state.focused, activeRoot: state.activeRoot };
    }).toEqual({ spine: 0, focused: true, activeRoot: true });
  } finally {
    await context.close();
  }
});

test("reflowable SVG stays native through paging, scrolling, resize and resume", async () => {
  const book = svgPublication(test.info(), "reflowable");
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 900, height: 900 } });
  try {
    await exposeReaderController(page);
    const frame = page.getByRole("main").locator("iframe").first();
    const inspect = () => frame.evaluate(frame => {
      if (!(frame instanceof HTMLIFrameElement)) throw new Error("Content host is not an iframe.");
      const controller = Reflect.get(window, "__readerController");
      if (!frame.contentDocument) throw new Error("Original SVG frame is absent.");
      const doc = frame.contentDocument;
      const root = doc.documentElement;
      const text = doc.querySelector("text");
      if (!text) throw new Error("Authored SVG text is absent.");
      const bounds = text.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      const hit = doc.elementFromPoint(x, y);
      const outer = frame.getBoundingClientRect();
      const parentHit = document.elementFromPoint(outer.left + x * outer.width / frame.clientWidth,
        outer.top + y * outer.height / frame.clientHeight);
      const point = controller.host.currentPosition();
      return {
        spine: controller.snapshot().spineIndex,
        mode: controller.snapshot().viewMode,
        root: root.localName,
        body: doc.body,
        title: doc.querySelector("title")?.textContent,
        painted: bounds.width > 0 && bounds.height > 0 && !!hit && (hit === text || text.contains(hit)) &&
          outer.width > 0 && outer.height > 0 && parentHit === frame,
        positionRoot: point?.node === root,
        sandbox: frame.getAttribute("sandbox"),
        scriptRan: root.hasAttribute("data-script-ran"),
        diagnostics: controller.getDiagnosticsText(),
      };
    });
    const assertOriginal = async (spine: number, mode = "paginated") => {
      await page.waitForFunction(() => {
        const controller = Reflect.get(window, "__readerController");
        return controller?.host && !controller.isLoadInFlight && !controller.isTurningPage &&
          !controller.isApplyingLayout && !controller.pendingLayout;
      });
      await expect(frame.contentFrame().locator(":root")).toHaveAttribute("xmlns", "http://www.w3.org/2000/svg");
      await expect.poll(async () => {
        const state = await inspect();
        return { spine: state.spine, mode: state.mode, painted: state.painted, positionRoot: state.positionRoot };
      }).toEqual({ spine, mode, painted: true, positionRoot: true });
      const state = await inspect();
      expect(state).toMatchObject({ root: "svg", body: null, title: `SVG page ${spine + 1}`,
        sandbox: "allow-same-origin", scriptRan: false });
      expect(state.diagnostics).not.toContain("ERROR");
      await expect(page.getByRole("alert")).toHaveCount(0);
    };
    await assertOriginal(0);
    await page.evaluate(() => Reflect.get(window, "__readerController").setAlwaysShowOnePage(true));
    await page.keyboard.press("ArrowRight");
    await assertOriginal(1);
    await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("scroll"));
    await assertOriginal(1, "scroll");
    await page.setViewportSize({ width: 1100, height: 780 });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").appliedWidth)).toBe(1100);
    await assertOriginal(1, "scroll");
    await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("paginated"));
    await assertOriginal(1);
    await page.evaluate(() => Reflect.get(window, "__readerController").flushProgress());
    await page.reload();
    await expect(page.getByRole("main").locator("iframe").first()).toBeVisible();
    await exposeReaderController(page);
    await assertOriginal(1);
    await page.keyboard.press("ArrowLeft");
    await assertOriginal(0);
  } finally {
    await context.close();
  }
});

test("external SVG-in-spine sample has no startup error", async () => {
  const book = process.env.AMBRA_SVG_SAMPLE;
  test.skip(!book, "Opt-in local reproduction; public samples are never stored in the repository.");
  const { context, readerPage } = await launchReader(book!, { viewport: { width: 1672, height: 902 } });
  try {
    await exposeReaderController(readerPage);
    const state = await readerPage.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const frame = document.querySelector("iframe")!;
      return {
        diagnostics: controller.getDiagnosticsText(),
        size: [frame.style.width, frame.style.height],
        root: frame.contentDocument?.documentElement.localName,
        body: frame.contentDocument?.body,
        sandbox: frame.getAttribute("sandbox"),
      };
    });
    console.log(JSON.stringify(state));
    expect(state.diagnostics).not.toContain("ERROR");
    expect(state.size).toEqual(["1571px", "2068px"]);
    expect(state.root).toBe("svg");
    expect(state.body).toBeNull();
    expect(state.sandbox).toBe("allow-same-origin");
  } finally {
    await context.close();
  }
});
