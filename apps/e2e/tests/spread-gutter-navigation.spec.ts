import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader, outerMarginPoint } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

function directionalFixture(info: TestInfo, counts: number[], rtl: boolean) {
  const book = navigationFixture(info, counts);
  if (rtl) {
    const manifest = path.join(info.outputPath("navigation-source"), "EPUB/package.opf");
    fs.writeFileSync(manifest, fs.readFileSync(manifest, "utf8")
      .replace("<spine>", '<spine page-progression-direction="rtl">'));
    execFileSync("zip", ["-q", "-X", book, "EPUB/package.opf"], {
      cwd: info.outputPath("navigation-source"),
    });
  }
  return book;
}

async function holdTurnAtStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    const browserWindow: Window = window;
    const nativeFrame = window.requestAnimationFrame;
    const nativeTimeout = browserWindow.setTimeout;
    const animations: Animation[] = [];
    const deadlines: (() => void)[] = [];
    const requests: number[] = [];
    const turn = controller.turnPage;
    controller.turnPage = function (direction: number) {
      requests.push(direction);
      return turn.call(this, direction);
    };
    Reflect.set(window, "__gutterRequests", requests);
    Reflect.set(window, "__gutterAnimations", animations);
    // Hold the owned transition's safety deadline as well as its CSS clock.
    browserWindow.setTimeout = (handler, timeout, ...args) => {
      if (controller.isAnimatingPageTurn && timeout === 600 && typeof handler === "function") {
        deadlines.push(() => handler(...args));
        return -deadlines.length;
      }
      return nativeTimeout.call(window, handler, timeout, ...args);
    };
    window.requestAnimationFrame = callback => nativeFrame.call(window, time => {
      callback(time);
      if (animations.length || !controller.isAnimatingPageTurn) return;
      const transitions = document.getAnimations().filter(animation =>
        animation instanceof CSSTransition && animation.effect?.getTiming().duration === 380);
      if (!transitions.some(animation =>
        animation instanceof CSSTransition && animation.transitionProperty === "transform")) return;
      for (const animation of transitions) {
        animation.pause();
        animation.currentTime = 0;
        animations.push(animation);
      }
    });
    Reflect.set(window, "__releaseGutterTurn", async () => {
      window.requestAnimationFrame = nativeFrame;
      browserWindow.setTimeout = nativeTimeout;
      for (const animation of animations) animation.finish();
      for (const deadline of deadlines) deadline();
      await Reflect.get(window, "__gutterPendingTurn");
    });
    Reflect.set(window, "__gutterPendingTurn", controller.turnPage(1));
  });
  await page.waitForFunction(() => Reflect.get(window, "__gutterAnimations").length > 0);
}

async function setTurnPhase(page: Page, time: number): Promise<void> {
  await page.evaluate(async time => {
    for (const animation of Reflect.get(window, "__gutterAnimations") as Animation[]) animation.currentTime = time;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, time);
}

for (const rtl of [false, true]) {
  for (const scenario of ["opening-boundary", "later-boundary", "single-page"] as const) {
    test(`${rtl ? "RTL" : "LTR"} ${scenario}: only physical outer margins navigate (#182)`, async () => {
      const counts = scenario === "opening-boundary" ? [1, 1, 4] : scenario === "later-boundary" ? [3, 4] : [1];
      const book = directionalFixture(test.info(), counts, rtl);
      const { context, readerPage: page } = await launchReader(book, {
        viewport: { width: 1400, height: 900 },
      });
      try {
        await exposeReaderController(page);
        const settled = () => page.waitForFunction(() => {
          const c = Reflect.get(window, "__readerController");
          return c?.host && !c.isTurningPage && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
        });
        await settled();
        for (const style of ["slide", "rotate", "scroll", "none"]) {
          await page.evaluate(async ({ style, scenario }) => {
            const c = Reflect.get(window, "__readerController");
            await c.setPageTurnAnimationStyle(style);
            await c.openSpineItem(0, { landOnPageIndex: scenario === "later-boundary" ? 2 : 0 });
          }, { style, scenario });
          await settled();
          const setup = await page.evaluate(() => {
            const c = Reflect.get(window, "__readerController");
            const left = c.host.columnElement("left").getBoundingClientRect();
            const right = c.host.columnElement("right").getBoundingClientRect();
            const requests: number[] = [];
            const original = Reflect.get(window, "__originalMarginTurn") ?? c.turnPage;
            Reflect.set(window, "__originalMarginTurn", original);
            c.turnPage = function (direction: number) {
              requests.push(direction);
              return original.call(this, direction);
            };
            Reflect.set(window, "__gutterRequests", requests);
            return {
              positions: c.host.positions,
              inert: [
                left.left + left.width / 4, left.right - 10,
                (left.right + right.left) / 2, right.left + 10,
                right.left + right.width * 0.75,
              ],
            };
          });
          expect(setup.positions).toEqual({
            first: { spineIndex: 0, pageIndex: scenario === "later-boundary" ? 2 : 0 },
            ...(scenario === "single-page" ? {} : { second: { spineIndex: 1, pageIndex: 0 } }),
          });
          await page.mouse.move(setup.inert[0]!, 350);
          const toolbar = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");
          await expect(toolbar).toHaveCSS("opacity", "0");
          await expect(toolbar).toHaveCSS("pointer-events", "none");
          for (const x of setup.inert) {
            await page.mouse.click(x, 350);
            await settled();
            expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests"))).toEqual([]);
            expect(await page.evaluate(() => Reflect.get(window, "__readerController").host.positions))
              .toEqual(setup.positions);
          }
          // Top/bottom whitespace inside the reading measure is equally inert.
          await page.mouse.click(setup.inert[0]!, 740);
          expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests"))).toEqual([]);
          const back = await outerMarginPoint(page, rtl ? "right" : "left");
          await page.mouse.click(back.x, back.y);
          await settled();
          expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests"))).toEqual([-1]);
          // Restore the boundary before testing forward traversal.
          await page.evaluate(async scenario => {
            const c = Reflect.get(window, "__readerController");
            await c.openSpineItem(0, { landOnPageIndex: scenario === "later-boundary" ? 2 : 0 });
          }, scenario);
          const forward = await outerMarginPoint(page, rtl ? "left" : "right");
          await page.mouse.click(forward.x, forward.y);
          await settled();
          expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests"))).toEqual([-1, 1]);
          const expected = scenario === "opening-boundary"
            ? { first: { spineIndex: 2, pageIndex: 0 }, second: { spineIndex: 2, pageIndex: 1 } }
            : scenario === "later-boundary"
              ? { first: { spineIndex: 1, pageIndex: 1 }, second: { spineIndex: 1, pageIndex: 2 } }
              : { first: { spineIndex: 0, pageIndex: 0 } };
          expect(await page.evaluate(() => Reflect.get(window, "__readerController").host.positions)).toEqual(expected);
        }
        if (scenario === "single-page") {
          for (const width of [1600, 1200]) {
            await page.setViewportSize({ width, height: 900 });
            await page.waitForFunction(width => Reflect.get(window, "__readerController").width === width, width);
            await settled();
            const geometry = await page.evaluate(() => {
              const c = Reflect.get(window, "__readerController");
              const left = c.host.columnElement("left").getBoundingClientRect();
              const right = c.host.columnElement("right").getBoundingClientRect();
              const pane = c.containerEl.getBoundingClientRect();
              return { left: left.left, right: right.right, leftWidth: left.width, rightWidth: right.width, pane: pane.toJSON() };
            });
            expect(geometry.leftWidth).toBeCloseTo(geometry.rightWidth);
            expect(geometry.left).toBeCloseTo(geometry.pane.left);
            expect(geometry.right).toBeCloseTo(geometry.pane.right);
            await page.mouse.move(width / 2, 350);
            await expect(page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ })
              .locator("..")).toHaveCSS("opacity", "0");
            await page.evaluate(() => { Reflect.get(window, "__gutterRequests").length = 0; });
            for (const side of ["left", "right"] as const) {
              const point = await outerMarginPoint(page, side);
              await page.mouse.click(point.x, point.y);
              await settled();
            }
            expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests")))
              .toEqual(rtl ? [1, -1] : [-1, 1]);
          }
        }
      } finally {
        await context.close();
      }
    });
  }

  for (const style of ["slide", "rotate", "scroll"]) {
    for (const target of ["gutter", "outer margin"] as const) {
      test(`${rtl ? "RTL" : "LTR"} ${style}: phase-controlled ${target} taps preserve turn ownership (#279)`, async () => {
        const { context, readerPage: page } = await launchReader(
          directionalFixture(test.info(), [16], rtl), { viewport: { width: 1400, height: 900 } },
        );
        try {
          await exposeReaderController(page);
          await page.evaluate(async animationStyle => {
            const controller = Reflect.get(window, "__readerController");
            await controller.setPageTurnAnimationStyle(animationStyle);
            await controller.openSpineItem(0, { landOnPageIndex: 2 });
          }, style);
          await page.mouse.move(700, 350);
          await expect(page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ })
            .locator("..")).toHaveCSS("opacity", "0");
          const point = target === "gutter" ? { x: 700, y: 350 }
            : await outerMarginPoint(page, rtl ? "left" : "right");
          await holdTurnAtStart(page);
          await page.mouse.move(point.x, point.y);
          await page.mouse.down();
          await setTurnPhase(page, 180);
          await page.mouse.up();
          if (target === "gutter") {
            // Also reject a tap that begins after the paper has rotated/moved.
            await page.mouse.click(point.x, point.y);
          }
          expect(await page.evaluate(() => Reflect.get(window, "__readerController").isAnimatingPageTurn)).toBe(true);
          expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests")))
            .toEqual(target === "gutter" ? [1] : [1, 1]);
          await page.evaluate(() => Reflect.get(window, "__releaseGutterTurn")());
          await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
          const first = target === "gutter" ? 4 : 6;
          expect(await page.evaluate(() => Reflect.get(window, "__readerController").host.positions)).toEqual({
            first: { spineIndex: 0, pageIndex: first },
            second: { spineIndex: 0, pageIndex: first + 1 },
          });
          // An accepted outer-margin request is replayed once by the bounded queue.
          expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests")))
            .toEqual(target === "gutter" ? [1] : [1, 1, 1]);
        } finally {
          await context.close();
        }
      });
    }
  }
}
