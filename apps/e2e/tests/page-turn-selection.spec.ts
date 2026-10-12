import { expect, test } from "@playwright/test";
import { clickReadingPage, launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

for (const single of [false, true]) {
  for (const rtl of [false, true]) {
    test(`${single ? "single" : "spread"} ${rtl ? "RTL" : "LTR"}: repeated edge clicks with vertical drift do not open annotation actions`, async () => {
      const epub = navigationFixture(
        test.info(),
        [60],
        (_chapter, index) =>
          `<p id="p${index}">${index}. ${"A quiet path through the hills leads home. ".repeat(30)}</p>`,
        rtl ? "rtl" : "ltr",
      );
      const { context, readerPage: page } = await launchReader(epub, {
        viewport: { width: 1547, height: 878 },
      });
      try {
        await exposeReaderController(page);
        await page.evaluate(async (single) => {
          const c = Reflect.get(window, "__readerController");
          await c.setPageTurnAnimationStyle("none");
          await c.setAlwaysShowOnePage(single);
          await c.openSpineItem(0, { fragment: "p10" });
          await c.setPageTurnAnimationStyle("rotate");
        }, single);
        await clickReadingPage(page, rtl ? "left" : "right");
        await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
        const initial = await page.evaluate(
          () => Reflect.get(window, "__readerController").snapshot().pageIndex,
        );
        const edge = await page.evaluate((rtl) => {
          const c = Reflect.get(window, "__readerController");
          const edges = [...c.pageMargins().edges].sort((a, b) => a.left - b.left);
          const rect = edges[rtl ? 0 : edges.length - 1];
          return { x: rtl ? rect.left + 3 : rect.right - 3, y: rect.top + rect.height / 2 };
        }, rtl);
        const beforeFocusChange = await page.evaluate(
          () => Reflect.get(window, "__readerController").snapshot().pageIndex,
        );
        await page.mouse.move(edge.x + (rtl ? 17 : -17), edge.y);
        await page.mouse.down();
        const away = await context.newPage();
        await away.bringToFront();
        await away.mouse.click(10, 10);
        // CDP input keeps its target window focused; simulate OS focus loss, then use native clicks.
        await page.evaluate(() => {
          Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
          try {
            window.dispatchEvent(new Event("blur"));
          } finally {
            Reflect.deleteProperty(document, "hasFocus");
          }
        });
        await expect(page.locator("[data-ambra-page-turn-input]")).toHaveCount(0);
        await away.close();
        await page.bringToFront();
        await page.mouse.up();
        expect(
          await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageIndex),
        ).toBe(beforeFocusChange);
        for (const [i, drift] of [0, 1, -1, 2, -2, 4, -4, 8, 0, 1, 0, 0].entries()) {
          const before = await page.evaluate(
            () => Reflect.get(window, "__readerController").snapshot().pageIndex,
          );
          const x = edge.x + (rtl ? 17 : -17);
          await page.mouse.move(x, edge.y);
          await page.mouse.down();
          await page.mouse.move(x + (i % 2 ? 1 : -1), edge.y + drift);
          await page.mouse.up();
          await expect
            .poll(() =>
              page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageIndex),
            )
            .toBe(before + (single ? 1 : 2));
          await page.waitForFunction(
            () => !Reflect.get(window, "__readerController").isTurningPage,
          );
        }
        for (let i = 0; i < 12; i++) {
          const y = edge.y + (i % 2 ? 6 : -6);
          const clickCount = (i % 3) + 1;
          await page.mouse.move(edge.x, y);
          await page.mouse.down({ clickCount });
          await page.mouse.move(edge.x, y + 4);
          await page.mouse.up({ clickCount });
          await page.waitForTimeout(60);
          expect(
            await page.evaluate(() => Reflect.get(window, "__readerController").selectionToolbar),
          ).toBeUndefined();
        }
        await page.waitForFunction(() => !Reflect.get(window, "__readerController").isTurningPage);
        const result = await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          return {
            page: c.snapshot().pageIndex,
            error: c.snapshot().error,
            toolbar: c.selectionToolbar,
            pending: !!c.pendingSelectionRange,
            selections: c
              .contentDocumentViews()
              .map(
                (view: { document: Document }) =>
                  view.document.getSelection()?.isCollapsed !== false,
              ),
          };
        });
        expect(result.page).toBeGreaterThan(initial);
        expect(result.error).toBeUndefined();
        expect(result.toolbar).toBeUndefined();
        expect(result.pending).toBe(false);
        expect(result.selections.every(Boolean)).toBe(true);

        await page.evaluate(async () =>
          Reflect.get(window, "__readerController").setPageTurnAnimationStyle("none"),
        );
        const text = await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          for (const { document: doc } of c.contentDocumentViews()) {
            const frame = doc.defaultView.frameElement as HTMLIFrameElement;
            const box = frame.getBoundingClientRect();
            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              for (const match of node.textContent!.matchAll(/\S{4,}/g)) {
                const range = doc.createRange();
                range.setStart(node, match.index);
                range.setEnd(node, match.index + match[0].length);
                const rect = range.getBoundingClientRect();
                if (rect.top > 120 && rect.bottom < frame.clientHeight - 120 && rect.left > 100) {
                  return { x: box.left + rect.left + 1, y: box.top + rect.top + rect.height / 2 };
                }
              }
            }
          }
          throw new Error("Visible interior text not found.");
        });
        await page.mouse.dblclick(text.x, text.y);
        await expect
          .poll(() =>
            page.evaluate(() => !!Reflect.get(window, "__readerController").selectionToolbar),
          )
          .toBe(true);
      } finally {
        await context.close();
      }
    });
  }
}
