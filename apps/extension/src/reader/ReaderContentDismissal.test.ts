import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedSpreadHost, PaginatedContentHost, SpreadPaginatedHost } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";
import { DiagnosticsLog } from "./DiagnosticsLog.js";

type Mode = "single" | "spread" | "fixed";
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function setUp(mode: Mode, commonFirst = true) {
  const container = document.createElement("div");
  const frame = document.createElement("iframe");
  container.append(frame);
  document.body.append(container);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = "<p>Book text</p><a href='#chapter'>Link</a><details><summary>More</summary></details>";
  const host = Object.create(mode === "single" ? PaginatedContentHost.prototype
    : mode === "spread" ? SpreadPaginatedHost.prototype : FixedSpreadHost.prototype);
  Object.defineProperty(host, "element", { value: mode === "single" ? frame : container });
  const views = [{ document: doc, spineIndex: 0, physicalSide: "right" }];
  const controller = Object.create(ReaderController.prototype);
  const operation = { own: vi.fn(), check: vi.fn() };
  Object.assign(controller, {
    diagnostics: new DiagnosticsLog(),
    host,
    containerEl: container,
    width: 900,
    height: 700,
    operations: { disposed: false, begin: vi.fn(() => operation), owns: () => true },
    pkg: { spine: [{ manifestItem: { path: "book.xhtml" } }], pageProgressionDirection: "ltr" },
    contentPointerActivityId: 0,
    contentDocumentViews: () => views,
    allContentDocuments: () => [doc],
    primaryContentDocument: () => doc,
    setUpContentBoundaries: vi.fn(),
    nativeReading: { attach: () => () => {} },
    narration: { snapshot: { available: false } },
    highlightInteraction: {
      findHighlightAtPoint: vi.fn(),
      dismissSelectionToolbar: vi.fn(),
      hasVisibleSelection: vi.fn((doc: Document) => doc.getSelection()?.isCollapsed === false),
    },
    notify: vi.fn(),
    turnPage: vi.fn(),
    suspendNarrationFollowing: vi.fn(),
    prepareIncomingPage: vi.fn(async () => undefined),
    settleDragPageTurn: vi.fn(async () => {}),
    finishTurn: vi.fn(),
  });
  if (commonFirst) controller.setUpContentInteraction();
  controller.setUpDragPageTurn();
  if (!commonFirst) controller.setUpContentInteraction();
  cleanups.push(() => {
    controller.gestureCleanup?.();
    controller.contentInteractionCleanup?.();
    controller.dragCleanup?.();
    container.remove();
  });
  return { controller, container, doc };
}

function pointer(target: EventTarget, type: string, x: number, pointerType = "mouse", id = 1, y = 300) {
  const event = new PointerEvent(type, {
    clientX: x, clientY: y, pointerType, pointerId: id, bubbles: true, button: 0,
  });
  target.dispatchEvent(event);
  return event;
}

function tap(target: EventTarget, x: number, pointerType = "mouse") {
  pointer(target, "pointerdown", x, pointerType);
  pointer(target, "pointerup", x, pointerType);
}

describe("content clicks dismiss chrome before navigating", () => {
  it.each([
    ["single", false], ["single", true],
    ["spread", false], ["spread", true],
    ["fixed", false], ["fixed", true],
  ] as const)("%s container=%s consumes the first tap but not the next", (mode, inContainer) => {
    const { controller, container, doc } = setUp(mode);
    let visible = true;
    const dismiss = vi.fn(() => {
      const dismissed = visible;
      visible = false;
      return dismissed;
    });
    controller.setContentUiDismissal(dismiss);
    const target = inContainer ? container : doc.body;
    const x = mode === "spread" && !inContainer ? 400 : 850;
    tap(target, x);
    expect(controller.turnPage).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);
    tap(target, x, "touch");
    expect(controller.turnPage).toHaveBeenCalledExactlyOnceWith(1);
    expect(dismiss).toHaveBeenCalledTimes(2);
    visible = true;
    tap(target, x);
    expect(controller.turnPage).toHaveBeenCalledTimes(1);
  });

  it.each(["single", "spread", "fixed"] as const)("deduplicates %s pointerdown regardless of listener order", mode => {
    const { controller, doc } = setUp(mode, false);
    controller.setContentUiDismissal(vi.fn().mockReturnValueOnce(true).mockReturnValue(false));
    tap(doc.body, mode === "spread" ? 400 : 850);
    expect(controller.dismissReaderUi).toHaveBeenCalledTimes(1);
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it.each(["single", "spread", "fixed"] as const)("preserves %s behavior without a UI handler or with held chrome", mode => {
    const { controller, doc } = setUp(mode);
    const x = mode === "spread" ? 400 : 850;
    tap(doc.body, x);
    controller.setContentUiDismissal(() => false);
    tap(doc.body, x);
    expect(controller.turnPage).toHaveBeenCalledTimes(2);
  });

  it.each(["single", "spread", "fixed"] as const)("keeps the %s dismissal snapshot across listener rebuilding", mode => {
    const { controller, doc } = setUp(mode);
    const x = mode === "spread" ? 400 : 850;
    controller.setContentUiDismissal(() => true);
    pointer(doc.body, "pointerdown", x);
    controller.setContentUiDismissal(() => false);
    controller.setUpDragPageTurn();
    pointer(doc.body, "pointerup", x);
    expect(controller.turnPage).not.toHaveBeenCalled();
    tap(doc.body, x);
    expect(controller.turnPage).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("allows a spread swipe even when its pointerdown dismissed chrome", () => {
    const { controller, doc } = setUp("spread");
    controller.setContentUiDismissal(() => true);
    pointer(doc.body, "pointerdown", 400, "touch");
    pointer(doc.body, "pointerup", 200, "touch");
    expect(controller.turnPage).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("allows a single-page drag even when its pointerdown dismissed chrome", async () => {
    const { controller, doc } = setUp("single");
    controller.setContentUiDismissal(() => true);
    pointer(doc.body, "pointerdown", 850, "touch");
    pointer(doc.body, "pointermove", 400, "touch");
    pointer(doc.body, "pointerup", 400, "touch");
    await Promise.resolve();
    expect(controller.prepareIncomingPage).toHaveBeenCalledOnce();
    expect(controller.settleDragPageTurn).toHaveBeenCalledWith(
      controller.host, undefined, 1, 0.5, expect.anything(), undefined, undefined, undefined,
    );
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it.each(["single", "spread", "fixed"] as const)("preserves %s link, disclosure, selection, and highlight guards", mode => {
    const { controller, doc } = setUp(mode);
    controller.setContentUiDismissal(() => false);
    const x = mode === "spread" ? 400 : 850;
    tap(doc.querySelector("a")!, x);
    tap(doc.querySelector("summary")!, x);
    vi.spyOn(doc, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
    tap(doc.body, x);
    expect(controller.highlightInteraction.dismissSelectionToolbar).toHaveBeenCalledOnce();
    vi.mocked(doc.getSelection).mockReturnValue(null);
    controller.highlightInteraction.findHighlightAtPoint.mockReturnValue({ id: "highlight" });
    tap(doc.body, x);
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it("retains RTL navigation after consuming a fixed-layout tap", () => {
    const { controller, doc } = setUp("fixed");
    controller.pkg.pageProgressionDirection = "rtl";
    controller.setUpDragPageTurn();
    controller.setContentUiDismissal(vi.fn().mockReturnValueOnce(true).mockReturnValue(false));
    tap(doc.body, 850);
    expect(controller.turnPage).not.toHaveBeenCalled();
    tap(doc.body, 850);
    expect(controller.turnPage).toHaveBeenCalledExactlyOnceWith(-1);
  });

  it.each(["single", "spread"] as const)(
    "%s ignores retained off-page selection before and during a margin tap",
    mode => {
      const { controller, doc } = setUp(mode);
      const x = mode === "spread" ? 400 : 850;
      const selection = { isCollapsed: false, removeAllRanges: vi.fn() } as unknown as Selection;
      const getSelection = vi.spyOn(doc, "getSelection").mockReturnValue(selection);
      controller.highlightInteraction.hasVisibleSelection.mockReturnValue(false);
      tap(doc.body, x);
      expect(controller.turnPage).toHaveBeenCalledExactlyOnceWith(1);
      expect(controller.highlightInteraction.dismissSelectionToolbar).not.toHaveBeenCalled();
      expect(selection.removeAllRanges).not.toHaveBeenCalled();

      getSelection.mockReturnValue(null);
      pointer(doc.body, "pointerdown", x);
      getSelection.mockReturnValue(selection);
      pointer(doc.body, "pointerup", x, "mouse", 1, 308);
      expect(controller.turnPage).toHaveBeenCalledTimes(2);

      controller.setContentUiDismissal(() => true);
      tap(doc.body, x);
      expect(controller.turnPage).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["single", "spread", "fixed"] as const)(
    "%s preserves a visible selection created during a tap",
    mode => {
      const { controller, doc } = setUp(mode);
      const x = mode === "spread" ? 400 : 850;
      pointer(doc.body, "pointerdown", x);
      vi.spyOn(doc, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
      pointer(doc.body, "pointerup", x);
      expect(controller.turnPage).not.toHaveBeenCalled();
      expect(controller.highlightInteraction.dismissSelectionToolbar).not.toHaveBeenCalled();
    },
  );

  it("does not cancel native book control activation or image zoom while dismissing chrome", () => {
    const { controller, doc } = setUp("single");
    controller.setContentUiDismissal(() => true);
    const button = doc.createElement("button");
    const activate = vi.fn();
    button.addEventListener("click", activate);
    doc.body.append(button);
    const down = pointer(button, "pointerdown", 850);
    const up = pointer(button, "pointerup", 850);
    button.click();
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
    expect(activate).toHaveBeenCalledOnce();
    const image = doc.createElement("img");
    image.src = "https://example.invalid/image.png";
    image.alt = "Book illustration";
    doc.body.append(image);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 500, 500));
    controller.openImageViewer = vi.fn();
    tap(image, 850);
    image.click();
    expect(controller.openImageViewer).toHaveBeenCalledWith(image.src, image.alt, image);
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it("does not consume secondary mouse buttons, cancellation, or another pointer's release", () => {
    const { controller, doc } = setUp("spread");
    const dismiss = vi.fn(() => true);
    controller.setContentUiDismissal(dismiss);
    doc.body.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", button: 2, bubbles: true }));
    expect(dismiss).not.toHaveBeenCalled();
    pointer(doc.body, "pointerdown", 400);
    pointer(doc.body, "pointerup", 400, "mouse", 2);
    expect(controller.gestureCleanup).toBeTypeOf("function");
    pointer(doc.body, "pointercancel", 400);
    expect(controller.gestureCleanup).toBeUndefined();
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it("does not navigate after disposal or retain a callback after it is cleared", () => {
    const { controller, doc } = setUp("spread");
    const dismiss = vi.fn(() => false);
    controller.setContentUiDismissal(dismiss);
    pointer(doc.body, "pointerdown", 400);
    controller.operations.disposed = true;
    pointer(doc.body, "pointerup", 400);
    expect(controller.turnPage).not.toHaveBeenCalled();
    controller.setContentUiDismissal(undefined);
    expect(controller.dismissUiForPointer(new PointerEvent("pointerdown"))).toBe(false);
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
