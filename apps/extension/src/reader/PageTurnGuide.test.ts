import { describe, expect, it, vi } from "vitest";
import { pageTurnGuideGeometry } from "./PageTurnGuide.js";
import { ReaderController } from "./ReaderController.js";

describe("page-turn guide geometry", () => {
  const pane = { left: 100, right: 1100, top: 20, height: 800 };
  it("uses only physical outside margins, not a spread's gutter or overlap", () => {
    expect(pageTurnGuideGeometry(pane, [{ left: 140, right: 570 }, { left: 630, right: 1060 }]))
      .toEqual({ left: 100, right: 1100, top: 20, height: 800, leftWidth: 40, rightWidth: 40 });
  });
  it("clamps overflowing content and handles resize without covering the measure", () => {
    expect(pageTurnGuideGeometry(pane, [{ left: 80, right: 1200 }]))
      .toMatchObject({ leftWidth: 0, rightWidth: 0 });
    expect(pageTurnGuideGeometry({ ...pane, right: 420 }, [{ left: 116, right: 404 }]))
      .toMatchObject({ leftWidth: 16, rightWidth: 16 });
    expect(pageTurnGuideGeometry(pane, [])).toBeUndefined();
    expect(pageTurnGuideGeometry({ ...pane, height: 100 }, [{ left: 140, right: 1060 }]))
      .toMatchObject({ top: 20, height: 100 });
    expect(pageTurnGuideGeometry({ ...pane, height: 0 }, [{ left: 140, right: 1060 }])).toBeUndefined();
  });
});

it("publishes committed navigation, never layout or a progress flush, and unsubscribes", async () => {
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    navigationListeners: new Set(), nativeReading: { current: () => undefined },
    host: undefined, isApplyingLayout: false,
  });
  const listener = vi.fn();
  const unsubscribe = controller.subscribeNavigation(listener);
  await controller.flushProgress();
  expect(listener).not.toHaveBeenCalled();
  controller.isApplyingLayout = true;
  await controller.saveProgress(false, true);
  expect(listener).not.toHaveBeenCalled();
  controller.isApplyingLayout = false;
  await controller.saveProgress(false, true);
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  await controller.saveProgress(false, true);
  expect(listener).toHaveBeenCalledOnce();
});
