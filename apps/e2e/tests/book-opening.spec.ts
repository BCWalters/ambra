import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentPageLabel, launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const fullLibrary of [true, false]) {
  test(`${fullLibrary ? "full" : "mini"} Library opens with a non-blocking, one-shot reader fade`, async () => {
    const { context, libraryPage, readerPage, extensionId } = await launchReader(
      path.resolve(here, "../fixtures/long-content.epub"),
      { viewport: { width: 1000, height: 900 } },
    );
    try {
      await readerPage.close();
      await context.addInitScript(() => {
        let count = 0;
        Reflect.set(window, "__openingCount", count);
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (keyframes, options) {
          const animation = animate.call(this, keyframes, options);
          if (this.hasAttribute("data-book-opening")) {
            Reflect.set(window, "__openingCount", ++count);
            Reflect.set(window, "__openingAnimation", animation);
            // Hold the cosmetic effect so input and focus can be tested during it.
            animation.pause();
            animation.currentTime = 90;
          }
          return animation;
        };
      });
      await libraryPage.setViewportSize({
        width: fullLibrary ? 1000 : 360,
        height: 900,
      });
      await libraryPage.goto(
        `chrome-extension://${extensionId}/src/library/index.html${fullLibrary ? "?view=tab" : ""}`,
      );
      await libraryPage.emulateMedia({ reducedMotion: "no-preference" });
      const open = libraryPage.getByRole("button", { name: /^Open / }).first();
      await open.hover();
      await libraryPage.mouse.down();
      await expect(open).toHaveCSS("filter", "brightness(0.88)");
      const opened = context.waitForEvent("page");
      await libraryPage.mouse.up();
      const page = await opened;
      await page.waitForLoadState("domcontentloaded");
      const cover = page.locator("[data-book-opening]");
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__openingCount"))).toBe(1);
      await expect(cover).toHaveAttribute("aria-hidden", "true");
      await expect(cover).toHaveCSS("pointer-events", "none");
      expect(await page.evaluate(() =>
        Reflect.get(window, "__openingAnimation").effect.getTiming().duration,
      )).toBe(180);
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
      const before = await currentPageLabel(page);
      expect(before).not.toBeNull();
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => currentPageLabel(page)).not.toBe(before);
      await expect(cover).toHaveCount(1);
      await page.evaluate(() => Reflect.get(window, "__openingAnimation").finish());
      await expect(cover).toHaveCount(0);
      expect(await page.evaluate(() => Reflect.get(window, "__openingCount"))).toBe(1);

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.reload();
      await expect(page.getByRole("slider", { name: "Position in book" }))
        .toHaveAttribute("aria-valuetext", /^Page \d+ of \d+/);
      await expect(cover).toHaveCount(0);
      expect(await page.evaluate(() => Reflect.get(window, "__openingCount"))).toBe(0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      expect(await page.evaluate(() => Reflect.get(window, "__openingCount"))).toBe(0);

      await libraryPage.emulateMedia({ reducedMotion: "reduce" });
      await expect(open).toHaveCSS("transition-duration", "0s");
    } finally {
      await context.close();
    }
  });
}
