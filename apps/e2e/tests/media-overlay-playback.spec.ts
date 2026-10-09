import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { strToU8, unzipSync, zipSync } from "fflate";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

// Regenerate: node apps/e2e/scripts/generate-media-overlay-fixtures.mjs
// Reflowable chapters have three four-second PCM WAV clips; fixed-layout pages have one.
// Boundary seeks supplement (not replace) genuine HTMLAudioElement progression.
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const narrated = path.join(fixtures, "media-overlay/narrated.epub");
const audioSelector = "audio[data-ambra-narration-audio]";
const controls = (page: Page) => page.getByRole("region", { name: "Narration controls" });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const position = (page: Page) => page.getByRole("slider", { name: "Position in book" });
const speedButton = (page: Page) => controls(page).getByRole("button", { name: /^Narration speed/ });

function boundaryFixture(info: TestInfo): string {
  const entries = unzipSync(fs.readFileSync(narrated));
  entries["EPUB/chapter-1.xhtml"] = strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>3.1.2 Narration boundary</title>
    <style>p{margin:0!important;break-inside:avoid;min-height:400px}.synthetic-narration-active{background:#ffe082}</style></head><body>
    <p id="c1-p1">First narrated passage.</p>
    <p id="c1-p2">${"The second narrated passage spans several lines of the next rendered page. ".repeat(12)}</p>
    <p id="c1-p3">Third narrated passage.</p></body></html>`);
  entries["EPUB/package.opf"] = strToU8(new TextDecoder().decode(entries["EPUB/package.opf"]!)
    .replace("Synthetic narration narrated", "3.1.2 Narration clipped-page boundary"));
  const file = info.outputPath("3.1.2-narration-page-boundary.epub");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  return file;
}

async function passagePaint(page: Page, id?: string, edge: "first" | "last" = "first") {
  return page.evaluate(({ fragment, edge }) => {
    const controller = Reflect.get(window, "__readerController");
    const views = controller.contentDocumentViews();
    const position = fragment ? undefined : controller.host.currentPosition();
    const results = [];
    for (const view of views) {
      const doc: Document = view.document;
      const node: Node | undefined = position?.node;
      if (!fragment && node?.ownerDocument !== doc) continue;
      const element = fragment ? doc.getElementById(fragment) : node?.parentElement;
      const window = doc.defaultView;
      if (!element || !window) continue;
      const frame = window.frameElement;
      if (!(frame instanceof HTMLIFrameElement)) throw new Error("Missing narrated frame.");
      const range = doc.createRange();
      if (!fragment) {
        const frameRect = frame.getBoundingClientRect();
        const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (!text.textContent?.trim() || !text.parentElement) continue;
          range.selectNodeContents(text);
          for (const rect of range.getClientRects()) {
            if (rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.bottom > window.innerHeight) continue;
            const x = (rect.left + rect.right) / 2;
            const y = (rect.top + rect.bottom) / 2;
            if (text.parentElement.contains(doc.elementFromPoint(x, y)) &&
              frame.ownerDocument.elementFromPoint(frameRect.left + x * frameRect.width / window.innerWidth,
                frameRect.top + y * frameRect.height / window.innerHeight) === frame) {
              return { withinLayoutViewport: true, painted: true };
            }
          }
        }
        return { withinLayoutViewport: false, painted: false };
      } else {
        range.selectNodeContents(element);
      }
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
      const rect = edge === "first" ? rects[0] : rects.at(-1);
      if (!rect) throw new Error("The narrated passage has no rendered text.");
      const frameRect = frame.getBoundingClientRect();
      const x = (rect.left + rect.right) / 2;
      const scaleX = frameRect.width / window.innerWidth;
      const scaleY = frameRect.height / window.innerHeight;
      const probeYs = edge === "first" ? [(rect.top + rect.bottom) / 2] : [rect.top + 1, rect.bottom - 1];
      results.push({
        withinLayoutViewport: rect.top >= 0 && rect.top < window.innerHeight &&
          rect.left >= 0 && rect.left < window.innerWidth,
        painted: probeYs.every(y =>
          (fragment ? doc.elementFromPoint(x, y)?.closest(`#${fragment}`) === element
            : element.contains(doc.elementFromPoint(x, y))) &&
          frame.ownerDocument.elementFromPoint(frameRect.left + x * scaleX, frameRect.top + y * scaleY) === frame),
      });
    }
    return results.find(result => result.painted) ?? results[0];
  }, { fragment: id, edge });
}

for (const reference of ["audio", "text", "textref"] as const) {
  test(`non-package SMIL ${reference} cannot alias packaged narration resources (#336, #337)`, async ({ browserName: _browserName }, info) => {
    const entries = unzipSync(fs.readFileSync(narrated));
    const audio = reference === "audio"
      ? "https://example.invalid/EPUB/audio/chapter-1.wav" : "audio/chapter-1.wav";
    const text = reference === "text"
      ? "https://example.invalid/EPUB/chapter-1.xhtml#c1-p1" : "chapter-1.xhtml#c1-p1";
    const textref = reference === "textref"
      ? "https://example.invalid/EPUB/chapter-1.xhtml#c1-p1" : "chapter-1.xhtml#c1-p1";
    entries["EPUB/overlay-1.smil"] = strToU8(`<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops">
      <body><seq epub:textref="${textref}"><par><text src="${text}"/>
      <audio src="${audio}" clipBegin="0s" clipEnd="4s"/></par></seq></body></smil>`);
    const file = info.outputPath(`non-package-${reference}.epub`);
    fs.writeFileSync(file, zipSync(entries, { level: 0 }));
    const requests: string[] = [];
    const errors: string[] = [];
    const { readerPage: page, context } = await launchReader(file, {
      beforeBookImport: async library => {
        library.context().on("request", request => {
          if (new URL(request.url()).hostname === "example.invalid") requests.push(request.url());
        });
        library.context().on("page", opened => opened.on("pageerror", error => errors.push(error.message)));
      },
    });
    try {
      await exposeReaderController(page);
      await page.mouse.move(350, 2);
      await button(page, "Play narration").click();
      await expect(controls(page).getByRole("status")).toHaveText("Narration could not be played.");
      expect(await audioState(page)).toMatchObject({ source: "", error: null, paused: true });
      expect(await page.evaluate(() =>
        Reflect.get(window, "__readerController").narration.snapshot.error,
      )).toContain("requires a packaged resource");
      await expect(page.frameLocator("iframe").first().locator("h1")).toHaveText("Narrated chapter 1");
      expect(requests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("narration clamps an authored end beyond real audio duration and advances at native media completion (#337)", async ({ browserName: _browserName }, info) => {
  const entries = unzipSync(fs.readFileSync(narrated));
  entries["EPUB/overlay-1.smil"] = strToU8('<smil xmlns="http://www.w3.org/ns/SMIL"><body><par><text src="chapter-1.xhtml#c1-p1"/><audio src="audio/chapter-1.wav" clipBegin="0s" clipEnd="99s"/></par></body></smil>');
  const file = info.outputPath("overlong-narration-end.epub");
  fs.writeFileSync(file, zipSync(entries, { level: 0 }));
  const { readerPage: page, context } = await launchReader(file);
  try {
    await listen(page);
    const source = (await audioState(page)).source;
    await expect.poll(() => highlighted(page)).toContain("c1-p1");
    await seek(page, 11.5);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(11.7);
    await expect.poll(() => highlighted(page)).toContain("c2-p1");
    expect((await audioState(page)).source).not.toBe(source);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.2);
    expect((await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).error).toBeNull();
  } finally {
    await context.close();
  }
});

test("narration follows a passage hidden by the current page clip but inside the iframe viewport (#377)", async () => {
  const { readerPage: page, context } = await launchReader(boundaryFixture(test.info()), {
    viewport: { width: 900, height: 700 },
  });
  try {
    await exposeReaderController(page);
    await listen(page);
    await setSpeed(page, 0.75);
    await expect.poll(() => passagePaint(page, "c1-p1")).toMatchObject({ painted: true });
    expect(await passagePaint(page, "c1-p2")).toEqual({ withinLayoutViewport: true, painted: false });
    const source = (await audioState(page)).source;
    const speed = speedButton(page);
    await speed.focus();
    await seek(page, 4.05);
    await expect.poll(() => passagePaint(page, "c1-p2")).toMatchObject({ painted: true });
    expect((await audioState(page)).source).toBe(source);
    expect((await audioState(page)).paused).toBe(false);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(4.2);
    await expect(speed).toBeFocused();
    await expect(button(page, "Return to narration")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const width of [900, 1105, 1326]) {
  test(`3.1.2 narration boundary has no overlapping or clipped final line at ${width}px (#377)`, async () => {
    const { readerPage: page, context } = await launchReader(boundaryFixture(test.info()), {
      viewport: { width, height: 840 },
    });
    try {
      await exposeReaderController(page);
      await listen(page);
      await seek(page, 4.05);
      await expect.poll(() => passagePaint(page, "c1-p2")).toMatchObject({ painted: true });
      expect(await passagePaint(page, "c1-p2", "last")).toMatchObject({ painted: true });
      expect(await passagePaint(page, "c1-p3")).toMatchObject({ painted: false });
    } finally {
      await context.close();
    }
  });
}

test("original W3C timing synchronization keeps the final narrated paragraph painted (#377)", async () => {
  const book = process.env.AMBRA_TIMING_SYNCHRONIZATION_EPUB;
  test.skip(!book, "Set AMBRA_TIMING_SYNCHRONIZATION_EPUB to the pinned original publication.");
  const { readerPage: page, context } = await launchReader(book!, {
    viewport: { width: 900, height: 500 },
  });
  try {
    await exposeReaderController(page);
    await listen(page);
    await expect.poll(() => passagePaint(page, "c01w00001")).toMatchObject({ painted: true });
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const doc: Document = controller.contentDocumentViews()[0].document;
      const paragraph = doc.getElementById("c01p0002");
      if (!paragraph) throw new Error("The original narrated paragraph was not found.");
      const range = doc.createRange();
      range.selectNodeContents(paragraph);
      doc.getSelection()!.removeAllRanges();
      doc.getSelection()!.addRange(range);
    });
    await button(page, "Jump to selection").click();
    await expect.poll(() => passagePaint(page, "c01p0002")).toMatchObject({ painted: true });
    const source = (await audioState(page)).source;
    await seek(page, 134.2);
    await expect.poll(() => passagePaint(page, "c01p0003")).toMatchObject({ painted: true });
    expect((await audioState(page)).source).toBe(source);
    expect((await audioState(page)).paused).toBe(false);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(134.3);
  } finally {
    await context.close();
  }
});

async function setSpeed(page: Page, rate: number) {
  await speedButton(page).click();
  await page.getByRole("menuitemradio", { name: `${rate}×`, exact: true }).click();
}

async function audioState(page: Page) {
  return page.locator(audioSelector).evaluate((element) => {
    const audio = element as HTMLAudioElement;
    return {
      time: audio.currentTime,
      paused: audio.paused,
      rate: audio.playbackRate,
      source: audio.currentSrc,
      error: audio.error?.code ?? null,
    };
  });
}

async function seek(page: Page, seconds: number) {
  await page.locator(audioSelector).evaluate((element, time) => {
    const audio = element as HTMLAudioElement;
    audio.currentTime = time;
    audio.dispatchEvent(new Event("timeupdate"));
  }, seconds);
}

async function highlighted(page: Page) {
  return page.evaluate(() =>
    [...new Set(Array.from(document.querySelectorAll("iframe")).flatMap((frame) => {
      if (
        frame.getBoundingClientRect().width === 0 ||
        getComputedStyle(frame).visibility === "hidden"
      ) {
        return [];
      }
      return Array.from(
        frame.contentDocument?.querySelectorAll(".synthetic-narration-active") ?? [],
      )
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.right > 0 &&
            bounds.left < frame.clientWidth &&
            bounds.bottom > 0 &&
            bounds.top < frame.clientHeight
          );
        })
        .map((element) => element.id);
    }))],
  );
}

async function visibleFrames(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter((frame) => {
        const bounds = frame.getBoundingClientRect();
        return (
          bounds.width > 0 && bounds.height > 0 && getComputedStyle(frame).visibility !== "hidden"
        );
      })
      .map((frame) => ({
        heading: frame.contentDocument?.querySelector("h1")?.textContent ?? "",
        x: frame.getBoundingClientRect().x,
        scrollTop: frame.contentDocument?.scrollingElement?.scrollTop ?? 0,
      })),
  );
}

async function narrationTarget(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const target = Reflect.get(window, "__readerController").narration.target;
    return typeof target?.fragment === "string" ? target.fragment : undefined;
  });
}

async function gateNarrationResource(page: Page, suffix = ".wav"): Promise<void> {
  await page.evaluate(suffix => {
    const loader = Reflect.get(window, "__readerController").contentLoader;
    const original = loader.loadResourceBytes.bind(loader);
    const gate = { entered: false, released: false, release: () => {} };
    const blocked = new Promise<void>(resolve => { gate.release = resolve; });
    Reflect.set(window, "__narrationLoadGate", gate);
    loader.loadResourceBytes = async (resource: string) => {
      const bytes = await original(resource);
      if (resource.endsWith(suffix)) {
        gate.entered = true;
        await blocked;
        gate.released = true;
      }
      return bytes;
    };
  }, suffix);
}

async function listen(page: Page) {
  await page.mouse.move(350, 2);
  await button(page, "Play narration").click();
  await expect(controls(page)).toBeVisible();
  await expect(button(page, "Pause narration")).toBeVisible();
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
}

async function toc(page: Page, title: string) {
  await page.mouse.move(350, 2);
  await button(page, "Contents").click();
  await page
    .getByRole("navigation", { name: "Table of contents" })
    .getByRole("button")
    .filter({ has: page.locator("span").filter({ hasText: new RegExp(`^${title}$`) }) })
    .click();
  await expect(page.getByRole("navigation", { name: "Table of contents" })).not.toBeVisible();
}

test("plain books do not offer recorded narration", async () => {
  const { readerPage: page, context } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    await expect(position(page)).toBeVisible();
    await page.mouse.move(350, 2);
    await expect(button(page, "Listen")).toHaveCount(0);
    await expect(controls(page)).toHaveCount(0);
    await expect(button(page, "Play narration")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("an unnarrated destination pauses explicitly, retry stays there and narrated navigation recovers paused (#337)", async ({ browserName: _browserName }, info) => {
  const entries = unzipSync(fs.readFileSync(narrated));
  entries["EPUB/plain.xhtml"] = strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Unnarrated chapter</title></head><body><h1>Unnarrated chapter</h1><p>This chapter has no recorded narration.</p></body></html>');
  entries["EPUB/package.opf"] = strToU8(new TextDecoder().decode(entries["EPUB/package.opf"]!)
    .replace("</manifest>", '<item id="plain" href="plain.xhtml" media-type="application/xhtml+xml"/></manifest>')
    .replace("</spine>", '<itemref idref="plain"/></spine>'));
  entries["EPUB/nav.xhtml"] = strToU8(new TextDecoder().decode(entries["EPUB/nav.xhtml"]!)
    .replace("</ol></nav>", '<li><a href="plain.xhtml">Unnarrated chapter</a></li></ol></nav>'));
  const fixture = info.outputPath("narrated-with-unnarrated-chapter.epub");
  fs.writeFileSync(fixture, zipSync(entries, { level: 0 }));
  const { readerPage: page, context } = await launchReader(fixture);
  try {
    await exposeReaderController(page);
    await listen(page);
    const source = (await audioState(page)).source;
    await toc(page, "Unnarrated chapter");
    await expect.poll(async () => (await audioState(page)).paused).toBe(true);
    await expect(controls(page)).toContainText("There is no recorded narration at this reading position.");
    await button(page, "Play narration").click();
    await expect(controls(page)).toContainText("There is no recorded narration at this reading position.");
    expect((await audioState(page)).paused).toBe(true);
    await expect(page.frameLocator("iframe").first().locator("h1")).toHaveText("Unnarrated chapter");
    await toc(page, "Narrated chapter 2");
    await expect.poll(async () => (await audioState(page)).source).not.toBe(source);
    await expect.poll(() => narrationTarget(page)).toBe("c2-p1");
    expect((await audioState(page)).paused).toBe(true);
    await button(page, "Play narration").click();
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.1);
    expect((await audioState(page)).paused).toBe(false);
  } finally {
    await context.close();
  }
});

test("Next can recover from an unsupported text-only narration passage after navigation (#337)", async ({ browserName: _browserName }, info) => {
  const entries = unzipSync(fs.readFileSync(narrated));
  entries["EPUB/overlay-2.smil"] = strToU8(new TextDecoder().decode(entries["EPUB/overlay-2.smil"]!)
    .replace('<audio src="audio/chapter-2.wav" clipBegin="0s" clipEnd="4s"/>', ""));
  const fixture = info.outputPath("narrated-with-text-only-passage.epub");
  fs.writeFileSync(fixture, zipSync(entries, { level: 0 }));
  const { readerPage: page, context } = await launchReader(fixture);
  try {
    await exposeReaderController(page);
    await listen(page);
    await toc(page, "Narrated chapter 2");
    await expect(controls(page)).toContainText("This narration segment has no recorded audio.");
    expect((await audioState(page)).paused).toBe(true);
    await button(page, "Next narrated passage").click();
    await expect.poll(() => narrationTarget(page)).toBe("c2-p2");
    expect((await audioState(page)).paused).toBe(true);
    await button(page, "Play narration").click();
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(4);
    await expect.poll(() => passagePaint(page, "c2-p2")).toMatchObject({ painted: true });
  } finally {
    await context.close();
  }
});

test("Next recovers from automatic progression failure without resetting to the preceding visible passage (#337)", async ({ browserName: _browserName }, info) => {
  const entries = unzipSync(fs.readFileSync(narrated));
  entries["EPUB/overlay-1.smil"] = strToU8(new TextDecoder().decode(entries["EPUB/overlay-1.smil"]!)
    .replace('<audio src="audio/chapter-1.wav" clipBegin="4s" clipEnd="8s"/>', ""));
  const fixture = info.outputPath("narrated-with-automatic-text-only-passage.epub");
  fs.writeFileSync(fixture, zipSync(entries, { level: 0 }));
  const { readerPage: page, context } = await launchReader(fixture);
  try {
    await exposeReaderController(page);
    await listen(page);
    await expect(controls(page)).toContainText("This narration segment has no recorded audio.");
    await expect.poll(() => narrationTarget(page)).toBe("c1-p2");
    expect((await audioState(page)).paused).toBe(true);
    await button(page, "Next narrated passage").click();
    await expect.poll(() => narrationTarget(page)).toBe("c1-p3");
    await expect.poll(() => passagePaint(page, "c1-p3")).toMatchObject({ painted: true });
    expect((await audioState(page)).paused).toBe(true);
    await button(page, "Play narration").click();
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(8);
  } finally {
    await context.close();
  }
});

test("real audio advances, pause/resume preserves its point, and collapse keeps playback and speed", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await expect(controls(page)).toBeVisible();
    expect((await audioState(page)).paused).toBe(true);
    await listen(page);
    await expect.poll(() => highlighted(page)).toContain("c1-p1");
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.2);
    expect((await audioState(page)).error).toBeNull();
    await button(page, "Pause narration").click();
    await expect(button(page, "Play narration")).toBeVisible();
    const pausedAt = (await audioState(page)).time;
    expect((await audioState(page)).paused).toBe(true);
    await page.waitForTimeout(250);
    expect((await audioState(page)).time).toBeCloseTo(pausedAt, 2);

    await setSpeed(page, 1.5);
    expect((await audioState(page)).rate).toBe(1.5);
    await button(page, "Play narration").click();
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(pausedAt);
    await button(page, "Collapse read-along controls").click();
    await expect(controls(page)).toHaveAttribute("data-collapsed", "true");
    expect((await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).rate).toBe(1.5);
    await button(page, "Pause narration").click();
    expect((await audioState(page)).paused).toBe(true);
    const closedAt = (await audioState(page)).time;
    await page.waitForTimeout(250);
    expect((await audioState(page)).time).toBeCloseTo(closedAt, 2);
  } finally {
    await context.close();
  }
});

test("clip boundaries follow pages and chapters without stealing control focus", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await listen(page);
    const speed = speedButton(page);
    await setSpeed(page, 0.75);
    await speed.focus();
    await expect.poll(() => highlighted(page)).toContain("c1-p1");
    const firstPosition = await position(page).getAttribute("aria-valuetext");
    const stripBounds = (await controls(page).boundingBox())!;
    const scrubberBounds = (await position(page).boundingBox())!;
    expect(scrubberBounds.y + scrubberBounds.height).toBeLessThanOrEqual(stripBounds.y + 1);
    await expect(controls(page).getByRole("slider")).toHaveCount(0);

    await seek(page, 4.05);
    await expect.poll(() => highlighted(page)).toContain("c1-p2");
    await expect(position(page)).not.toHaveAttribute("aria-valuetext", firstPosition!);
    await expect(speed).toBeFocused();
    expect((await controls(page).boundingBox())!.y).toBeCloseTo(stripBounds.y, 0);
    await seek(page, 8.05);
    await expect.poll(() => highlighted(page)).toContain("c1-p3");
    const firstSource = (await audioState(page)).source;
    await seek(page, 12);
    await expect.poll(() => highlighted(page)).toContain("c2-p1");
    await expect.poll(async () => (await audioState(page)).source).not.toBe(firstSource);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(speed).toBeFocused();
    await expect(button(page, "Return to narration")).toHaveCount(0);

    await button(page, "Next narrated passage").click();
    await expect.poll(() => highlighted(page)).toContain("c2-p2");
    await expect(button(page, "Next narrated passage")).toBeFocused();
    await button(page, "Previous narrated passage").click();
    await expect.poll(() => highlighted(page)).toContain("c2-p1");
    await expect(button(page, "Previous narrated passage")).toBeFocused();
  } finally {
    await context.close();
  }
});

test("Play starts at the displayed narrated passage, not the book beginning", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await toc(page, "Chapter 2 passage 2");
    await expect(page.frameLocator("iframe").first().locator("h1")).toHaveText(
      "Narrated chapter 2",
    );
    await listen(page);
    await expect.poll(() => highlighted(page)).toContain("c2-p2");
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(4);
    expect((await audioState(page)).time).toBeLessThan(8);
  } finally {
    await context.close();
  }
});

for (const browsing of ["contents", "scrubber"] as const) {
  test(`paused ${browsing} navigation resumes narration at the new reading position (#337)`, async () => {
    const { readerPage: page, context } = await launchReader(narrated);
    try {
      await exposeReaderController(page);
      await listen(page);
      await setSpeed(page, 0.75);
      await button(page, "Pause narration").click();
      const source = (await audioState(page)).source;
      if (browsing === "contents") {
        await toc(page, "Narrated chapter 2");
      } else {
        await position(page).focus();
        await position(page).press("End");
        await expect(position(page)).toHaveAttribute("aria-valuenow", "100");
      }
      expect((await audioState(page)).paused).toBe(true);
      await button(page, "Play narration").click();
      await expect.poll(async () => (await audioState(page)).source).not.toBe(source);
      const fragment = browsing === "contents" ? "c2-p1" : "c2-p3";
      const begin = browsing === "contents" ? 0 : 8;
      await expect.poll(() => narrationTarget(page)).toBe(fragment);
      await expect.poll(() => passagePaint(page, browsing === "scrubber" ? undefined : fragment)).toMatchObject({ painted: true });
      await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(begin + 0.1);
      expect(await audioState(page)).toMatchObject({ paused: false, rate: 0.75, error: null });
      await expect(button(page, "Return to narration")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

for (const mode of ["fixed-layout", "scroll", "roll"] as const) {
  test(`${mode}: paused chapter navigation resumes the requested document's audio (#337)`, async ({ browserName: _browserName }, info) => {
    let fixture = narrated;
    if (mode === "roll") {
      const entries = unzipSync(fs.readFileSync(path.join(fixtures, "media-overlay/fixed-layout.epub")));
      entries["EPUB/package.opf"] = strToU8(new TextDecoder().decode(entries["EPUB/package.opf"]!)
        .replace('property="rendition:layout">pre-paginated', 'property="rendition:layout">roll'));
      fixture = info.outputPath("narrated-roll.epub");
      fs.writeFileSync(fixture, zipSync(entries, { level: 0 }));
    }
    const { readerPage: page, context } = await launchReader(
      mode === "fixed-layout" ? path.join(fixtures, "media-overlay/fixed-layout.epub") : fixture,
    );
    try {
      if (mode === "scroll") {
        await page.mouse.move(350, 2);
        await button(page, "Ambra settings").click();
        await page.getByRole("combobox", { name: "Reading mode", exact: true }).selectOption(mode);
        await page.keyboard.press("Escape");
      }
      await exposeReaderController(page);
      await listen(page);
      await button(page, "Pause narration").click();
      const source = (await audioState(page)).source;
      await toc(page, "Narrated chapter 2");
      expect((await audioState(page)).paused).toBe(true);
      await page.evaluate(async () => {
        await Reflect.get(window, "__readerController").performNarrationAction("start");
      });
      expect((await audioState(page)).source).not.toBe(source);
      expect((await audioState(page)).paused).toBe(false);
      await expect.poll(() => highlighted(page)).toContain("c2-p1");
      await expect.poll(() => passagePaint(page, "c2-p1")).toMatchObject({ painted: true });
    } finally {
      await context.close();
    }
  });
}

test("paused page navigation resumes the newly painted segment in the same chapter (#337)", async ({ browserName: _browserName }, info) => {
  const { readerPage: page, context } = await launchReader(boundaryFixture(info));
  try {
    await exposeReaderController(page);
    await listen(page);
    await setSpeed(page, 0.75);
    await button(page, "Pause narration").click();
    const source = (await audioState(page)).source;
    const before = await position(page).getAttribute("aria-valuetext");
    await button(page, "Play narration").blur();
    await page.keyboard.press("ArrowRight");
    await expect(position(page)).not.toHaveAttribute("aria-valuetext", before!);
    expect((await audioState(page)).paused).toBe(true);
    await button(page, "Play narration").click();
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(4);
    expect((await audioState(page)).time).toBeLessThan(8);
    expect((await audioState(page)).source).toBe(source);
    await expect.poll(() => highlighted(page)).toContain("c1-p2");
    await expect.poll(() => passagePaint(page, "c1-p2")).toMatchObject({ painted: true });
  } finally {
    await context.close();
  }
});

test("failed paused navigation preserves the paused audio point (#337)", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await listen(page);
    await setSpeed(page, 0.75);
    await seek(page, 5);
    await expect.poll(() => highlighted(page)).toContain("c1-p2");
    await button(page, "Pause narration").click();
    const paused = await audioState(page);
    await exposeReaderController(page);
    await page.evaluate(async () => {
      await Reflect.get(window, "__readerController").goToBookmark("epubcfi(/6/2!/4/9998[missing])");
    });
    await page.mouse.move(350, 2);
    await button(page, "Play narration").click();
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).source).toBe(paused.source);
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(paused.time - 0.05);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(paused.time + 0.1);
  } finally {
    await context.close();
  }
});

  test("Next after paused navigation chooses the new chapter's next passage (#337)", async () => {
    const { readerPage: page, context } = await launchReader(narrated);
    try {
      await listen(page);
      await setSpeed(page, 0.75);
      await seek(page, 5);
      await expect.poll(() => highlighted(page)).toContain("c1-p2");
      await button(page, "Pause narration").click();
      const paused = await audioState(page);
      await toc(page, "Narrated chapter 2");
      await expect.poll(async () => (await audioState(page)).source).not.toBe(paused.source);
      expect((await audioState(page)).paused).toBe(true);
      await button(page, "Next narrated passage").click();
      await button(page, "Play narration").click();
      await expect.poll(async () => (await audioState(page)).paused).toBe(false);
      expect((await audioState(page)).source).not.toBe(paused.source);
        expect((await audioState(page)).time).toBeGreaterThanOrEqual(4);
        await expect.poll(() => highlighted(page)).toContain("c2-p2");
        await expect(button(page, "Return to narration")).toHaveCount(0);
        await expect(page.frameLocator("iframe").first().locator("h1")).toHaveText("Narrated chapter 2");
    } finally {
      await context.close();
    }
  });

for (const browsing of ["page", "contents", "scrubber"] as const) {
  test(`${browsing} navigation retargets playing narration and preserves speed (#337)`, async ({ browserName: _browserName }, info) => {
    const { readerPage: page, context } = await launchReader(browsing === "page" ? boundaryFixture(info) : narrated);
    try {
      await exposeReaderController(page);
      await listen(page);
      await setSpeed(page, 0.75);
      await seek(page, 0.2);
      const source = (await audioState(page)).source;
      if (browsing === "page") {
        const before = await position(page).getAttribute("aria-valuetext");
        await speedButton(page).blur();
        await page.keyboard.press("ArrowRight");
        await expect(position(page)).not.toHaveAttribute("aria-valuetext", before!);
      } else if (browsing === "contents") {
        await toc(page, "Narrated chapter 2");
      } else {
        await position(page).focus();
        await position(page).press("End");
        await expect(position(page)).toHaveAttribute("aria-valuenow", "100");
      }
      const fragment = browsing === "page" ? "c1-p2" : browsing === "contents" ? "c2-p1" : "c2-p3";
      const begin = browsing === "page" ? 4 : browsing === "contents" ? 0 : 8;
      await expect.poll(async () => (await audioState(page)).paused).toBe(false);
      await expect.poll(() => narrationTarget(page)).toBe(fragment);
      expect((await audioState(page)).time).toBeGreaterThanOrEqual(begin);
      expect((await audioState(page)).rate).toBe(0.75);
      if (browsing === "page") expect((await audioState(page)).source).toBe(source);
      else expect((await audioState(page)).source).not.toBe(source);
      await expect.poll(() => passagePaint(page, browsing === "scrubber" ? undefined : fragment)).toMatchObject({ painted: true });
      await expect(button(page, "Return to narration")).toHaveCount(0);
      await seek(page, begin + 1);
      await button(page, "Restart page audio").click();
      await expect.poll(() => highlighted(page)).toContain(fragment);
      await expect.poll(async () => (await audioState(page)).time).toBeLessThan(begin + 0.5);
    } finally {
      await context.close();
    }
  });
}

test("invalid audio is rejected before playback assignment and stays explicit in compact controls", {
  tag: "@audio-resource-conformance",
}, async () => {
  const { readerPage: page, context } = await launchReader(
    path.join(fixtures, "media-overlay/invalid-audio.epub"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await exposeReaderController(page);
    await page.mouse.move(350, 2);
    await button(page, "Play narration").click();
    await expect(controls(page).getByRole("status")).toHaveText("Narration could not be played.");
    expect(await audioState(page)).toMatchObject({ source: "", error: null, paused: true });
    expect(await page.evaluate(() =>
      Reflect.get(window, "__readerController").narration.snapshot.error,
    )).toContain("No supported audio resource");
    await expect(button(page, "Play narration")).toBeVisible();
    await button(page, "Collapse read-along controls").click();
    await expect(controls(page)).toHaveAttribute("data-collapsed", "true");
    await expect(controls(page).getByRole("status")).toHaveText("Narration could not be played.");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("a post-probe native audio failure stays explicit in compact controls without unhandled errors", {
  tag: "@audio-resource-conformance",
}, async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await listen(page);
    await page.locator(audioSelector).evaluate(element => {
      const audio = element as HTMLAudioElement;
      const url = URL.createObjectURL(new Blob(["Original undecodable audio"], { type: "audio/wav" }));
      audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
      audio.src = url;
      audio.load();
    });
    await expect.poll(async () => (await audioState(page)).error).not.toBeNull();
    await expect(controls(page).getByRole("status")).toHaveText("Narration could not be played.");
    expect((await audioState(page)).paused).toBe(true);
    await expect(button(page, "Play narration")).toBeVisible();
    await button(page, "Collapse read-along controls").click();
    await expect(controls(page)).toHaveAttribute("data-collapsed", "true");
    await expect(controls(page).getByRole("status")).toHaveText("Narration could not be played.");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const action of ["play", "pause", "navigate"] as const) {
  test(`${action} during navigation audio loading preserves the latest location and playback intent (#337)`, async () => {
    const { readerPage: page, context } = await launchReader(narrated);
    try {
      await exposeReaderController(page);
      await listen(page);
      if (action !== "pause") await button(page, "Pause narration").click();
      const source = (await audioState(page)).source;
      await gateNarrationResource(page, "chapter-2.wav");
      await toc(page, "Narrated chapter 2");
      await page.waitForFunction(() => Reflect.get(window, "__narrationLoadGate").entered);
      if (action === "play") await button(page, "Play narration").click();
      else if (action === "pause") await button(page, "Pause narration").click();
      else await toc(page, "Narrated chapter 1");
      await page.evaluate(() => Reflect.get(window, "__narrationLoadGate").release());
      await page.waitForFunction(() => Reflect.get(window, "__narrationLoadGate").released);
      if (action === "play") {
        await expect.poll(async () => (await audioState(page)).source).not.toBe(source);
        await expect.poll(async () => (await audioState(page)).paused).toBe(false);
        await expect.poll(() => narrationTarget(page)).toBe("c2-p1");
      } else {
        await expect(button(page, "Play narration")).toBeVisible();
        expect((await audioState(page)).paused).toBe(true);
        const fragment = action === "navigate" ? "c1-p1" : "c2-p1";
        await expect.poll(() => narrationTarget(page)).toBe(fragment);
        await button(page, "Play narration").click();
        await expect.poll(async () => (await audioState(page)).paused).toBe(false);
        if (action === "navigate") expect((await audioState(page)).source).toBe(source);
        else expect((await audioState(page)).source).not.toBe(source);
        await expect.poll(() => highlighted(page)).toContain(fragment);
      }
    } finally {
      await context.close();
    }
  });
}

test("Restart page audio ignores a retained selection; Jump to selection remains independent (#337)", async ({ browserName: _browserName }, info) => {
  const { readerPage: page, context } = await launchReader(boundaryFixture(info));
  try {
    await exposeReaderController(page);
    await listen(page);
    await button(page, "Pause narration").click();
    await page.locator("iframe").first().evaluate(frame => {
      const doc = (frame as HTMLIFrameElement).contentDocument!;
      const range = doc.createRange();
      range.selectNodeContents(doc.getElementById("c1-p2")!);
      doc.getSelection()!.removeAllRanges();
      doc.getSelection()!.addRange(range);
    });
    await expect(button(page, "Jump to selection")).toBeVisible();
    await expect(button(page, "Restart page audio")).toBeVisible();
    await button(page, "Restart page audio").click();
    await expect.poll(() => narrationTarget(page)).toBe("c1-p1");
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).time).toBeLessThan(4);
    await expect.poll(() => passagePaint(page, "c1-p1")).toMatchObject({ painted: true });
    await button(page, "Jump to selection").click();
    await expect.poll(() => narrationTarget(page)).toBe("c1-p2");
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(4);
    await expect.poll(() => passagePaint(page, "c1-p2")).toMatchObject({ painted: true });
    await expect(button(page, "Return to narration")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

for (const action of ["expanded pause", "collapsed pause", "collapse without pausing"]) {
  test(`${action} preserves the intended in-flight audio loading behavior`, async () => {
    const { readerPage: page, context } = await launchReader(narrated);
    try {
      await exposeReaderController(page);
      await gateNarrationResource(page);
      await page.mouse.move(350, 2);
      await button(page, "Play narration").click();
      await page.waitForFunction(() => Reflect.get(window, "__narrationLoadGate").entered);
      if (action !== "expanded pause") await button(page, "Collapse read-along controls").click();
      if (action !== "collapse without pausing") await button(page, "Pause narration").click();
      await page.evaluate(() => Reflect.get(window, "__narrationLoadGate").release());
      await page.waitForFunction(() => Reflect.get(window, "__narrationLoadGate").released);
      await page.waitForTimeout(200);
      if (action === "collapse without pausing") {
        await expect.poll(async () => (await audioState(page)).paused).toBe(false);
        await expect(controls(page)).toHaveAttribute("data-collapsed", "true");
        await expect(button(page, "Pause narration")).toBeVisible();
      } else {
        expect((await audioState(page)).paused).toBe(true);
        await expect(button(page, "Play narration")).toBeVisible();
        await button(page, "Play narration").click();
        await expect.poll(async () => (await audioState(page)).paused).toBe(false);
        await expect.poll(() => highlighted(page)).toContain("c1-p1");
      }
    } finally {
      await context.close();
    }
  });
}

test("1400px reflowable spreads follow narration into another chapter and retain control focus", async () => {
  const { readerPage: page, context } = await launchReader(narrated, {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await expect.poll(async () => (await visibleFrames(page)).length).toBe(2);
    const frames = await visibleFrames(page);
    expect(frames[0]!.x).toBeLessThan(frames[1]!.x);
    await listen(page);
    const speed = speedButton(page);
    await setSpeed(page, 0.75);
    await speed.focus();
    await expect.poll(() => highlighted(page)).toEqual(["c1-p1"]);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.15);
    const source = (await audioState(page)).source;

    await seek(page, 4.05);
    await expect.poll(() => highlighted(page)).toEqual(["c1-p2"]);
    await expect(speed).toBeFocused();
    await seek(page, 8.05);
    await expect.poll(() => highlighted(page)).toEqual(["c1-p3"]);
    await seek(page, 12);
    await expect.poll(() => highlighted(page)).toEqual(["c2-p1"]);
    await expect.poll(async () => (await visibleFrames(page)).length).toBe(2);
    expect(
      (await visibleFrames(page)).some((frame) => frame.heading === "Narrated chapter 2"),
    ).toBe(true);
    await expect.poll(async () => (await audioState(page)).source).not.toBe(source);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(speed).toBeFocused();
    await expect(button(page, "Return to narration")).toHaveCount(0);
    expect((await audioState(page)).error).toBeNull();
  } finally {
    await context.close();
  }
});

test("scroll mode wheel navigation retargets audio without jumping back; later clips still follow (#337)", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await exposeReaderController(page);
    await page.mouse.move(350, 2);
    await button(page, "Ambra settings").click();
    await page.getByRole("combobox", { name: "Reading mode", exact: true }).selectOption("scroll");
    await expect(page.getByRole("combobox", { name: "Reading mode", exact: true })).toHaveValue("scroll");
    await page.keyboard.press("Escape");
    await expect(position(page)).toHaveCount(0);
    await listen(page);
    await setSpeed(page, 0.75);
    await expect.poll(() => highlighted(page)).toEqual(["c1-p1"]);
    const source = (await audioState(page)).source;
    const frame = (await page.locator("iframe").first().boundingBox())!;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.mouse.wheel(0, 1400);
    await expect.poll(async () => (await visibleFrames(page))[0]!.scrollTop).toBeGreaterThan(1000);
    await expect.poll(() => narrationTarget(page)).toBe("c1-p2");
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(4);
    const browsedTop = (await visibleFrames(page))[0]!.scrollTop;
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(4.15);
    expect((await visibleFrames(page))[0]!.scrollTop).toBeCloseTo(browsedTop, 0);
    await expect(button(page, "Return to narration")).toHaveCount(0);
    expect((await audioState(page)).source).toBe(source);
    expect((await audioState(page)).paused).toBe(false);
    await seek(page, 8.05);
    await expect.poll(() => highlighted(page)).toEqual(["c1-p3"]);
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(8.05);
    await expect(button(page, "Return to narration")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("fixed-layout narration highlights the secondary spread document without moving control focus", async () => {
  const { readerPage: page, context } = await launchReader(
    path.join(fixtures, "media-overlay/fixed-layout.epub"),
    { viewport: { width: 1400, height: 900 } },
  );
  try {
    await expect
      .poll(async () => (await visibleFrames(page)).map((frame) => frame.heading))
      .toEqual(["Narrated chapter 1", "Narrated chapter 2"]);
    await expect(position(page)).toHaveCount(1);
    await listen(page);
    const speed = speedButton(page);
    await setSpeed(page, 0.75);
    await speed.focus();
    await expect.poll(() => highlighted(page)).toEqual(["c1-p1"]);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.15);
    const source = (await audioState(page)).source;

    await seek(page, 4);
    await expect.poll(() => highlighted(page)).toEqual(["c2-p1"]);
    await expect(page.frameLocator("iframe").nth(1).locator("#c2-p1")).toHaveClass(
      /synthetic-narration-active/,
    );
    await expect(page.frameLocator("iframe").first().locator("#c1-p1")).not.toHaveClass(
      /synthetic-narration-active/,
    );
    await expect
      .poll(async () => (await visibleFrames(page)).map((frame) => frame.heading))
      .toEqual(["Narrated chapter 1", "Narrated chapter 2"]);
    await expect.poll(async () => (await audioState(page)).source).not.toBe(source);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(speed).toBeFocused();
    await expect(button(page, "Return to narration")).toHaveCount(0);
    await button(page, "Previous narrated passage").click();
    await expect.poll(() => highlighted(page)).toEqual(["c1-p1"]);
    await expect(button(page, "Previous narrated passage")).toBeDisabled();
    expect((await audioState(page)).error).toBeNull();
  } finally {
    await context.close();
  }
});
