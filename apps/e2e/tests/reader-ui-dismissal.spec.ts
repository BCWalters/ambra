import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader, outerMarginPoint } from "../harness.js";
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
  return outerMarginPoint(page, rtl ? "left" : "right");
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
    const margin = await outerMarginPoint(page);
    const point = await page.evaluate(margin => {
      const c = Reflect.get(window, "__readerController");
      const pane = c.containerEl.getBoundingClientRect();
      const frame = c.host.element.getBoundingClientRect();
      return { x: margin.x, y: Math.min(pane.bottom - 150, frame.bottom + 60) };
    }, margin);
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
    for (const name of ["Ambra settings", "Text and page options"]) {
      await reveal(page, await readingPoint(page));
      const before = await position(page);
      await page.getByRole("button", { name, exact: true }).click();
      const surface = name === "Ambra settings"
        ? page.getByRole("dialog", { name, exact: true })
        : page.getByRole("menu");
      await expect(surface).toBeVisible();
      const frame = await page.locator("iframe").first().boundingBox();
      if (!frame) throw new Error("Reading frame has no visible bounds");
      const point = { x: frame.x + frame.width - 8, y: frame.y + frame.height * 0.45 };
      expect(
        await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.tagName, point),
      ).toBe("IFRAME");
      if (name === "Ambra settings") {
        await page.mouse.move(point.x, point.y);
        // Exercise settings that outlive the chrome's 2.5-second idle timer.
        await page.waitForTimeout(3000);
        await expect(surface).toBeVisible();
      }
      await page.mouse.click(point.x, point.y);
      await expect(surface).toBeHidden();
      await settled(page);
      expect(await position(page)).toEqual(before);
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => position(page)).not.toEqual(before);
      await settled(page);
    }

    for (const name of ["Book details", "Show contents", "Annotations", "Search"]) {
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
      await page.getByRole("button", { name: "Help & About", exact: true }).click();
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

test("reference tasks replace each other while Contents and Annotations share pin state and Search keeps its own", async () => {
  const { context, readerPage: page } = await launchReader(fixture("two-chapter"), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await settled(page);
    const contents = page.getByRole("navigation", { name: "Table of contents", exact: true });
    const annotations = page.getByRole("navigation", { name: "Annotations", exact: true });
    const search = page.getByRole("navigation", { name: "Search", exact: true });
    await page.getByRole("button", { name: "Show contents", exact: true }).click();
    await expect(contents).toBeVisible();
    await contents.getByRole("button", { name: "Pin contents panel", exact: true }).click();
    await settled(page);

    await page.getByRole("button", { name: "Annotations", exact: true }).click();
    await expect(contents).toBeHidden();
    await expect(annotations).toBeVisible();
    await expect(annotations.getByRole("button", { name: "Unpin annotations panel", exact: true })).toBeVisible();
    await expect(annotations.getByRole("combobox", { name: "Show", exact: true })).toHaveValue("all");
    await settled(page);
    const pane = await page.getByRole("main").boundingBox();
    const annotationBounds = await annotations.boundingBox();
    expect(annotationBounds!.x).toBeGreaterThanOrEqual(pane!.x + pane!.width - 1);

    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(annotations).toBeHidden();
    await expect(contents).toBeHidden();
    await expect(search).toBeVisible();
    await expect(search.getByRole("button", { name: "Pin search panel", exact: true })).toBeVisible();
    await search.getByRole("button", { name: "Pin search panel", exact: true }).click();
    await page.getByRole("button", { name: "Show contents", exact: true }).click();
    await expect(search).toBeHidden();
    await expect(contents.getByRole("button", { name: "Unpin contents panel", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(contents).toBeHidden();
    await expect(search.getByRole("button", { name: "Unpin search panel", exact: true })).toBeVisible();
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

for (const panel of [
  { name: "Table of contents", toggle: "Show contents", pin: "contents" },
  { name: "Annotations", toggle: "Annotations", pin: "annotations" },
  { name: "Search", toggle: "Search", pin: "search" },
]) {
  test(`${panel.name}: narrow layout overlays without forgetting the pin preference or moving focus`, async () => {
    const { context, readerPage: page } = await launchReader(fixture("two-chapter"), {
      viewport: { width: 1000, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await settled(page);
      await page.getByRole("button", { name: panel.toggle, exact: true }).click();
      const reference = page.getByRole("navigation", { name: panel.name, exact: true });
      await reference.getByRole("button", { name: `Pin ${panel.pin} panel`, exact: true }).click();
      await expect(reference).toHaveCSS("position", "relative");
      const panelWidth = await reference.evaluate(element => element.getBoundingClientRect().width);
      const threshold = Math.ceil(panelWidth + 320);
      const readingPane = page.getByRole("main");
      const focusTarget = panel.pin === "search"
        ? reference.getByRole("searchbox")
        : panel.pin === "annotations"
          ? reference.getByRole("combobox", { name: "Show", exact: true })
          : reference;
      if (panel.pin === "search") await focusTarget.fill("chapter");
      if (panel.pin === "annotations") await focusTarget.selectOption("bookmarks");
      await focusTarget.focus();

      await page.setViewportSize({ width: threshold - 1, height: 900 });
      await expect(reference).toHaveCSS("position", "absolute");
      await expect(reference).toBeVisible();
      await expect(focusTarget).toBeFocused();
      await settled(page);
      expect(await readingPane.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(320);
      const unavailable = reference.getByRole("button", { name: `Pin ${panel.pin} panel`, exact: true });
      await expect(unavailable).toHaveAttribute("aria-disabled", "true");
      await unavailable.focus();
      await expect(unavailable).toBeFocused();
      await expect(unavailable).toHaveAccessibleDescription(/at least 320 px for the book/);
      await unavailable.press("Enter");
      await expect(reference).toHaveCSS("position", "absolute");

      await page.setViewportSize({ width: threshold, height: 900 });
      await expect(reference).toHaveCSS("position", "relative");
      const restoredPin = reference.getByRole("button", { name: `Unpin ${panel.pin} panel`, exact: true });
      await expect(restoredPin).toBeFocused();
      await settled(page);
      expect(await readingPane.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(320);
      if (panel.pin === "search") await expect(focusTarget).toHaveValue("chapter");
      if (panel.pin === "annotations") await expect(focusTarget).toHaveValue("bookmarks");

      await restoredPin.click();
      await page.setViewportSize({ width: threshold - 1, height: 900 });
      await expect(unavailable).toHaveAttribute("aria-disabled", "true");
      await page.setViewportSize({ width: 1000, height: 900 });
      await expect(reference).toHaveCSS("position", "absolute");
      await expect(unavailable).toBeEnabled();
    } finally {
      await context.close();
    }
  });
}

test("reference docking uses the row left by the Inspector dock, not the viewport width", async () => {
  const { context, readerPage: page } = await launchReader(fixture("two-chapter"), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await settled(page);
    await page.getByRole("button", { name: "Show contents", exact: true }).click();
    const contents = page.getByRole("navigation", { name: "Table of contents", exact: true });
    await contents.getByRole("button", { name: "Pin contents panel", exact: true }).click();
    await page.getByRole("button", { name: "Book details", exact: true }).click();
    await page.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
    const inspector = page.getByRole("dialog", { name: "EPUB Inspector", exact: true });
    await inspector.getByRole("button", { name: "Dock left", exact: true }).click();
    await page.getByRole("button", { name: "Show contents", exact: true }).click();
    await expect(contents).toHaveCSS("position", "relative");
    await contents.focus();

    await page.setViewportSize({ width: 1000, height: 900 });
    await expect(contents).toHaveCSS("position", "absolute");
    await expect(contents).toBeFocused();
    const panelWidth = await contents.evaluate(element => element.getBoundingClientRect().width);
    const available = await page.locator("[data-ambra-reference-row]").evaluate(element => element.getBoundingClientRect().width);
    expect(available).toBeLessThan(panelWidth + 320);
    expect(1000).toBeGreaterThan(panelWidth + 320);
    await settled(page);
    expect(await page.getByRole("main").evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(available, 0);

    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(contents).toHaveCSS("position", "relative");
    await expect(contents).toBeFocused();
    await expect(contents.getByRole("button", { name: "Unpin contents panel", exact: true })).toBeVisible();
    await expect(inspector).toBeVisible();
    await settled(page);
    expect(await page.getByRole("main").evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(320);
  } finally {
    await context.close();
  }
});
