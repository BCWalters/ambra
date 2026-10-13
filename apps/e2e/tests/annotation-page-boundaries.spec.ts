import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";

const paragraph = `<p id="continuous">${Array.from({ length: 400 }, (_, index) =>
  `A quiet path ${index} through <em>the green hills</em> leads home. `).join("")}</p>`;

async function middlePage(info: TestInfo, width: number) {
  const reader = await launchReader(navigationFixture(info, [1], () => paragraph), {
    viewport: { width, height: 900 },
  });
  await reader.readerPage.evaluate(async (single) => {
    const controller = Reflect.get(window, "__readerController");
    await controller.setPageTurnAnimationStyle("none");
    await controller.setAlwaysShowOnePage(single);
    await controller.turnPage(1);
  }, width < 1000);
  await reader.readerPage.waitForFunction(() => {
    const controller = Reflect.get(window, "__readerController");
    return !controller.isTurningPage && !controller.isLoadInFlight && !controller.isApplyingLayout && !controller.pendingLayout;
  });
  return reader;
}

async function fullPageExpectation(page: Page, index = 0) {
  return page.evaluate(index => {
    const controller = Reflect.get(window, "__readerController");
    const view = controller.contentDocumentViews()[index];
    const canonical = view.document.createRange();
    canonical.setStart(view.page.startBreak.node, view.page.startBreak.offset ?? 0);
    canonical.setEnd(view.page.endBreak.node, view.page.endBreak.offset ?? 0);
    const selected = view.document.createRange();
    selected.selectNodeContents(view.document.getElementById("continuous"));
    if (selected.compareBoundaryPoints(Range.START_TO_START, canonical) > 0) {
      canonical.setStart(selected.startContainer, selected.startOffset);
    }
    if (selected.compareBoundaryPoints(Range.END_TO_END, canonical) < 0) {
      canonical.setEnd(selected.endContainer, selected.endOffset);
    }
    return {
      text: canonical.toString(),
      startCfi: controller.locatorResolver.generate(view.spineIndex, canonical.startContainer, canonical.startOffset).cfi,
      endCfi: controller.locatorResolver.generate(view.spineIndex, canonical.endContainer, canonical.endOffset).cfi,
      spineIndex: view.spineIndex,
      startsMidParagraph: view.document.getElementById("continuous")?.contains(canonical.startContainer) &&
        canonical.toString().length < view.document.getElementById("continuous").textContent.length,
    };
  }, index);
}

async function assertSavedSelection(page: Page) {
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    const pending = controller.pendingSelectionRange;
    const view = controller.contentDocumentViews().find((view: { document: Document }) => view.document === pending?.startContainer.ownerDocument);
    if (!pending || !view?.page) throw new Error("Visible page selection was not captured.");
    const text = pending.toString();
    const startCfi = controller.locatorResolver.generate(view.spineIndex, pending.startContainer, pending.startOffset).cfi;
    const endCfi = controller.locatorResolver.generate(view.spineIndex, pending.endContainer, pending.endOffset).cfi;
    const walker = view.document.createTreeWalker(view.document.getElementById("continuous"), NodeFilter.SHOW_TEXT);
    let characters = 0;
    let hiddenCharacters = 0;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (!pending.intersectsNode(node)) continue;
      for (let offset = 0; offset < node.length; offset++) {
        const glyph = view.document.createRange();
        glyph.setStart(node, offset);
        glyph.setEnd(node, offset + 1);
        const start = glyph.cloneRange();
        start.collapse(true);
        const end = glyph.cloneRange();
        end.collapse(false);
        const selectionStart = pending.cloneRange();
        selectionStart.collapse(true);
        const selectionEnd = pending.cloneRange();
        selectionEnd.collapse(false);
        if (start.compareBoundaryPoints(Range.START_TO_START, selectionEnd) < 0 &&
          end.compareBoundaryPoints(Range.START_TO_START, selectionStart) > 0) {
          characters++;
          if (!view.page.containsPosition(node, offset, view.document)) hiddenCharacters++;
        }
      }
    }
    return { text, startCfi, endCfi, characters, hiddenCharacters, nativeText: view.document.getSelection()?.toString() };
  });
  expect(result.characters).toBeGreaterThan(10);
  expect(result.hiddenCharacters).toBe(0);
  expect(result.nativeText).toBe(result.text);
  await page.evaluate(async () => Reflect.get(window, "__readerController").addHighlight("yellow"));
  const saved = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().highlights.at(-1));
  expect(saved).toMatchObject({ text: result.text, startCfi: result.startCfi, endCfi: result.endCfi });
  return saved;
}

for (const width of [760, 1400]) {
  for (const direction of ["up", "down"] as const) {
    test(`${width}px: native mouse release of a ${direction}-margin selection stores only visible page text (#422)`, async ({ browserName: _browserName }, info) => {
      const { context, readerPage: page } = await middlePage(info, width);
      try {
        expect((await fullPageExpectation(page)).startsMidParagraph).toBe(true);
        const point = await page.evaluate(() => {
          const controller = Reflect.get(window, "__readerController");
          const view = controller.contentDocumentViews()[0];
          const frame = view.document.defaultView.frameElement as HTMLIFrameElement;
          const box = frame.getBoundingClientRect();
          const [top = 0, , bottom = top] = Array.from(
            frame.style.clipPath.matchAll(/(-?[\d.]+)px/g), (match) => Number(match[1]),
          );
          const bounds = { top: Math.max(0, box.top + top), bottom: Math.min(innerHeight, box.bottom - bottom) };
          const walker = view.document.createTreeWalker(view.document.getElementById("continuous"), NodeFilter.SHOW_TEXT);
          let best: { x: number; y: number; distance: number } | undefined;
          for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
            for (let offset = 0; offset < node.length; offset++) {
              if (!view.page.containsPosition(node, offset, view.document)) continue;
              const glyph = view.document.createRange();
              glyph.setStart(node, offset);
              glyph.setEnd(node, offset + 1);
              const rect = glyph.getBoundingClientRect();
              const y = box.top + (rect.top + rect.bottom) / 2;
              if (!rect.width || y < bounds.top + 60 || y > bounds.bottom - 60) continue;
              const x = box.left + (rect.left + rect.right) / 2;
              const distance = Math.abs(y - (bounds.top + bounds.bottom) / 2) + Math.abs(x - (box.left + box.width / 2));
              if (!best || distance < best.distance) best = { x, y, distance };
            }
          }
          if (!best) throw new Error("No painted interior glyph for native selection.");
          return { ...best, bounds };
        });
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        // Held-pointer movement across the transformed iframe hangs Chromium's
        // input acknowledgement (#15). Seed its overextended range, then use
        // genuine mouse press/release events to exercise completion outside it.
        const expected = await page.evaluate(direction => {
          const controller = Reflect.get(window, "__readerController");
          const view = controller.contentDocumentViews()[0];
          const selection = view.document.getSelection();
          const node = selection.anchorNode;
          const offset = selection.anchorOffset;
          if (!node) throw new Error("Native mouse press did not establish a selection anchor.");
          const paragraph = view.document.getElementById("continuous");
          selection.setBaseAndExtent(node, offset, paragraph, direction === "up" ? 0 : paragraph.childNodes.length);
          const visible = view.document.createRange();
          visible.setStart(direction === "up" ? view.page.startBreak.node : node,
            direction === "up" ? view.page.startBreak.offset ?? 0 : offset);
          visible.setEnd(direction === "up" ? node : view.page.endBreak.node,
            direction === "up" ? offset : view.page.endBreak.offset ?? 0);
          return {
            text: visible.toString(),
            startCfi: controller.locatorResolver.generate(view.spineIndex, visible.startContainer, visible.startOffset).cfi,
            endCfi: controller.locatorResolver.generate(view.spineIndex, visible.endContainer, visible.endOffset).cfi,
          };
        }, direction);
        const input = await context.newCDPSession(page);
        await input.send("Input.dispatchMouseEvent", {
          type: "mouseReleased", button: "left", buttons: 0, x: point.x,
          y: direction === "up" ? point.bounds.top - 8 : point.bounds.bottom + 8,
          clickCount: 1,
        });
        await input.detach();
        await expect(page.getByRole("button", { name: "Add note", exact: true })).toBeVisible();
        expect(await assertSavedSelection(page)).toMatchObject(expected);
      } finally {
        await context.close();
      }
    });
  }
}

for (const path of ["keyboard", "creation-bypass"] as const) {
  test(`${path}: both ends of a mid-paragraph range use canonical page text and CFIs (#422)`, async ({ browserName: _browserName }, info) => {
    const { context, readerPage: page } = await middlePage(info, 760);
    try {
      const expected = await fullPageExpectation(page);
      expect(expected.startsMidParagraph).toBe(true);
      await page.evaluate(path => {
        const controller = Reflect.get(window, "__readerController");
        const view = controller.contentDocumentViews()[0];
        const paragraph = view.document.getElementById("continuous");
        const range = view.document.createRange();
        range.selectNodeContents(paragraph);
        if (path === "creation-bypass") controller.pendingSelectionRange = range;
        else {
          view.document.defaultView.focus();
          view.document.getSelection().setBaseAndExtent(paragraph, paragraph.childNodes.length, paragraph, 0);
        }
      }, path);
      if (path === "keyboard") {
        await page.keyboard.press("Shift");
        await expect(page.getByRole("button", { name: "Add note", exact: true })).toBeVisible();
        expect(await page.evaluate(() => {
          const view = Reflect.get(window, "__readerController").contentDocumentViews()[0];
          const selection = view.document.getSelection();
          return selection.anchorNode === Reflect.get(window, "__readerController").pendingSelectionRange.endContainer &&
            selection.anchorOffset === Reflect.get(window, "__readerController").pendingSelectionRange.endOffset;
        })).toBe(true);
      }
      await page.evaluate(async () => Reflect.get(window, "__readerController").addHighlight("green"));
      const saved = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().highlights.at(-1));
      expect(saved).toMatchObject({ text: expected.text, startCfi: expected.startCfi, endCfi: expected.endCfi, spineIndex: expected.spineIndex });
    } finally {
      await context.close();
    }
  });
}

test("empty page intersections cannot be persisted through an alternate creation path (#422)", async ({ browserName: _browserName }, info) => {
  const { context, readerPage: page } = await middlePage(info, 760);
  try {
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      const view = controller.contentDocumentViews()[0];
      const range = view.document.createRange();
      range.selectNodeContents(view.document.getElementById("continuous").firstChild);
      controller.pendingSelectionRange = range;
      await controller.addHighlight("yellow");
    });
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().highlights)).toEqual([]);
    await expect(page.getByRole("status").filter({ hasText: "no text on the visible page" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("spread pages from independently loaded chapters keep separate annotation ownership (#422)", async ({ browserName: _browserName }, info) => {
  const fixture = navigationFixture(info, [1, 1], chapter => chapter === 0
    ? '<p id="continuous">A short first chapter with <em>ordinary inline text</em>.</p>' : paragraph);
  const { context, readerPage: page } = await launchReader(fixture, { viewport: { width: 1400, height: 900 } });
  try {
    const identity = await page.evaluate(() => Reflect.get(window, "__readerController").contentDocumentViews()
      .map((view: { spineIndex: number }) => view.spineIndex));
    expect(identity).toEqual([0, 1]);
    for (const index of [0, 1]) {
      const expected = await fullPageExpectation(page, index);
      await page.evaluate(async index => {
        const controller = Reflect.get(window, "__readerController");
        const view = controller.contentDocumentViews()[index];
        const range = view.document.createRange();
        range.selectNodeContents(view.document.getElementById("continuous"));
        controller.pendingSelectionRange = range;
        await controller.addHighlight("yellow");
      }, index);
      const saved = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().highlights.at(-1));
      expect(saved).toMatchObject({ text: expected.text, startCfi: expected.startCfi, endCfi: expected.endCfi, spineIndex: expected.spineIndex });
    }
  } finally {
    await context.close();
  }
});

test("CSS-reordered caption annotations use non-linear page membership (#422)", async ({ browserName: _browserName }, info) => {
  const fixture = navigationFixture(info, [1], () =>
    `<figure style="display:table;width:300px;margin:0;break-inside:avoid">
      <figcaption id="continuous" style="display:table-caption;caption-side:bottom">${"A caption with visible and off-page letters. ".repeat(100)}</figcaption>
      <div><svg xmlns="http://www.w3.org/2000/svg" width="120" height="200"><rect width="120" height="200" fill="blue"/></svg></div>
    </figure>`);
  const { context, readerPage: page } = await launchReader(fixture, { viewport: { width: 760, height: 900 } });
  try {
    const expected = await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.setAlwaysShowOnePage(true);
      await controller.goToNavPoint({ path: controller.pkg.spine[0].manifestItem.path, fragment: "continuous" });
      const view = controller.contentDocumentViews()[0];
      if (!view.page.positionOverrides?.length) throw new Error("Fixture did not create non-linear page membership.");
      const text = view.document.getElementById("continuous").firstChild;
      const offsets = Array.from({ length: text.length }, (_, offset) => offset)
        .filter(offset => view.page.containsPosition(text, offset, view.document));
      const first = offsets[0];
      const last = offsets.at(-1);
      if (first === undefined || last === undefined) throw new Error("No visible caption text.");
      const visible = view.document.createRange();
      visible.setStart(text, first);
      visible.setEnd(text, last + 1);
      const raw = view.document.createRange();
      raw.selectNodeContents(text);
      view.document.getSelection().removeAllRanges();
      view.document.getSelection().addRange(raw);
      view.document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      return {
        text: visible.toString(),
        startCfi: controller.locatorResolver.generate(view.spineIndex, visible.startContainer, visible.startOffset).cfi,
        endCfi: controller.locatorResolver.generate(view.spineIndex, visible.endContainer, visible.endOffset).cfi,
        hidden: text.length - offsets.length,
      };
    });
    expect(expected.hidden).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Add note", exact: true })).toBeVisible();
    const { hidden: _hidden, ...annotation } = expected;
    expect(await assertSavedSelection(page)).toMatchObject(annotation);
  } finally {
    await context.close();
  }
});
