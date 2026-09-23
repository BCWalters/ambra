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
