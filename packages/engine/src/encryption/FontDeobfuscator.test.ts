import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADOBE_FONT_OBFUSCATION_ALGORITHM_URI,
  FontDeobfuscator,
  IDPF_FONT_OBFUSCATION_ALGORITHM_URI,
  UnsupportedEncryptionAlgorithmError,
} from "./FontDeobfuscator.js";

const UNIQUE_IDENTIFIER = "urn:uuid:12345678-1234-5678-1234-567812345678";

async function loadFixtureBytes(name: string): Promise<Uint8Array> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

describe("FontDeobfuscator", () => {
  it("isSupportedAlgorithm recognizes both known algorithm URIs and rejects others", () => {
    expect(FontDeobfuscator.isSupportedAlgorithm(IDPF_FONT_OBFUSCATION_ALGORITHM_URI)).toBe(true);
    expect(FontDeobfuscator.isSupportedAlgorithm(ADOBE_FONT_OBFUSCATION_ALGORITHM_URI)).toBe(true);
    expect(FontDeobfuscator.isSupportedAlgorithm("http://example.com/some-drm-scheme")).toBe(false);
  });

  it("de-obfuscates a real IDPF-obfuscated font fixture back to the exact original plaintext", async () => {
    const obfuscated = await loadFixtureBytes(
      "font-obfuscation-epub-src/OEBPS/fonts/idpf-obfuscated.otf",
    );
    const plaintext = await loadFixtureBytes("font-obfuscation-plaintext.bin");

    const result = await FontDeobfuscator.deobfuscate(
      obfuscated,
      IDPF_FONT_OBFUSCATION_ALGORITHM_URI,
      UNIQUE_IDENTIFIER,
    );

    expect(result).toEqual(plaintext);
  });

  it("de-obfuscates a real Adobe-obfuscated font fixture back to the exact original plaintext", async () => {
    const obfuscated = await loadFixtureBytes(
      "font-obfuscation-epub-src/OEBPS/fonts/adobe-obfuscated.otf",
    );
    const plaintext = await loadFixtureBytes("font-obfuscation-plaintext.bin");

    const result = await FontDeobfuscator.deobfuscate(
      obfuscated,
      ADOBE_FONT_OBFUSCATION_ALGORITHM_URI,
      UNIQUE_IDENTIFIER,
    );

    expect(result).toEqual(plaintext);
  });

  it("leaves bytes beyond the algorithm's obfuscated prefix length untouched", async () => {
    // Sanity check on the fixture itself: since only a bounded prefix is
    // ever obfuscated, the obfuscated file's tail should already be
    // byte-identical to the plaintext even without de-obfuscating.
    const obfuscated = await loadFixtureBytes(
      "font-obfuscation-epub-src/OEBPS/fonts/idpf-obfuscated.otf",
    );
    const plaintext = await loadFixtureBytes("font-obfuscation-plaintext.bin");

    expect(obfuscated.slice(1040)).toEqual(plaintext.slice(1040));
    // And the prefix must actually differ (i.e. the fixture really is
    // obfuscated, not accidentally identical to plaintext).
    expect(obfuscated.slice(0, 1040)).not.toEqual(plaintext.slice(0, 1040));
  });

  it("throws UnsupportedEncryptionAlgorithmError for an unrecognized algorithm URI", async () => {
    const bytes = new Uint8Array(10);

    await expect(
      FontDeobfuscator.deobfuscate(bytes, "http://example.com/some-drm-scheme", UNIQUE_IDENTIFIER),
    ).rejects.toThrow(UnsupportedEncryptionAlgorithmError);
  });

  it("throws when the Adobe algorithm is requested with a non-UUID identifier", async () => {
    const bytes = new Uint8Array(10);

    await expect(
      FontDeobfuscator.deobfuscate(bytes, ADOBE_FONT_OBFUSCATION_ALGORITHM_URI, "not-a-uuid"),
    ).rejects.toThrow(UnsupportedEncryptionAlgorithmError);
  });

  it("IDPF algorithm strips whitespace from the identifier before hashing, per spec", async () => {
    const obfuscated = await loadFixtureBytes(
      "font-obfuscation-epub-src/OEBPS/fonts/idpf-obfuscated.otf",
    );
    const plaintext = await loadFixtureBytes("font-obfuscation-plaintext.bin");

    // Whitespace inserted around/within the identifier must not change the
    // derived key (the spec requires stripping whitespace first).
    const identifierWithWhitespace = "  urn:uuid:12345678-1234-5678-1234-567812345678  ";

    const result = await FontDeobfuscator.deobfuscate(
      obfuscated,
      IDPF_FONT_OBFUSCATION_ALGORITHM_URI,
      identifierWithWhitespace,
    );

    expect(result).toEqual(plaintext);
  });

  it("does not mutate the input bytes", async () => {
    const obfuscated = await loadFixtureBytes(
      "font-obfuscation-epub-src/OEBPS/fonts/idpf-obfuscated.otf",
    );
    const originalCopy = Uint8Array.from(obfuscated);

    await FontDeobfuscator.deobfuscate(
      obfuscated,
      IDPF_FONT_OBFUSCATION_ALGORITHM_URI,
      UNIQUE_IDENTIFIER,
    );

    expect(obfuscated).toEqual(originalCopy);
  });
});
