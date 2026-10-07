// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManifestItem, PackageDocument } from "../container/PackageDocument.js";
import type { ResourceCapabilities, ResourceConsumer } from "./ResourceCapabilities.js";
import {
  ResourceFallbackSelector,
  ResourceResolutionCancelledError,
  ResourceResolutionError,
  UnsupportedResourceError,
} from "./ResourceFallbackSelector.js";

function setup(
  items: readonly ManifestItem[],
  supports: ResourceCapabilities["supports"] = async (type) => type === "image/png",
) {
  const pkg = PackageDocument.parse(
    `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:fallback-selector</dc:identifier><dc:title>Fallback selection</dc:title><dc:language>en</dc:language></metadata>
    <manifest/><spine/></package>`,
    "package.opf",
  );
  vi.spyOn(pkg, "findManifestItemByPath").mockImplementation((path) =>
    items.find((item) => item.path === path),
  );
  vi.spyOn(pkg, "getManifestItem").mockImplementation((id) => items.find((item) => item.id === id));
  const read = vi.fn(async () => new Uint8Array([1]));
  const capability = vi.fn(supports);
  const selector = new ResourceFallbackSelector(pkg, read, { supports: capability });
  const notify = vi.fn();
  selector.onUnsupported(notify);
  return { selector, read, capability, notify };
}

const item = (id: string, type: string, fallback?: string) =>
  new ManifestItem(id, `${id}.bin`, type, new Set(), fallback);
afterEach(() => vi.restoreAllMocks());

describe("consumer-aware foreign-resource fallback selection", () => {
  it("skips policy-blocked manifest locations before probing or reading and selects their packaged fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = new ManifestItem("remote", "https://example.test/image.png", "image/png", new Set(), "local",
      undefined, { kind: "https", url: "https://example.test/image.png" });
    const fallback = item("local", "image/png");
    const { selector, capability, read, notify } = setup([original, fallback]);
    expect(await selector.select(original.path, "image")).toBe(fallback);
    expect(capability).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("https URL policy"));
    selector.dispose();
  });
  it("selects the first supported candidate in order and never inspects its unused broken tail", async () => {
    const original = item("foreign", "application/foreign", "unsupported");
    const unsupported = item("unsupported", "image/jxl", "supported");
    const supported = item("supported", "image/png", "missing");
    const { selector, capability, notify } = setup([original, unsupported, supported]);
    expect(await selector.select(original.path, "image")).toBe(supported);
    expect(capability.mock.calls.map((call) => call[0])).toEqual([
      "application/foreign",
      "image/jxl",
      "image/png",
    ]);
    expect(notify).not.toHaveBeenCalled();
    selector.dispose();
  });

  it("deduplicates concurrent probes and caches selection separately by consumer", async () => {
    const original = item("original", "image/png", "audio");
    const audio = item("audio", "audio/mp4");
    const { selector, capability } = setup([original, audio], async (type, consumer) =>
      consumer === "image" ? type === "image/png" : type === "audio/mp4",
    );
    expect(
      await Promise.all([
        selector.select(original.path, "image"),
        selector.select(original.path, "image"),
      ]),
    ).toEqual([original, original]);
    expect(await selector.select(original.path, "image")).toBe(original);
    expect(capability).toHaveBeenCalledTimes(1);
    expect(await selector.select(original.path, "audio")).toBe(audio);
    selector.dispose();
  });

  it.each(["image", "font", "audio", "video", "object", "stylesheet"] satisfies ResourceConsumer[])(
    "passes the %s consumer and selected candidate byte reader to capabilities",
    async (consumer) => {
      const original = item("original", "application/foreign", "fallback");
      const fallback = item("fallback", "image/png");
      const { selector, read } = setup([original, fallback], async (type, context, bytes) => {
        expect(context).toBe(consumer);
        if (type !== "image/png") return false;
        expect(await bytes()).toEqual(new Uint8Array([1]));
        return true;
      });
      expect(await selector.select(original.path, consumer)).toBe(fallback);
      expect(read).toHaveBeenCalledExactlyOnceWith(fallback.path);
      selector.dispose();
    },
  );

  it.each([
    { items: [item("a", "application/foreign")], reason: "exhausted", chain: ["a"] },
    {
      items: [item("a", "application/foreign", "missing")],
      reason: "missing-target",
      chain: ["a", "missing"],
    },
    {
      items: [item("a", "application/foreign", "b"), item("b", "application/foreign", "a")],
      reason: "cycle",
      chain: ["a", "b", "a"],
    },
  ])(
    "reports $reason precisely, without hanging or suppressing unrelated requests",
    async ({ items, reason, chain }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const supported = item("supported", "image/png");
      const { selector, notify } = setup([...items, supported]);
      await expect(selector.select("a.bin", "image")).rejects.toMatchObject({ reason, chain });
      await expect(selector.select("a.bin", "image")).rejects.toBeInstanceOf(
        UnsupportedResourceError,
      );
      expect(notify).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(await selector.select(supported.path, "image")).toBe(supported);
      selector.dispose();
    },
  );

  it("preserves missing direct resource and unexpected decoder errors, and permits a retry", async () => {
    const original = item("original", "image/png");
    const { selector, capability, notify } = setup([original]);
    await expect(selector.select("missing.bin", "image")).rejects.toBeInstanceOf(
      ResourceResolutionError,
    );
    capability.mockRejectedValueOnce(new Error("Unexpected decoder failure"));
    await expect(selector.select(original.path, "image")).rejects.toThrow(
      "Unexpected decoder failure",
    );
    expect(notify).not.toHaveBeenCalled();
    expect(await selector.select(original.path, "image")).toBe(original);
    selector.dispose();
  });

  it("immediately rejects pending and future callers on disposal even if a byte read ignores cancellation", async () => {
    let complete!: (supported: boolean) => void;
    const { selector } = setup(
      [item("a", "image/png")],
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const first = selector.select("a.bin", "image");
    const second = selector.select("a.bin", "image");
    const settled = Promise.allSettled([first, second]);
    selector.dispose();
    for (const result of await settled) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toBeInstanceOf(ResourceResolutionCancelledError);
    }
    complete(true);
    await expect(selector.select("a.bin", "image")).rejects.toBeInstanceOf(
      ResourceResolutionCancelledError,
    );
  });
});
