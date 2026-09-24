import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixture = fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
const addNote = (page: Page) => page.getByRole("button", { name: "Add note", exact: true });

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isLoadInFlight && !c.isTurningPage && !c.isApplyingLayout && !c.pendingLayout;
  });
}

async function selectionGeometry(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("iframe")).map(frame => {
    const box = frame.getBoundingClientRect();
    const doc = frame.contentDocument!;
    const selection = doc.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    const insets = Array.from(frame.style.clipPath.matchAll(/(-?[\d.]+)px/g), m => Number(m[1]));
    const [top = 0, right = top, bottom = top, left = right] = insets;
    const bounds = {
      top: Math.max(0, box.top + top), bottom: Math.min(innerHeight, box.bottom - bottom),
      left: Math.max(0, box.left + left), right: Math.min(innerWidth, box.right - right),
    };
    const rects = Array.from(range?.getClientRects() ?? [], rect => ({
      top: box.top + rect.top, bottom: box.top + rect.bottom,
      left: box.left + rect.left, right: box.left + rect.right,
      width: rect.width, height: rect.height,
    }));
    return {
      frame: box.toJSON(), clip: frame.style.clipPath, bounds,
      text: selection?.toString(), rects,
      visible: rects.filter(rect => rect.width > 0 && rect.height > 0 &&
        rect.bottom > bounds.top && rect.top < bounds.bottom &&
        rect.right > bounds.left && rect.left < bounds.right),
      endpoints: range ? {
        start: range.startContainer.textContent, startOffset: range.startOffset,
        end: range.endContainer.textContent, endOffset: range.endOffset,
      } : undefined,
    };
  }));
}

async function recordGeometry(page: Page, label: string, extra = {}) {
  const geometry = await selectionGeometry(page);
  await test.info().attach(label, {
    body: JSON.stringify({ ...extra, geometry, popup: await addNote(page).isVisible() ? await addNote(page).boundingBox() : null }, null, 2),
    contentType: "application/json",
  });
  return geometry;
}

async function selectRange(page: Page, shape: "hidden" | "spanning" | "visible" | "keyboard", frameIndex: number) {
  return page.evaluate(({ shape, frameIndex }) => {
    const frame = document.querySelectorAll("iframe")[frameIndex]!;
    const doc = frame.contentDocument!;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const frameBox = frame.getBoundingClientRect();
    const clipTop = Number(frame.style.clipPath.match(/inset\(([\d.]+)px/)?.[1] ?? 0);
    let first: Text | undefined;
    let visible: { node: Text; offset: number } | undefined;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (!node.textContent?.trim()) continue;
      first ??= node;
      for (let offset = 0; offset < node.length - 10; offset++) {
        const probe = doc.createRange();
        probe.setStart(node, offset);
        probe.setEnd(node, offset + 10);
        const rect = probe.getBoundingClientRect();
        if (rect.width > 0 && rect.top >= Math.max(150 - frameBox.top, clipTop) &&
          rect.bottom + frameBox.top < Math.min(frameBox.bottom - 100, innerHeight - 100)) {
          visible = { node, offset };
          break;
        }
      }
      if (visible) break;
    }
    if (!first || !visible) throw new Error(`Fixture has no suitable visible text: ${JSON.stringify({
      frame: frameBox.toJSON(), clip: frame.style.clipPath, body: doc.body.getBoundingClientRect().toJSON(),
    })}`);
    const range = doc.createRange();
    if (shape === "hidden" || shape === "spanning") range.setStart(first, 0);
    else range.setStart(visible.node, visible.offset);
    if (shape === "hidden") range.setEnd(first, Math.min(10, first.length));
    else range.setEnd(visible.node, visible.offset + 10);
    if (shape === "keyboard") doc.defaultView!.focus();
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    if (shape !== "keyboard") doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    return selection.toString();
  }, { shape, frameIndex });
}

for (const { width, margin, frameIndex, edge } of [
  { width: 760, margin: "right", frameIndex: 0, edge: "right" },
  { width: 1400, margin: "outer left", frameIndex: 0, edge: "left" },
  { width: 1400, margin: "inner left-page right", frameIndex: 0, edge: "right" },
  { width: 1400, margin: "inner right-page left", frameIndex: 1, edge: "left" },
  { width: 1400, margin: "outer right", frameIndex: 1, edge: "right" },
]) {
  test(`${width}px: a real brief ${margin}-margin drag cannot open an off-page annotation popup (#169)`, async () => {
    const { context, readerPage: page } = await launchReader(fixture, {
      viewport: { width, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await settled(page);
      await page.keyboard.press("ArrowRight");
      await settled(page);
      const before = await page.evaluate(() => {
        const s = Reflect.get(window, "__readerController").snapshot();
        return { spine: s.spineIndex, page: s.pageIndex };
      });
      const toolbar = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");
      await page.mouse.move(10, 2);
      await expect(toolbar).toHaveCSS("pointer-events", "auto");
      const frame = (await page.locator("iframe").nth(frameIndex).boundingBox())!;
      const point = {
        x: edge === "left" ? frame.x + 10 : frame.x + frame.width - 10,
        y: edge === "left" ? 225 : 200,
      };
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      // Playwright's drag-interception probe hangs on these clipped iframes.
      // CDP still delivers a real trusted mouse move and Chromium's native selection.
      const input = await context.newCDPSession(page);
      await input.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: point.x, y: point.y + 8, button: "left", buttons: 1,
      });
      await input.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: point.x, y: point.y + 8, button: "left", buttons: 0, clickCount: 1,
      });
      await input.detach();
      await settled(page);
      const geometry = await recordGeometry(page, "native-margin-drag", { from: point, to: { ...point, y: point.y + 8 } });
      const selected = geometry.find(frame => frame.text?.trim());
      expect(selected, "the real pointer gesture must produce native text selection").toBeDefined();
      expect(selected!.rects.length).toBeGreaterThan(0);
      expect(selected!.visible, "every selected client rect is outside the painted page").toEqual([]);
      await expect(addNote(page)).toBeHidden();
      expect(await page.evaluate(() => {
        const s = Reflect.get(window, "__readerController").snapshot();
        return { spine: s.spineIndex, page: s.pageIndex };
      })).toEqual(before);
      expect((await selectionGeometry(page)).find(frame => frame.text?.trim())?.endpoints).toEqual(selected!.endpoints);
    } finally {
      await context.close();
    }
  });
}

for (const width of [760, 1400]) {
  test(`${width}px: hidden and page-start-spanning DOM ranges retain their native selection (#169)`, async () => {
    const { context, readerPage: page } = await launchReader(fixture, {
      viewport: { width, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await settled(page);
      await page.keyboard.press("ArrowRight");
      await settled(page);
      const index = 0;
      for (const shape of ["visible", "spanning", "hidden"] as const) {
        const text = await selectRange(page, shape, index);
        const geometry = (await recordGeometry(page, `dom-range-${shape}`))[index]!;
        expect(text.length).toBeGreaterThan(0);
        if (shape === "hidden") {
          expect(geometry.visible).toEqual([]);
          await expect(addNote(page)).toBeHidden();
        } else {
          expect(geometry.visible.length).toBeGreaterThan(0);
          if (shape === "spanning") expect(geometry.rects.some(rect => rect.bottom <= geometry.bounds.top)).toBe(true);
          await expect(addNote(page)).toBeVisible();
          const popup = (await addNote(page).locator("xpath=ancestor::*[@role='toolbar']").boundingBox())!;
          const visibleTop = Math.max(geometry.bounds.top, Math.min(...geometry.visible.map(rect => rect.top)));
          expect.soft(popup.y + popup.height).toBeGreaterThanOrEqual(visibleTop - 20);
          expect.soft(popup.y + popup.height).toBeLessThanOrEqual(visibleTop);
        }
        const after = (await selectionGeometry(page))[index]!;
        expect(after.text).toBe(text);
        expect(after.endpoints).toEqual(geometry.endpoints);
      }
    } finally {
      await context.close();
    }
  });
}

test("keyboard completion preserves a visible DOM range in paginated and scroll modes", async () => {
  const { context, readerPage: page } = await launchReader(fixture, {
    viewport: { width: 760, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await settled(page);
    for (const mode of ["paginated", "scroll"]) {
      if (mode === "scroll") {
        await page.mouse.move(10, 2);
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("menuitemradio", { name: "Scroll", exact: true }).click();
        await page.keyboard.press("Escape");
        await expect.poll(() => page.evaluate(() =>
          Reflect.get(window, "__readerController").snapshot().viewMode)).toBe("scroll");
        await settled(page);
      }
      const text = await selectRange(page, "keyboard", 0);
      await page.keyboard.press("Shift");
      await expect(addNote(page)).toBeVisible();
      const geometry = (await recordGeometry(page, `keyboard-${mode}`))[0]!;
      expect(geometry.text).toBe(text);
      expect(geometry.text?.length).toBe(10);
      expect(geometry.visible.length).toBeGreaterThan(0);
    }
  } finally {
    await context.close();
  }
});
