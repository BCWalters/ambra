// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { FixedContentHost } from "./FixedContentHost.js";
import { FixedSpreadHost } from "./FixedSpreadHost.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("FixedSpreadHost child ownership", () => {
  const loader = {} as ContentLoader;
  const resolver = {} as ResourceUrlResolver;

  it.each(["left", "right"] as const)("reserves an unpaired %s slot without another frame or navigation item", async side => {
    vi.spyOn(FixedContentHost.prototype, "open").mockImplementation(async function (this: FixedContentHost) {
      Object.defineProperty(this.element, "contentDocument", {
        configurable: true, value: document.implementation.createHTMLDocument(side),
      });
    });
    vi.spyOn(FixedContentHost.prototype, "naturalSize", "get").mockReturnValue({ width: 900, height: 600 });
    const scale = vi.spyOn(FixedContentHost.prototype, "applyExternalScale").mockImplementation(() => {});
    const host = new FixedSpreadHost(1800, 900);
    await host.open(loader, resolver, { kind: "single", spineIndex: 4, side }, undefined);
    expect(scale).toHaveBeenLastCalledWith(1, 1800, 900);
    const frame = host.element.querySelector("iframe")!;
    expect(frame.style.left).toBe(side === "left" ? "0px" : "900px");
    expect(host.spineIndices).toEqual([4]);
    expect(host.documentViews().map(view => [view.spineIndex, view.physicalSide])).toEqual([[4, side]]);
    expect(host.element.querySelectorAll("iframe")).toHaveLength(1);
    host.setZoom(2);
    expect(scale).toHaveBeenLastCalledWith(2, 3600, 1200);
    expect(frame.style.left).toBe(side === "left" ? "0px" : "1800px");
    host.resize(900, 900);
    expect(host.zoom).toBe(2);
    expect(scale).toHaveBeenLastCalledWith(1, 1800, 900);
    expect(frame.style.left).toBe(side === "left" ? "0px" : "900px");
    host.dispose();
  });

  it.each([
    { width: 900, height: 900, rtl: false },
    { width: 2200, height: 900, rtl: false },
    { width: 900, height: 900, rtl: true },
    { width: 2200, height: 900, rtl: true },
  ])("shares the full available width without a gutter for unequal pages: %j", async ({ width, height, rtl }) => {
    vi.spyOn(FixedContentHost.prototype, "open").mockResolvedValue();
    vi.spyOn(FixedContentHost.prototype, "naturalSize", "get")
      .mockReturnValueOnce({ width: 400, height: 800 })
      .mockReturnValueOnce({ width: 600, height: 600 });
    const scale = vi.spyOn(FixedContentHost.prototype, "applyExternalScale").mockImplementation(() => {});
    const host = new FixedSpreadHost(width, height);
    await host.open(loader, resolver, {
      kind: "pair", leftSpineIndex: rtl ? 1 : 0, rightSpineIndex: rtl ? 0 : 1,
    }, undefined);
    const expectedScale = Math.min(width / 1000, height / 800);
    expect(scale.mock.calls).toEqual([
      [expectedScale, 400 * expectedScale, height],
      [expectedScale, 600 * expectedScale, height],
    ]);
    expect(host.element.firstElementChild?.children).toHaveLength(2);
    expect((host.element.firstElementChild as HTMLElement).style.flexDirection).toBe(rtl ? "row-reverse" : "row");
    expect(FixedSpreadHost.GUTTER_WIDTH).toBe(0);
    host.dispose();
  });

  it("magnifies both unequal pages with one scale, keeps iframe identity, and refits independently of user zoom", async () => {
    vi.spyOn(FixedContentHost.prototype, "open").mockResolvedValue();
    vi.spyOn(FixedContentHost.prototype, "naturalSize", "get")
      .mockReturnValueOnce({ width: 400, height: 800 }).mockReturnValueOnce({ width: 600, height: 600 });
    const scale = vi.spyOn(FixedContentHost.prototype, "applyExternalScale").mockImplementation(() => {});
    const host = new FixedSpreadHost(1000, 800);
    await host.open(loader, resolver, { kind: "pair", leftSpineIndex: 0, rightSpineIndex: 1 }, undefined);
    const frames = [...host.element.querySelectorAll("iframe")];
    host.setZoom(2);
    expect(scale.mock.calls.slice(-2)).toEqual([[2, 800, 1600], [2, 1200, 1600]]);
    host.resize(500, 400);
    expect(host.zoom).toBe(2);
    expect(scale.mock.calls.slice(-2)).toEqual([[1, 400, 800], [1, 600, 800]]);
    expect([...host.element.querySelectorAll("iframe")]).toEqual(frames);
    host.setZoom(1);
    expect(scale.mock.calls.slice(-2)).toEqual([[0.5, 200, 400], [0.5, 300, 400]]);
    for (const invalid of [0, -1, NaN, Infinity]) expect(() => host.setZoom(invalid)).toThrow(RangeError);
    host.setZoom(100);
    expect(host.zoom).toBe(FixedSpreadHost.MAX_ZOOM);
    host.dispose();
  });

  it.each(["ltr", "rtl"] as const)("keeps %s physical sides distinct from reading order and primary focus", async direction => {
    vi.spyOn(FixedContentHost.prototype, "open").mockImplementation(async function (this: FixedContentHost, _loader, _resolver, spineIndex) {
      const doc = document.implementation.createHTMLDocument(String(spineIndex));
      doc.title = String(spineIndex);
      Object.defineProperty(this.element, "contentDocument", { configurable: true, value: doc });
    });
    const host = new FixedSpreadHost(1400, 900);
    await host.open(loader, resolver, {
      kind: "pair",
      leftSpineIndex: direction === "rtl" ? 3 : 2,
      rightSpineIndex: direction === "rtl" ? 2 : 3,
    }, undefined);
    const views = host.documentViews();
    expect(views.map(view => [view.spineIndex, view.document.title, view.physicalSide])).toEqual([
      [2, "2", direction === "rtl" ? "right" : "left"],
      [3, "3", direction === "rtl" ? "left" : "right"],
    ]);
    expect(host.primaryContentDocument()).toBe(views[0]!.document);
    expect(host.currentPosition()?.node.ownerDocument).toBe(views[0]!.document);
    expect(host.contentDocuments().map(doc => doc.title)).toEqual(direction === "rtl" ? ["3", "2"] : ["2", "3"]);
    expect([...host.element.querySelectorAll("iframe")].map(frame => frame.contentDocument?.title)).toEqual(["2", "3"]);
    host.dispose();
  });

  it("disposes both old columns before opening a replacement single page", async () => {
    const open = vi.spyOn(FixedContentHost.prototype, "open").mockResolvedValue();
    const dispose = vi.spyOn(FixedContentHost.prototype, "dispose");
    const host = new FixedSpreadHost(1000, 900);
    document.createElement("div").append(host.element);
    await host.open(loader, resolver, { kind: "pair", leftSpineIndex: 0, rightSpineIndex: 1 }, undefined);
    const oldChildren = [...open.mock.contexts];
    open.mockImplementationOnce(async () => {
      expect(dispose.mock.contexts).toEqual(oldChildren);
    });

    await host.open(loader, resolver, { kind: "single", spineIndex: 2 }, undefined);
    expect(host.element.querySelectorAll("iframe")).toHaveLength(1);
    expect(host.spineIndices).toEqual([2]);
    host.dispose();
    host.dispose();
    expect(dispose).toHaveBeenCalledTimes(3);
    expect(host.contentDocuments()).toEqual([]);
    expect(host.spineIndices).toEqual([]);
    expect(host.element.parentNode).toBeNull();
  });

  it("disposes an old single before opening a replacement pair", async () => {
    const open = vi.spyOn(FixedContentHost.prototype, "open").mockResolvedValue();
    const dispose = vi.spyOn(FixedContentHost.prototype, "dispose");
    const host = new FixedSpreadHost(1000, 900);
    await host.open(loader, resolver, { kind: "single", spineIndex: 0 }, undefined);
    const oldChild = open.mock.contexts[0];

    await host.open(loader, resolver, { kind: "pair", leftSpineIndex: 1, rightSpineIndex: 2 }, undefined);
    expect(dispose.mock.contexts).toEqual([oldChild]);
    expect(host.element.querySelectorAll("iframe")).toHaveLength(2);
    host.dispose();
    expect(dispose).toHaveBeenCalledTimes(3);
  });

  it("propagates load failure and still disposes every owned child", async () => {
    const failure = new Error("Page load failed");
    vi.spyOn(FixedContentHost.prototype, "open").mockRejectedValueOnce(failure).mockResolvedValue();
    const dispose = vi.spyOn(FixedContentHost.prototype, "dispose");
    const host = new FixedSpreadHost(1000, 900);

    await expect(host.open(
      loader, resolver, { kind: "pair", leftSpineIndex: 0, rightSpineIndex: 1 }, undefined,
    )).rejects.toBe(failure);
    host.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
