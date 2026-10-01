import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { launchReader } from "../harness.js";
import { progressMarkerFixture, type ProgressMarkerFixture } from "../progress-marker-fixtures.js";
import { exposeReaderController } from "../reader-controller.js";

type Style = "off" | "upcoming";
const sliderFor = (page: Page) => page.getByRole("slider", { name: "Position in book", exact: true });
const layerFor = (page: Page) => sliderFor(page).locator("[data-progress-markers]");
const readingPages = [9, 23, 39, 56, 75, 94, 115, 133, 152, 170, 186, 200];

async function seedStyle(page: Page, value: string): Promise<void> {
  await page.evaluate(async value => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ambra-library");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("preferences", "readwrite");
        transaction.objectStore("preferences").put({ key: "defaultProgressMarkerStyle", value });
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  }, value);
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const controller = Reflect.get(window, "__readerController");
    return controller?.snapshot().bookPageCount > 0 &&
      !controller.isLoadInFlight && !controller.isTurningPage &&
      !controller.isApplyingLayout && !controller.pendingLayout;
  }, undefined, { timeout: 60_000 });
}

async function launch(info: TestInfo, kind: ProgressMarkerFixture, rtl = false, preference?: string) {
  const reader = await launchReader(progressMarkerFixture(info, kind, rtl ? "rtl" : "ltr"), {
    viewport: { width: 1400, height: 900 },
    beforeBookImport: preference === undefined ? undefined : page => seedStyle(page, preference),
  });
  try {
    await exposeReaderController(reader.readerPage);
    await settled(reader.readerPage);
    await sliderFor(reader.readerPage).focus();
    await expect(sliderFor(reader.readerPage)).toHaveAttribute("data-progress-marker-style",
      preference === "off" ? "off" : "upcoming");
    return reader;
  } catch (error) {
    await reader.context.close();
    throw error;
  }
}

async function chooseStyle(page: Page, style: Style) {
  await page.mouse.move(300, 2);
  await page.getByRole("button", { name: "Ambra settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Ambra settings", exact: true });
  const reading = settings.locator("details");
  if (!await reading.evaluate(element => (element as HTMLDetailsElement).open)) {
    await reading.locator("summary").click();
  }
  const choice = settings.getByRole("combobox", { name: "Progress landmarks", exact: true });
  await expect(choice.locator("option")).toHaveText(["Show", "Hide"]);
  await choice.selectOption(style);
  await expect(choice).toHaveValue(style);
  await page.keyboard.press("Escape");
}

async function position(page: Page) {
  return page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    const state = controller.snapshot();
    return {
      page: state.bookPageIndex as number, count: state.bookPageCount as number,
      path: state.currentSpinePath as string,
      offset: controller.host.currentPosition()?.offset as number | undefined,
    };
  });
}

async function seek(page: Page, fraction: number) {
  await page.evaluate(async fraction => Reflect.get(window, "__readerController").seekToFraction(fraction), fraction);
  await settled(page);
  await sliderFor(page).focus();
}

async function fractions(page: Page, rtl = false) {
  return sliderFor(page).evaluate((slider, rtl) => {
    const track = slider.getBoundingClientRect();
    return [...slider.querySelectorAll("[data-upcoming-boundary]")].map(boundary => {
      const box = boundary.getBoundingClientRect();
      const fraction = (box.left + box.width / 2 - track.left) / track.width;
      return rtl ? 1 - fraction : fraction;
    });
  }, rtl);
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const target = info.outputPath(`${name}.png`);
  await sliderFor(page).locator("..").screenshot({ path: target });
  await info.attach(name, { path: target, contentType: "image/png" });
}

async function geometry(page: Page, rtl = false) {
  const result = await sliderFor(page).evaluate((slider, rtl) => {
    const box = slider.getBoundingClientRect();
    const track = slider.querySelector("[data-scrubber-track]")!.getBoundingClientRect();
    const thumb = slider.querySelector("[data-scrubber-thumb]")!.getBoundingClientRect();
    const fill = slider.querySelector("[data-scrubber-fill]")!;
    const fillBox = fill.getBoundingClientRect();
    const thumbX = thumb.left + thumb.width / 2;
    const fractionAt = (x: number) => rtl ? (track.right - x) / track.width : (x - track.left) / track.width;
    return {
      current: fractionAt(thumbX), footer: slider.parentElement!.getBoundingClientRect().height,
      track: { top: track.top - box.top, height: track.height, width: track.width },
      thumb: { top: thumb.top - box.top, bottom: thumb.bottom - box.top },
      fill: {
        fraction: fillBox.width / track.width, height: fillBox.height,
        opacity: getComputedStyle(fill).opacity, backgroundImage: getComputedStyle(fill).backgroundImage,
        edge: Math.abs((rtl ? fillBox.left : fillBox.right) - thumbX),
      },
      bands: [...slider.querySelectorAll("[data-upcoming-band]")].map(band => {
        const bounds = band.getBoundingClientRect();
        return {
          start: fractionAt(rtl ? bounds.right : bounds.left),
          end: fractionAt(rtl ? bounds.left : bounds.right),
          top: bounds.top - track.top, height: bounds.height,
          opacity: Number(getComputedStyle(band).opacity),
          front: band.hasAttribute("data-reading-start-band"), back: band.hasAttribute("data-reading-end-band"),
        };
      }),
      boundaries: [...slider.querySelectorAll("[data-upcoming-boundary]")].map(mark => {
        const bounds = mark.getBoundingClientRect();
        return { fraction: fractionAt(bounds.left + bounds.width / 2), top: bounds.top - track.top, height: bounds.height };
      }),
      start: [...slider.querySelectorAll<HTMLElement>('[data-reading-landmark="start"]')].map(mark => {
        const bounds = mark.getBoundingClientRect();
        return {
          fraction: Number(mark.dataset.fraction), actual: fractionAt(bounds.left + bounds.width / 2),
          top: bounds.top - track.top, width: bounds.width, height: bounds.height,
          color: getComputedStyle(mark).backgroundColor,
        };
      }),
      decorative: [...slider.querySelectorAll<HTMLElement>(
        "[data-upcoming-band], [data-upcoming-boundary], [data-reading-landmark]",
      )].every(mark => mark.tabIndex === -1 && getComputedStyle(mark).pointerEvents === "none"),
    };
  }, rtl);
  expect(result.footer).toBe(56);
  expect(result.track.top).toBe(24);
  expect(result.track.height).toBe(10);
  expect(result.thumb).toEqual({ top: 21, bottom: 37 });
  expect(result.fill.height).toBe(10);
  expect(result.fill.opacity).toBe("1");
  expect(result.fill.backgroundImage).toBe("none");
  expect(result.fill.edge).toBeLessThanOrEqual(1);
  expect(Math.abs(result.fill.fraction - result.current) * result.track.width).toBeLessThanOrEqual(0.1);
  expect(result.boundaries.length).toBeLessThanOrEqual(100);
  result.bands.forEach(band => {
    expect(band.top).toBe(0);
    expect(band.height).toBe(10);
    expect(band.start).toBeGreaterThanOrEqual(result.current - 0.0001);
    expect(band.end).toBeGreaterThan(band.start);
    expect(band.end).toBeLessThanOrEqual(1.0001);
    if (band.front || band.back) expect(band.opacity).toBe(0.64);
    else expect([0.16, 0.38]).toContain(band.opacity);
  });
  result.boundaries.forEach(boundary => {
    expect(boundary.fraction).toBeGreaterThanOrEqual(result.current - 0.0001);
    expect(boundary.top).toBe(0);
    expect(boundary.height).toBe(10);
  });
  for (const start of result.start) {
    expect(start.actual).toBeCloseTo(start.fraction, 4);
    expect(start).toMatchObject({ top: 0, width: 6, height: 10 });
    const color = start.color.match(/\d+/g)!.map(Number);
    expect(color[1]!).toBeGreaterThan(color[0]!);
    expect(color[1]!).toBeGreaterThan(color[2]!);
  }
  expect(result.decorative).toBe(true);
  await expect(page.locator("[data-marker-legend]")).toHaveCount(0);
  await expect(layerFor(page)).toHaveAttribute("aria-hidden", "true");
  await expect(layerFor(page).locator("a, button, input, [tabindex]")).toHaveCount(0);
  await expect(layerFor(page).locator('[data-reading-landmark="end"], [data-chapter-marker], [data-chapter-band]')).toHaveCount(0);
  return result;
}

test.describe("Progress landmarks", () => {
  test.setTimeout(180_000);

  test("Show is the default; global Show/Hide persists across books without moving the reader or footer", async () => {
    const info = test.info();
    const { context, readerPage: page, libraryPage } = await launch(info, "sparse");
    try {
      await seek(page, 0.5);
      const before = await position(page);
      const slider = sliderFor(page);
      for (const style of ["off", "upcoming", "off"] as const) {
        await chooseStyle(page, style);
        await expect(slider).toHaveAttribute("data-progress-marker-style", style);
        expect(await position(page)).toEqual(before);
        expect((await slider.locator("..").boundingBox())!.height).toBe(56);
        await expect(slider.locator("[data-scrubber-track]")).toHaveCSS("height", style === "off" ? "4px" : "10px");
        if (style === "off") await expect(layerFor(page)).toHaveCount(0);
        expect(await page.evaluate(async () =>
          (await Reflect.get(window, "__readerController").library.getGlobalReadingSettings()).progressMarkerStyle)).toBe(style);
      }
      await page.reload();
      await expect(slider).toBeVisible();
      await exposeReaderController(page);
      await settled(page);
      await expect(slider).toHaveAttribute("data-progress-marker-style", "off");
      expect((await position(page)).page).toBe(before.page);
      await chooseStyle(libraryPage, "upcoming");
      await expect(slider).toHaveAttribute("data-progress-marker-style", "upcoming");
      expect((await position(page)).page).toBe(before.page);
      await libraryPage.locator('input[type="file"]').setInputFiles(progressMarkerFixture(info, "missing-landmarks"));
      const open = libraryPage.getByRole("button", { name: /^Open Progress markers missing-landmarks ltr/ });
      await expect(open).toBeVisible();
      const opened = context.waitForEvent("page");
      await open.click();
      await expect(sliderFor(await opened)).toHaveAttribute("data-progress-marker-style", "upcoming");
      await slider.focus();
      await slider.press("Home");
      await settled(page);
      expect((await position(page)).page).toBeLessThan(before.page);
      await slider.press("PageUp");
      await settled(page);
      expect((await position(page)).page).toBeGreaterThan(1);
    } finally { await context.close(); }
  });

  for (const legacy of ["ticks", "sections", "minimal"]) {
    test(`saved ${legacy} prototype preference becomes Show`, async () => {
      const { context, readerPage: page } = await launch(test.info(), "sparse", false, legacy);
      try {
        await expect(layerFor(page)).toHaveAttribute("data-marker-detail", "chapters");
        await geometry(page);
        await chooseStyle(page, "off");
        await expect(sliderFor(page)).toHaveAttribute("data-progress-marker-style", "off");
      } finally { await context.close(); }
    });
  }

  for (const [kind, detail, count] of [
    ["sparse", "chapters", 4], ["dense-flat", "landmarks", 0],
    ["dense-nested", "sections", 4], ["crowded-parts", "sections", 4],
    ["same-page", "chapters", 5], ["duplicate-target", "chapters", 4],
    ["unresolved", "landmarks", 0],
  ] as const) {
    test(`${kind}: complete chapter levels, grouping, and conservative fallback without spacing suppression`, async () => {
      const { context, readerPage: page } = await launch(test.info(), kind);
      try {
        await seek(page, 0);
        await expect(layerFor(page)).toHaveAttribute("data-marker-detail", detail);
        await expect(layerFor(page).locator("[data-upcoming-boundary]")).toHaveCount(count);
        const result = await geometry(page);
        expect(result.start).toHaveLength(1);
        expect(result.bands.filter(band => band.back)).toHaveLength(1);
        const marks = await fractions(page);
        if (kind.startsWith("dense") || kind === "crowded-parts") {
          expect((await position(page)).count).toBeGreaterThanOrEqual(250);
        }
        if (kind === "same-page") expect(new Set(marks.map(mark => mark.toFixed(5))).size).toBe(4);
        if (kind === "crowded-parts") expect((marks[1]! - marks[0]!) * result.track.width).toBeLessThan(32);
        if (kind === "sparse") {
          expect(marks[2]! - marks[1]!).toBeGreaterThan((marks[1]! - marks[0]!) * 1.3);
          await screenshot(page, test.info(), "sparse-proportional-landmarks");
        }
      } finally { await context.close(); }
    });
  }

  for (const chapterCount of [100, 101] as const) {
    test(`${chapterCount} flat chapters: exact 100-target cutoff`, async () => {
      const { context, readerPage: page } = await launch(test.info(), chapterCount === 100 ? "flat-100" : "flat-101");
      try {
        await seek(page, 0);
        const measured = await page.evaluate(() => {
          const state = Reflect.get(window, "__readerController").snapshot();
          return {
            total: state.bookPageCount as number,
            pages: state.toc.map((entry: { target: string }) => state.tocPageNumbers.get(entry.target) as number) as number[],
          };
        });
        expect(measured.total).toBe(chapterCount + 12);
        expect(new Set(measured.pages).size).toBe(chapterCount);
        await expect(layerFor(page)).toHaveAttribute("data-marker-detail", chapterCount === 100 ? "chapters" : "landmarks");
        await expect(layerFor(page).locator("[data-upcoming-boundary]")).toHaveCount(chapterCount === 100 ? 100 : 0);
        const actual = await fractions(page);
        if (chapterCount === 100) {
          actual.forEach((fraction, index) => expect(fraction).toBeCloseTo((measured.pages[index]! - 1) / measured.total, 4));
          expect((actual[1]! - actual[0]!) * (await sliderFor(page).boundingBox())!.width).toBeLessThan(32);
        }
        await geometry(page);
      } finally { await context.close(); }
    });
  }

  for (const kind of ["missing-landmarks", "unresolved-landmarks"] as const) {
    test(`${kind}: no invented reading boundaries`, async () => {
      const { context, readerPage: page } = await launch(test.info(), kind);
      try {
        await seek(page, 0);
        await expect(layerFor(page)).toHaveAttribute("data-marker-detail", "chapters");
        await expect(layerFor(page).locator("[data-upcoming-boundary]")).toHaveCount(4);
        await expect(layerFor(page).locator("[data-reading-landmark], [data-reading-start-band], [data-reading-end-band]")).toHaveCount(0);
        await geometry(page);
      } finally { await context.close(); }
    });
  }

  test("fragments within one spine document resolve to measured pages, not spine starts", async () => {
    const { context, readerPage: page } = await launch(test.info(), "fragments");
    try {
      await seek(page, 0);
      const entries = await page.evaluate(() => {
        const state = Reflect.get(window, "__readerController").snapshot();
        return state.toc.map((entry: { target: string }) => ({
          target: entry.target, fraction: (state.tocPageNumbers.get(entry.target) - 1) / state.bookPageCount,
        })) as { target: string; fraction: number }[];
      });
      expect(new Set(entries.map(entry => entry.target.split("#")[0])).size).toBe(1);
      const actual = await fractions(page);
      expect(actual).toHaveLength(4);
      expect(new Set(actual).size).toBe(4);
      actual.forEach((fraction, index) => expect(fraction).toBeCloseTo(entries[index]!.fraction, 4));
      await geometry(page);
    } finally { await context.close(); }
  });

  for (const rtl of [false, true]) {
    test(`${rtl ? "RTL" : "LTR"}: linked book title and crowded front/back matter retain twelve reading chapters at wide/narrow widths`, async () => {
      const info = test.info();
      const { context, readerPage: page } = await launch(info, "nested-reading-work", rtl);
      try {
        await seek(page, 0);
        const measured = await page.evaluate(() => {
          const state = Reflect.get(window, "__readerController").snapshot();
          const flatten = (items: typeof state.toc): typeof state.toc =>
            items.flatMap((item: typeof state.toc[number]) => [item, ...flatten(item.children)]);
          return { total: state.bookPageCount, pages: flatten(state.toc).map((item: typeof state.toc[number]) => state.tocPageNumbers.get(item.target)) };
        });
        expect(measured).toEqual({ total: 230, pages: [7, 8, ...readingPages, 220, 221] });
        for (const width of [1400, 320]) {
          await page.setViewportSize({ width, height: 900 });
          await settled(page);
          await seek(page, 0);
          await expect(layerFor(page)).toHaveAttribute("data-marker-detail", "chapters");
          const result = await geometry(page, rtl);
          const expected = readingPages.map(chapterPage => (chapterPage - 1) / 230)
            .filter(fraction => Math.abs(fraction - 7 / 230) * result.track.width >= 12 &&
              Math.abs(fraction - 219 / 230) * result.track.width >= 12);
          const actual = await fractions(page, rtl);
          expect(actual).toHaveLength(expected.length);
          actual.forEach((fraction, index) =>
            expect(Math.abs(fraction - expected[index]!) * result.track.width).toBeLessThanOrEqual(0.1));
          expect(result.bands).toHaveLength(15);
          expect(Math.abs(result.bands.find(band => band.front)!.end - 7 / 230) * result.track.width).toBeLessThanOrEqual(0.1);
          expect(Math.abs(result.bands.find(band => band.back)!.start - 219 / 230) * result.track.width).toBeLessThanOrEqual(0.1);
          await screenshot(page, info, `reading-work-${rtl ? "rtl" : "ltr"}-${width}`);
        }
      } finally { await context.close(); }
    });

    test(`${rtl ? "RTL" : "LTR"}: compact lanes, midbook seek/drag clipping, popup, and panel alignment`, async () => {
      const info = test.info();
      const { context, readerPage: page } = await launch(info, "nested-reading-work", rtl);
      try {
        await seek(page, 0.5);
        await page.evaluate(async () => Reflect.get(window, "__readerController").toggleBookmark());
        const slider = sliderFor(page);
        await slider.focus();
        const compact = await slider.evaluate(element => {
          const sliderBox = element.getBoundingClientRect();
          const flag = element.querySelector("[data-bookmark-marker]")!.getBoundingClientRect();
          const thumb = element.querySelector("[data-scrubber-thumb]")!.getBoundingClientRect();
          const labels = [...element.parentElement!.querySelectorAll("span, p")]
            .filter(label => !element.contains(label)).map(label => label.getBoundingClientRect())
            .filter(box => box.height > 0 && box.left < flag.right && box.right > flag.left);
          return {
            height: sliderBox.height, flagTop: flag.top - sliderBox.top, flagHeight: flag.height,
            gap: flag.top - thumb.bottom, labelGap: thumb.top - Math.max(...labels.map(label => label.bottom)),
          };
        });
        expect(compact).toMatchObject({ height: 54, flagTop: 39, flagHeight: 15, gap: 2 });
        expect(compact.labelGap).toBeGreaterThanOrEqual(0);
        const toolbar = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");
        expect((await slider.locator("..").boundingBox())!.height).toBe((await toolbar.boundingBox())!.height);
        const checkMidbook = async () => {
          const result = await geometry(page, rtl);
          expect(result.current).toBeGreaterThan(0.25);
          expect(result.current).toBeLessThan(0.85);
          expect(result.bands[0]!.start).toBeCloseTo(result.current, 4);
          expect(result.bands.at(-1)!.back).toBe(true);
          expect(result.bands.at(-1)!.start).toBeCloseTo(219 / 230, 4);
          const expected = readingPages.map(chapterPage => (chapterPage - 1) / 230).filter(fraction => fraction >= result.current);
          expect(result.boundaries).toHaveLength(expected.length);
          result.boundaries.forEach((boundary, index) => expect(boundary.fraction).toBeCloseTo(expected[index]!, 4));
          return result;
        };
        await checkMidbook();
        await screenshot(page, info, `landmarks-${rtl ? "rtl" : "ltr"}-midbook-bookmark`);
        await page.mouse.move(300, 2);
        await page.getByRole("button", { name: "Show contents", exact: true }).click();
        const contents = page.getByRole("navigation", { name: "Table of contents" });
        await expect(contents).toBeVisible();
        await expect.poll(async () => {
          const panel = (await contents.boundingBox())!;
          return Math.abs(panel.y + panel.height - (await slider.locator("..").boundingBox())!.y);
        }).toBeLessThanOrEqual(1);
        await page.keyboard.press("Escape");
        await expect(contents).not.toBeVisible();
        await slider.focus();
        const track = (await slider.locator("[data-scrubber-track]").boundingBox())!;
        const xAt = (fraction: number) => track.x + track.width * (rtl ? 1 - fraction : fraction);
        await page.mouse.click(xAt(0.35), track.y + 5);
        await settled(page);
        const sought = await checkMidbook();
        expect(sought.current).toBeGreaterThan(0.3);
        expect(sought.current).toBeLessThan(0.4);
        await page.mouse.move(xAt(sought.current), track.y + 5);
        await page.mouse.down();
        try {
          await page.mouse.move(xAt(0.72), track.y + 5, { steps: 4 });
          await expect(slider).toHaveAttribute("aria-valuenow", "72");
          expect((await checkMidbook()).current).toBeCloseTo(0.72, 2);
          const popup = page.locator("[data-scrubber-preview]");
          await expect(popup).toBeVisible();
          const popupBox = (await popup.boundingBox())!;
          expect(popupBox.x).toBeGreaterThanOrEqual(7);
          expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(1393);
          await screenshot(page, info, `landmarks-${rtl ? "rtl" : "ltr"}-drag`);
        } finally { await page.mouse.up(); }
        await settled(page);
        const committed = await checkMidbook();
        expect(committed.current).toBeGreaterThan(0.65);
        await page.emulateMedia({ forcedColors: "active" });
        for (const band of await layerFor(page).locator("[data-upcoming-band]").all()) await expect(band).toHaveCSS("display", "none");
        const boundaries = layerFor(page).locator("[data-upcoming-boundary]");
        await expect(boundaries).toHaveCount(committed.boundaries.length);
        for (const boundary of await boundaries.all()) await expect(boundary).toBeVisible();
      } finally { await context.close(); }
    });

    test(`${rtl ? "RTL" : "LTR"}: darker front/back bands work with or without chapter detail and clip away after reading`, async () => {
      const info = test.info();
      const { context, readerPage: page } = await launch(info, "dense-flat", rtl);
      try {
        await seek(page, 0);
        await expect(layerFor(page)).toHaveAttribute("data-marker-detail", "landmarks");
        const initial = await geometry(page, rtl);
        expect(initial.boundaries).toHaveLength(0);
        expect(initial.bands).toHaveLength(2);
        expect(initial.bands[0]!.front).toBe(true);
        expect(initial.bands[0]!.end).toBeCloseTo(4 / 262, 4);
        expect(initial.bands[1]!.back).toBe(true);
        expect(initial.bands[1]!.start).toBeCloseTo(258 / 262, 4);
        await seek(page, 0.5);
        const middle = await geometry(page, rtl);
        expect(middle.bands).toHaveLength(1);
        expect(middle.bands[0]!.back).toBe(true);
        await screenshot(page, info, `dense-${rtl ? "rtl" : "ltr"}-midbook-end-band`);
        // At the last spread, the first visible page is not yet the final page.
        await page.evaluate(async () => Reflect.get(window, "__readerController").setAlwaysShowOnePage(true));
        await settled(page);
        await seek(page, 1);
        await expect(layerFor(page).locator("[data-upcoming-band]")).toHaveCount(0);
      } finally { await context.close(); }
    });

    test(`${rtl ? "RTL" : "LTR"}: resizing retains grouped chapters without a minimum gap and seeking stays mirrored`, async () => {
      const { context, readerPage: page } = await launch(test.info(), "dense-nested", rtl);
      try {
        await seek(page, 0);
        const before = await position(page);
        const original = await fractions(page, rtl);
        expect(original).toHaveLength(4);
        await page.setViewportSize({ width: 320, height: 900 });
        await settled(page);
        await sliderFor(page).focus();
        await expect(layerFor(page)).toHaveAttribute("data-marker-detail", "sections");
        const narrow = await geometry(page, rtl);
        expect(narrow.boundaries).toHaveLength(3);
        expect((await position(page)).path).toBe(before.path);
        await page.setViewportSize({ width: 1400, height: 900 });
        await settled(page);
        await sliderFor(page).focus();
        const restored = await fractions(page, rtl);
        restored.forEach((fraction, index) => expect(fraction).toBeCloseTo(original[index]!, 4));
        const track = (await sliderFor(page).boundingBox())!;
        await page.mouse.click(track.x + track.width * (rtl ? 0.25 : 0.75), track.y + 29);
        await settled(page);
        const after = await position(page);
        expect(after.page / after.count).toBeGreaterThan(0.65);
        expect(after.page / after.count).toBeLessThan(0.85);
      } finally { await context.close(); }
    });
  }

  test("incomplete full-book counting removes stale landmarks until precision is available", async () => {
    const { context, readerPage: page } = await launch(test.info(), "sparse");
    try {
      await expect(layerFor(page)).toHaveAttribute("data-marker-detail", "chapters");
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        Reflect.set(window, "__landmarkPageCounts", controller.bookPagination.pageCounts);
        controller.bookPagination.pageCounts = controller.bookPagination.pageCounts.map(() => undefined);
        controller.notify();
      });
      await expect(layerFor(page)).toHaveAttribute("data-marker-detail", "pending");
      await expect(layerFor(page).locator("[data-upcoming-band], [data-upcoming-boundary], [data-reading-landmark]")).toHaveCount(0);
      await page.getByRole("main").locator("iframe").first().evaluate(frame => (frame as HTMLIFrameElement).focus());
      await page.mouse.move(700, 450);
      await expect(sliderFor(page).locator("..")).toHaveCSS("pointer-events", "none", { timeout: 10_000 });
      await page.mouse.move(700, 895);
      await expect(sliderFor(page).locator("..")).toHaveCSS("pointer-events", "auto");
      const mapping = page.getByText("Mapping your book…", { exact: true });
      await expect(mapping).toBeVisible();
      const mappingBox = (await mapping.boundingBox())!;
      const footer = (await sliderFor(page).locator("..").boundingBox())!;
      expect(mappingBox.x + mappingBox.width / 2).toBeCloseTo(footer.x + footer.width / 2, 0);
      await expect(page.locator("[data-marker-legend]")).toHaveCount(0);
      await expect(sliderFor(page)).not.toHaveAccessibleDescription(/pending|mapping|counting/i);
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        controller.bookPagination.pageCounts = Reflect.get(window, "__landmarkPageCounts");
        Reflect.deleteProperty(window, "__landmarkPageCounts");
        controller.notify();
      });
      await expect(layerFor(page)).toHaveAttribute("data-marker-detail", "chapters");
      await geometry(page);
    } finally { await context.close(); }
  });
});
