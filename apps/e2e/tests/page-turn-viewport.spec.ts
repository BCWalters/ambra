import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

function viewportFixture(info: TestInfo): string {
  const epub = navigationFixture(info, [24]);
  const source = info.outputPath("navigation-source");
  const chapter = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Viewport-relative original text</title><style>
      section { margin-top: 20vh; } p { margin: 0 0 1em; }
    </style></head><body><section>${Array.from({ length: 120 }, (_, i) =>
      `<p>Paragraph ${i + 1}. This original fixture follows the position of a line of text through a page turn.
      The page keeps its reading viewport while the surrounding paper moves.
      Another paragraph supplies enough text to exercise several later spreads.</p>`).join("")}
    </section></body></html>`;
  fs.writeFileSync(path.join(source, "EPUB/c0.xhtml"), chapter);
  const manifest = path.join(source, "EPUB/package.opf");
  fs.writeFileSync(manifest, fs.readFileSync(manifest, "utf8").replaceAll(' properties="svg"', ""));
  execFileSync("zip", ["-q", "-X", epub, "EPUB/c0.xhtml", "EPUB/package.opf"], { cwd: source });
  return epub;
}

const toolbar = (page: Page) =>
  page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isTurningPage && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
  });
}

async function position(page: Page) {
  return page.evaluate(() => {
    const s = Reflect.get(window, "__readerController").snapshot();
    return { spine: s.spineIndex, page: s.pageIndex };
  });
}

interface TurnGeometry {
  before: number[];
  during: number[][];
  after: (number | null)[];
  labels: string[];
}

async function measureTurns(page: Page, spread: boolean) {
  await page.evaluate(spread => {
    type Host = { element: HTMLElement; contentDocuments?: () => Document[] };
    const c = Reflect.get(window, "__readerController");
    const turns: TurnGeometry[] = [];
    Reflect.set(window, "__viewportTurns", turns);
    const method = spread ? "animateSpreadTurn" : "animatePageTurn";
    const orchestrator = c.pageTurnOrchestrator;
    const original = orchestrator[method];
    orchestrator[method] = async function (oldHost: Host, newHost: Host, ...rest: unknown[]) {
      const anchors = [oldHost, newHost].flatMap((host, side) => {
        const docs = host.contentDocuments?.() ?? [(host.element as HTMLIFrameElement).contentDocument!];
        return docs.map((doc, column) => {
          const frame = doc.defaultView!.frameElement as HTMLIFrameElement;
          const insets = [...frame.style.clipPath.matchAll(/([\d.]+)px/g)].map(m => Number(m[1]));
          const top = insets[0] ?? 0;
          const bottomInset = insets.length >= 3 ? insets[2]! : top;
          const bottom = doc.defaultView!.innerHeight - bottomInset;
          const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent?.trim()) continue;
            const range = doc.createRange();
            range.selectNodeContents(walker.currentNode);
            const line = [...range.getClientRects()].findIndex(r =>
              r.width > 0 && r.height > 0 && r.top >= top && r.bottom <= bottom);
            if (line >= 0) return { range, line, doc, frame, label: `${side ? "incoming" : "outgoing"}-${column}` };
          }
          throw new Error("No visible publication text to measure");
        });
      });
      // Real glyph fragment coordinates in each iframe, not body transforms.
      // Outer 3D projection intentionally changes screen Y during rotate.
      const read = () => anchors.map(a => a.range.getClientRects()[a.line]!.top);
      const layout = () => anchors.map(a => ({
        viewport: [a.doc.defaultView!.innerWidth, a.doc.defaultView!.innerHeight],
        scroll: [a.doc.defaultView!.scrollX, a.doc.defaultView!.scrollY],
        bodyTop: a.doc.body.getBoundingClientRect().top,
        bodyTransform: a.doc.body.style.transform,
        frame: a.frame.getBoundingClientRect().toJSON(),
      }));
      const turn = { before: read(), during: [] as number[][], after: [] as (number | null)[],
        labels: anchors.map(a => a.label), beforeLayout: layout(), duringLayout: [] as ReturnType<typeof layout>[], afterLayout: [] as ReturnType<typeof layout> };
      turns.push(turn);
      let request: number;
      const sample = () => {
        turn.during.push(read());
        turn.duringLayout.push(layout());
        request = requestAnimationFrame(sample);
      };
      request = requestAnimationFrame(sample);
      try {
        await original.call(this, oldHost, newHost, ...rest);
        // The caller adopts the incoming host and removes the outgoing host
        // after this method returns. Measure the surviving painted frame, not
        // their temporary shared flex layout inside synchronous cleanup.
        requestAnimationFrame(() => {
          turn.after = anchors.map(a => a.frame.isConnected
            ? a.range.getClientRects()[a.line]!.top : null);
          turn.afterLayout = layout();
        });
      } finally {
        cancelAnimationFrame(request);
      }
    };
  }, spread);
}

for (const spread of [true, false]) {
  for (const style of ["slide", "rotate", "scroll"] as const) {
    test(`${style} ${spread ? "spread" : "single"}: first reveal-zone tap turns without viewport text jumps (#180)`, async () => {
      const info = test.info();
      const book = process.env.AMBRA_E2E_ULYSSES_EPUB ?? viewportFixture(info);
      const width = spread ? 1400 : 800;
      const { context, readerPage: page } = await launchReader(book, {
        viewport: { width, height: 900 },
      });
      try {
        await exposeReaderController(page);
        await settled(page);
        await page.evaluate(async ({ style, realBook }) => {
          const c = Reflect.get(window, "__readerController");
          await c.setPageTurnAnimationStyle(style);
          if (realBook) {
            const path = c.pkg.spine.find((ref: { manifestItem: { path: string } }) =>
              /chapter-1\.xhtml$/.test(ref.manifestItem.path))?.manifestItem.path;
            if (!path) throw new Error("Ulysses chapter one is missing");
            await c.goToNavPoint({ path });
          }
        }, { style, realBook: !!process.env.AMBRA_E2E_ULYSSES_EPUB });
        await settled(page);
        await page.keyboard.press("ArrowRight");
        await settled(page);
        expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().isSpread))
          .toBe(spread);
        await measureTurns(page, spread);
        const scrubber = page.getByRole("slider", { name: "Position in book", exact: true }).locator("..");

        for (let turn = 0; turn < 4; turn++) {
          await page.mouse.move(width - 20, 350);
          await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
          await expect(toolbar(page)).toHaveCSS("opacity", "0");
          await expect(scrubber).toHaveCSS("opacity", "0");
          // Widen the real commit-before-fade window without touching reader
          // state or page animations. Both chrome surfaces remain unpainted,
          // whether React commits before or after the trusted pointerdown.
          for (const surface of [toolbar(page), scrubber]) {
            await surface.evaluate(element => { element.style.transitionDelay = "10s"; });
          }
          // Explicitly approach the controls after a content dismissal;
          // repeated taps in the edge strip alone must not re-open chrome.
          await page.mouse.move(10, 20);
          const before = await position(page);
          const count = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageCount);
          expect(before.page + (spread ? 2 : 1), "a later page must exist").toBeLessThan(count);
          if (turn % 2 === 0) {
            await page.mouse.move(width - 20, 825);
            await expect(toolbar(page)).toHaveCSS("pointer-events", "auto");
            await expect(toolbar(page)).toHaveCSS("opacity", "0");
            await expect(scrubber).toHaveCSS("opacity", "0");
            await page.mouse.down();
            await page.mouse.up();
          } else {
            // Keep the combined pointermove + down/up path too.
            await page.mouse.click(width - 20, 825);
          }
          await expect.poll(() => position(page)).toEqual({
            spine: before.spine, page: before.page + (spread ? 2 : 1),
          });
          await settled(page);
        }

        // Actually rendered unpinned chrome still consumes the first tap (#164).
        for (const surface of [toolbar(page), scrubber]) {
          await surface.evaluate(element => { element.style.transitionDelay = ""; });
        }
        await page.mouse.move(10, 2);
        await expect(toolbar(page)).toHaveCSS("pointer-events", "auto");
        await expect(toolbar(page)).toHaveCSS("opacity", "1");
        for (const surface of [toolbar(page), scrubber]) {
          await surface.evaluate(element => { element.style.transitionDuration = "10s"; });
        }
        // Use the exposed paper strip above the scrubber, not a font-dependent
        // point that may fall inside the clipped iframe on another platform.
        const dismissalY = (await scrubber.boundingBox())!.y - 8;
        const beforeDismissal = await position(page);
        await page.mouse.click(width - 20, dismissalY);
        await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
        await settled(page);
        expect(await position(page)).toEqual(beforeDismissal);
        // A small pointer movement must not re-open controls between the two
        // taps, even if React paints before the second pointerdown.
        await page.mouse.move(width - 19, dismissalY);
        await page.evaluate(() => new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        // Do not retry until the ordinary idle timer hides an incorrect reveal.
        expect(await toolbar(page).evaluate(element => getComputedStyle(element).pointerEvents))
          .toBe("none");
        await page.mouse.click(width - 19, dismissalY);
        await expect.poll(() => position(page)).toEqual({
          spine: beforeDismissal.spine, page: beforeDismissal.page + (spread ? 2 : 1),
        });
        for (const surface of [toolbar(page), scrubber]) {
          await surface.evaluate(element => { element.style.transitionDuration = ""; });
        }
        await settled(page);
        await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
        await page.keyboard.press("ArrowLeft");
        await expect.poll(() => position(page)).toEqual(beforeDismissal);
        await settled(page);

        await page.waitForFunction(() => Reflect.get(window, "__viewportTurns")
          .every((turn: TurnGeometry) => turn.after.length > 0));
        const turns = await page.evaluate(() => Reflect.get(window, "__viewportTurns")) as TurnGeometry[];
        const geometryPath = info.outputPath("text-fragment-geometry.json");
        fs.writeFileSync(geometryPath, JSON.stringify(turns, null, 2));
        await info.attach("text-fragment-geometry", {
          path: geometryPath, contentType: "application/json",
        });
        expect(turns).toHaveLength(6);
        for (const [index, turn] of turns.entries()) {
          expect(turn.before).toHaveLength(spread ? 4 : 2);
          expect(turn.during.length, "must sample the real animation").toBeGreaterThan(2);
          expect(turn.after.filter(y => y !== null)).toHaveLength(spread ? 2 : 1);
          for (const sample of [...turn.during, turn.after]) {
            sample.forEach((y, anchor) => y !== null && expect(
              Math.abs(y - turn.before[anchor]!),
              `turn ${index}, ${turn.labels[anchor]} text Y ${turn.before[anchor]} → ${y}`,
            ).toBeLessThanOrEqual(1));
          }
        }
      } finally {
        await context.close();
      }
    });
  }
}
