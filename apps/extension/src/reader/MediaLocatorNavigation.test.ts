// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedLocator } from "@ambra/engine";
import { currentMediaCfi, prepareMediaPosition, spatialMediaPoint } from "./MediaLocatorNavigation.js";

function mediaPoint(node: Node, temporalOffsetSeconds = 3): ResolvedLocator {
  return { spineIndex: 0, node, characterOffset: undefined, mediaOffsets: { temporalOffsetSeconds } };
}

function audio(): HTMLAudioElement {
  const element = document.createElement("audio");
  document.body.append(element);
  Object.defineProperties(element, {
    duration: { configurable: true, value: 10 },
    readyState: { configurable: true, value: 3 },
  });
  return element;
}

beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("media locator transport", () => {
  it.each([true, false])("seeks without changing paused=%s intent or speed", async paused => {
    const element = audio();
    Object.defineProperty(element, "paused", { value: paused });
    element.playbackRate = 1.75;
    const play = vi.spyOn(element, "play").mockResolvedValue();
    const pause = vi.spyOn(element, "pause").mockImplementation(() => {});
    await prepareMediaPosition(mediaPoint(element), new AbortController().signal);
    expect(element.currentTime).toBe(3);
    expect(element.paused).toBe(paused);
    expect(element.playbackRate).toBe(1.75);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it("loads metadata for preload=none before assigning the time", async () => {
    const element = audio();
    element.preload = "none";
    Object.defineProperty(element, "readyState", { configurable: true, value: 0 });
    const load = vi.spyOn(element, "load").mockImplementation(() => {
      expect(element.currentTime).toBe(0);
      Object.defineProperty(element, "readyState", { value: 1 });
      element.dispatchEvent(new Event("loadedmetadata"));
    });
    await prepareMediaPosition(mediaPoint(element), new AbortController().signal);
    expect(load).toHaveBeenCalledOnce();
    expect(element.currentTime).toBe(3);
    expect(element.paused).toBe(true);
  });

  it("does not mutate a stale target when metadata arrives after cancellation", async () => {
    const element = audio();
    Object.defineProperty(element, "readyState", { configurable: true, value: 0 });
    vi.spyOn(element, "load").mockImplementation(() => {});
    const owner = new AbortController();
    const pending = prepareMediaPosition(mediaPoint(element), owner.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    owner.abort();
    await rejected;
    Object.defineProperty(element, "readyState", { value: 3 });
    element.dispatchEvent(new Event("loadedmetadata"));
    expect(element.currentTime).toBe(0);
  });

  it("reports a metadata timeout instead of claiming a successful element-only landing", async () => {
    vi.useFakeTimers();
    const element = audio();
    Object.defineProperty(element, "readyState", { value: 0 });
    vi.spyOn(element, "load").mockImplementation(() => {});
    const rejected = expect(prepareMediaPosition(mediaPoint(element), new AbortController().signal))
      .rejects.toThrow(/Timed out.*metadata/);
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(element.currentTime).toBe(0);
  });

  it("reports decode errors and out-of-duration positions", async () => {
    const element = audio();
    await expect(prepareMediaPosition(mediaPoint(element, 11), new AbortController().signal))
      .rejects.toThrow(/outside.*duration/);
    expect(element.currentTime).toBe(0);
    Object.defineProperty(element, "error", { value: { code: 4 } });
    await expect(prepareMediaPosition(mediaPoint(element), new AbortController().signal))
      .rejects.toThrow(/cannot be decoded/);
  });

  it("rejects a silently clamped media seek", async () => {
    const element = audio();
    Object.defineProperty(element, "currentTime", { get: () => 0, set: () => {} });
    await expect(prepareMediaPosition(mediaPoint(element), new AbortController().signal))
      .rejects.toThrow(/did not accept/);
  });

  it("saves the live time while retaining spatial coordinates and assertion parameters", () => {
    const element = document.createElement("video");
    element.currentTime = 4.25;
    expect(currentMediaCfi("epubcfi(/6/2!/4/2~3@25:75[;vendor=context])", element))
      .toBe("epubcfi(/6/2!/4/2~4.25@25:75[;vendor=context])");
    expect(currentMediaCfi("epubcfi(/6/2!/4/2@25:75)", element))
      .toBe("epubcfi(/6/2!/4/2@25:75)");
  });
});

describe("spatial media geometry", () => {
  function image(): HTMLImageElement {
    const element = document.createElement("img");
    element.style.cssText = "width:200px;height:100px;box-sizing:border-box;border:10px solid;padding:10px;object-fit:contain;object-position:25% 75%";
    document.body.append(element);
    Object.defineProperties(element, {
      naturalWidth: { value: 400 }, naturalHeight: { value: 100 },
    });
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 200, 100));
    return element;
  }

  it("maps intrinsic percentages through padding, borders, letterboxing and object-position", () => {
    expect(spatialMediaPoint(image(), { x: 25, y: 50 })).toEqual({ x: 70, y: 75 });
  });

  it("rejects points hidden by an authored cover crop", () => {
    const element = image();
    element.style.objectFit = "cover";
    element.style.objectPosition = "50% 50%";
    expect(() => spatialMediaPoint(element, { x: 0, y: 50 })).toThrow(/visible crop/);
  });

  it("does not fabricate a percentage from an unrendered image", () => {
    const element = image();
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect());
    expect(() => spatialMediaPoint(element, { x: 25, y: 50 })).toThrow(/visible dimensions/);
  });

  it("maps SVG viewBox coordinates through the actual screen transform", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.append(svg);
    Object.defineProperties(svg, {
      viewBox: { value: { baseVal: { x: 10, y: 20, width: 100, height: 200 } } },
      getScreenCTM: { value: () => ({ a: 2, b: 0, c: 0, d: 3, e: 5, f: 7 }) },
    });
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(25, 67, 200, 600));
    expect(spatialMediaPoint(svg, { x: 25, y: 75 })).toEqual({ x: 75, y: 517 });
  });
});
