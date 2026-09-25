import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

test("standalone SVG spine opens, retains native focus and resumes without errors", async () => {
  const info = test.info();
  const source = info.outputPath("svg-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:synthetic-svg-spine</dc:identifier><dc:title>SVG spine regression</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-25T00:00:00Z</meta><meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">none</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${[0, 1, 2].map(i => `<item id="s${i}" href="s${i}.svg" media-type="image/svg+xml"/>`).join("")}</manifest><spine>${[0, 1, 2].map(i => `<itemref idref="s${i}"/>`).join("")}</spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${[0, 1, 2].map(i => `<li><a href="s${i}.svg">Page ${i + 1}</a></li>`).join("")}</ol></nav></body></html>`);
  for (const i of [0, 1, 2]) {
    fs.writeFileSync(path.join(source, `EPUB/s${i}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 600 800" aria-labelledby="title description"><title id="title">SVG page ${i + 1}</title><desc id="description">Original geometric reading test.</desc><defs><linearGradient id="fill"><stop stop-color="white"/><stop offset="1" stop-color="lightblue"/></linearGradient></defs><rect width="600" height="800" fill="url(#fill)"/><text x="20" y="80">SVG page ${i + 1}</text><script>document.documentElement.setAttribute('data-script-ran', 'true')</script></svg>`);
  }
  const book = info.outputPath("svg-spine.epub");
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "EPUB"], { cwd: source });
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
