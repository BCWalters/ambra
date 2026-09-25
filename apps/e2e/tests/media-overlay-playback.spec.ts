import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

// Regenerate: node apps/e2e/scripts/generate-media-overlay-fixtures.mjs
// Reflowable chapters have three four-second PCM WAV clips; fixed-layout pages have one.
// Boundary seeks supplement (not replace) genuine HTMLAudioElement progression.
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const narrated = path.join(fixtures, "media-overlay/narrated.epub");
const audioSelector = "audio[data-ambra-narration-audio]";
const controls = (page: Page) => page.getByRole("region", { name: "Narration controls" });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const position = (page: Page) => page.getByRole("slider", { name: "Position in book" });
const speedButton = (page: Page) => controls(page).getByRole("button", { name: /^Narration speed/ });

async function setSpeed(page: Page, rate: number) {
  await speedButton(page).click();
  await page.getByRole("menuitemradio", { name: `${rate}×`, exact: true }).click();
}

async function audioState(page: Page) {
  return page.locator(audioSelector).evaluate((element) => {
    const audio = element as HTMLAudioElement;
    return {
      time: audio.currentTime,
      paused: audio.paused,
      rate: audio.playbackRate,
      source: audio.currentSrc,
      error: audio.error?.code ?? null,
    };
  });
}

async function seek(page: Page, seconds: number) {
  await page.locator(audioSelector).evaluate((element, time) => {
    const audio = element as HTMLAudioElement;
    audio.currentTime = time;
    audio.dispatchEvent(new Event("timeupdate"));
  }, seconds);
}

async function highlighted(page: Page) {
  return page.evaluate(() =>
    [...new Set(Array.from(document.querySelectorAll("iframe")).flatMap((frame) => {
      if (
        frame.getBoundingClientRect().width === 0 ||
        getComputedStyle(frame).visibility === "hidden"
      ) {
        return [];
      }
      return Array.from(
        frame.contentDocument?.querySelectorAll(".synthetic-narration-active") ?? [],
      )
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.right > 0 &&
            bounds.left < frame.clientWidth &&
            bounds.bottom > 0 &&
            bounds.top < frame.clientHeight
          );
        })
        .map((element) => element.id);
    }))],
  );
}

async function visibleFrames(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("iframe"))
      .filter((frame) => {
        const bounds = frame.getBoundingClientRect();
        return (
          bounds.width > 0 && bounds.height > 0 && getComputedStyle(frame).visibility !== "hidden"
        );
      })
      .map((frame) => ({
        heading: frame.contentDocument?.querySelector("h1")?.textContent ?? "",
        x: frame.getBoundingClientRect().x,
        scrollTop: frame.contentDocument?.scrollingElement?.scrollTop ?? 0,
      })),
  );
}

async function listen(page: Page) {
  await page.mouse.move(350, 2);
  await button(page, "Listen").click();
  await expect(controls(page)).toBeVisible();
  await expect(button(page, "Pause narration")).toBeVisible();
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
}

async function toc(page: Page, title: string) {
  await page.mouse.move(350, 2);
  await button(page, "Show contents").click();
  await page
    .getByRole("navigation", { name: "Table of contents" })
    .getByRole("button")
    .filter({ has: page.locator("span").filter({ hasText: new RegExp(`^${title}$`) }) })
    .click();
  await expect(page.getByRole("navigation", { name: "Table of contents" })).not.toBeVisible();
}

test("plain books do not offer recorded narration", async () => {
  const { readerPage: page, context } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    await expect(position(page)).toBeVisible();
    await page.mouse.move(350, 2);
    await expect(button(page, "Listen")).toHaveCount(0);
    await expect(controls(page)).toHaveCount(0);
    await expect(button(page, "Play narration")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("real audio advances, pause/resume preserves its point, speed and close work", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await expect(controls(page)).toHaveCount(0);
    await listen(page);
    await expect.poll(() => highlighted(page)).toContain("c1-p1");
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.2);
    expect((await audioState(page)).error).toBeNull();
    await button(page, "Pause narration").click();
    await expect(button(page, "Play narration")).toBeVisible();
    const pausedAt = (await audioState(page)).time;
    expect((await audioState(page)).paused).toBe(true);
    await page.waitForTimeout(250);
    expect((await audioState(page)).time).toBeCloseTo(pausedAt, 2);

    await setSpeed(page, 1.5);
    expect((await audioState(page)).rate).toBe(1.5);
    await button(page, "Play narration").click();
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(pausedAt);
    await button(page, "Close narration").click();
    await expect(controls(page)).toHaveCount(0);
    expect((await audioState(page)).paused).toBe(true);
    const closedAt = (await audioState(page)).time;
    await page.waitForTimeout(250);
    expect((await audioState(page)).time).toBeCloseTo(closedAt, 2);
  } finally {
    await context.close();
  }
});

test("clip boundaries follow pages and chapters without stealing control focus", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await listen(page);
    const speed = speedButton(page);
    await setSpeed(page, 0.75);
    await speed.focus();
    await expect.poll(() => highlighted(page)).toContain("c1-p1");
    const firstPosition = await position(page).getAttribute("aria-valuetext");
    const stripBounds = (await controls(page).boundingBox())!;
    const scrubberBounds = (await position(page).boundingBox())!;
    expect(scrubberBounds.y + scrubberBounds.height).toBeLessThanOrEqual(stripBounds.y + 1);
    await expect(controls(page).getByRole("slider")).toHaveCount(0);

    await seek(page, 4.05);
    await expect.poll(() => highlighted(page)).toContain("c1-p2");
    await expect(position(page)).not.toHaveAttribute("aria-valuetext", firstPosition!);
    await expect(speed).toBeFocused();
    expect((await controls(page).boundingBox())!.y).toBeCloseTo(stripBounds.y, 0);
    await seek(page, 8.05);
    await expect.poll(() => highlighted(page)).toContain("c1-p3");
    const firstSource = (await audioState(page)).source;
    await seek(page, 12);
    await expect.poll(() => highlighted(page)).toContain("c2-p1");
    await expect.poll(async () => (await audioState(page)).source).not.toBe(firstSource);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(speed).toBeFocused();
    await expect(button(page, "Return to narration")).toHaveCount(0);

    await button(page, "Next narrated passage").click();
    await expect.poll(() => highlighted(page)).toContain("c2-p2");
    await expect(button(page, "Next narrated passage")).toBeFocused();
    await button(page, "Previous narrated passage").click();
    await expect.poll(() => highlighted(page)).toContain("c2-p1");
    await expect(button(page, "Previous narrated passage")).toBeFocused();
  } finally {
    await context.close();
  }
});

test("opening Listen starts at the displayed narrated passage, not the book beginning", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await toc(page, "Chapter 2 passage 2");
    await expect(page.frameLocator("iframe").first().locator("h1")).toHaveText(
      "Narrated chapter 2",
    );
    await listen(page);
    await expect.poll(() => highlighted(page)).toContain("c2-p2");
    expect((await audioState(page)).time).toBeGreaterThanOrEqual(4);
    expect((await audioState(page)).time).toBeLessThan(8);
  } finally {
    await context.close();
  }
});

for (const browsing of ["page", "contents", "scrubber"] as const) {
  test(`${browsing} browsing keeps audio playing; Return follows audio, Listen from this page changes it`, async () => {
    const { readerPage: page, context } = await launchReader(narrated);
    try {
      await listen(page);
      await setSpeed(page, 0.75);
      await seek(page, 0.2);
      const source = (await audioState(page)).source;
      if (browsing === "page") {
        const before = await position(page).getAttribute("aria-valuetext");
        await speedButton(page).blur();
        await page.keyboard.press("ArrowRight");
        await expect(position(page)).not.toHaveAttribute("aria-valuetext", before!);
      } else if (browsing === "contents") {
        await toc(page, "Narrated chapter 2");
      } else {
        await position(page).focus();
        await position(page).press("End");
        await expect(position(page)).toHaveAttribute("aria-valuenow", "100");
      }
      await expect(button(page, "Return to narration")).toBeVisible();
      expect((await audioState(page)).paused).toBe(false);
      expect((await audioState(page)).source).toBe(source);
      const browsedPosition = await position(page).getAttribute("aria-valuetext");
      const timeBefore = (await audioState(page)).time;
      await expect
        .poll(async () => (await audioState(page)).time)
        .toBeGreaterThan(timeBefore + 0.1);
      // Cross a clip boundary while detached: it must not pull the reader back.
      await seek(page, 4.05);
      await expect(position(page)).toHaveAttribute("aria-valuetext", browsedPosition!);
      await button(page, "Return to narration").click();
      await expect.poll(() => highlighted(page)).toContain("c1-p2");
      await expect(button(page, "Return to narration")).toHaveCount(0);
      expect((await audioState(page)).source).toBe(source);
      expect((await audioState(page)).time).toBeGreaterThanOrEqual(4);

      await toc(page, "Narrated chapter 2");
      await expect(button(page, "Return to narration")).toBeVisible();
      await button(page, "Listen from this page").click();
      await expect.poll(() => highlighted(page)).toContain("c2-p1");
      await expect.poll(async () => (await audioState(page)).source).not.toBe(source);
      expect((await audioState(page)).time).toBeLessThan(4);
      await expect(button(page, "Return to narration")).toHaveCount(0);
      await expect(page.frameLocator("iframe").first().locator("h1")).toHaveText(
        "Narrated chapter 2",
      );
    } finally {
      await context.close();
    }
  });
}

test("a real audio decode error is shown and can be closed without unhandled errors", async () => {
  const { readerPage: page, context } = await launchReader(
    path.join(fixtures, "media-overlay/invalid-audio.epub"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.mouse.move(350, 2);
    await button(page, "Listen").click();
    await expect(controls(page).getByRole("status")).toHaveText("Narration could not be played.");
    await expect.poll(async () => (await audioState(page)).error).not.toBeNull();
    expect((await audioState(page)).paused).toBe(true);
    await expect(button(page, "Play narration")).toBeVisible();
    await button(page, "Close narration").click();
    await expect(controls(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const action of ["Pause narration", "Close narration"]) {
  test(`${action} cancels an in-flight real audio resource load`, async () => {
    const { readerPage: page, context } = await launchReader(narrated);
    try {
      await exposeReaderController(page);
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const loader = controller.contentLoader;
        const original = loader.loadResourceBytes.bind(loader);
        const gate = { entered: false, released: false, release: () => {} };
        const blocked = new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        Reflect.set(window, "__narrationLoadGate", gate);
        loader.loadResourceBytes = async (resource: string) => {
          const bytes = await original(resource);
          if (resource.endsWith(".wav")) {
            gate.entered = true;
            await blocked;
            gate.released = true;
          }
          return bytes;
        };
      });
      await page.mouse.move(350, 2);
      await button(page, "Listen").click();
      await page.waitForFunction(() => Reflect.get(window, "__narrationLoadGate").entered);
      await button(page, action).click();
      await page.evaluate(() => Reflect.get(window, "__narrationLoadGate").release());
      await page.waitForFunction(() => Reflect.get(window, "__narrationLoadGate").released);
      await page.waitForTimeout(200);
      expect((await audioState(page)).paused).toBe(true);
      if (action === "Close narration") {
        await expect(controls(page)).toHaveCount(0);
      } else {
        await expect(button(page, "Play narration")).toBeVisible();
        await button(page, "Play narration").click();
        await expect.poll(async () => (await audioState(page)).paused).toBe(false);
        await expect.poll(() => highlighted(page)).toContain("c1-p1");
      }
    } finally {
      await context.close();
    }
  });
}

test("1400px reflowable spreads follow narration into another chapter and retain control focus", async () => {
  const { readerPage: page, context } = await launchReader(narrated, {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await expect.poll(async () => (await visibleFrames(page)).length).toBe(2);
    const frames = await visibleFrames(page);
    expect(frames[0]!.x).toBeLessThan(frames[1]!.x);
    await listen(page);
    const speed = speedButton(page);
    await setSpeed(page, 0.75);
    await speed.focus();
    await expect.poll(() => highlighted(page)).toEqual(["c1-p1"]);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.15);
    const source = (await audioState(page)).source;

    await seek(page, 4.05);
    await expect.poll(() => highlighted(page)).toEqual(["c1-p2"]);
    await expect(speed).toBeFocused();
    await seek(page, 8.05);
    await expect.poll(() => highlighted(page)).toEqual(["c1-p3"]);
    await seek(page, 12);
    await expect.poll(() => highlighted(page)).toEqual(["c2-p1"]);
    await expect.poll(async () => (await visibleFrames(page)).length).toBe(2);
    expect(
      (await visibleFrames(page)).some((frame) => frame.heading === "Narrated chapter 2"),
    ).toBe(true);
    await expect.poll(async () => (await audioState(page)).source).not.toBe(source);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(speed).toBeFocused();
    await expect(button(page, "Return to narration")).toHaveCount(0);
    expect((await audioState(page)).error).toBeNull();
  } finally {
    await context.close();
  }
});

test("scroll mode native wheel browsing keeps audio playing and Return restores following", async () => {
  const { readerPage: page, context } = await launchReader(narrated);
  try {
    await page.mouse.move(350, 2);
    await button(page, "Settings").click();
    await page.getByRole("menuitem", { name: /^Reading mode/ }).click();
    await page.getByRole("menuitemradio", { name: "Scroll", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "Scroll", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(position(page)).toHaveCount(0);
    await listen(page);
    await setSpeed(page, 0.75);
    await expect.poll(() => highlighted(page)).toEqual(["c1-p1"]);
    const source = (await audioState(page)).source;
    const frame = (await page.locator("iframe").first().boundingBox())!;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.mouse.wheel(0, 1400);
    await expect.poll(async () => (await visibleFrames(page))[0]!.scrollTop).toBeGreaterThan(1000);
    await expect(button(page, "Return to narration")).toBeVisible();
    expect((await audioState(page)).paused).toBe(false);
    const timeBefore = (await audioState(page)).time;
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(timeBefore + 0.15);
    const browsedTop = (await visibleFrames(page))[0]!.scrollTop;
    await seek(page, 4.05);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(4.15);
    expect((await visibleFrames(page))[0]!.scrollTop).toBeCloseTo(browsedTop, 0);
    expect(await highlighted(page)).not.toContain("c1-p2");

    await button(page, "Return to narration").click();
    await expect.poll(() => highlighted(page)).toEqual(["c1-p2"]);
    await expect(button(page, "Return to narration")).toHaveCount(0);
    expect((await visibleFrames(page))[0]!.scrollTop).toBeLessThan(browsedTop);
    expect((await audioState(page)).source).toBe(source);
    expect((await audioState(page)).paused).toBe(false);
    await seek(page, 8.05);
    await expect.poll(() => highlighted(page)).toEqual(["c1-p3"]);
    await expect(button(page, "Return to narration")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("fixed-layout narration highlights the secondary spread document without moving control focus", async () => {
  const { readerPage: page, context } = await launchReader(
    path.join(fixtures, "media-overlay/fixed-layout.epub"),
    { viewport: { width: 1400, height: 900 } },
  );
  try {
    await expect
      .poll(async () => (await visibleFrames(page)).map((frame) => frame.heading))
      .toEqual(["Narrated chapter 1", "Narrated chapter 2"]);
    await expect(position(page)).toHaveCount(0);
    await listen(page);
    const speed = speedButton(page);
    await setSpeed(page, 0.75);
    await speed.focus();
    await expect.poll(() => highlighted(page)).toEqual(["c1-p1"]);
    await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.15);
    const source = (await audioState(page)).source;

    await seek(page, 4);
    await expect.poll(() => highlighted(page)).toEqual(["c2-p1"]);
    await expect(page.frameLocator("iframe").nth(1).locator("#c2-p1")).toHaveClass(
      /synthetic-narration-active/,
    );
    await expect(page.frameLocator("iframe").first().locator("#c1-p1")).not.toHaveClass(
      /synthetic-narration-active/,
    );
    await expect
      .poll(async () => (await visibleFrames(page)).map((frame) => frame.heading))
      .toEqual(["Narrated chapter 1", "Narrated chapter 2"]);
    await expect.poll(async () => (await audioState(page)).source).not.toBe(source);
    await expect.poll(async () => (await audioState(page)).paused).toBe(false);
    await expect(speed).toBeFocused();
    await expect(button(page, "Return to narration")).toHaveCount(0);
    await button(page, "Previous narrated passage").click();
    await expect.poll(() => highlighted(page)).toEqual(["c1-p1"]);
    await expect(button(page, "Previous narrated passage")).toBeDisabled();
    expect((await audioState(page)).error).toBeNull();
  } finally {
    await context.close();
  }
});
