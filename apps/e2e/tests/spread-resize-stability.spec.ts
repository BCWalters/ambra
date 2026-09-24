import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { navigationFixture } from "../navigation-fixture.js";

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isTurningPage && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
  });
}

test("resize reloads only when reflow requires a different chapter pair (#183)", async () => {
  const { context, readerPage: page } = await launchReader(navigationFixture(test.info(), [6, 4]), {
    viewport: { width: 1400, height: 1500 },
  });
  try {
    await exposeReaderController(page);
    await settled(page);
    await page.evaluate(() => Reflect.get(window, "__readerController").openSpineItem(1));
    await settled(page);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").host.positions)).toEqual({
      first: { spineIndex: 0, pageIndex: 2 }, second: { spineIndex: 1, pageIndex: 0 },
    });
    await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const position = c.host.currentPosition();
      Reflect.set(window, "__boundaryResize", {
        host: c.host, locator: c.locatorResolver.generate(1, position.node, position.offset ?? 0),
      });
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForFunction(() => Reflect.get(window, "__readerController").appliedHeight === 900);
    await settled(page);
    const result = await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const before = Reflect.get(window, "__boundaryResize");
      const view = c.host.documentViews().find((v: { spineIndex: number }) => v.spineIndex === 1);
      const position = c.locatorResolver.resolveInDocument(before.locator, 1, view.document);
      return { replaced: c.host !== before.host, positions: c.host.positions,
        anchorVisible: view.page.containsPosition(position.node, position.characterOffset ?? 0, view.document) };
    });
    expect(result.replaced).toBe(true);
    expect(result.anchorVisible).toBe(true);
    expect(result.positions).toEqual({
      first: { spineIndex: 1, pageIndex: 0 }, second: { spineIndex: 1, pageIndex: 1 },
    });
  } finally {
    await context.close();
  }
});

for (const boundary of [false, true]) {
  test(`${boundary ? "cross-chapter" : "ordinary"} spread resize retains documents, reading anchor and no loading (#183)`, async () => {
    const realBook = !boundary && process.env.AMBRA_E2E_ULYSSES_EPUB;
    const book = boundary ? navigationFixture(test.info(), [1, 1, 4]) :
      realBook || fileURLToPath(new URL("../fixtures/long-content.epub", import.meta.url));
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await settled(page);
      if (realBook) {
        await page.evaluate(async () => {
          const c = Reflect.get(window, "__readerController");
          const path = c.pkg.spine.find((ref: { manifestItem: { path: string } }) =>
            ref.manifestItem.path.endsWith("/chapter-1.xhtml")).manifestItem.path;
          await c.goToNavPoint({ path });
        });
        await settled(page);
      }
      if (!boundary) {
        await page.keyboard.press("ArrowRight");
        await settled(page);
      }
      await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      await page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        const state = { host: c.host, documents: c.host.contentDocuments(),
          anchor: c.nativeReading.current() ?? c.host.currentPosition(), loads: 0, loading: false };
        Reflect.set(window, "__resizeState", state);
        const open = c.openSpineItem;
        c.openSpineItem = function (...args: unknown[]) { state.loads++; return open.apply(this, args); };
        const notify = c.notify;
        c.notify = function () { state.loading ||= this.isLoading; return notify.call(this); };
      });
      const measurements = [];
      for (const viewport of [
        { width: 1390, height: 900 }, { width: 1380, height: 900 },
        { width: 1360, height: 930 }, { width: 1320, height: 950 },
        { width: 1400, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(({ width, height }) => {
          const c = Reflect.get(window, "__readerController");
          return c.appliedWidth === width && c.appliedHeight === height;
        }, viewport);
        await settled(page);
        const state = await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          const before = Reflect.get(window, "__resizeState");
          const views = c.host.documentViews();
          const anchorView = views.find((v: { document: Document }) => v.document === before.anchor.node.ownerDocument);
          const selection = before.anchor.node.ownerDocument.getSelection();
          return {
            sameHost: c.host === before.host,
            sameDocuments: views.every((v: { document: Document }, i: number) => v.document === before.documents[i]),
            anchorVisible: anchorView?.page.containsPosition(before.anchor.node, before.anchor.offset ?? 0, anchorView.document),
            nativeCaretRetained: selection?.anchorNode === before.anchor.node &&
              selection.anchorOffset === (before.anchor.offset ?? 0),
            loads: before.loads, loading: before.loading,
            frames: views.map((v: { document: Document }) => ({
              width: v.document.defaultView!.innerWidth, height: v.document.defaultView!.innerHeight,
            })),
          };
        });
        measurements.push({ viewport, ...state });
        expect(state.sameHost).toBe(true);
        expect(state.sameDocuments).toBe(true);
        expect(state.anchorVisible).toBe(true);
        expect(state.nativeCaretRetained).toBe(true);
        expect(state.loads).toBe(0);
        expect(state.loading).toBe(false);
        expect(state.frames).toEqual(Array.from({ length: 2 }, () => ({
          width: (viewport.width - 40) / 2, height: viewport.height,
        })));
        await expect(page.getByText("Loading…", { exact: true })).toBeHidden();
      }
      await test.info().attach("resize-host-and-position", {
        body: JSON.stringify(measurements, null, 2), contentType: "application/json",
      });
      const position = () => page.evaluate(() => Reflect.get(window, "__readerController").host.positions);
      const beforeTurn = await position();
      await page.keyboard.press("ArrowRight");
      await settled(page);
      expect(await position()).not.toEqual(beforeTurn);
      await page.keyboard.press("ArrowLeft");
      await settled(page);
      expect(await position()).toEqual(beforeTurn);
    } finally {
      await context.close();
    }
  });
}
