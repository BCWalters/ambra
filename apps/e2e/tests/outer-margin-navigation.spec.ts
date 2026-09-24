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

for (const rtl of [false, true]) {
  test(`single ${rtl ? "RTL" : "LTR"}: content whitespace and measure boundaries are not tap zones`, async () => {
    const { context, readerPage: page } = await launchReader(navigationFixture(test.info(), [8]), {
      viewport: { width: 800, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.evaluate(async rtl => {
        const c = Reflect.get(window, "__readerController");
        c.pkg.pageProgressionDirection = rtl ? "rtl" : "ltr";
        await c.setPageTurnAnimationStyle("none");
        await c.openSpineItem(0, { landOnPageIndex: 2 });
      }, rtl);
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
      for (const x of [bounds.left + 1, bounds.left + 30, bounds.right - 30, bounds.right - 1]) {
        await page.mouse.click(x, 350);
        await page.mouse.click(x, 740);
        expect(await turns(page)).toEqual([]);
      }
      // A small release drift from content into the margin is not a margin tap.
      await page.mouse.move(bounds.right - 2, 740);
      await page.mouse.down();
      await page.mouse.move(bounds.right + 2, 740);
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
  test(`FXL ${rtl ? "RTL" : "LTR"}: only outside scaled artwork navigates, never the gutter`, async () => {
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
        for (const x of [rect.left + 5, rect.left + rect.width / 4, rect.right - 5]) {
          await page.mouse.click(x, 400);
          expect(await turns(page)).toEqual([]);
        }
      }
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

      // Width-fitted artwork leaves no lateral margin. Do not steal its edges.
      await page.setViewportSize({ width: 1200, height: 900 });
      await settle(page);
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").width)).toBe(1200);
      await page.mouse.click(5, 400);
      await page.mouse.click(1195, 400);
      expect(await turns(page)).toEqual([-1, 1]);
      await page.keyboard.press(rtl ? "ArrowRight" : "ArrowLeft");
      await settle(page);
      expect(await turns(page)).toEqual([-1, 1, -1]);
    } finally {
      await context.close();
    }
  });
}
