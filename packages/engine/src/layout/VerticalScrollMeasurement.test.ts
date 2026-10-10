// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { measureVerticalScrollChunks } from "./VerticalScrollMeasurement.js";
import { ScrollViewEngine } from "./ScrollViewEngine.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  (document.scrollingElement ?? document.documentElement).scrollLeft = 0;
});

describe("native vertical columns", () => {
  it.each(["vertical-rl", "vertical-lr"])("measures UTF-16 boundaries and restores %s horizontal offsets", mode => {
    const text = document.createTextNode("abcdef");
    document.body.append(text);
    const rightToLeft = mode === "vertical-rl";
    Object.defineProperties(document.documentElement, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 300 },
    });
    const root = document.scrollingElement ?? document.documentElement;
    root.scrollLeft = 0;
    const nativeRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = nativeRange();
      const columns = [new DOMRect(rightToLeft ? 80 : 0, 0, 20, 90), new DOMRect(rightToLeft ? -20 : 100, 0, 20, 90)];
      Object.defineProperties(range, {
        getClientRects: { value: () => columns },
        getBoundingClientRect: { value: () => columns[Math.floor(range.startOffset / 3)] },
      });
      return range;
    });
    const style = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(element => new Proxy(style(element), {
      get: (target, property) => property === "writingMode" ? mode : Reflect.get(target, property, target),
    }));
    const chunks = measureVerticalScrollChunks(document.body, rightToLeft);
    expect(chunks.map(chunk => [chunk.top, chunk.bottom, chunk.breakBefore.offset])).toEqual([[0, 20, 0], [100, 120, 3]]);
    const engine = ScrollViewEngine.prepare(document.body);
    expect(engine.isAtStart).toBe(true);
    engine.restorePosition(text, 4);
    expect(root.scrollLeft).toBe(rightToLeft ? -100 : 100);
    expect(engine.currentPosition()).toEqual({ node: text, offset: 3 });
    expect(engine.isAtStart).toBe(false);
    expect(engine.isAtEnd).toBe(false);
    root.scrollLeft = rightToLeft ? -200 : 200;
    expect(engine.isAtEnd).toBe(true);
  });

  it("tracks atomic images and excludes ruby annotation text", () => {
    document.body.innerHTML = '<ruby><rt>annotation</rt></ruby><img id="image"/>';
    const image = document.getElementById("image")!;
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(200, 10, 40, 40));
    expect(measureVerticalScrollChunks(document.body, false)).toEqual([
      { top: 200, bottom: 240, breakBefore: { node: image } },
    ]);
  });
});
