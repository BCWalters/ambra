import { describe, expect, it, vi } from "vitest";
import { frameContentBounds, outerMarginSide, reflowableContentBounds } from "./PageMargins.js";

describe("outer page margins", () => {
  it("excludes both content boundaries, content whitespace, and the entire gutter", () => {
    const pages = [{ left: 100, right: 600 }, { left: 800, right: 1300 }];
    for (const x of [100, 120, 600, 650, 700, 799, 800, 1100, 1300]) {
      expect(outerMarginSide(x, pages)).toBeUndefined();
    }
    expect(outerMarginSide(99, pages)).toBe(-1);
    expect(outerMarginSide(1301, pages)).toBe(1);
    expect(outerMarginSide(99, [...pages].reverse())).toBe(-1);
    expect(outerMarginSide(1301, [...pages].reverse())).toBe(1);
  });

  it("supports a single page and no rendered pages", () => {
    expect(outerMarginSide(20, [{ left: 30, right: 730 }])).toBe(-1);
    expect(outerMarginSide(740, [{ left: 30, right: 730 }])).toBe(1);
    expect(outerMarginSide(20, [])).toBeUndefined();
  });

  it("reads the actual body measure including reader padding, not text rectangles", () => {
    document.body.style.cssText = "padding: 0 27px; border: 2px solid black";
    vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue({
      left: 84, right: 696,
    } as DOMRect);
    expect(reflowableContentBounds(document)).toEqual({ left: 113, right: 667 });
    vi.restoreAllMocks();
    document.body.style.cssText = "";
  });

  it("maps local content bounds through rendered frame scaling and pane offsets", () => {
    const frame = document.createElement("iframe");
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      left: 720, right: 1320, width: 600,
    } as DOMRect);
    Object.defineProperty(frame, "clientWidth", { value: 1200 });
    expect(frameContentBounds(frame, { left: 40, right: 1160 })).toEqual({
      left: 740, right: 1300,
    });
    // Fixed-layout artwork owns the entire intrinsic viewport, including white areas.
    expect(frameContentBounds(frame)).toMatchObject({ left: 720, right: 1320 });
    vi.restoreAllMocks();
  });
});
