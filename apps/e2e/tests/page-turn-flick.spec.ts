import { expect, test } from "@playwright/test";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

for (const rtl of [false, true]) {
  for (const single of [false, true]) {
    for (const style of ["rotate", "slide", "scroll"] as const) {
      test(`${single ? "single" : "spread"} ${rtl ? "RTL" : "LTR"} ${style}: a final moderate 5% swipe commits after holding or wandering, but shorter and slower swipes return`, async () => {
        const { context, readerPage: page } = await launchReader(
          navigationFixture(test.info(), [12], undefined, rtl ? "rtl" : "ltr"),
          { viewport: { width: 1540, height: 878 } },
        );
        try {
          await exposeReaderController(page);
          await page.evaluate(
            async ({ single, style }) => {
              const c = Reflect.get(window, "__readerController");
              await c.setAlwaysShowOnePage(single);
              await c.setPageTurnAnimationStyle(style);
            },
            { single, style },
          );
          for (const [fraction, duration, commit, wander, pause, reversal, buttonsCleared] of [
            [0.049, 200, false, false, 20, 0, false],
            [0.05, 200, true, false, 20, 0, false],
            [0.05, 200, true, true, 20, 0, false],
            [0.06, 500, false, false, 20, 0, false],
            [0.05, 350, true, false, 180, 2, false],
            [0.05, 200, false, false, 20, 10, false],
            [0.049, 200, false, false, 20, 0, true],
            [0.05, 200, true, false, 20, 0, true],
          ] as const) {
            const before = await page.evaluate(() =>
              Reflect.get(window, "__readerController").currentReadingCfi(),
            );
            const edge = await page.evaluate((rtl) => {
              const edges = [...Reflect.get(window, "__readerController").pageMargins().edges].sort(
                (a, b) => a.left - b.left,
              );
              const edge = edges[rtl ? 0 : edges.length - 1];
              return { x: rtl ? edge.left + 3 : edge.right - 3, y: edge.top + edge.height / 2 };
            }, rtl);
            await page.mouse.move(edge.x, edge.y);
            await page.mouse.down();
            await page.mouse.move(edge.x + (rtl ? 1 : -1) * 8, edge.y);
            await page.evaluate(
              ({ fraction, duration, rtl, wander, pause, reversal, buttonsCleared }) => {
                const c = Reflect.get(window, "__readerController");
                const gesture = c.controlledTurn;
                Reflect.set(window, "__testedMouseGestureId", c.mouseGestureSequence);
                const start = gesture.start;
                const latestTime = gesture.latestTime;
                const side = rtl ? -1 : 1;
                const distance = Math.ceil(c.width * fraction);
                let x = gesture.latestX;
                const emit = (
                  type: "pointermove" | "pointerup",
                  x: number,
                  time: number,
                  buttons = type === "pointermove" ? 1 : 0,
                ) => {
                  const event = new PointerEvent(type, {
                    pointerId: start.pointerId,
                    pointerType: "mouse",
                    buttons,
                    screenX: x,
                    screenY: start.screenY,
                    cancelable: true,
                    bubbles: true,
                  });
                  Object.defineProperty(event, "timeStamp", { value: latestTime + time });
                  document.dispatchEvent(event);
                };
                if (wander) {
                  emit("pointermove", x - side * c.width * 0.1, 100);
                  x += side * c.width * 0.1;
                  emit("pointermove", x, 200);
                }
                emit("pointermove", x, 3200);
                for (let step = 1; step <= 12; step++) {
                  emit(
                    "pointermove",
                    x - (side * distance * step) / 12,
                    3200 + (duration * step) / 12,
                  );
                }
                if (buttonsCleared) {
                  emit("pointermove", x - side * distance, 3200 + duration + pause, 0);
                }
                emit("pointerup", x - side * distance + side * reversal, 3200 + duration + pause);
              },
              { fraction, duration, rtl, wander, pause, reversal, buttonsCleared },
            );
            await page.mouse.up();
            await page.waitForFunction(() => {
              const c = Reflect.get(window, "__readerController");
              return !c.isTurningPage && !c.controlledTurn && !c.gestureCleanup;
            });
            const after = await page.evaluate(() =>
              Reflect.get(window, "__readerController").currentReadingCfi(),
            );
            const trace = await page.evaluate(() => {
              const c = Reflect.get(window, "__readerController");
              const id = Reflect.get(window, "__testedMouseGestureId");
              return c
                .getDiagnosticsText()
                .split("\n")
                .filter((line: string) => line.includes(`page-turn-mouse gestureId=${id} `));
            });
            if (commit) expect(after, trace.join("\n")).not.toBe(before);
            else expect(after, trace.join("\n")).toBe(before);
            expect(trace.some((line: string) => line.includes('phase="down"'))).toBe(true);
            expect(trace.some((line: string) => line.includes('phase="up"'))).toBe(true);
            expect(
              trace.some(
                (line: string) =>
                  line.includes('phase="decision"') && line.includes(`commit=${commit}`),
              ),
            ).toBe(true);
            if (buttonsCleared) {
              expect(trace.some((line: string) => line.includes('release="buttons-cleared"'))).toBe(
                true,
              );
              expect(trace.some((line: string) => line.includes('reason="buttons-lost"'))).toBe(
                false,
              );
            }
            expect(trace.some((line: string) => line.includes('phase="finished"'))).toBe(true);
            expect(trace.some((line: string) => line.includes("…"))).toBe(false);
            await expect(
              page.locator(
                "[data-ambra-curled-leaf], [data-ambra-page-turn-input], [data-ambra-preparing-page-turn]",
              ),
            ).toHaveCount(0);
            expect(
              await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().error),
            ).toBeUndefined();
          }
        } finally {
          await context.close();
        }
      });
    }
  }
}
