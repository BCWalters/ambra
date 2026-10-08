import { describe, expect, it } from "vitest";
import { visiblePageBounds } from "./VisiblePageBounds.js";

describe("visiblePageBounds", () => {
  it.each([
    ["none", { top: 0, bottom: 600 }],
    ["inset(50px)", { top: 50, bottom: 550 }],
    ["inset(50px 0)", { top: 50, bottom: 550 }],
    ["inset(50px 0 200px)", { top: 50, bottom: 400 }],
    ["inset(50px 0 200px 0)", { top: 50, bottom: 400 }],
    ["inset(50px 0px 200px 0px)", { top: 50, bottom: 400 }],
  ])("preserves the actual paint interval for %s", (clip, expected) => {
    const frame = document.createElement("iframe");
    frame.style.clipPath = clip;
    document.body.append(frame);
    expect(visiblePageBounds(frame, 600)).toEqual(expected);
    frame.remove();
  });
});
