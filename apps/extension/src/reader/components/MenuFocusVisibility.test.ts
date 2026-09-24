import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollMenuFocusIntoView } from "./MenuFocusVisibility.js";

const surfaces: HTMLElement[] = [];
afterEach(() => {
  for (const surface of surfaces) surface.remove();
  surfaces.length = 0;
  vi.restoreAllMocks();
});

describe("menu focus visibility", () => {
  function surface(itemY: number) {
    const popover = document.createElement("div");
    const item = document.createElement("button");
    popover.append(item);
    popover.style.border = "1px solid";
    document.body.append(popover);
    surfaces.push(popover);
    vi.spyOn(popover, "getBoundingClientRect").mockReturnValue(new DOMRect(2, 40, 280, 212.5));
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(new DOMRect(7, itemY, 270, 32));
    return { popover, item };
  }

  it("fully reveals the last item when a fractional viewport clips it inside the border", () => {
    const { popover, item } = surface(220);
    popover.scrollTop = 472;
    scrollMenuFocusIntoView(popover, item);
    expect(popover.scrollTop).toBe(474);
  });

  it("reveals a clipped first item without rounding away the missing fraction", () => {
    const { popover, item } = surface(40.5);
    popover.scrollTop = 40;
    scrollMenuFocusIntoView(popover, item);
    expect(popover.scrollTop).toBe(38);
  });

  it("does not scroll an already visible focused item", () => {
    const { popover, item } = surface(100);
    popover.scrollTop = 40;
    scrollMenuFocusIntoView(popover, item);
    expect(popover.scrollTop).toBe(40);
  });
});
