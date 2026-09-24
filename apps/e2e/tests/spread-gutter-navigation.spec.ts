import { expect, test, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
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
    test(`${rtl ? "RTL" : "LTR"} ${scenario}: right-page gutter never requests backward navigation (#182)`, async () => {
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
            const rect = c.host.columnElement("right").getBoundingClientRect();
            const requests: number[] = [];
            const original = c.turnPage;
            c.turnPage = function (direction: number) { requests.push(direction); return original.call(this, direction); };
            Reflect.set(window, "__gutterRequests", requests);
            return { positions: c.host.positions, x: rect.left + 10 };
          });
          expect(setup.positions).toEqual({
            first: { spineIndex: 0, pageIndex: scenario === "later-boundary" ? 2 : 0 },
            ...(scenario === "single-page" ? {} : { second: { spineIndex: 1, pageIndex: 0 } }),
          });
          await page.mouse.move(setup.x, 350);
          const toolbar = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");
          await expect(toolbar).toHaveCSS("opacity", "0");
          await expect(toolbar).toHaveCSS("pointer-events", "none");
          await page.mouse.click(setup.x, 350);
          await settled();
          expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests"))).toEqual([1]);
          const expected = scenario === "opening-boundary"
            ? { first: { spineIndex: 2, pageIndex: 0 }, second: { spineIndex: 2, pageIndex: 1 } }
            : scenario === "later-boundary"
              ? { first: { spineIndex: 1, pageIndex: 1 }, second: { spineIndex: 1, pageIndex: 2 } }
              : { first: { spineIndex: 0, pageIndex: 0 } };
          expect(await page.evaluate(() => Reflect.get(window, "__readerController").host.positions)).toEqual(expected);
        }
      } finally {
        await context.close();
      }
    });
  }

  for (const style of ["slide", "rotate", "scroll"]) {
    test(`${rtl ? "RTL" : "LTR"} ${style}: a right-gutter tap during animation does not reverse direction (#182)`, async () => {
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
        await page.mouse.move(710, 350);
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
        await page.mouse.click(710, 350);
        expect(await page.evaluate(() => Reflect.get(window, "__gutterRequests")))
          .not.toContain(-1);
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
