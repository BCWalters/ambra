/** The two font obfuscation algorithms actually seen in real-world EPUBs
 * (identified by the `Algorithm` URI in `META-INF/encryption.xml`). Real
 * DRM-encrypted resources (e.g. Adobe ADEPT content encryption, Readium
 * LCP) use different algorithm URIs entirely and are out of scope — see
 * `FontDeobfuscator.isSupportedAlgorithm`. */
export const IDPF_FONT_OBFUSCATION_ALGORITHM_URI = "http://www.idpf.org/2008/embedding";
export const ADOBE_FONT_OBFUSCATION_ALGORITHM_URI = "http://ns.adobe.com/pdf/enc#RC";

const IDPF_OBFUSCATED_BYTE_COUNT = 1040;
const ADOBE_OBFUSCATED_BYTE_COUNT = 1024;

/** Thrown when asked to reverse an algorithm this engine doesn't
 * implement (i.e. not one of the two font obfuscation schemes above) —
 * most likely genuine DRM, which is explicitly out of scope for Wave 1
 * (see the project plan's phasing). */
export class UnsupportedEncryptionAlgorithmError extends Error {
  public constructor(algorithmUri: string) {
    super(
      `Unsupported encryption/obfuscation algorithm: ${algorithmUri}. This is likely DRM-protected ` +
        "content, which Ambra does not support (font de-obfuscation is the only reversible scheme handled).",
    );
    this.name = "UnsupportedEncryptionAlgorithmError";
  }
}

/**
 * Reverses EPUB font obfuscation — a light, non-cryptographic scrambling
 * of the first portion of an embedded font file's bytes, intended only to
 * discourage casually extracting a font for reuse elsewhere (not real
 * encryption/DRM). Two incompatible schemes are used in the wild and both
 * are supported here for real-world compatibility: the IDPF/W3C-specified
 * algorithm, and Adobe's earlier, differently-keyed scheme.
 */
export class FontDeobfuscator {
  public static isSupportedAlgorithm(algorithmUri: string): boolean {
    return (
      algorithmUri === IDPF_FONT_OBFUSCATION_ALGORITHM_URI ||
      algorithmUri === ADOBE_FONT_OBFUSCATION_ALGORITHM_URI
    );
  }

  /** De-obfuscates `bytes` (a whole font file's contents) given the
   * algorithm URI from `META-INF/encryption.xml` and the publication's
   * unique identifier (`PackageMetadata.identifier`). Throws
   * `UnsupportedEncryptionAlgorithmError` for any other algorithm URI. */
  public static async deobfuscate(
    bytes: Uint8Array,
    algorithmUri: string,
    uniqueIdentifier: string,
  ): Promise<Uint8Array> {
    if (algorithmUri === IDPF_FONT_OBFUSCATION_ALGORITHM_URI) {
      const key = await FontDeobfuscator.computeIdpfKey(uniqueIdentifier);
      return xorPrefix(bytes, key, IDPF_OBFUSCATED_BYTE_COUNT);
    }

    if (algorithmUri === ADOBE_FONT_OBFUSCATION_ALGORITHM_URI) {
      const key = FontDeobfuscator.computeAdobeKey(uniqueIdentifier);
      return xorPrefix(bytes, key, ADOBE_OBFUSCATED_BYTE_COUNT);
    }

    throw new UnsupportedEncryptionAlgorithmError(algorithmUri);
  }

  /** IDPF/W3C algorithm: the key is the 20-byte SHA-1 digest of the
   * publication's unique identifier, with all whitespace characters
   * removed, UTF-8 encoded. SHA-1 is used here purely as a
   * non-cryptographic bit-mixing step (per spec) — computed via the
   * native Web Crypto API rather than a hand-written implementation. */
  private static async computeIdpfKey(uniqueIdentifier: string): Promise<Uint8Array> {
    const normalized = uniqueIdentifier.replace(/\s+/g, "");
    const encoded = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest("SHA-1", encoded);
    return new Uint8Array(digest);
  }

  /** Adobe algorithm: the key is the publication's identifier interpreted
   * as a raw 16-byte UUID — no hashing. The identifier is expected in
   * `urn:uuid:########-####-####-####-############` form (an optional
   * `urn:uuid:` prefix, dashes, then 32 hex digits); the prefix and dashes
   * are stripped and the remaining hex string is parsed directly into
   * bytes. */
  private static computeAdobeKey(uniqueIdentifier: string): Uint8Array {
    const hex = uniqueIdentifier
      .trim()
      .replace(/^urn:uuid:/i, "")
      .replace(/-/g, "");

    if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
      throw new UnsupportedEncryptionAlgorithmError(
        `${ADOBE_FONT_OBFUSCATION_ALGORITHM_URI} (identifier "${uniqueIdentifier}" is not a UUID)`,
      );
    }

    const key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return key;
  }
}

/** XORs the first `min(prefixLength, bytes.length)` bytes of `bytes`
 * against `key`, cycling through `key` as needed, and returns a new
 * array — the shared core of both obfuscation schemes, which differ only
 * in key derivation and prefix length. XOR is a self-inverse operation,
 * so this same function both obfuscates and de-obfuscates. */
function xorPrefix(bytes: Uint8Array, key: Uint8Array, prefixLength: number): Uint8Array {
  const result = Uint8Array.from(bytes);
  const obfuscatedLength = Math.min(prefixLength, result.length);

  for (let i = 0; i < obfuscatedLength; i++) {
    result[i] = (result[i] as number) ^ (key[i % key.length] as number);
  }

  return result;
}
