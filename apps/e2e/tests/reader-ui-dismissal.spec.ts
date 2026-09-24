import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}.epub`, import.meta.url));
const toolbar = (page: Page) =>
  page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return (
      c?.host &&
      Math.round(c.width) === c.containerEl.clientWidth &&
      !c.isLoadInFlight &&
      !c.isTurningPage &&
      !c.isApplyingLayout &&
      !c.pendingLayout
    );
  });
}

async function position(page: Page) {
  return page.evaluate(() => {
    const snapshot = Reflect.get(window, "__readerController").snapshot();
    return { spine: snapshot.spineIndex, page: snapshot.pageIndex };
  });
}

async function readingPoint(page: Page, rtl = false) {
  const box = await page.locator("iframe").first().boundingBox();
  if (!box) throw new Error("Reading frame has no visible bounds");
  return { x: box.x + box.width * (rtl ? 0.2 : 0.8), y: box.y + box.height * 0.45 };
}

async function reveal(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(10, 2);
  await expect(toolbar(page)).toHaveCSS("pointer-events", "auto");
  await page.mouse.move(point.x, point.y);
  await expect(toolbar(page)).toHaveCSS("opacity", "1");
}

for (const scenario of [
  { name: "single-column", width: 760, book: "two-chapter" },
  { name: "spread", width: 1400, book: "two-chapter" },
  { name: "fixed LTR", width: 1400, book: "fxl-spread-ltr" },
  { name: "fixed RTL", width: 1400, book: "fxl-spread-rtl", rtl: true },
  { name: "touch", width: 760, book: "two-chapter", touch: true },
]) {
  test(`${scenario.name}: first reading tap dismisses chrome; the next tap navigates`, async () => {
    const { context, readerPage: page } = await launchReader(fixture(scenario.book), {
      viewport: { width: scenario.width, height: 900 },
      hasTouch: scenario.touch,
    });
    try {
      await exposeReaderController(page);
      await settled(page);
      const point = await readingPoint(page, scenario.rtl);
      const tap = () =>
        scenario.touch
          ? page.touchscreen.tap(point.x, point.y)
          : page.mouse.click(point.x, point.y);
      await reveal(page, point);
      const before = await position(page);
      await tap();
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
      await settled(page);
      expect(await position(page)).toEqual(before);
      await tap();
      await expect.poll(() => position(page)).not.toEqual(before);
      await settled(page);
      const after = await position(page);
      await reveal(page, point);
      await tap();
      await settled(page);
      expect(await position(page)).toEqual(after);
    } finally {
      await context.close();
    }
  });
}

test("a below-page margin tap dismisses chrome before navigating", async () => {
  const { context, readerPage: page } = await launchReader(
    fixture("chained-single-page-chapters"),
    {
      viewport: { width: 760, height: 900 },
    },
  );
  try {
    await exposeReaderController(page);
    await settled(page);
    const point = await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const pane = c.containerEl.getBoundingClientRect();
      const frame = c.host.element.getBoundingClientRect();
      return { x: pane.x + pane.width * 0.85, y: Math.min(pane.bottom - 150, frame.bottom + 60) };
    });
    expect(
      await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.tagName, point),
    ).not.toBe("IFRAME");
    await reveal(page, point);
    const before = await position(page);
    await page.mouse.click(point.x, point.y);
    await settled(page);
    expect(await position(page)).toEqual(before);
    await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => position(page)).not.toEqual(before);
  } finally {
    await context.close();
  }
});

test("book taps dismiss preferences and unpinned panels without click-through or an extra dismissing tap", async () => {
  const { context, readerPage: page } = await launchReader(fixture("two-chapter"), {
    viewport: { width: 900, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await settled(page);
    for (const name of ["Settings", "Text and page options"]) {
      await reveal(page, await readingPoint(page));
      const before = await position(page);
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      const frame = await page.locator("iframe").first().boundingBox();
      if (!frame) throw new Error("Reading frame has no visible bounds");
      const point = { x: frame.x + frame.width - 8, y: frame.y + frame.height * 0.45 };
      expect(
        await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.tagName, point),
      ).toBe("IFRAME");
      if (name === "Settings") {
        await page.mouse.move(point.x, point.y);
        // Exercise a menu that outlives the chrome's 2.5-second idle timer.
        await page.waitForTimeout(3000);
        await expect(page.getByRole("menu")).toBeVisible();
      }
      await page.mouse.click(point.x, point.y);
      await expect(page.getByRole("menu")).toBeHidden();
      await settled(page);
      expect(await position(page)).toEqual(before);
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => position(page)).not.toEqual(before);
      await settled(page);
    }

    for (const name of ["Book details", "Show contents", "Search"]) {
      await reveal(page, await readingPoint(page));
      const before = await position(page);
      await page.getByRole("button", { name, exact: true }).click();
      const point = { x: 450, y: 450 };
      await page.mouse.click(point.x, point.y);
      await settled(page);
      expect(await position(page)).toEqual(before);
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
      const next = await readingPoint(page);
      await page.mouse.click(next.x, next.y);
      await expect.poll(() => position(page)).not.toEqual(before);
      await settled(page);
    }
  } finally {
    await context.close();
  }
});

test("Help and its nested shortcut guide dismiss directly to reading on a backdrop tap", async () => {
  const { context, readerPage: page } = await launchReader(fixture("two-chapter"), {
    viewport: { width: 900, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await settled(page);
    for (const shortcuts of [false, true]) {
      await reveal(page, await readingPoint(page));
      const before = await position(page);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("menuitem", { name: "Help & About", exact: true }).click();
      const help = page.getByRole("dialog", { name: "Help & About", exact: true });
      await expect(help).toBeVisible();
      if (shortcuts) {
        await help.getByRole("button", { name: "Show keyboard shortcuts", exact: true }).click();
        await expect(
          page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }),
        ).toBeVisible();
      }
      await page.mouse.click(100, 450);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
      await settled(page);
      expect(await position(page)).toEqual(before);
      const next = await readingPoint(page);
      await page.mouse.click(next.x, next.y);
      await expect.poll(() => position(page)).not.toEqual(before);
      await settled(page);
    }
  } finally {
    await context.close();
  }
});

test("pinned contents keeps chrome visible without consuming ordinary page taps", async () => {
  const { context, readerPage: page } = await launchReader(fixture("two-chapter"), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await settled(page);
    await page.getByRole("button", { name: "Show contents", exact: true }).click();
    await page.getByRole("button", { name: "Pin contents panel", exact: true }).click();
    await settled(page);
    const before = await position(page);
    const point = await readingPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => position(page)).not.toEqual(before);
    await expect(
      page.getByRole("button", { name: "Unpin contents panel", exact: true }),
    ).toBeVisible();
    await expect(toolbar(page)).toHaveCSS("pointer-events", "auto");
  } finally {
    await context.close();
  }
});
