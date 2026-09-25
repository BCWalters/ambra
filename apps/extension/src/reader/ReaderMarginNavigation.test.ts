import { describe, expect, it, vi } from "vitest";
import { ReaderController } from "./ReaderController.js";
import { outerMarginSide } from "./PageMargins.js";
import { FixedSpreadHost } from "@ambra/engine";

function setup(rtl = false) {
  const controller = Object.create(ReaderController.prototype);
  Object.assign(controller, {
    pkg: { pageProgressionDirection: rtl ? "rtl" : "ltr" },
    marginSide: (_doc: Document, x: number) => outerMarginSide(x, [{ left: 40, right: 760 }]),
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
