import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/two-chapter.epub",
);

async function columns(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter((frame) => {
        const rect = frame.getBoundingClientRect();
        if (rect.width < 100 || rect.right <= 0 || rect.left >= innerWidth) return false;
        for (let element: Element | null = frame; element; element = element.parentElement) {
          const style = getComputedStyle(element);
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")
            return false;
        }
        return true;
      })
      .map((frame) => Math.round(frame.getBoundingClientRect().width)),
  );
}

async function position(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter(
        (frame) =>
          frame.getBoundingClientRect().right > 0 &&
          getComputedStyle(frame).visibility !== "hidden",
      )
      .map((frame) => frame.contentDocument?.body.style.transform ?? ""),
  );
}

async function verifyNavigation(page: Page, width: number): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect.poll(() => columns(page)).toEqual([width, width]);
  // Pagination probes can overlap the viewport inside a zero-size clipped
  // container. Capture only after they and any outgoing spread are released.
  await expect.poll(() => page.locator("iframe").count()).toBe(2);
  const before = await position(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => position(page)).not.toEqual(before);
  await expect.poll(() => columns(page)).toEqual([width, width]);
  // Wait for the committed page, not a transient outgoing/incoming pair.
  await expect.poll(() => page.locator("iframe").count()).toBe(2);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => position(page)).toEqual(before);
  await expect.poll(() => columns(page)).toEqual([width, width]);
  expect(errors).toEqual([]);
}

for (const failLoad of [false, true]) {
  test(`a newer resize during second-column ${failLoad ? "load failure" : "loading"} is replayed at its real dimensions`, async () => {
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await expect.poll(() => columns(page)).toEqual([680, 680]);
      // Same-mode spread resizes reuse their documents. Cross the threshold
      // so this race still exercises a genuine second-document load.
      await page.setViewportSize({ width: 800, height: 900 });
      await expect.poll(() => columns(page)).toEqual([800]);
      // Hold precisely the new spread's second document load, not a guessed
      // timeout or the unrelated background pagination probe.
      await page.evaluate(() => {
        const prototype = HTMLIFrameElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "src")!;
        const state = { held: false, release: () => {} };
        Reflect.set(window, "__resizeRaceGate", state);
        Object.defineProperty(prototype, "src", {
          ...descriptor,
          set(this: HTMLIFrameElement, value: string) {
            const siblings = this.parentElement?.querySelectorAll("iframe");
            if (!state.held && siblings?.length === 2 && siblings[1] === this) {
              state.held = true;
              Object.defineProperty(prototype, "src", descriptor);
              const block = (event: Event) => event.stopImmediatePropagation();
              this.addEventListener("load", block, true);
              state.release = (fail = false) => {
                this.removeEventListener("load", block, true);
                if (fail) this.dispatchEvent(new Event("error"));
                else descriptor.set!.call(this, value);
              };
              return;
            }
            descriptor.set!.call(this, value);
          },
        });
      });
      await page.setViewportSize({ width: 1300, height: 900 });
      await page.waitForFunction(() => Reflect.get(window, "__resizeRaceGate")?.held);
      await page.setViewportSize({ width: 1100, height: 900 });
      // Ensure ResizeObserver has delivered the new dimensions while held.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.evaluate(
        (fail) => Reflect.get(window, "__resizeRaceGate").release(fail),
        failLoad,
      );
      await verifyNavigation(page, 530);
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

for (const style of ["slide", "rotate", "scroll"] as const) {
  test(`${style}: resizing during an animated turn leaves one owned spread`, async () => {
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      if (style !== "slide") {
        await page.getByRole("button", { name: "Settings" }).click();
        await page.getByRole("menuitem", { name: /^Page turn/ }).click();
        await page
          .getByRole("menuitemradio", { name: style === "rotate" ? /Page flip/ : /Film strip/ })
          .click();
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
      await exposeReaderController(page);
      // Closing Settings returns focus to its button; arrow keys there must
      // not navigate the book. Enter reading before starting the actual turn.
      await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => Reflect.get(window, "__readerController").isAnimatingPageTurn);
      await page.setViewportSize({ width: 1300, height: 900 });
      await verifyNavigation(page, 630);
      await expect.poll(() => page.locator("iframe").count()).toBe(2);
    } finally {
      await context.close();
    }
  });
}
