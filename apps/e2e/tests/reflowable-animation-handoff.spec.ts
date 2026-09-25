import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { SpreadPaginatedHost } from "../../../packages/engine/src/index.js";
import { clickReadingPage, launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

declare global {
  interface Window {
    spreadHandoff: {
      incoming?: SpreadPaginatedHost;
      release?: () => void;
      transitions: number;
    };
  }
}

function longTextBook(direction: "ltr" | "rtl"): string {
  const target = navigationFixture(test.info(), [1]);
  const source = test.info().outputPath("navigation-source");
  const opf = path.join(source, "EPUB/package.opf");
  fs.writeFileSync(opf, fs.readFileSync(opf, "utf8").replace("<spine>", `<spine page-progression-direction="${direction}">`));
  const prose = "The traveller paused beside the quiet road and considered the distant hills. " +
    "Every small village offered another story, and every story suggested a different path home. ";
  fs.writeFileSync(path.join(source, "EPUB/c0.xhtml"),
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>A long journey</title></head><body>${
      Array.from({ length: 600 }, (_, i) => `<p id="p${i}">${i}. ${prose.repeat(8)}</p>`).join("")
    }</body></html>`);
  execFileSync("zip", ["-q", "-X", "-r", target, "EPUB"], { cwd: source });
  return target;
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isTurningPage && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const host: SpreadPaginatedHost = window.spreadHandoff.incoming ?? Reflect.get(window, "__readerController").host;
    return host.contentDocuments().map(doc => {
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      const lines = Array.from(doc.querySelectorAll("p")).flatMap(p => {
        const range = doc.createRange();
        range.selectNodeContents(p);
        return Array.from(range.getClientRects())
          .filter(r => r.top > 100 && r.bottom < 700 && r.width > 0)
          .map(r => ({ x: frame.x + r.x, y: frame.y + r.y, width: r.width, height: r.height }));
      });
      return {
        frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
        lines,
        translation: doc.body.style.transform,
      };
    });
  });
}

/** Compare actual ink, not only layout boxes: half a CSS pixel became a full
 * painted pixel in Chromium in #208. Small +/- shifts also diagnose failures. */
async function compareInk(page: Page, before: Buffer, after: Buffer, lefts: number[]) {
  return page.evaluate(async ({ before, after, lefts }) => {
    const decode = async (base64: string) => {
      const image = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height);
      image.close();
      return pixels;
    };
    const a = await decode(before);
    const b = await decode(after);
    return lefts.map(left => {
      const differences = [-2, -1, 0, 1, 2].map(dx => {
        let difference = 0;
        let ink = 0;
        for (let y = 110; y < 700; y++) for (let x = Math.ceil(left) + 100; x < Math.ceil(left) + 620; x++) {
          const av = a.data[(y * a.width + x) * 4]!;
          const bv = b.data[(y * b.width + x + dx) * 4]!;
          difference += Math.abs(av - bv);
          ink += 255 - av;
        }
        return { dx, difference, ink };
      });
      return { left, differences, bestShift: [...differences].sort((a, b) => a.difference - b.difference)[0]!.dx };
    });
  }, { before: before.toString("base64"), after: after.toString("base64"), lefts });
}

for (const direction of ["ltr", "rtl"] as const) {
  for (const style of ["slide", "rotate", "scroll", "none"] as const) {
    test(`${direction} ${style}: text stays fixed across spread handoff, odd/fractional widths and resize (#208)`, async () => {
      test.setTimeout(90_000);
      const { context, readerPage: page } = await launchReader(longTextBook(direction), {
        viewport: { width: 1547, height: 878 },
      });
      try {
        await exposeReaderController(page);
        await settled(page);
        await page.evaluate(async style => {
          const c = Reflect.get(window, "__readerController");
          await c.openSpineItem(0, { landOnFractionInItem: 0.5 });
          await c.setPageTurnAnimationStyle(style);
          window.spreadHandoff = { transitions: 0 };
          document.addEventListener("transitionrun", event => {
            if (event.propertyName === "transform" && event.target instanceof Element &&
              c.containerEl.contains(event.target)) window.spreadHandoff.transitions++;
          });
          const orchestrator = c.pageTurnOrchestrator;
          const animate = orchestrator.animateSpreadTurn.bind(orchestrator);
          orchestrator.animateSpreadTurn = (oldHost: SpreadPaginatedHost, newHost: SpreadPaginatedHost, ...args: unknown[]) => {
            window.spreadHandoff.incoming = newHost;
            return animate(oldHost, newHost, ...args);
          };
          // Let the real transition finish, then hold its final painted frame
          // before cleanup/adoption. No animation or layout styles are changed.
          const animator = c.pageTurnAnimator;
          for (const method of ["playPageTurnAnimation", "playScrollTurn"]) {
            const play = animator[method].bind(animator);
            animator[method] = async (...args: unknown[]) => {
              await play(...args);
              await new Promise<void>(resolve => { window.spreadHandoff.release = resolve; });
            };
          }
        }, style);
        await settled(page);
        const measurements = [];
        for (const width of [1547, 1547.5, 1546]) {
          await page.setViewportSize({ width: Math.ceil(width), height: 878 });
          await page.evaluate(width => {
            Reflect.get(window, "__readerController").containerEl.style.right = `${Math.ceil(width) - width}px`;
          }, width);
          await page.waitForFunction(width => Reflect.get(window, "__readerController").appliedWidth === width, width);
          await settled(page);
          await page.evaluate(() => { window.spreadHandoff.incoming = undefined; });
          const start = await measure(page);
          expect(start).toHaveLength(2);
          expect(start.every(column => column.lines.length >= 15)).toBe(true);
          const initialPng = style === "none" ? await page.screenshot() : undefined;
          for (const forward of [true, false]) {
            const side = forward === (direction === "ltr") ? "right" : "left";
            await clickReadingPage(page, side);
            if (style === "none") {
              await settled(page);
              const after = await measure(page);
              expect(after.map(v => v.frame)).toEqual(start.map(v => v.frame));
              if (forward) expect(after.map(v => v.translation)).not.toEqual(start.map(v => v.translation));
              else {
                expect(after).toEqual(start);
                const ink = await compareInk(page, initialPng!, await page.screenshot(), start.map(v => v.frame.x));
                for (const column of ink) {
                  expect(column.bestShift).toBe(0);
                  expect(column.differences.find(v => v.dx === 0)!.difference).toBe(0);
                }
                measurements.push({ width, ink });
              }
              continue;
            }
            await page.waitForFunction(() => !!window.spreadHandoff.release);
            const before = await measure(page);
            const beforePng = await page.screenshot();
            await page.evaluate(() => {
              window.spreadHandoff.release!();
              window.spreadHandoff.release = undefined;
            });
            await settled(page);
            const after = await measure(page);
            const afterPng = await page.screenshot();
            // A forward flip's opaque back face intentionally covers the first
            // reading-order page. Both pages are visible on backward flips.
            const painted = style === "rotate" && forward ? before.slice(1) : before;
            const ink = await compareInk(page, beforePng, afterPng, painted.map(v => v.frame.x));
            measurements.push({ width, forward, before, after, ink });
            await test.info().attach(`${width}-${side}-ink`, {
              body: JSON.stringify(ink), contentType: "application/json",
            });
            if (JSON.stringify(before) !== JSON.stringify(after) || ink.some(v => v.bestShift !== 0)) {
              await test.info().attach(`${width}-${side}-final-frame`, { body: beforePng, contentType: "image/png" });
              await test.info().attach(`${width}-${side}-settled`, { body: afterPng, contentType: "image/png" });
            }
            expect(after).toEqual(before);
            for (const column of ink) {
              expect(column.differences[0]!.ink).toBeGreaterThan(100_000);
              expect(column.bestShift).toBe(0);
              expect(column.differences.find(v => v.dx === 0)!.difference).toBe(0);
            }
          }
          expect(await measure(page)).toEqual(start);
        }
        const transitions = await page.evaluate(() => window.spreadHandoff.transitions);
        if (style === "none") expect(transitions).toBe(0);
        else expect(transitions).toBeGreaterThan(0);
        await test.info().attach("handoff-measurements", {
          body: JSON.stringify(measurements), contentType: "application/json",
        });
      } finally {
        await context.close();
      }
    });
  }
}
