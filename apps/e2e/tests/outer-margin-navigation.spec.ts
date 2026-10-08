import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader, outerMarginPoint } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

async function settle(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isTurningPage && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
  });
}

async function observeTurns(page: Page) {
  await page.mouse.move(400, 350);
  await expect(page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ })
    .locator("..")).toHaveCSS("opacity", "0");
  await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const original = c.turnPage;
    const turns: number[] = [];
    Reflect.set(window, "__marginTurns", turns);
    c.turnPage = function(direction: number) {
      turns.push(direction);
      return original.call(this, direction);
    };
  });
}

async function turns(page: Page) {
  return page.evaluate(() => Reflect.get(window, "__marginTurns"));
}

for (const { width, scale, justify } of [
  { width: 320, scale: 1, justify: false },
  { width: 480, scale: 1.5, justify: true },
  { width: 1100, scale: 0.75, justify: true },
]) for (const rtl of [false, true]) {
  test(`${width}px ${rtl ? "RTL" : "LTR"}: hybrid edges preserve text and turn from blank line ends (#268)`, async () => {
    const book = navigationFixture(test.info(), [8], (_chapter, index) =>
      `<section id="part${index}" style="height:600px;break-inside:avoid">
        <p class="edge-copy" style="margin:0;direction:${rtl ? "rtl" : "ltr"};text-align:${justify ? "justify" : rtl ? "right" : "left"}">
          ${"Original words describe a quiet garden, a nearby window, and a winding path. ".repeat(3)}
        </p>
        <p class="edge-word" style="text-align:right;margin:0">Selection</p>
        <p class="edge-end" style="text-align:left;margin:20px 0">End.</p>
        <button style="display:block;width:100%;height:30px">A publication control</button>
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" style="display:block;margin-left:auto"><rect width="32" height="32" fill="blue"/></svg>
      </section>`, rtl ? "rtl" : "ltr");
    const { context, readerPage: page } = await launchReader(book, { viewport: { width, height: 900 } });
    try {
      await exposeReaderController(page);
      await page.evaluate(async scale => {
        const c = Reflect.get(window, "__readerController");
        await c.setPageTurnAnimationStyle("none");
        await c.setFontScale(scale);
        await c.setContentWidth(44);
        await c.openSpineItem(0, { landOnPageIndex: 2 });
      }, scale);
      await settle(page);
      const geometry = await page.evaluate(() => {
        const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"))
          .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        const frame = frames.at(-1)!;
        const doc = frame.contentDocument!;
        const pane = frame.getBoundingClientRect();
        const clipTop = Number(frame.style.clipPath.match(/inset\(([\d.]+)px/)?.[1] ?? 0);
        const body = doc.body.getBoundingClientRect();
        const padding = parseFloat(doc.defaultView!.getComputedStyle(doc.body).paddingRight);
        const oldEdgeWidth = Math.max(44, Math.min(pane.width * 0.08, 64));
        const edgeWidth = Math.max(64, Math.min(pane.width * 0.2, 160));
        const blankX = pane.width - (oldEdgeWidth + edgeWidth) / 2;
        const visible = Array.from(doc.querySelectorAll("section")).find(section => {
          const box = section.querySelector(".edge-end")!.getBoundingClientRect();
          return box.top > 140 && box.bottom < 750;
        })!;
        const end = visible.querySelector(".edge-end")!.getBoundingClientRect();
        const copy = visible.querySelector(".edge-copy")!;
        const walker = doc.createTreeWalker(visible.querySelector(".edge-word")!, NodeFilter.SHOW_TEXT);
        const range = doc.createRange();
        let glyph: { x: number; y: number } | undefined;
        while (walker.nextNode() && !glyph) {
          const node = walker.currentNode;
          for (let offset = 0; offset < node.textContent!.length && !glyph; offset++) {
            if (!/\p{L}/u.test(node.textContent![offset]!)) continue;
            range.setStart(node, offset); range.setEnd(node, offset + 1);
            for (const box of range.getClientRects()) {
              const gx = Math.max((box.left + box.right) / 2, pane.width - edgeWidth + 0.5);
              if (box.width > 1 && gx < box.right - 0.25 && box.top > clipTop + 1 && box.bottom < 750) {
                glyph = { x: pane.left + gx, y: pane.top + (box.top + box.bottom) / 2 };
                break;
              }
            }
          }
        }
        range.selectNodeContents(visible.querySelector(".edge-word")!);
        const word = range.getBoundingClientRect();
        const selection = { x: pane.left + (word.left + word.right) / 2, y: pane.top + (word.top + word.bottom) / 2 };
        range.selectNodeContents(copy);
        const lines = Array.from(range.getClientRects()).filter(rect => rect.height > 0 && rect.top > clipTop + 1);
        const gapIndex = lines.findIndex((line, i) => i > 0 && line.top > lines[i - 1]!.bottom + 1);
        const gap = gapIndex > 0 ? {
          x: pane.left + blankX,
          y: pane.top + (lines[gapIndex]!.top + lines[gapIndex - 1]!.bottom) / 2,
        } : undefined;
        const button = visible.querySelector("button")!.getBoundingClientRect();
        const image = visible.querySelector("svg")!.getBoundingClientRect();
        return {
          blank: { x: pane.left + blankX, y: pane.top + (end.top + end.bottom) / 2 },
          glyph, selection, gap, blankX, bandStart: pane.width - edgeWidth,
          oldBandStart: pane.width - oldEdgeWidth, bodyRight: body.right - padding,
          button: { x: pane.left + blankX, y: pane.top + (button.top + button.bottom) / 2 },
          image: { x: pane.left + image.right - 1, y: pane.top + (image.top + image.bottom) / 2 },
          count: Reflect.get(window, "__readerController").snapshot().pageCount,
        };
      });
      expect(geometry.blankX).toBeLessThan(geometry.bodyRight);
      expect(geometry.blankX).toBeGreaterThan(geometry.bandStart);
      expect(geometry.blankX).toBeLessThan(geometry.oldBandStart);
      expect(geometry.glyph, JSON.stringify(geometry)).toBeDefined();
      expect(geometry.gap, JSON.stringify(geometry)).toBeDefined();
      await observeTurns(page);
      await page.mouse.dblclick(geometry.glyph!.x, geometry.glyph!.y);
      expect(await turns(page)).toEqual([]);
      // The edge probe may be beside the final caret; select from the word's
      // interior rather than relying on platform-specific word-boundary snaps.
      await page.mouse.dblclick(geometry.selection.x, geometry.selection.y);
      expect(await turns(page)).toEqual([]);
      expect(await page.evaluate(() => Array.from(document.querySelectorAll("iframe"))
        .some(frame => !!frame.contentDocument!.getSelection()?.toString().trim()))).toBe(true);
      await page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        c.highlightInteraction.dismissSelectionToolbar();
        for (const frame of document.querySelectorAll("iframe")) frame.contentDocument!.getSelection()?.removeAllRanges();
      });
      await page.mouse.click(geometry.button.x, geometry.button.y);
      await page.mouse.click(geometry.image.x, geometry.image.y);
      expect(await turns(page)).toEqual([]);
      await page.mouse.click(geometry.blank.x, geometry.blank.y);
      await settle(page);
      expect(await turns(page)).toEqual([rtl ? -1 : 1]);
      await page.evaluate(() => Reflect.get(window, "__readerController").openSpineItem(0, { landOnPageIndex: 2 }));
      await settle(page);
      await page.mouse.click(geometry.gap!.x, geometry.gap!.y);
      await settle(page);
      expect(await turns(page)).toEqual([rtl ? -1 : 1, rtl ? -1 : 1]);
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageCount))
        .toBe(geometry.count);
    } finally { await context.close(); }
  });
}

for (const width of [360, 1100]) for (const rtl of [false, true]) {
  test(`${width}px ${rtl ? "RTL" : "LTR"}: wider edges navigate through the full-height reading pane`, async () => {
    const book = navigationFixture(test.info(), [12], (_chapter, index) =>
      `<section style="height:600px;break-inside:avoid"><p>Original passage ${index}.</p></section>`, rtl ? "rtl" : "ltr");
    const { context, readerPage: page } = await launchReader(book, { viewport: { width, height: 900 } });
    try {
      await exposeReaderController(page);
      await page.evaluate(async () => {
        const c = Reflect.get(window, "__readerController");
        await c.setPageTurnAnimationStyle("none");
        await c.openSpineItem(0, { landOnPageIndex: 4 });
      });
      await settle(page);
      await observeTurns(page);
      const toolbar = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");
      const geometry = await page.evaluate(() => {
        const frames = Array.from(document.querySelectorAll("iframe"))
          .map(frame => frame.getBoundingClientRect()).sort((a, b) => a.left - b.left);
        const points = [frames[0]!, frames.at(-1)!].map((pane, index) => {
          const oldBand = Math.max(44, Math.min(pane.width * 0.08, 64));
          const band = Math.max(64, Math.min(pane.width * 0.2, 160));
          const inset = (oldBand + band) / 2;
          return { x: index ? pane.right - inset : pane.left + inset, inset, oldBand, band };
        });
        return { points, spread: Reflect.get(window, "__readerController").snapshot().isSpread };
      });
      expect(geometry.spread).toBe(width === 1100);
      await test.info().attach("full-height-edge-geometry", {
        body: JSON.stringify(geometry), contentType: "application/json",
      });
      const expected: number[] = [];
      for (const [index, point] of geometry.points.entries()) {
        expect(point.inset).toBeGreaterThan(point.oldBand);
        expect(point.inset).toBeLessThan(point.band);
        for (const y of [1, 60, 450, 825, 899]) {
          await page.evaluate(() =>
            Reflect.get(window, "__readerController").openSpineItem(0, { landOnPageIndex: 4 }));
          await settle(page);
          await page.mouse.move(20, 20);
          await expect(toolbar).toHaveCSS("opacity", "1");
          await page.mouse.move(width / 2, 1);
          await expect(page.getByRole("tooltip")).toBeHidden();
          await page.mouse.click(point.x, y);
          await expect(toolbar, `dismissal at x=${point.x}, y=${y}`).toHaveCSS("pointer-events", "none");
          expect(await turns(page), "visible chrome consumes the first tap").toEqual(expected);
          await page.mouse.click(point.x, y);
          await settle(page);
          expected.push((index ? 1 : -1) * (rtl ? -1 : 1));
          expect(await turns(page), `x=${point.x}, y=${y}`).toEqual(expected);
        }
      }
    } finally {
      await context.close();
    }
  });
}

for (const rtl of [false, true]) {
  test(`single ${rtl ? "RTL" : "LTR"}: content beyond the expanded bands stays inert`, async () => {
    const { context, readerPage: page } = await launchReader(navigationFixture(test.info(), [8], undefined, rtl ? "rtl" : "ltr"), {
      viewport: { width: 800, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.evaluate(async () => {
        const c = Reflect.get(window, "__readerController");
        await c.setPageTurnAnimationStyle("none");
        await c.openSpineItem(0, { landOnPageIndex: 2 });
      });
      await settle(page);
      const bounds = await page.evaluate(() => {
        const frame = document.querySelector("iframe")!;
        const doc = frame.contentDocument!;
        const body = doc.body.getBoundingClientRect();
        const style = doc.defaultView!.getComputedStyle(doc.body);
        const rect = frame.getBoundingClientRect();
        return {
          left: rect.left + body.left + parseFloat(style.paddingLeft),
          right: rect.left + body.right - parseFloat(style.paddingRight),
          pane: rect.toJSON(),
        };
      });
      await test.info().attach("rendered-measure", {
        body: JSON.stringify(bounds), contentType: "application/json",
      });
      await observeTurns(page);
      const band = Math.max(64, Math.min(bounds.pane.width * 0.2, 160));
      const leftBoundary = Math.max(bounds.left, bounds.pane.left + band);
      const rightBoundary = Math.min(bounds.right, bounds.pane.right - band);
      for (const x of [leftBoundary + 1, leftBoundary + 30, rightBoundary - 30, rightBoundary - 1]) {
        await page.mouse.click(x, 350);
        await page.mouse.click(x, 740);
        expect(await turns(page)).toEqual([]);
      }

      // A small release drift from content into the margin is not a margin tap.
      await page.mouse.move(rightBoundary - 2, 740);
      await page.mouse.down();
      await page.mouse.move(rightBoundary + 2, 740);
      await page.mouse.up();
      expect(await turns(page)).toEqual([]);
      const right = await outerMarginPoint(page, "right");
      await page.mouse.click(right.x, right.y);
      await settle(page);
      expect(await turns(page)).toEqual([rtl ? -1 : 1]);
      const left = await outerMarginPoint(page, "left");
      await page.mouse.click(left.x, left.y);
      await settle(page);
      expect(await turns(page)).toEqual([rtl ? -1 : 1, rtl ? 1 : -1]);
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageIndex)).toBe(2);
    } finally {
      await context.close();
    }
  });
}

for (const rtl of [false, true]) {
  test(`FXL ${rtl ? "RTL" : "LTR"}: scaled artwork interiors and gutter stay inert; outer edges navigate`, async () => {
    const book = fileURLToPath(new URL(`../fixtures/fxl-spread-${rtl ? "rtl" : "ltr"}.epub`, import.meta.url));
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 1600, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await settle(page);
      await page.evaluate(async () => {
        const c = Reflect.get(window, "__readerController");
        await c.setPageTurnAnimationStyle("none");
        await c.turnPage(1);
      });
      await settle(page);
      await observeTurns(page);
      const geometry = await page.evaluate(() => Array.from(document.querySelectorAll("iframe"))
        .map(frame => frame.getBoundingClientRect().toJSON())
        .sort((a, b) => a.left - b.left));
      await test.info().attach("rendered-fixed-pages", {
        body: JSON.stringify(geometry), contentType: "application/json",
      });
      for (const rect of geometry) {
        const band = Math.min(rect.width * 0.08, 64);
        for (const x of [rect.left + band + 1, rect.left + rect.width / 4, rect.right - band - 1]) {
          await page.mouse.click(x, 400);
          expect(await turns(page)).toEqual([]);
        }
      }
      await page.mouse.click(geometry[0]!.right - 5, 400);
      await page.mouse.click(geometry[1]!.left + 5, 400);
      await page.mouse.click((geometry[0]!.right + geometry[1]!.left) / 2, 400);
      expect(await turns(page)).toEqual([]);
      const back = await outerMarginPoint(page, rtl ? "right" : "left");
      await page.mouse.click(back.x, back.y);
      await settle(page);
      expect(await turns(page)).toEqual([-1]);
      const forward = await outerMarginPoint(page, rtl ? "left" : "right");
      await page.mouse.click(forward.x, forward.y);
      await settle(page);
      expect(await turns(page)).toEqual([-1, 1]);

      // Width-fitted artwork retains both physical outer-edge targets.
      await page.setViewportSize({ width: 1200, height: 900 });
      await settle(page);
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").appliedWidth)).toBe(1200);
      await settle(page);
      await page.mouse.move(600, 400);
      await expect(page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ })
        .locator("..")).toHaveCSS("opacity", "0");
      await page.mouse.click(rtl ? 1195 : 5, 400);
      await settle(page);
      expect(await turns(page)).toEqual([-1, 1, -1]);
      await page.mouse.click(rtl ? 5 : 1195, 400);
      await settle(page);
      expect(await turns(page)).toEqual([-1, 1, -1, 1]);
    } finally {
      await context.close();
    }
  });
}
