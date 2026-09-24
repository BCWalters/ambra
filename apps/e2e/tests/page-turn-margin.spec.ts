import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = process.env.AMBRA_E2E_ROMEO_EPUB ??
  fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const toolbar = (page: Page) =>
  page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isLoadInFlight && !c.isTurningPage && !c.isApplyingLayout && !c.pendingLayout;
  });
}

async function position(page: Page) {
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController").snapshot();
    return { spine: c.spineIndex, page: c.pageIndex };
  });
}

for (const style of ["slide", "scroll"] as const) {
  test(`${style}: one hidden-chrome right-margin click advances a two-page spread (#174)`, async () => {
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await settled(page);
      await page.evaluate(async style => {
        await Reflect.get(window, "__readerController").setPageTurnAnimationStyle(style);
      }, style);
      await page.keyboard.press("ArrowRight");
      await settled(page);
      await page.keyboard.press("ArrowRight");
      await settled(page);
      const box = (await page.locator("iframe").nth(1).boundingBox())!;
      const point = { x: box.x + box.width - 10, y: 200 };
      await page.mouse.move(point.x, point.y);
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");

      for (let turn = 0; turn < 3; turn++) {
        const before = await position(page);
        await page.mouse.click(point.x, point.y);
        await expect.poll(() => position(page)).not.toEqual(before);
        await settled(page);
        await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
        await page.keyboard.press("ArrowLeft");
        await settled(page);
        expect(await position(page)).toEqual(before);
      }

      // Chromium can select text translated outside this page on a tiny
      // margin drag. Such an invisible range must not eat the next click.
      await page.mouse.move(10, 2);
      await expect(toolbar(page)).toHaveCSS("pointer-events", "auto");
      const before = await position(page);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      const input = await context.newCDPSession(page);
      await input.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: point.x, y: point.y + 8, button: "left", buttons: 1,
      });
      await input.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: point.x, y: point.y + 8, button: "left", buttons: 0, clickCount: 1,
      });
      await input.detach();
      await settled(page);
      expect(await position(page)).toEqual(before);
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
      await expect(page.getByRole("button", { name: "Add note", exact: true })).toBeHidden();
      const selections = await page.evaluate(() => Array.from(document.querySelectorAll("iframe")).map(frame => {
        const s = frame.contentDocument!.getSelection();
        const box = frame.getBoundingClientRect();
        const [top = 0, right = top, bottom = top, left = right] =
          Array.from(frame.style.clipPath.matchAll(/(-?[\d.]+)px/g), m => Number(m[1]));
        const rects = s?.rangeCount ? Array.from(s.getRangeAt(0).getClientRects()) : [];
        return {
          text: s?.toString(), clip: frame.style.clipPath,
          frame: box.toJSON(),
          rects: rects.map(r => r.toJSON()),
          visible: rects.filter(r => r.width > 0 && r.height > 0 &&
            r.bottom > Math.max(top, -box.top) &&
            r.top < Math.min(box.height - bottom, innerHeight - box.top) &&
            r.right > Math.max(left, -box.left) &&
            r.left < Math.min(box.width - right, innerWidth - box.left)).length,
        };
      }));
      await test.info().attach("before-single-click", {
        body: JSON.stringify({ before, selections }, null, 2), contentType: "application/json",
      });
      expect(selections.some(s => s.text?.trim())).toBe(true);
      expect(selections.every(s => s.visible === 0)).toBe(true);
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => position(page)).not.toEqual(before);
      await settled(page);
      await page.keyboard.press("ArrowLeft");
      await settled(page);

      // A tiny drift during a hidden-chrome tap can create the same range
      // before pointerup; it must not swallow this click either.
      const beforeDrift = await position(page);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      const driftInput = await context.newCDPSession(page);
      await driftInput.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: point.x, y: point.y + 8, button: "left", buttons: 1,
      });
      await driftInput.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: point.x, y: point.y + 8, button: "left", buttons: 0, clickCount: 1,
      });
      await driftInput.detach();
      await expect.poll(() => position(page)).not.toEqual(beforeDrift);
      await settled(page);
    } finally {
      await context.close();
    }
  });
}
