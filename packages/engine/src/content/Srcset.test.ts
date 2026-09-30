import { describe, expect, it, vi } from "vitest";
import { srcsetUrlRanges } from "./Srcset.js";

function urls(input: string): string[] {
  return srcsetUrlRanges(input).map(({ start, end }) => input.slice(start, end));
}

describe("srcset URL ranges", () => {
  it.each([
    ["", []],
    [", , \t\n", []],
    ["one.png", ["one.png"]],
    ["one.png 1x, two.png 2x", ["one.png", "two.png"]],
    ["small.png 320w,\nlarge.png 1280w", ["small.png", "large.png"]],
    ["a.png, b.png, c.png,,,", ["a.png", "b.png", "c.png"]],
    ["a,b.png 1x, second.png 2x", ["a,b.png", "second.png"]],
    ["data:image/png;base64,AAAA 1x, local.png 2x", ["data:image/png;base64,AAAA", "local.png"]],
    ["data:image/png;base64,AAAA, local.png 2x", ["data:image/png;base64,AAAA", "local.png"]],
    ["a.png .5x,\tb.png 1e0x,\fc.png 2E+0x", ["a.png", "b.png", "c.png"]],
    ["a.png 000320w 00240h, b.png 240h 320w", ["a.png", "b.png"]],
    ["zero.png 0x, negative-zero.png -0x", ["zero.png", "negative-zero.png"]],
    ["a.png,b.png", ["a.png,b.png"]],
    ["a.png\u00a0b.png 1x", ["a.png\u00a0b.png"]],
  ])("preserves URL boundaries in %j", (input, expected) => {
    expect(urls(input)).toEqual(expected);
  });

  it.each([
    "0w", "-1w", "1.5w", "1x 2x", "1w 2w", "1h 2h", "1h", "1w 2x",
    "1x 2h", "2h 1x", "-1x", "+1x", "1.x", "NaNx", "Infinityx",
    "1q", "1w 0h", "calc(1, 2)", "1x (bad, descriptor)",
  ])("leaves invalid %s candidates for browser rejection rather than resource loading", descriptor => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(urls(`invalid.png ${descriptor}, valid.png 2x`)).toEqual(["valid.png"]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not discover false candidates inside an unclosed descriptor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(urls("first.png 1x, invalid.png (unfinished, hidden.png 2x")).toEqual(["first.png"]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
