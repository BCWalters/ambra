import { describe, expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";
import { outerMarginSide } from "./PageMargins.js";
import { FixedSpreadHost, SpreadPaginatedHost } from "@ambra/engine";
import { ReaderOperations } from "./ReaderOperation.js";

function setup(rtl = false) {
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    pkg: { pageProgressionDirection: rtl ? "rtl" : "ltr" },
    marginSide: (_doc: Document, x: number, _y: number, parentX = x) =>
      outerMarginSide(parentX, [{ left: 40, right: 760 }]),
    turnPage: vi.fn(),
    highlightInteraction: {
      hasVisibleSelection: vi.fn(() => false),
      findHighlightAtPoint: vi.fn(() => undefined),
    },
  });
  const tap = (x: number, startX = x, target: Element = document.body, deltaY = 0) =>
    controller.handleContentClick(
      { clientX: x, clientY: 300 + deltaY, target }, startX, 300, document,
    );
  return { controller, tap };
}

describe("ReaderController margin taps", () => {
  it.each([false, true])("distinguishes paper motion from real swipes during a turn (RTL=%s)", rtl => {
    const { controller } = setup(rtl);
    Object.assign(controller, {
      turnMargins: {},
      operations: new ReaderOperations(),
      dismissUiForPointer: () => false,
      dismissContentSelection: () => false,
    });
    const cleanup = controller.setUpMarginClicks(document, document, true);
    const pointer = (type: string, clientX: number, screenX: number) =>
      new PointerEvent(type, {
        pointerId: 1, pointerType: "mouse", button: 0,
        clientX, clientY: 300, screenX, screenY: 400, bubbles: true,
      });
    try {
      for (const projectedX of [1100, 20]) {
        document.body.dispatchEvent(pointer("pointerdown", 780, 800));
        document.body.dispatchEvent(pointer("pointerup", projectedX, 800));
        expect(controller.turnPage.mock.calls).toEqual([[rtl ? -1 : 1]]);
        controller.turnPage.mockClear();
      }
      document.body.dispatchEvent(pointer("pointerdown", 780, 800));
      document.body.dispatchEvent(pointer("pointerup", 1100, 900));
      expect(controller.turnPage.mock.calls).toEqual([[rtl ? 1 : -1]]);
    } finally {
      cleanup();
      controller.gestureCleanup?.();
      controller.operations.dispose();
    }
  });

  it.each([false, true])("keeps settled spread margins throughout a turn and releases them afterward (RTL=%s)", async rtl => {
    const { controller, tap } = setup(rtl);
    delete controller.marginSide;
    const frames = [document.createElement("iframe"), document.createElement("iframe")];
    document.body.append(...frames);
    const host = Object.create(SpreadPaginatedHost.prototype);
    host.columnElement = (side: string) => frames[side === "left" ? 0 : 1];
    let projected = false;
    frames.forEach((frame, index) => {
      Object.defineProperty(frame, "clientWidth", { value: 700 });
      vi.spyOn(frame, "getBoundingClientRect").mockImplementation(() => {
        const left = projected ? 700 + index * 350 : index * 700;
        const width = projected ? 350 : 700;
        return { left, right: left + width, width } as DOMRect;
      });
      frame.contentDocument!.body.style.padding = "0 40px";
      vi.spyOn(frame.contentDocument!.body, "getBoundingClientRect")
        .mockReturnValue({ left: 0, right: 700 } as DOMRect);
    });
    let finish!: () => void;
    Object.assign(controller, {
      host,
      containerEl: document.createElement("div"),
      contentDocumentViews: () => frames.map(frame => ({ document: frame.contentDocument! })),
      operations: new ReaderOperations(),
      diagnostics: { record: vi.fn() },
      closeTableViewer: vi.fn(),
      clearNavigationHighlights: vi.fn(),
      applyPendingLayout: vi.fn(),
      turnPageInternal: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })),
      turnPage: ReaderController.prototype.turnPage,
    });
    const turns = vi.spyOn(controller, "turnPage");
    try {
      const pending = controller.turnPage(1);
      expect(controller.turnMargins).toBeDefined();
      projected = true;
      tap(700);
      expect(turns).toHaveBeenCalledTimes(1);
      expect(controller.queuedTurn).toBeUndefined();
      expect(controller.marginSide(document, 20, 300)).toBe(-1);
      expect(controller.marginSide(document, 1380, 300)).toBe(1);
      finish();
      await pending;
      expect(controller.turnMargins).toBeUndefined();
      expect(controller.marginSide(document, 700, 300)).toBe(-1);
      const cancelled = controller.turnPage(1);
      expect(controller.turnMargins).toBeDefined();
      controller.operations.dispose();
      expect(controller.turnMargins).toBeUndefined();
      finish();
      await cancelled;
    } finally {
      controller.operations.dispose();
      frames.forEach(frame => frame.remove());
      vi.restoreAllMocks();
    }
  });

  it.each([false, true])("maps physical outer edges into reading order (RTL=%s)", rtl => {
    const { controller, tap } = setup(rtl);
    tap(20);
    tap(780);
    expect(controller.turnPage.mock.calls).toEqual(rtl ? [[1], [-1]] : [[-1], [1]]);
  });

  it("does not scan selections or highlights for content taps", () => {
    const { controller, tap } = setup();
    for (const x of [40, 70, 350, 700, 760]) tap(x);
    expect(controller.turnPage).not.toHaveBeenCalled();
    expect(controller.highlightInteraction.findHighlightAtPoint).not.toHaveBeenCalled();
    expect(controller.highlightInteraction.hasVisibleSelection).not.toHaveBeenCalled();
  });

  it("requires the press and release to stay in the same margin, without dragging", () => {
    const { controller, tap } = setup();
    tap(762, 758);
    tap(758, 762);
    tap(780, 765);
    tap(780, 780, document.body, 11);
    expect(controller.turnPage).not.toHaveBeenCalled();
    tap(780, 775);
    expect(controller.turnPage).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each(["isTurningPage", "isLoadInFlight"])("forwards valid taps to the bounded turn queue during %s", flag => {
    const { controller, tap } = setup();
    controller[flag] = true;
    tap(780);
    expect(controller.turnPage).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("ignores taps while applying a new layout", () => {
    const { controller, tap } = setup();
    controller.isApplyingLayout = true;
    tap(780);
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it.each(["a", "summary", "img"])("preserves %s interaction even if it protrudes into a margin", tag => {
    const { controller, tap } = setup();
    const target = document.createElement(tag);
    if (tag === "a") target.setAttribute("href", "#chapter");
    tap(780, 780, target);
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it("allows fixed-layout raster artwork but not linked artwork", () => {
    const { controller, tap } = setup();
    controller.host = Object.create(FixedSpreadHost.prototype);
    const image = document.createElement("img");
    tap(780, 780, image);
    expect(controller.turnPage).toHaveBeenCalledExactlyOnceWith(1);
    controller.turnPage.mockClear();
    const link = document.createElement("a");
    link.setAttribute("href", "#target");
    link.append(image);
    tap(780, 780, image);
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it.each([
    '<button><span>Button</span></button>',
    '<label><input type="checkbox"/></label>',
    '<select><option>Choice</option></select>',
    '<textarea>Text</textarea>',
    '<video controls></video>',
    '<div role="slider"><span>Slider</span></div>',
    '<div contenteditable="true"><span>Editor</span></div>',
    '<svg><a href="#target"><rect/></a></svg>',
  ])("preserves interactive fixed-layout elements: %s", markup => {
    const { controller, tap } = setup();
    controller.host = Object.create(FixedSpreadHost.prototype);
    const container = document.createElement("div");
    container.innerHTML = markup;
    tap(780, 780, Array.from(container.querySelectorAll("*")).at(-1)!);
    expect(controller.turnPage).not.toHaveBeenCalled();
  });

  it("preserves visible selection and highlight interactions at the page edges", () => {
    const { controller, tap } = setup();
    controller.highlightInteraction.hasVisibleSelection.mockReturnValue(true);
    tap(780);
    expect(controller.turnPage).not.toHaveBeenCalled();
    controller.highlightInteraction.hasVisibleSelection.mockReturnValue(false);
    controller.highlightInteraction.findHighlightAtPoint.mockReturnValue({ id: "edge-highlight" });
    tap(780);
    expect(controller.turnPage).not.toHaveBeenCalled();
  });
});
