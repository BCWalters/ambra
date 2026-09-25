import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLibraryCover, LIBRARY_COVER_HEIGHT, LIBRARY_COVER_WIDTH } from "./LibraryCover.js";

describe("createLibraryCover", () => {
  const image = {
    naturalWidth: 1600, naturalHeight: 2400, src: "",
    decode: vi.fn(), removeAttribute: vi.fn(),
  };
  let canvases: HTMLCanvasElement[];
  const drawImage = vi.fn();
  const encoded = new Blob(["thumbnail"], { type: "image/jpeg" });

  beforeEach(() => {
    image.naturalWidth = 1600;
    image.naturalHeight = 2400;
    image.decode.mockReset().mockResolvedValue(undefined);
    image.removeAttribute.mockReset();
    drawImage.mockClear();
    canvases = [];
    vi.stubGlobal("Image", class { constructor() { return image; } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:source");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this);
      return { drawImage } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(encoded));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("bounds both raster dimensions without changing aspect ratio and frees decode resources", async () => {
    expect(await createLibraryCover(new Blob(["large"], { type: "image/jpeg" }))).toBe(encoded);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 400, LIBRARY_COVER_HEIGHT);
    expect(canvases[0]!.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.85);
    expect(canvases[0]!.width).toBe(0);
    expect(canvases[0]!.height).toBe(0);
    expect(image.removeAttribute).toHaveBeenCalledWith("src");
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:source");
  });

  it("bounds wide covers and never upscales smaller covers", async () => {
    image.naturalWidth = 2400;
    image.naturalHeight = 1200;
    await createLibraryCover(new Blob(["wide"], { type: "image/jpeg" }));
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, LIBRARY_COVER_WIDTH, 210);
    image.naturalWidth = 140;
    image.naturalHeight = 200;
    const small = new Blob(["small"], { type: "image/jpeg" });
    expect(await createLibraryCover(small)).toBe(small);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it.each(["image/gif", "image/webp", "application/octet-stream"])(
    "preserves %s without flattening animation, vectors, or unknown image formats",
    async (type) => {
      const original = new Blob(["unchanged"], { type });
      expect(await createLibraryCover(original)).toBe(original);
      expect(image.decode).not.toHaveBeenCalled();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );

  it("resizes still PNG covers without losing transparency", async () => {
    const bytes = new Uint8Array(16);
    // The browser decoder validates image bytes; this test exercises the
    // chunk scanner's static decision without needing a PNG encoder.
    bytes.set([0x49, 0x44, 0x41, 0x54], 12);
    await createLibraryCover(new Blob([bytes], { type: "image/png" }));
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 400, 600);
    expect(canvases[0]!.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", 0.85);
  });

  it("preserves APNG animation rather than encoding only the first frame", async () => {
    const bytes = new Uint8Array(41);
    const header = new DataView(bytes.buffer);
    header.setUint32(8, 13);
    header.setUint32(12, 0x49484452); // IHDR
    header.setUint32(37, 0x6163544c); // acTL
    const original = new Blob([bytes], { type: "image/png" });
    expect(await createLibraryCover(original)).toBe(original);
    expect(image.decode).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rasterizes viewBox-only SVGs to card size with alpha-preserving PNG", async () => {
    image.naturalWidth = 100;
    image.naturalHeight = 150;
    await createLibraryCover(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 2100"/>'], { type: "image/svg+xml" }));
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 400, 600);
    expect(canvases[0]!.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", 0.85);
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="x"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@keyframes cover {}</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/gif;base64,R0lGODlh"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="relative.jpg"/></svg>',
  ])("preserves animated SVG without flattening it", async (text) => {
    const original = new Blob([text], { type: "image/svg+xml" });
    expect(await createLibraryCover(original)).toBe(original);
    expect(image.decode).not.toHaveBeenCalled();
  });

  it("reports decode failures and selects the accessible title fallback", async () => {
    image.decode.mockRejectedValue(new Error("Corrupt JPEG"));
    expect(await createLibraryCover(new Blob(["bad"], { type: "image/jpeg" }))).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("book title"), expect.any(Error));
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("reports encoding failures and releases canvas storage", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null));
    expect(await createLibraryCover(new Blob(["cover"], { type: "image/jpeg" }))).toBeUndefined();
    expect(console.warn).toHaveBeenCalledOnce();
    expect(canvases[0]!.width).toBe(0);
    expect(canvases[0]!.height).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
});
