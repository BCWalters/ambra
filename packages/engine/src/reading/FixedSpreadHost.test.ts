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
