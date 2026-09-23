import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixture = process.env.AMBRA_SCRUBBER_BOOK ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/long-content.epub");
const nativeMouse = process.env.AMBRA_SCRUBBER_NATIVE_MOUSE === "1";

for (const width of [760, 1400]) {
  test(`${width}px ${nativeMouse ? "macOS" : "Chromium"} rapid full-width thumb drags navigate after release (#146)`, async () => {
    test.setTimeout(180_000);
    if (nativeMouse) {
      expect(process.platform).toBe("darwin");
      expect(process.env.AMBRA_E2E_HEADLESS).not.toBe("1");
    }
    const { context, readerPage: page } = await launchReader(fixture, {
      viewport: nativeMouse ? null : { width, height: 900 },
    });
    try {
      if (nativeMouse) {
        const nativeClient = await context.newCDPSession(page);
        const { windowId } = await nativeClient.send("Browser.getWindowForTarget");
        await nativeClient.send("Browser.setWindowBounds", {
          windowId, bounds: { left: 80, top: 80, width, height: 800 },
        });
        await page.bringToFront();
        const browserClient = await context.browser()!.newBrowserCDPSession();
        const { processInfo } = await browserClient.send("SystemInfo.getProcessInfo");
        const browserProcess = processInfo.find(process => process.type === "browser")!;
        execFileSync("osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${browserProcess.id}) to true`]);
        await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
      }
      await exposeReaderController(page);
      await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 0);
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const state = {
          calls: [] as number[], settled: 0, captureLossBeforeRelease: 0, pressed: false,
          events: [] as { type: string; x?: number; y?: number; buttons?: number; time: number; captured?: boolean; target?: string }[],
        };
        Reflect.set(window, "__longDrag", state);
        for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"]) {
          window.addEventListener(type, event => {
            const pointer = event as PointerEvent;
            const slider = document.querySelector('[role="slider"][aria-label="Position in book"]');
            if (type === "pointerdown") state.pressed = true;
            if (type === "lostpointercapture" && pointer.buttons === 0 && state.pressed) {
              state.captureLossBeforeRelease++;
            }
            if (type === "pointerup" || type === "pointercancel") state.pressed = false;
            state.events.push({
              type, x: pointer.clientX, y: pointer.clientY, buttons: pointer.buttons,
              time: performance.now(), captured: slider?.hasPointerCapture(pointer.pointerId),
              target: (event.target as Element)?.closest?.("[role]")?.getAttribute("role") ?? undefined,
            });
            if (state.events.length > 200) state.events.shift();
          }, true);
        }
        const seek = controller.seekToFraction.bind(controller);
        controller.seekToFraction = async (fraction: number) => {
          state.calls.push(fraction);
          await seek(fraction);
          state.settled++;
        };
      });
      const slider = page.getByRole("slider", { name: "Position in book" });
      for (let index = 0; index < 24; index++) {
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        await page.mouse.move(width / 2, viewportHeight - 5);
        const box = (await slider.boundingBox())!;
        const thumb = (await slider.locator(":scope > div").last().boundingBox())!;
        const x = thumb.x + thumb.width / 2;
        const y = thumb.y + thumb.height / 2;
        const fraction = index % 2 ? 0.025 : 0.975;
        const targetX = box.x + box.width * fraction;
        const targetY = index % 3 === 2 ? y - 120 : y;
        // DevTools mouse events don't reproduce macOS's early capture loss.
        if (nativeMouse) {
          const origin = await page.evaluate(() => ({
            x: window.screenX + (window.outerWidth - window.innerWidth) / 2,
            y: window.screenY + window.outerHeight - window.innerHeight,
          }));
          execFileSync("swift", ["-e", `
            import CoreGraphics
            import Darwin
            guard CGPreflightPostEventAccess() else { fatalError("Native input permission missing") }
            let source = CGEventSource(stateID: .hidSystemState)
            func send(_ type: CGEventType, _ x: Double, _ y: Double) {
              let event = CGEvent(mouseEventSource: source, mouseType: type,
                mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)!
              event.setIntegerValueField(.mouseEventClickState, value: 1)
              event.post(tap: .cghidEventTap)
            }
            let x: Double = ${origin.x + x}, y: Double = ${origin.y + y}
            let endX: Double = ${origin.x + targetX}, endY: Double = ${origin.y + targetY}
            send(.mouseMoved, x, y)
            usleep(20000)
            send(.leftMouseDown, x, y)
            for step in 1...6 {
              usleep(5000)
              let progress = Double(step) / 6
              send(.leftMouseDragged, x + (endX - x) * progress, y + (endY - y) * progress)
            }
            usleep(5000)
            send(.leftMouseUp, endX, endY)
          `]);
        } else {
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(targetX, targetY);
          await page.mouse.up();
        }
        await expect.poll(() => page.evaluate(() => Reflect.get(window, "__longDrag").calls.length)).toBe(index + 1);
        await expect.poll(() => page.evaluate(() => Reflect.get(window, "__longDrag").settled)).toBe(index + 1);
        await expect.poll(() => page.evaluate(fraction => {
          const snapshot = Reflect.get(window, "__readerController").snapshot();
          const wanted = Math.max(1, Math.round(fraction * snapshot.bookPageCount));
          return snapshot.bookPageIndex === wanted || snapshot.spreadPageNumbers?.includes(wanted);
        }, fraction)).toBe(true);
      }
      if (nativeMouse) {
        expect(await page.evaluate(() => Reflect.get(window, "__longDrag").captureLossBeforeRelease)).toBeGreaterThan(0);
      }
    } finally {
      await test.info().attach("long-drag-events", {
        body: JSON.stringify(await page.evaluate(() => ({
          trace: Reflect.get(window, "__longDrag"),
          snapshot: Reflect.get(window, "__readerController")?.snapshot(),
        })), null, 2),
        contentType: "application/json",
      });
      await context.close();
    }
  });
}
