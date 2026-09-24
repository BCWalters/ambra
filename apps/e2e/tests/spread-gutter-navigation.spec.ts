import { expect, test, type TestInfo } from "@playwright/test";
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
    test(`${rtl ? "RTL" : "LTR"} ${style}: a gutter tap during animation requests no navigation (#182)`, async () => {
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
        await page.evaluate(() => {
          const controller = Reflect.get(window, "__readerController");
          const requests: number[] = [];
          const originalTurn = controller.turnPage;
          controller.turnPage = function (direction: number) {
            requests.push(direction);
            return originalTurn.call(this, direction);
          };
          Reflect.set(window, "__gutterRequests", requests);
          const animate = Element.prototype.animate;
          const animations: Animation[] = [];
          Reflect.set(window, "__gutterNativeAnimate", animate);
          Reflect.set(window, "__gutterAnimations", animations);
          Element.prototype.animate = function (...args) {
            const animation = animate.apply(this, args);
            animation.playbackRate = 0.02;
            animations.push(animation);
            return animation;
          };
          Reflect.set(window, "__gutterPendingTurn", controller.turnPage(1));
        });
        await page.waitForFunction(() => Reflect.get(window, "__readerController").isAnimatingPageTurn);
        await page.mouse.click(700, 350);
        expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests")))
          .toEqual([1]);
        await page.evaluate(async () => {
          Element.prototype.animate = Reflect.get(window, "__gutterNativeAnimate");
          for (const animation of Reflect.get(window, "__gutterAnimations") as Animation[]) animation.finish();
          await Reflect.get(window, "__gutterPendingTurn");
        });
        await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
        expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageIndex))
          .toBeGreaterThan(2);
      } finally {
        await context.close();
      }
    });
  }
}
