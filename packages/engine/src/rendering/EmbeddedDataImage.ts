export const MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_EMBEDDED_IMAGE_TOTAL_BYTES = 32 * 1024 * 1024;

const IMAGE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "image/svg+xml", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon", "image/jxl",
]);

export class EmbeddedDataImageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EmbeddedDataImageError";
  }
}

function header(url: string): { type: string; base64: boolean; start: number } {
  const comma = url.indexOf(",");
  if (!/^data:/i.test(url) || comma < 0 || comma > 128 ||
    url.length - comma - 1 > MAX_EMBEDDED_IMAGE_BYTES * 3) {
    throw new EmbeddedDataImageError("Embedded image has an invalid or oversized data URL.");
  }
  const parts = url.slice(5, comma).split(";");
  const type = parts.shift()!.toLowerCase();
  if (!IMAGE_TYPES.has(type)) throw new EmbeddedDataImageError("Embedded data resource is not an allowed image type.");
  const base64 = parts.at(-1)?.toLowerCase() === "base64";
  if (base64) parts.pop();
  if (parts.some(part => !/^charset=[a-z0-9._-]+$/i.test(part))) {
    throw new EmbeddedDataImageError("Embedded image has unsupported data URL parameters.");
  }
  return { type, base64, start: comma + 1 };
}

export function embeddedDataImageType(url: string): string {
  return header(url).type;
}

function percentBytes(payload: string, limit: number): Uint8Array {
  const bytes = new Uint8Array(Math.min(payload.length * 3, limit + 1));
  let length = 0;
  const append = (byte: number): void => {
    if (length >= limit) throw new EmbeddedDataImageError("Embedded image exceeds the decoded payload limit.");
    bytes[length++] = byte;
  };
  const encoder = new TextEncoder();
  for (let index = 0; index < payload.length; index++) {
    if (payload[index] === "%") {
      const hex = payload.slice(index + 1, index + 3);
      if (!/^[a-f0-9]{2}$/i.test(hex)) throw new EmbeddedDataImageError("Embedded image has malformed percent encoding.");
      append(parseInt(hex, 16));
      index += 2;
    } else {
      const code = payload.codePointAt(index)!;
      if (code < 128) append(code);
      else {
        for (const byte of encoder.encode(String.fromCodePoint(code))) append(byte);
        if (code > 0xffff) index++;
      }
    }
  }
  return bytes.slice(0, length);
}

export function decodeEmbeddedDataImage(url: string): { mediaType: string; bytes: Uint8Array } {
  const { type, base64, start } = header(url);
  const payload = url.slice(start);
  if (!base64) return { mediaType: type, bytes: percentBytes(payload, MAX_EMBEDDED_IMAGE_BYTES) };
  const encoded = percentBytes(payload, Math.ceil(MAX_EMBEDDED_IMAGE_BYTES / 3) * 4);
  let text = "";
  for (let offset = 0; offset < encoded.length; offset += 8192) {
    text += String.fromCharCode(...encoded.subarray(offset, offset + 8192));
  }
  text = text.replace(/[\t\n\f\r ]/g, "");
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  if (!/^[a-z0-9+/]*={0,2}$/i.test(text) || text.length % 4 === 1 ||
    Math.floor(text.length * 3 / 4) - padding > MAX_EMBEDDED_IMAGE_BYTES) {
    throw new EmbeddedDataImageError("Embedded image has invalid or oversized base64 encoding.");
  }
  try {
    const binary = atob(text);
    return { mediaType: type, bytes: Uint8Array.from(binary, character => character.charCodeAt(0)) };
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "InvalidCharacterError") throw error;
    throw new EmbeddedDataImageError("Embedded image has malformed base64 encoding.");
  }
}
