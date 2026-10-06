// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserResourceCapabilities } from "./ResourceCapabilities.js";

const capabilities = new BrowserResourceCapabilities();
const read = async () => new Uint8Array([1, 2, 3]);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native resource capability probes", () => {
  it.each(["image/avif", "image/jxl", "image/png", "image/svg+xml"])(
    "uses the image consumer decoder for %s and revokes its probe URL",
    async (type) => {
      const image = document.createElement("img");
      Object.defineProperty(image, "naturalWidth", { value: 80 });
      Object.defineProperty(image, "naturalHeight", { value: 60 });
      vi.stubGlobal(
        "Image",
        class {
          constructor() {
            return image;
          }
        },
      );
      const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:probe");
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const pending = capabilities.supports(type, "image", read, new AbortController().signal);
      await Promise.resolve();
      expect(image.src).toBe("blob:probe");
      image.dispatchEvent(new Event("load"));
      expect(await pending).toBe(true);
      expect(create.mock.calls[0]?.[0]).toMatchObject({ type });
      expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:probe");
      expect(image.hasAttribute("src")).toBe(false);
    },
  );

  it("treats decoder rejection as unsupported, not an unconditional JPEG XL pass", async () => {
    const image = document.createElement("img");
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          return image;
        }
      },
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const pending = capabilities.supports("image/jxl", "image", read, new AbortController().signal);
    await Promise.resolve();
    image.dispatchEvent(new Event("error"));
    expect(await pending).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it.each(["font/otf", "font/ttf", "font/woff", "font/woff2"])(
    "tests %s with FontFace without installing it into document fonts",
    async (type) => {
      const load = vi.fn(async () => ({}));
      const construct = vi.fn();
      vi.stubGlobal(
        "FontFace",
        class {
          constructor(family: string, bytes: ArrayBuffer) {
            construct(family, bytes);
          }
          load = load;
        },
      );
      const create = vi.spyOn(URL, "createObjectURL");
      expect(await capabilities.supports(type, "font", read, new AbortController().signal)).toBe(
        true,
      );
      expect(new Uint8Array(construct.mock.calls[0]![1])).toEqual(new Uint8Array([1, 2, 3]));
      expect(load).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="opus"', "video/mp4"])(
    "checks %s with the media consumer without playing audio",
    async (type) => {
      const media = document.createElement(type.startsWith("audio") ? "audio" : "video");
      const createElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag) =>
        tag === "audio" || tag === "video" ? media : createElement(tag),
      );
      const canPlay = vi.spyOn(media, "canPlayType").mockReturnValue("probably");
      const load = vi.spyOn(media, "load").mockImplementation(() => {});
      const play = vi.spyOn(media, "play");
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const pending = capabilities.supports(
        type,
        type.startsWith("audio") ? "audio" : "video",
        read,
        new AbortController().signal,
      );
      await Promise.resolve();
      media.dispatchEvent(new Event("loadeddata"));
      expect(await pending).toBe(true);
      expect(canPlay).toHaveBeenCalledExactlyOnceWith(type);
      expect(load).toHaveBeenCalledTimes(2);
      expect(play).not.toHaveBeenCalled();
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(media.hasAttribute("src")).toBe(false);
    },
  );

  it("does not expose document/plugin objects or read resources for incompatible consumers", async () => {
    const bytes = vi.fn(read);
    expect(
      await capabilities.supports(
        "application/xhtml+xml",
        "object",
        bytes,
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(
      await capabilities.supports("image/png", "audio", bytes, new AbortController().signal),
    ).toBe(false);
    expect(bytes).not.toHaveBeenCalled();
  });

  it("cancels a pending decoder and cleans up its URL and listeners", async () => {
    const image = document.createElement("img");
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          return image;
        }
      },
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const abort = new AbortController();
    const pending = capabilities.supports("image/avif", "image", read, abort.signal);
    await Promise.resolve();
    abort.abort(new Error("Cancelled"));
    await expect(pending).rejects.toThrow("Cancelled");
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
  });

  it("bounds decoder checks and diagnoses timeout before permitting fallback", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const image = document.createElement("img");
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          return image;
        }
      },
    );
    const pending = capabilities.supports(
      "image/avif",
      "image",
      read,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Timed out checking"));
  });
});
