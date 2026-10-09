import { describe, expect, it } from "vitest";
import {
  decodeEmbeddedDataImage, EmbeddedDataImageError, MAX_EMBEDDED_IMAGE_BYTES,
} from "./EmbeddedDataImage.js";

describe("bounded embedded data images", () => {
  it("decodes base64, percent-escaped base64 and binary percent bytes without treating plus as a space", () => {
    expect(decodeEmbeddedDataImage("data:image/png;base64,/wAB").bytes).toEqual(new Uint8Array([255, 0, 1]));
    expect(decodeEmbeddedDataImage("DATA:image/PNG;BASE64,%2FwAB").bytes).toEqual(new Uint8Array([255, 0, 1]));
    expect(decodeEmbeddedDataImage("data:image/png,%FF%00%01+").bytes).toEqual(new Uint8Array([255, 0, 1, 43]));
  });

  it("preserves SVG UTF-8 and charset parameters", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>caf\u00e9 \ud83d\ude00</text></svg>';
    const result = decodeEmbeddedDataImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    expect(result.mediaType).toBe("image/svg+xml");
    expect(new TextDecoder().decode(result.bytes)).toBe(svg);
    expect(decodeEmbeddedDataImage(`data:image/svg+xml,${svg}`).bytes).toEqual(result.bytes);
  });

  it.each([
    "data:text/html,%3Cscript%3E",
    "data:application/xhtml+xml,%3Chtml%2F%3E",
    "data:text/css,p%7Bcolor:red%7D",
    "data:font/woff2;base64,YQ==",
    "data:image/png,%ZZ",
    "data:image/png;base64,A===",
    "data:image/png;base64,Y",
    "data:image/png;base64,%FF",
    "data:image/png;unknown=parameter,YQ==",
    "data:image/png;base64",
  ])("rejects unsafe or malformed input without exposing the payload: %s", url => {
    expect(() => decodeEmbeddedDataImage(url)).toThrow(EmbeddedDataImageError);
  });

  it("accepts the exact decoded bound and rejects one extra byte for both encodings", () => {
    const payload = "x".repeat(MAX_EMBEDDED_IMAGE_BYTES);
    expect(decodeEmbeddedDataImage(`data:image/png,${payload}`).bytes.byteLength).toBe(MAX_EMBEDDED_IMAGE_BYTES);
    expect(() => decodeEmbeddedDataImage(`data:image/png,${payload}x`)).toThrow("decoded payload limit");
    const base64 = btoa(payload);
    expect(decodeEmbeddedDataImage(`data:image/png;base64,${base64}`).bytes.byteLength).toBe(MAX_EMBEDDED_IMAGE_BYTES);
    expect(() => decodeEmbeddedDataImage(`data:image/png;base64,${btoa(payload + "x")}`)).toThrow("oversized base64");
  });
});
