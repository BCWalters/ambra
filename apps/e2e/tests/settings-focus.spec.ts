import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return !c.isApplyingLayout && !c.isLoadInFlight && !c.isTurningPage && !c.pendingLayout;
  });
}

async function rememberPosition(page: Page) {
  await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const position = c.host.currentPosition();
    Reflect.set(window, "__settingsPosition", {
      spineIndex: c.spineIndex,
      locator: c.locatorResolver.generate(c.spineIndex, position.node, position.offset),
    });
  });
}

async function observeLayoutPositions(page: Page) {
  await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const reopen = c.reopenForCurrentSize.bind(c);
    // Each queued reflow bridges the preceding layout's page start, which
    // can move as page boundaries change. Check the actual incoming CFI of
    // the final reflow, without replacing or bypassing any host behavior.
    c.reopenForCurrentSize = (...args: unknown[]) => {
      const position = c.host.currentPosition();
      Reflect.set(window, "__settingsPosition", {
        spineIndex: c.spineIndex,
        locator: c.locatorResolver.generate(c.spineIndex, position.node, position.offset),
      });
      return reopen(...args);
    };
  });
}

async function expectPositionVisible(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const saved = Reflect.get(window, "__settingsPosition");
    return c.contentDocumentViews().some(({ document: doc, spineIndex }: { document: Document; spineIndex: number }) => {
      if (spineIndex !== saved.spineIndex) return false;
      const resolved = c.locatorResolver.resolveInDocument(saved.locator, spineIndex, doc);
      const range = doc.createRange();
      if (resolved.node.nodeType === Node.TEXT_NODE) {
        const offset = resolved.characterOffset ?? 0;
        range.setStart(resolved.node, offset);
        range.setEnd(resolved.node, Math.min(offset + 1, resolved.node.textContent.length));
      } else {
        range.selectNodeContents(resolved.node);
      }
      return [...range.getClientRects()].some(rect =>
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < doc.defaultView!.innerHeight &&
        rect.right > 0 && rect.left < doc.defaultView!.innerWidth,
      );
    });
  })).toBe(true);
}

async function expectControlRetained(page: Page, control: Locator) {
  await settled(page);
  await expect(control).toBeVisible();
  await expect(control).toBeFocused();
  await expect(page.getByRole("button", { name: "Text and page options", exact: true }))
    .toHaveAttribute("aria-expanded", "true");
  expect(await control.evaluate(element => element === Reflect.get(window, "__settingsControl"))).toBe(true);
  await expectPositionVisible(page);
}

for (const { width, mode } of [
  { width: 900, mode: "paginated" },
  { width: 1400, mode: "paginated" },
  { width: 900, mode: "scroll" },
] as const) {
  test(`${width}px ${mode}: repeated and rapid real slider input retains menu, control focus and reading position`, async () => {
    const { context, readerPage: page } = await launchReader(book, { viewport: { width, height: 900 } });
    try {
      await exposeReaderController(page);
      await page.evaluate(async mode => {
        const c = Reflect.get(window, "__readerController");
        await c.setViewMode(mode);
        await c.seekToFraction(0.35);
      }, mode);
      await observeLayoutPositions(page);
      for (const { name, property, submenu } of [
        { name: "Font size", property: "fontScale", submenu: "Text" },
        { name: "Line spacing", property: "lineSpacing", submenu: "Text" },
        { name: "Character spacing", property: "letterSpacing", submenu: "Text" },
        { name: "Column width", property: "contentWidthEm", submenu: "Page" },
      ]) {
        await page.getByRole("button", { name: "Text and page options", exact: true }).click();
        await page.getByRole("menuitem", { name: submenu, exact: true }).press("ArrowRight");
        const slider = page.getByRole("slider", { name, exact: true });
        await slider.focus();
        await slider.evaluate(element => Reflect.set(window, "__settingsControl", element));
        for (let step = 0; step < 2; step++) {
          await rememberPosition(page);
          await page.keyboard.press("ArrowRight");
          await expectControlRetained(page, slider);
        }
        await rememberPosition(page);
        for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowRight");
        await expectControlRetained(page, slider);
        const value = Number(await slider.inputValue());
        await expect.poll(() => page.evaluate(property =>
          Reflect.get(window, "__readerController")[property], property)).toBe(value);

        await rememberPosition(page);
        const box = (await slider.boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.65, box.y + box.height / 2, { steps: 12 });
        await page.mouse.up();
        await expectControlRetained(page, slider);
        await expect.poll(() => page.evaluate(property =>
          Reflect.get(window, "__readerController")[property], property)).toBe(Number(await slider.inputValue()));
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test("font, responsive columns and reading mode preserve shell focus, while explicit navigation enters content", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await exposeReaderController(page);
    await page.evaluate(() => Reflect.get(window, "__readerController").seekToFraction(0.35));
    await page.getByRole("button", { name: "Text and page options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Text", exact: true }).press("ArrowRight");
    const font = page.getByRole("menuitemradio", { name: "Georgia", exact: true });
    await rememberPosition(page);
    await font.evaluate(element => Reflect.set(window, "__settingsControl", element));
    await font.click();
    await expectControlRetained(page, font);
    await expect(font).toHaveAttribute("aria-checked", "true");
    for (const width of [900, 1400]) {
      await rememberPosition(page);
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").appliedWidth)).toBe(width);
      await expectControlRetained(page, font);
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const name of ["Scroll", "Paginated"]) {
      await rememberPosition(page);
      const mode = page.getByRole("menuitemradio", { name, exact: true });
      await mode.click();
      await expect(mode).toHaveAttribute("aria-checked", "true");
      await settled(page);
      await expect(mode).toBeFocused();
      await expectPositionVisible(page);
    }
    await page.keyboard.press("Escape");
    const settings = page.getByRole("button", { name: "Settings", exact: true });
    await settings.focus();
    await page.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      await c.goToNavPoint(c.navigation.toc.items[1]);
    });
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
    await page.evaluate(() => Reflect.get(window, "__readerController").setFontScale(1.25));
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
    const before = await page.evaluate(() => JSON.stringify(Reflect.get(window, "__readerController").host.positions));
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => JSON.stringify(Reflect.get(window, "__readerController").host.positions)))
      .not.toBe(before);
    await settled(page);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
