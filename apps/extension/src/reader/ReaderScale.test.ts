// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { SpreadPaginatedHost } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";
import { ReaderOperations } from "./ReaderOperation.js";

function fixture() {
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    operations: new ReaderOperations(),
    isTurningPage: false, isLoadInFlight: false, isApplyingLayout: false,
    clearNavigationHighlights: vi.fn(), diagnostics: { record: vi.fn() },
    applyPendingLayout: vi.fn(), reportTransientError: vi.fn(),
  });
  return controller;
}

describe("bounded busy navigation", () => {
  it("retains just the latest extra direction and runs it after the active turn", async () => {
    const controller = fixture();
    let release!: () => void;
    controller.turnPageInternal = vi.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockResolvedValue(undefined);
    const first = controller.turnPage(1);
    await controller.turnPage(1);
    await controller.turnPage(1);
    await controller.turnPage(-1);
    expect(controller.turnPageInternal).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(controller.turnPageInternal.mock.calls.map((call: [number]) => call[0])).toEqual([1, -1]);
    expect(controller.queuedTurn).toBeUndefined();
  });

  it("does not replay queued input after a failed turn", async () => {
    const controller = fixture();
    let reject!: (error: Error) => void;
    controller.turnPageInternal = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const first = controller.turnPage(1);
    await controller.turnPage(1);
    const error = new Error("Could not prepare page");
    reject(error);
    await first;
    expect(controller.turnPageInternal).toHaveBeenCalledOnce();
    expect(controller.reportTransientError).toHaveBeenCalledWith(error, "open", "the next page");
    expect(controller.queuedTurn).toBeUndefined();
  });

  it("does not replay a turn into an applying layout or a disposed reader", async () => {
    for (const disposed of [false, true]) {
      const controller = fixture();
      controller.queuedTurn = 1;
      controller.turnPageInternal = vi.fn();
      if (disposed) controller.operations.dispose();
      else controller.isApplyingLayout = true;
      controller.drainQueuedTurn();
      expect(controller.turnPageInternal).not.toHaveBeenCalled();
      expect(controller.queuedTurn).toBeUndefined();
    }
  });
});

describe("canonical page counts", () => {
  it("uses the live column count instead of measuring a chapter again", async () => {
    const controller = fixture();
    const host = Object.create(SpreadPaginatedHost.prototype);
    host.pageCountFor = vi.fn(() => 503);
    Object.assign(controller, {
      host, width: 1400, appliedWidth: 1400, height: 900, appliedHeight: 900,
      spreadCounts: new Map(), measureSpreadChapter: vi.fn(async () => 1),
    });
    expect(await controller.spreadPageCount(1, controller.operations.begin())).toBe(503);
    expect(controller.measureSpreadChapter).not.toHaveBeenCalled();
  });

  it("does not use live counts while the requested geometry is still pending", async () => {
    const controller = fixture();
    const host = Object.create(SpreadPaginatedHost.prototype);
    host.pageCountFor = vi.fn(() => 503);
    Object.assign(controller, {
      host, width: 1300, appliedWidth: 1400, height: 900, appliedHeight: 900,
      spreadCounts: new Map(), measureSpreadChapter: vi.fn(async () => 601),
    });
    expect(await controller.spreadPageCount(1, controller.operations.begin())).toBe(601);
    expect(host.pageCountFor).not.toHaveBeenCalled();
  });

  it("never substitutes a local page number for an unknown global number", () => {
    const controller = fixture();
    controller.bookPagination = { positionFor: vi.fn(() => ({ currentPage: undefined })) };
    expect(controller.furniturePageNumber(1, 0)).toBeUndefined();
    controller.bookPagination.positionFor.mockReturnValue({ currentPage: 2 });
    expect(controller.furniturePageNumber(1, 0)).toBe(2);
  });
});
