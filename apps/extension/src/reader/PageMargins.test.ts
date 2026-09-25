import { describe, expect, it, vi } from "vitest";
import { fixedLayoutEdgeSide, frameContentBounds, outerMarginSide, reflowableContentBounds } from "./PageMargins.js";

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

  describe("fixed-layout edge bands", () => {
    it("uses 8% of rendered page width and retains letterboxing", () => {
      const pages = [{ left: 50, right: 550 }];
      expect(fixedLayoutEdgeSide(49, pages)).toBe(-1);
      expect(fixedLayoutEdgeSide(89, pages)).toBe(-1);
      expect(fixedLayoutEdgeSide(90, pages)).toBeUndefined();
      expect(fixedLayoutEdgeSide(510, pages)).toBeUndefined();
      expect(fixedLayoutEdgeSide(511, pages)).toBe(1);
      expect(fixedLayoutEdgeSide(551, pages)).toBe(1);
    });

    it("caps each edge at 64 CSS pixels on wide pages", () => {
      const pages = [{ left: 0, right: 1600 }];
      expect(fixedLayoutEdgeSide(63, pages)).toBe(-1);
      expect(fixedLayoutEdgeSide(64, pages)).toBeUndefined();
      expect(fixedLayoutEdgeSide(1536, pages)).toBeUndefined();
      expect(fixedLayoutEdgeSide(1537, pages)).toBe(1);
    });

    it("excludes inner edges and gutters regardless of reading order", () => {
      const pages = [{ left: 100, right: 600 }, { left: 620, right: 1120 }];
      for (const ordered of [pages, [...pages].reverse()]) {
        expect(fixedLayoutEdgeSide(139, ordered)).toBe(-1);
        expect(fixedLayoutEdgeSide(1081, ordered)).toBe(1);
        for (const x of [140, 590, 600, 610, 620, 630, 1080]) {
          expect(fixedLayoutEdgeSide(x, ordered)).toBeUndefined();
        }
      }
      expect(fixedLayoutEdgeSide(0, [])).toBeUndefined();
    });
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
