// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PaginatedContentHost, ScrollContentHost, SpreadPaginatedHost } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";

function fixture() {
  const host = Object.create(SpreadPaginatedHost.prototype);
  host.relayoutForResize = vi.fn(() => true);
  const anchor = { node: document.createTextNode("Native reading anchor"), offset: 3, spineIndex: 0 };
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    host, width: 1400, height: 900, appliedWidth: 1400, appliedHeight: 900,
    viewMode: "paginated", fontScale: 1, fontFamily: "palatino",
    lineSpacing: 1, letterSpacing: 0, contentWidthEm: 34, alwaysShowOnePage: false,
    operations: { disposed: false }, nativeReading: { current: () => anchor, retainedForShell: () => anchor, retain: vi.fn() },
    shouldSwitchSpreadMode: vi.fn(() => false), reopenForCurrentSize: vi.fn(async () => {}),
    setUpDragPageTurn: vi.fn(), refreshBookPagination: vi.fn(),
    highlightInteraction: { updateNoteMarkers: vi.fn() },
    diagnostics: { record: vi.fn() }, notify: vi.fn(),
    library: { patchBookReadingSettings: vi.fn(async () => {}) }, saveProgress: vi.fn(async () => {}),
  });
  return { controller, host, anchor };
}

describe("spread resize ownership", () => {
  it("reflows in place with the native anchor and refreshes captured tap geometry", async () => {
    const { controller, host, anchor } = fixture();
    await controller.applyLayout({ configuration: { ...controller.currentLayout(), width: 1300, height: 950 } });
    expect(host.relayoutForResize).toHaveBeenCalledWith(1300, 950, anchor);
    expect(controller.reopenForCurrentSize).not.toHaveBeenCalled();
    expect(controller.host).toBe(host);
    expect(controller.appliedWidth).toBe(1300);
    expect(controller.appliedHeight).toBe(950);
    expect(controller.setUpDragPageTurn).toHaveBeenCalledOnce();
    expect(controller.nativeReading.retain).toHaveBeenCalledWith(anchor);
    expect(controller.refreshBookPagination).toHaveBeenCalledOnce();
    expect(controller.highlightInteraction.updateNoteMarkers).toHaveBeenCalledOnce();
  });

  it("uses the owned reopen path when reflow changes the required chapter pair", async () => {
    const { controller, host } = fixture();
    host.relayoutForResize.mockReturnValue(false);
    await controller.applyLayout({ configuration: { ...controller.currentLayout(), width: 1300 } });
    expect(controller.reopenForCurrentSize).toHaveBeenCalledOnce();
    expect(controller.setUpDragPageTurn).not.toHaveBeenCalled();
  });

  it("does not use same-host reflow when crossing the spread threshold", async () => {
    const { controller, host } = fixture();
    controller.shouldSwitchSpreadMode.mockReturnValue(true);
    await controller.applyLayout({ configuration: { ...controller.currentLayout(), width: 800 } });
    expect(host.relayoutForResize).not.toHaveBeenCalled();
    expect(controller.reopenForCurrentSize).toHaveBeenCalledOnce();
  });

  it("leaves typography rebuilds under their existing owner", async () => {
    const { controller, host } = fixture();
    await controller.applyLayout({ configuration: { ...controller.currentLayout(), fontScale: 1.2 } });
    expect(host.relayoutForResize).not.toHaveBeenCalled();
    expect(controller.reopenForCurrentSize).toHaveBeenCalledOnce();
  });

  it("keeps disclosure rebuilds on canonical pages while carrying summary focus", async () => {
    const { controller, host } = fixture();
    const disclosureFocus = { spineIndex: 0, ordinal: 1 };
    await controller.applyLayout({
      configuration: controller.currentLayout(), reflow: true, disclosureFocus,
    });
    expect(host.relayoutForResize).not.toHaveBeenCalled();
    expect(controller.reopenForCurrentSize).toHaveBeenCalledWith(disclosureFocus, true);
  });

  it("does no work for unchanged dimensions", async () => {
    const { controller, host } = fixture();
    await controller.applyLayout({ configuration: controller.currentLayout() });
    expect(host.relayoutForResize).not.toHaveBeenCalled();
    expect(controller.reopenForCurrentSize).not.toHaveBeenCalled();
  });

  it("queues one-page changes through layout ownership and saves them as book settings", async () => {
    const { controller } = fixture();
    controller.shouldSwitchSpreadMode.mockReturnValue(true);
    await controller.applyLayout({
      configuration: { ...controller.currentLayout(), alwaysShowOnePage: true },
    });
    expect(controller.reopenForCurrentSize).toHaveBeenCalledOnce();
    expect(controller.library.patchBookReadingSettings).toHaveBeenCalledWith(undefined, { alwaysShowOnePage: true });
    expect(controller.saveProgress).toHaveBeenCalledOnce();
    expect(controller.currentLayout().alwaysShowOnePage).toBe(true);
  });

  it("keeps the centered scroll host when the saved one-page preference changes", async () => {
    const { controller } = fixture();
    const host = Object.create(ScrollContentHost.prototype);
    host.resize = vi.fn();
    Object.assign(controller, { host, viewMode: "scroll" });
    await controller.applyLayout({
      configuration: { ...controller.currentLayout(), alwaysShowOnePage: true },
    });
    expect(controller.reopenForCurrentSize).not.toHaveBeenCalled();
    expect(controller.library.patchBookReadingSettings).toHaveBeenCalledWith(undefined, { alwaysShowOnePage: true });
  });
});

it("one-page display gates every reflowable spread decision, not fixed-layout planning", () => {
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    alwaysShowOnePage: true, viewMode: "paginated", host: Object.create(PaginatedContentHost.prototype),
    containerEl: document.createElement("div"), width: 2400,
    pkg: { metadata: {}, spine: [{ resolveRenditionLayout: () => "reflowable" }] },
  });
  expect(controller.useReflowableSpread(2400)).toBe(false);
  expect(controller.shouldSwitchSpreadMode(2400)).toBe(false);
  expect(controller.canMergeSpreadIntoNext(0)).toBe(false);
  controller.alwaysShowOnePage = false;
  expect(controller.useReflowableSpread(2400)).toBe(true);
  expect(controller.shouldSwitchSpreadMode(2400)).toBe(true);
  expect(controller.canMergeSpreadIntoNext(0)).toBe(true);
  expect(controller.useReflowableSpread(600)).toBe(false);
});
