import { test, expect, type TestInfo, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

function svgPublication(info: TestInfo, layout: "pre-paginated" | "reflowable",
  variant: "original" | "geometry" | "mixed" = "original"): string {
  const indices = variant === "geometry" ? [0, 1, 2, 3] : [0, 1, 2];
  const source = info.outputPath("svg-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:synthetic-svg-spine:${layout}:${variant}</dc:identifier><dc:title>3.1.5 SVG presentation ${layout} ${variant}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-25T00:00:00Z</meta><meta property="rendition:layout">${layout}</meta><meta property="rendition:spread">${variant === "original" ? "none" : "both"}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${indices.map(i => `<item id="s${i}" href="s${i}.${variant === "mixed" && i === 1 ? "xhtml" : "svg"}" media-type="${variant === "mixed" && i === 1 ? "application/xhtml+xml" : "image/svg+xml"}"/>`).join("")}</manifest><spine>${indices.map(i => `<itemref idref="s${i}"/>`).join("")}</spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${indices.map(i => `<li><a href="s${i}.${variant === "mixed" && i === 1 ? "xhtml" : "svg"}">Page ${i + 1}</a></li>`).join("")}</ol></nav></body></html>`);
  for (const i of indices) {
    if (variant === "mixed" && i === 1) {
      fs.writeFileSync(path.join(source, "EPUB/s1.xhtml"),
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>XHTML page 2</title></head><body><p>Ordinary reflowable XHTML between SVG pages.</p></body></html>');
      continue;
    }
    const attributes = variant === "geometry" ? [
      'viewBox="0 0 360 110"', 'width="200" height="200"',
      'width="320" height="180" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"',
      'viewBox="0 0 240 480"',
    ][i] : 'width="100%" height="100%" viewBox="0 0 600 800"';
    const canvas = variant === "geometry" ? [[360, 110], [200, 200], [100, 100], [240, 480]][i]! : [600, 800];
    fs.writeFileSync(path.join(source, `EPUB/s${i}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" ${attributes} aria-labelledby="title description"><title id="title">SVG page ${i + 1}</title><desc id="description">Original geometric reading test.</desc><defs><linearGradient id="fill"><stop stop-color="white"/><stop offset="1" stop-color="lightblue"/></linearGradient></defs><rect id="canvas" width="${canvas[0]}" height="${canvas[1]}" fill="url(#fill)"/>${variant === "geometry" && i === 2 ? '<rect id="clipped" x="0" y="0" width="100" height="10" fill="red"/>' : ""}<text x="20" y="${variant === "geometry" ? 30 : 80}" style="font-size:${variant === "geometry" && i === 0 ? 5 : 16}px;fill:black">SVG page ${i + 1}</text><script>document.documentElement.setAttribute('data-script-ran', 'true')</script></svg>`);
  }
  const book = info.outputPath(`3.1.5-svg-${layout}-${variant}.epub`);
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", book, "META-INF", "EPUB"], { cwd: source });
  return book;
}

async function settleSvg(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isLoadInFlight && !c.isTurningPage && !c.isApplyingLayout && !c.pendingLayout;
  });
}

async function geometry(page: Page) {
  await settleSvg(page);
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const hostBounds = c.host.element.getBoundingClientRect();
    const views: readonly { document: Document; spineIndex: number }[] = c.contentDocumentViews();
    return {
      index: c.snapshot().spineIndex, mode: c.snapshot().viewMode,
      rollIndex: c.host.currentSpineIndex,
      readingIndex: views.find(view => view.document === c.host.currentPosition()?.node.ownerDocument)?.spineIndex,
      width: c.width, height: c.height,
      scrollTop: c.host.element.scrollTop, scrollHeight: c.host.element.scrollHeight,
      clientWidth: c.host.element.clientWidth, clientHeight: c.host.element.clientHeight,
      authorLayout: c.pkg.metadata.renditionLayout,
      authorItems: c.pkg.spine.map((item: { resolveRenditionLayout: (layout: string) => string }) =>
        item.resolveRenditionLayout(c.pkg.metadata.renditionLayout)),
      count: c.snapshot().bookPageCount,
      frames: views.map(view => {
        const frame = [...document.querySelectorAll("iframe")].find(frame => frame.contentDocument === view.document);
        if (!frame) throw new Error("Committed publication frame is absent.");
        const root = view.document.documentElement;
        const outer = frame.getBoundingClientRect();
        const rootBounds = root.getBoundingClientRect();
        const canvas = view.document.getElementById("canvas")?.getBoundingClientRect();
        return {
          index: view.spineIndex, root: root.localName, namespace: root.namespaceURI,
          width: outer.width, height: outer.height,
          x: outer.left - hostBounds.left, y: outer.top - hostBounds.top,
          logicalWidth: frame.clientWidth, logicalHeight: frame.clientHeight,
          rootWidth: rootBounds.width, rootHeight: rootBounds.height,
          paintedCanvasWidth: canvas ? canvas.width * outer.width / frame.clientWidth : undefined,
          paintedCanvasHeight: canvas ? canvas.height * outer.height / frame.clientHeight : undefined,
          transform: view.document.defaultView?.getComputedStyle(root).transform,
          viewBox: root.getAttribute("viewBox"), authoredWidth: root.getAttribute("width"),
          authoredHeight: root.getAttribute("height"), aspect: root.getAttribute("preserveAspectRatio"),
          font: view.document.querySelector("text")?.getAttribute("style"),
          clippedHit: view.document.elementFromPoint(frame.clientWidth / 2, 2)?.id === "clipped",
          scriptRan: root.hasAttribute("data-script-ran"), sandbox: frame.getAttribute("sandbox"),
        };
      }),
      diagnostics: c.getDiagnosticsText(),
    };
  });
}

async function assertCanvasFit(page: Page) {
  const state = await geometry(page);
  const frames = state.frames;
  expect(frames.length).toBeGreaterThan(0);
  let totalWidth = 0;
  let maximumHeight = 0;
  const scales: number[] = [];
  for (const frame of frames) {
    expect(["svg", "html"]).toContain(frame.root);
    if (frame.root === "svg") {
      expect(frame.namespace).toBe("http://www.w3.org/2000/svg");
      expect(frame.rootWidth).toBeCloseTo(frame.logicalWidth, 1);
      expect(frame.rootHeight).toBeCloseTo(frame.logicalHeight, 1);
      expect(frame.transform).toBe("none");
    }
    expect(frame.height / frame.width).toBeCloseTo(frame.logicalHeight / frame.logicalWidth, 3);
    expect(frame.y).toBeCloseTo((state.height - frame.height) / 2, 1);
    expect(frame.scriptRan).toBe(false);
    expect(frame.sandbox).toBe("allow-same-origin");
    totalWidth += frame.width;
    maximumHeight = Math.max(maximumHeight, frame.height);
    scales.push(frame.width / frame.logicalWidth);
  }
  expect(totalWidth).toBeLessThanOrEqual(state.width + 1);
  expect(maximumHeight).toBeLessThanOrEqual(state.height + 1);
  expect(Math.min(Math.abs(totalWidth - state.width), Math.abs(maximumHeight - state.height))).toBeLessThan(1);
  expect(Math.min(...frames.map(frame => frame.x))).toBeCloseTo((state.width - totalWidth) / 2, 1);
  for (const scale of scales) expect(scale).toBeCloseTo(scales[0]!, 3);
  expect(state.diagnostics).not.toContain("ERROR");
  return state;
}

for (const layout of ["reflowable", "pre-paginated"] as const) {
  test(`${layout} SVG canvases enlarge, shrink and share one spread scale without changing authored viewports (#379)`, async () => {
    const { context, readerPage: page } = await launchReader(svgPublication(test.info(), layout, "geometry"),
      { viewport: { width: 620, height: 900 } });
    try {
      await exposeReaderController(page);
      const narrow = await assertCanvasFit(page);
      expect(narrow.frames.map(frame => frame.index)).toEqual([0]);
      expect(narrow.frames[0]).toMatchObject({ logicalWidth: 360, logicalHeight: 110,
        authoredWidth: null, authoredHeight: null, viewBox: "0 0 360 110", font: "font-size:5px;fill:black" });
      expect(narrow.frames[0]!.width / 360).toBeGreaterThan(1);
      await page.setViewportSize({ width: 1600, height: 900 });
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").appliedWidth)).toBe(1600);
      const wide = await assertCanvasFit(page);
      expect(wide.frames.map(frame => frame.index)).toEqual([0, 1]);
      expect(wide.frames[1]).toMatchObject({ logicalWidth: 200, logicalHeight: 200, viewBox: null });
      if (layout === "reflowable") {
        await page.getByRole("button", { name: "Book details", exact: true }).click();
        await page.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
        const inspector = page.getByRole("dialog", { name: "EPUB Inspector", exact: true });
        await expect(inspector.getByRole("img", { name: "EPUB/s0.svg", exact: true })).toBeVisible();
        await inspector.getByRole("button", { name: "Dock left", exact: true }).click();
        await expect.poll(async () => (await geometry(page)).width).toBeLessThan(wide.width);
        await assertCanvasFit(page);
        await inspector.getByRole("button", { name: "Close EPUB Inspector", exact: true }).click();
        await expect.poll(async () => (await geometry(page)).width).toBe(wide.width);
        await assertCanvasFit(page);
      }
      await page.evaluate(() => Reflect.get(window, "__readerController").openSpineItem(2));
      const next = await assertCanvasFit(page);
      expect(next.frames.map(frame => frame.index)).toEqual([2, 3]);
      expect(next.frames[0]).toMatchObject({ logicalWidth: 320, logicalHeight: 180,
        viewBox: "0 0 100 100", aspect: "xMidYMid slice", clippedHit: false });
      if (layout === "reflowable") {
        await page.evaluate(() => Reflect.get(window, "__readerController").setAlwaysShowOnePage(true));
        expect((await assertCanvasFit(page)).frames.map(frame => frame.index)).toEqual([2]);
        await page.evaluate(() => Reflect.get(window, "__readerController").setAlwaysShowOnePage(false));
        expect((await assertCanvasFit(page)).frames.map(frame => frame.index)).toEqual([2, 3]);
      }
      await page.setViewportSize({ width: 620, height: 360 });
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").appliedWidth)).toBe(620);
      await page.evaluate(() => Reflect.get(window, "__readerController").openSpineItem(3));
      const reduced = await assertCanvasFit(page);
      expect(reduced.frames.map(frame => frame.index)).toEqual([3]);
      expect(reduced.frames[0]!.width / 240).toBeLessThan(1);
      expect(reduced.authorLayout).toBe(layout);
      expect(reduced.authorItems).toEqual([layout, layout, layout, layout]);
      expect(reduced.count).toBe(4);
    } finally {
      await context.close();
    }
  });
}

for (const original of [false, true]) {
  test(`${original ? "original W3C order" : "different-sized"} SVG pages form a centered gapless continuous scroll with coherent navigation/resume (#373)`, async () => {
    const external = process.env.AMBRA_SVG_SPINE_ORDER_EPUB;
    test.skip(original && !external, "Opt-in original W3C SVG spine order book.");
    const book = original ? external! : svgPublication(test.info(), "reflowable", "geometry");
    const { context, readerPage: page } = await launchReader(book, { viewport: { width: 800, height: 900 } });
    try {
      await exposeReaderController(page);
      await page.getByRole("button", { name: /ambra settings/i }).click();
      await page.getByLabel("Reading mode", { exact: true }).selectOption("scroll");
      await page.keyboard.press("Escape");
      const state = await geometry(page);
      expect(state.mode).toBe("scroll");
      expect(state.frames.map(frame => frame.index)).toEqual([0, 1, 2, 3]);
      expect(state.scrollHeight).toBeGreaterThan(state.clientHeight);
      let bottom = -state.scrollTop;
      for (const frame of state.frames) {
        expect(frame.x).toBeCloseTo(0, 1);
        expect(frame.width).toBeCloseTo(state.clientWidth, 1);
        expect(frame.y).toBeCloseTo(bottom, 1);
        expect(frame.height).toBeCloseTo(frame.width * frame.logicalHeight / frame.logicalWidth, 1);
        expect(frame.rootWidth).toBeCloseTo(frame.logicalWidth, 1);
        expect(frame.rootHeight).toBeCloseTo(frame.logicalHeight, 1);
        expect(frame.scriptRan).toBe(false);
        bottom += frame.height;
      }
      await page.getByRole("main").hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 120);
      await expect.poll(async () => (await geometry(page)).scrollTop).toBeGreaterThan(0);
      if (original) {
        await page.evaluate(() => Reflect.get(window, "__readerController").openSpineItem(2));
      } else {
        await page.getByRole("button", { name: "Contents", exact: true }).click();
        await page.getByRole("button", { name: /^Page 3(,|$)/ }).click();
      }
      await expect.poll(async () => (await geometry(page)).index).toBe(2);
      await page.setViewportSize({ width: 700, height: 750 });
      await expect.poll(async () => (await geometry(page)).width).toBe(700);
      expect((await geometry(page)).index).toBe(2);
      await page.getByRole("main").hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(0, 100);
      await expect.poll(async () => (await geometry(page)).frames.find(frame => frame.index === 2)?.y).toBeLessThan(-50);
      const beforeResume = (await geometry(page)).frames.find(frame => frame.index === 2)!;
      const resumeFraction = -beforeResume.y / beforeResume.height;
      await page.evaluate(() => Reflect.get(window, "__readerController").flushProgress());
      await page.reload();
      await expect(page.getByRole("main").locator("iframe").first()).toBeAttached();
      await exposeReaderController(page);
      await expect.poll(async () => (await geometry(page)).index).toBe(2);
      expect((await geometry(page)).mode).toBe("scroll");
      const resumed = (await geometry(page)).frames.find(frame => frame.index === 2)!;
      expect(-resumed.y / resumed.height).toBeCloseTo(resumeFraction, 2);
      await page.evaluate(() => Reflect.get(window, "__readerController").setAlwaysShowOnePage(true));
      await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
      await page.keyboard.press("Alt+Shift+PageUp");
      await expect.poll(async () => (await geometry(page)).mode).toBe("paginated");
      expect((await assertCanvasFit(page)).frames.map(frame => frame.index)).toEqual([2]);
      expect((await geometry(page)).authorLayout).toBe("reflowable");
      await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
      await page.keyboard.press("Alt+Shift+PageDown");
      await expect.poll(async () => (await geometry(page)).mode).toBe("scroll");
      expect((await geometry(page)).index).toBe(2);
      expect((await geometry(page)).frames).toHaveLength(4);
      const returned = (await geometry(page)).frames.find(frame => frame.index === 2)!;
      expect(-returned.y / returned.height).toBeCloseTo(resumeFraction, 2);
      await page.evaluate(() => Reflect.get(window, "__readerController").seekToFraction(1));
      await expect.poll(async () => (await geometry(page)).index).toBe(3);
      expect((await geometry(page)).rollIndex).toBe(3);
      expect((await geometry(page)).readingIndex).toBe(3);
      if (original) {
        await page.setViewportSize({ width: 320, height: 1800 });
        await expect.poll(async () => (await geometry(page)).width).toBe(320);
        expect((await geometry(page)).scrollHeight).toBeLessThanOrEqual((await geometry(page)).clientHeight);
        expect((await geometry(page)).rollIndex).toBe(3);
        expect((await geometry(page)).readingIndex).toBe(3);
      }
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test("pixel-coordinate SVG without a viewBox scales the drawn canvas, not only its viewport (#379)", async () => {
  const { context, readerPage: page } = await launchReader(svgPublication(test.info(), "reflowable", "geometry"),
    { viewport: { width: 620, height: 900 } });
  try {
    await exposeReaderController(page);
    await page.evaluate(() => Reflect.get(window, "__readerController").openSpineItem(1));
    const state = await geometry(page);
    const frame = state.frames[0]!;
    expect(frame.viewBox).toBeNull();
    expect(frame.paintedCanvasWidth).toBeCloseTo(state.width, 1);
    expect(frame.paintedCanvasHeight).toBeCloseTo(state.width, 1);
    expect(frame.paintedCanvasWidth).toBeGreaterThan(200);
    await assertCanvasFit(page);
  } finally {
    await context.close();
  }
});

test("mixed SVG/XHTML books fit SVG pagination without joining chapters into a fixed scroll (#373/#379)", async () => {
  const { context, readerPage: page } = await launchReader(svgPublication(test.info(), "reflowable", "mixed"),
    { viewport: { width: 1600, height: 900 } });
  try {
    await exposeReaderController(page);
    expect((await assertCanvasFit(page)).frames.map(frame => frame.index)).toEqual([0]);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await geometry(page)).index).toBe(1);
    expect((await geometry(page)).frames.every(frame => frame.root === "html")).toBe(true);
    await page.evaluate(() => Reflect.get(window, "__readerController").openSpineItem(2));
    expect((await assertCanvasFit(page)).frames.map(frame => frame.index)).toEqual([2]);
    await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("scroll"));
    const scroll = await geometry(page);
    expect(scroll.mode).toBe("scroll");
    expect(scroll.frames).toHaveLength(1);
    expect(scroll.frames[0]!.index).toBe(2);
    await page.evaluate(() => Reflect.get(window, "__readerController").openSpineItem(1));
    expect((await geometry(page)).frames.every(frame => frame.root === "html")).toBe(true);
    expect((await geometry(page)).mode).toBe("scroll");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const name of ["mol-timing-synchronization_svg", "mol-timing-synchronization_svg-fxl"]) {
  test(`original W3C ${name}: small SVG fills its actual pane with narration controls and after resize (#379)`, async () => {
    const directory = process.env.AMBRA_SVG_NARRATION_EPUB_DIR;
    test.skip(!directory, "Opt-in original W3C SVG timing books.");
    const { context, readerPage: page } = await launchReader(path.join(directory!, `${name}.epub`),
      { viewport: { width: 1000, height: 800 } });
    try {
      await exposeReaderController(page);
      await page.evaluate(() => Reflect.get(window, "__readerController").goToChapter(1));
      const initial = await assertCanvasFit(page);
      const svg = initial.frames.find(frame => frame.root === "svg");
      expect(svg).toMatchObject({ logicalWidth: 360, logicalHeight: 110, viewBox: "0 0 360 110" });
      if (name === "mol-timing-synchronization_svg") expect(svg?.width).toBeGreaterThan(360);
      await page.mouse.move(350, 2);
      await page.getByRole("button", { name: "Play narration", exact: true }).click();
      await expect.poll(() => page.evaluate(() =>
        document.querySelector<HTMLAudioElement>("audio[data-ambra-narration-audio]")?.currentTime)).toBeGreaterThan(0.1);
      await assertCanvasFit(page);
      await page.getByRole("button", { name: "Pause narration", exact: true }).click();
      await page.setViewportSize({ width: 640, height: 760 });
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").appliedWidth)).toBe(640);
      const resized = await assertCanvasFit(page);
      expect(resized.frames.find(frame => frame.root === "svg")).toMatchObject({
        logicalWidth: 360, logicalHeight: 110, viewBox: "0 0 360 110" });
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
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
    const inspect = () => page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const view = controller.host.documentViews().find((view: { spineIndex: number }) =>
        view.spineIndex === controller.snapshot().spineIndex);
      const frame = [...document.querySelectorAll("iframe")].find(frame => frame.contentDocument === view?.document);
      if (!frame) throw new Error("Current original SVG frame is absent.");
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
        positionDocument: point?.node === root || point?.node.ownerDocument === doc,
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
        return { spine: state.spine, mode: state.mode, painted: state.painted, positionDocument: state.positionDocument };
      }).toEqual({ spine, mode, painted: true, positionDocument: true });
      const state = await inspect();
      if (mode === "paginated") expect(state.positionRoot).toBe(true);
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
