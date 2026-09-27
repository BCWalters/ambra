import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

function setup() {
  document.body.innerHTML = "<table><tbody><tr><td>Value</td></tr></tbody></table><button>Expand table</button>";
  const table = document.querySelector("table")!;
  const trigger = document.querySelector("button")!;
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    operations: { disposed: false }, isFixedLayoutHost: () => false,
    tableViewerFocusRevision: 0,
    allContentDocuments: () => [document], notify: vi.fn(),
    translate: () => "Table viewer", reportTransientError: vi.fn(),
    turnPage: vi.fn(), goToChapter: vi.fn(),
  });
  return { controller, table, trigger };
}

describe("reader table viewer ownership", () => {
  it("owns the modal synchronously, preserves reading navigation and restores the source control", async () => {
    const { controller, table, trigger } = setup();
    controller.openTableViewer(table, trigger);
    expect(controller.tableViewer.xhtml).toContain("<table>");
    controller.dispatchArrowNavigation(1);
    expect(controller.turnPage).not.toHaveBeenCalled();
    expect(controller.goToChapter).not.toHaveBeenCalled();
    const focus = vi.spyOn(trigger, "focus");
    controller.closeTableViewer();
    await Promise.resolve();
    expect(controller.tableViewer).toBeUndefined();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("closes before navigation and does not restore focus into a removed control", async () => {
    const { controller, table, trigger } = setup();
    const focus = vi.spyOn(trigger, "focus");
    controller.openTableViewer(table, trigger);
    await controller.openSpineItem(1);
    expect(controller.tableViewer).toBeUndefined();
    expect(focus).not.toHaveBeenCalled();
    controller.openTableViewer(table, trigger);
    trigger.remove();
    controller.closeTableViewer();
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
  });

  it("deliberately excludes fixed-layout pages and reports invalid sources", () => {
    const { controller, table, trigger } = setup();
    controller.isFixedLayoutHost = () => true;
    controller.openTableViewer(table, trigger);
    expect(controller.tableViewer).toBeUndefined();
    controller.isFixedLayoutHost = () => false;
    table.remove();
    controller.openTableViewer(table, trigger);
    expect(controller.reportTransientError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "The source table is no longer available." }), "open", "Table viewer");
  });

  it("cancels deferred source focus if navigation starts immediately after closing", async () => {
    const { controller, table, trigger } = setup();
    const focus = vi.spyOn(trigger, "focus");
    controller.openTableViewer(table, trigger);
    controller.closeTableViewer();
    await controller.openSpineItem(1);
    expect(focus).not.toHaveBeenCalled();
  });
});
