import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const book = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/two-chapter.epub",
);
let rtlBook: string;

test.beforeAll(({ browserName }, info) => {
  const source = path.join(info.project.outputDir, `scrubber-rtl-source-${browserName}`);
  fs.mkdirSync(source, { recursive: true });
  execFileSync("unzip", ["-q", "-o", book, "-d", source]);
  const opf = path.join(source, "OEBPS/content.opf");
  fs.writeFileSync(
    opf,
    fs.readFileSync(opf, "utf8").replace("<spine", '<spine page-progression-direction="rtl"'),
  );
  rtlBook = path.join(info.project.outputDir, "scrubber-rtl.epub");
  execFileSync("zip", ["-q", "-X", "-0", rtlBook, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", rtlBook, "META-INF", "OEBPS"], { cwd: source });
});

async function instrument(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Inspect the mounted hook's real controller, without a production test API.
    for (const element of document.querySelectorAll("*")) {
      const key = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
      if (!key) continue;
      for (let fiber = Reflect.get(element, key); fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const controller = hook.memoizedState;
          if (
            controller &&
            typeof controller.seekToFraction === "function" &&
            typeof controller.setFontScale === "function"
          ) {
            Reflect.set(window, "__scrubberController", controller);
          }
        }
      }
    }
    if (!Reflect.get(window, "__scrubberController")) throw new Error("Controller not found");
  });
  await page.waitForFunction(
    () => Reflect.get(window, "__scrubberController").snapshot().bookPageCount !== undefined,
  );
  await page.evaluate(() => {
    const controller = Reflect.get(window, "__scrubberController");
    const state = {
      calls: [] as number[],
      settled: [] as number[],
      gates: [] as { release: () => void; fail: () => void }[],
      frames: [] as { now: string | null; text: string | null; thumb: string }[],
    };
    Reflect.set(window, "__scrubberState", state);
    const seek = controller.seekToFraction.bind(controller);
    controller.seekToFraction = async (fraction: number) => {
      const id = state.calls.push(fraction) - 1;
      try {
        await seek(fraction);
      } finally {
        state.settled.push(id);
      }
    };
    const load = controller.contentLoader.loadSpineDocument.bind(controller.contentLoader);
    const gatedSeeks = new Set<number>();
    controller.contentLoader.loadSpineDocument = async (index: number) => {
      // Hold the first chapter load of each seek; subsequent spread columns
      // still load normally once that navigation is explicitly released.
      const request = state.calls.length - 1;
      if (request >= 0 && !gatedSeeks.has(request)) {
        gatedSeeks.add(request);
        await new Promise<void>((resolve, reject) =>
          state.gates.push({
            release: resolve,
            fail: () => reject(new Error("Chapter load failed for scrubber regression")),
          }),
        );
      }
      return load(index);
    };
    const sample = () => {
      const slider = document.querySelector('[role="slider"][aria-label="Position in book"]');
      if (slider)
        state.frames.push({
          now: slider.getAttribute("aria-valuenow"),
          text: slider.getAttribute("aria-valuetext"),
          thumb: (slider.lastElementChild as HTMLElement).style.left,
        });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function waitForGates(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (count) => Reflect.get(window, "__scrubberState").gates.length === count,
    count,
  );
}

async function release(page: Page, index = 0, fail = false): Promise<void> {
  await page.evaluate(
    ({ index, fail }) => {
      const gate = Reflect.get(window, "__scrubberState").gates[index];
      if (fail) gate.fail();
      else gate.release();
    },
    { index, fail },
  );
}

async function settled(page: Page, id = 0): Promise<void> {
  await page.waitForFunction(
    (id) => Reflect.get(window, "__scrubberState").settled.includes(id),
    id,
  );
}

async function frames(page: Page, clear = false) {
  return page.evaluate((clear) => {
    const state = Reflect.get(window, "__scrubberState");
    const result = state.frames as { now: string | null; text: string | null; thumb: string }[];
    if (clear) state.frames = [];
    return result;
  }, clear);
}

for (const width of [760, 1400]) {
  for (const rtl of [false, true]) {
    for (const input of ["pointer", "keyboard"] as const) {
      test(`${width}px ${rtl ? "RTL" : "LTR"} ${input}: destination survives held chapter load and live snapshots (#134)`, async () => {
        const { context, readerPage: page } = await launchReader(rtl ? rtlBook : book, {
          viewport: { width, height: 900 },
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await instrument(page);
          const slider = page.getByRole("slider", { name: "Position in book" });
          const before = await slider.getAttribute("aria-valuenow");
          await page.mouse.move(380, 890);
          const box = (await slider.boundingBox())!;
          if (input === "pointer") {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * (rtl ? 0.2 : 0.8), box.y + box.height / 2);
            expect(await page.evaluate(() => Reflect.get(window, "__scrubberState").calls)).toEqual(
              [],
            );
            await page.mouse.up();
          } else {
            await slider.focus();
            await slider.press("End");
          }
          await waitForGates(page, 1);
          const destination = input === "pointer" ? "80" : "100";
          await expect(slider).toHaveAttribute("aria-valuenow", destination);
          await expect(slider).toHaveAttribute("aria-valuetext", /Chapter Two/);
          const destinationText = await slider.getAttribute("aria-valuetext");
          await frames(page, true);

          // Neither ordinary motion/release nor a live controller notification
          // may turn a pending navigation back into an active pointer gesture.
          await page.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
          await slider.dispatchEvent("pointerup", { pointerId: 91, clientX: box.x });
          await page.evaluate(() =>
            Reflect.get(window, "__scrubberController").announce("Live update while seeking"),
          );
          await expect(page.getByText("Live update while seeking", { exact: true })).toBeAttached();
          await expect.poll(async () => (await frames(page)).length).toBeGreaterThan(8);
          const held = await frames(page);
          expect(
            held.every((frame) => frame.now === destination && frame.text === destinationText),
          ).toBe(true);
          expect(
            held.every(
              (frame) =>
                Math.abs(
                  parseFloat(frame.thumb) - (rtl ? 100 - Number(destination) : Number(destination)),
                ) < 0.2,
            ),
          ).toBe(true);
          expect(
            await page.evaluate(() => Reflect.get(window, "__scrubberState").calls.length),
          ).toBe(1);
          expect(
            await page.evaluate(
              () => Reflect.get(window, "__scrubberController").snapshot().spineIndex,
            ),
          ).toBe(0);

          await release(page);
          await settled(page);
          await expect
            .poll(() =>
              page.evaluate(
                () => Reflect.get(window, "__scrubberController").snapshot().spineIndex,
              ),
            )
            .toBe(1);
          await expect(slider).not.toHaveAttribute("aria-valuetext", /Chapter Two/);
          expect((await frames(page)).every((frame) => frame.now !== before)).toBe(true);
          const actual = await page.evaluate(() => {
            const snapshot = Reflect.get(window, "__scrubberController").snapshot();
            return String(Math.round((snapshot.bookPageIndex / snapshot.bookPageCount) * 100));
          });
          await expect(slider).toHaveAttribute("aria-valuenow", actual);
          expect(errors).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
  }
}

test("older seek completion cannot clear a newer keyboard destination or an active drag (#134)", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 760, height: 900 },
  });
  try {
    await instrument(page);
    const slider = page.getByRole("slider", { name: "Position in book" });
    await slider.focus();
    await slider.press("End");
    await waitForGates(page, 1);
    await slider.press("Home");
    await waitForGates(page, 2);
    await release(page);
    await settled(page);
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await expect(slider).toHaveAttribute("aria-valuetext", /Chapter One/);

    await page.mouse.move(380, 890);
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await page.mouse.down();
    await release(page, 1);
    await settled(page, 1);
    await expect(slider).toHaveAttribute("aria-valuenow", "70");
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.up();
    await waitForGates(page, 3);
    await expect(slider).toHaveAttribute("aria-valuenow", "80");
    await release(page, 2);
    await settled(page, 2);
    await expect(slider).not.toHaveAttribute("aria-valuetext", /Chapter Two/);
    expect(
      await page.evaluate(() => Reflect.get(window, "__scrubberController").snapshot().spineIndex),
    ).toBe(1);
    expect(await page.evaluate(() => Reflect.get(window, "__scrubberState").calls.length)).toBe(3);
  } finally {
    await context.close();
  }
});

for (const rtl of [false, true]) {
  test(`${rtl ? "RTL" : "LTR"} repeated arrows accumulate, and stale failure cannot erase the latest commit (#134)`, async () => {
    const { context, readerPage: page } = await launchReader(rtl ? rtlBook : book, {
      viewport: { width: 760, height: 900 },
    });
    try {
      await instrument(page);
      const slider = page.getByRole("slider", { name: "Position in book" });
      const total = await page.evaluate(
        () => Reflect.get(window, "__scrubberController").snapshot().bookPageCount as number,
      );
      await slider.focus();
      await slider.press("End");
      await waitForGates(page, 1);
      await slider.press(rtl ? "ArrowRight" : "ArrowLeft");
      await waitForGates(page, 2);
      await slider.press(rtl ? "ArrowRight" : "ArrowLeft");
      await waitForGates(page, 3);
      const calls = await page.evaluate(
        () => Reflect.get(window, "__scrubberState").calls as number[],
      );
      expect(calls[0]).toBe(1);
      expect(calls[1]).toBeCloseTo(1 - 1 / total);
      expect(calls[2]).toBeCloseTo(1 - 2 / total);
      await expect(slider).toHaveAttribute("aria-valuenow", String(Math.round(calls[2]! * 100)));
      await release(page, 2);
      await settled(page, 2);
      await expect(slider).not.toHaveAttribute("aria-valuetext", /Chapter Two/);
      const committed = await slider.getAttribute("aria-valuenow");
      await release(page, 0, true);
      await release(page, 1);
      await settled(page, 0);
      await settled(page, 1);
      await expect(slider).toHaveAttribute("aria-valuenow", committed!);
      await expect(
        page.getByText("Chapter load failed for scrubber regression", { exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => Reflect.get(window, "__scrubberController").snapshot().spineIndex,
        ),
      ).toBe(1);
    } finally {
      await context.close();
    }
  });
}

test("failed chapter loads and rejected seeks restore actual position with a visible error (#134)", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 760, height: 900 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await instrument(page);
    const slider = page.getByRole("slider", { name: "Position in book" });
    const before = await slider.getAttribute("aria-valuenow");
    await slider.focus();
    await slider.press("End");
    await waitForGates(page, 1);
    await expect(slider).toHaveAttribute("aria-valuenow", "100");
    await release(page, 0, true);
    await settled(page);
    await expect(slider).toHaveAttribute("aria-valuenow", before!);
    await expect(
      page.getByRole("status").filter({ hasText: "Chapter load failed for scrubber regression" }),
    ).toBeVisible();
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__scrubberController");
      controller.dismissError();
      controller.seekToFraction = async () => {
        throw new Error("Seek rejected for scrubber regression");
      };
    });
    await slider.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", before!);
    await expect(
      page.getByRole("status").filter({ hasText: "Seek rejected for scrubber regression" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("preview is readable at narrow widths and Escape leaves the book in place", async ({
  browserName,
}, info) => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 760, height: 900 },
  });
  try {
    await instrument(page);
    const slider = page.getByRole("slider", { name: "Position in book" });
    await slider.focus();
    const before = await slider.getAttribute("aria-valuenow");
    await expect(slider).toHaveCSS("outline-style", "solid");
    await expect(slider).toHaveCSS("outline-width", "2px");
    const track = (await slider.boundingBox())!;
    expect(track.height).toBeGreaterThanOrEqual(44);
    await page.mouse.move(track.x + track.width * 0.5, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.8, track.y + track.height / 2);
    await expect(slider).toHaveAttribute("aria-valuetext", /^Preview:/);
    await expect(page.getByText("Release to go here", { exact: true })).toBeVisible();
    const popup = page.getByText("Preview", { exact: true }).locator("..");
    await slider.press("Escape");
    await page.mouse.up();
    await expect(slider).toHaveAttribute("aria-valuenow", before!);

    await page.evaluate(() => {
      const controller = Reflect.get(window, "__scrubberController");
      const preview = controller.previewSeek.bind(controller);
      controller.previewSeek = (fraction: number) => ({
        ...preview(fraction),
        chapterLabel: "A very long chapter title — " + "AWordWithoutAnyBreaks".repeat(12),
      });
    });
    const widePageCount = await page.evaluate(
      () => Reflect.get(window, "__scrubberController").snapshot().bookPageCount,
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await page.waitForFunction((previous) => {
      const total = Reflect.get(window, "__scrubberController").snapshot().bookPageCount;
      return total !== undefined && total !== previous;
    }, widePageCount);
    const narrowBefore = await slider.getAttribute("aria-valuenow");
    const narrowTrack = (await slider.boundingBox())!;
    await page.mouse.move(narrowTrack.x, narrowTrack.y + narrowTrack.height / 2);
    await page.mouse.down();
    for (const fraction of [0, 1]) {
      const box = (await slider.boundingBox())!;
      await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
      await expect
        .poll(async () => {
          const bounds = (await popup.boundingBox())!;
          return bounds.x >= 7.5 && bounds.x + bounds.width <= 312.5;
        })
        .toBe(true);
      expect(await popup.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    const labels = await slider.evaluate((el) => {
      const row = el.parentElement!.firstElementChild!;
      return [...row.querySelectorAll("p")].map((label) => {
        const bounds = label.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right };
      });
    });
    expect(labels[0]!.right).toBeLessThan(labels[1]!.left);
    await page.screenshot({ path: info.outputPath(`${browserName}-scrubber-narrow-preview.png`) });
    await slider.press("Escape");
    await page.mouse.up();
    await expect(popup).toHaveCount(0);
    await expect(slider).toHaveAttribute("aria-valuenow", narrowBefore!);
    expect(await page.evaluate(() => Reflect.get(window, "__scrubberState").calls)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("touch preview cancels cleanly and release announces pending navigation", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 390, height: 844 },
  });
  try {
    await instrument(page);
    const slider = page.getByRole("slider", { name: "Position in book" });
    await slider.focus();
    const before = await slider.getAttribute("aria-valuenow");
    const box = (await slider.boundingBox())!;
    const client = await context.newCDPSession(page);
    const touchPoints = [{ x: box.x + box.width * 0.8, y: box.y + box.height / 2 }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
    await expect(slider).toHaveAttribute("aria-valuetext", /^Preview:/);
    await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(slider).toHaveAttribute("aria-valuenow", before!);
    expect(await page.evaluate(() => Reflect.get(window, "__scrubberState").calls)).toEqual([]);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await waitForGates(page, 1);
    await expect(slider).toHaveAttribute("aria-valuetext", /^Going to position…:/);
    await expect(page.getByText("Release to go here", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, "__scrubberState").calls.length)).toBe(1);
    await release(page);
    await settled(page);
    await expect(slider).not.toHaveAttribute("aria-valuetext", /^Going to position…:/);
  } finally {
    await context.close();
  }
});
test("pointer cancellation drops only its preview and never seeks (#134)", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 760, height: 900 },
  });
  try {
    await instrument(page);
    const slider = page.getByRole("slider", { name: "Position in book" });
    const before = await slider.getAttribute("aria-valuenow");
    await page.mouse.move(380, 890);
    const box = (await slider.boundingBox())!;
    await slider.evaluate((element) =>
      element.addEventListener(
        "pointerdown",
        (event) => {
          Reflect.set(window, "__scrubberPointerId", (event as PointerEvent).pointerId);
        },
        { once: true },
      ),
    );
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.down();
    await expect(slider).toHaveAttribute("aria-valuenow", "80");
    await slider.dispatchEvent("pointercancel", {
      pointerId: await page.evaluate(() => Reflect.get(window, "__scrubberPointerId")),
    });
    await page.mouse.up();
    await expect(slider).toHaveAttribute("aria-valuenow", before!);
    expect(await page.evaluate(() => Reflect.get(window, "__scrubberState").calls)).toEqual([]);

    await slider.focus();
    await slider.press("End");
    await waitForGates(page, 1);
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.mouse.down();
    await expect(slider).toHaveAttribute("aria-valuenow", "60");
    await slider.dispatchEvent("pointercancel", {
      pointerId: await page.evaluate(() => Reflect.get(window, "__scrubberPointerId")),
    });
    await page.mouse.up();
    await expect(slider).toHaveAttribute("aria-valuenow", "100");
    expect(await page.evaluate(() => Reflect.get(window, "__scrubberState").calls)).toEqual([1]);
    await release(page);
    await settled(page);
  } finally {
    await context.close();
  }
});
