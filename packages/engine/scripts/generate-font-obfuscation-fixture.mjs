#!/usr/bin/env node
// Generates the font-obfuscation-epub-src fixture's two "obfuscated" font
// files (one per algorithm) plus the shared plaintext they both decode to,
// using Node's native crypto.subtle (identical primitives to what the
// engine itself uses) so this is a faithful, independently-computed
// reference — not just the engine's own logic mirrored back at itself.
//
// Not part of the shipped extension: a dev-time fixture generator, run
// once and its output committed (like build-fixtures.sh, which packages
// these source files into the actual .epub test fixture afterward).

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = fileURLToPath(new URL("../test/fixtures", import.meta.url));
const FONT_DIR = fileURLToPath(
  new URL("../test/fixtures/font-obfuscation-epub-src/OEBPS/fonts", import.meta.url),
);

const UNIQUE_IDENTIFIER = "urn:uuid:12345678-1234-5678-1234-567812345678";
const PLAINTEXT_LENGTH = 2000; // > both 1040 (IDPF) and 1024 (Adobe) obfuscated-prefix lengths

function buildDeterministicPlaintext(length) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    // Simple deterministic, non-repeating-in-a-trivial-way byte sequence —
    // real font bytes are irrelevant here, only exact round-tripping matters.
    bytes[i] = (i * 37 + 11) % 256;
  }
  return bytes;
}

function xorPrefix(bytes, key, prefixLength) {
  const result = Uint8Array.from(bytes);
  const n = Math.min(prefixLength, result.length);
  for (let i = 0; i < n; i++) {
    result[i] ^= key[i % key.length];
  }
  return result;
}

async function computeIdpfKey(uniqueIdentifier) {
  const normalized = uniqueIdentifier.replace(/\s+/g, "");
  const encoded = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-1", encoded);
  return new Uint8Array(digest);
}

function computeAdobeKey(uniqueIdentifier) {
  const hex = uniqueIdentifier
    .trim()
    .replace(/^urn:uuid:/i, "")
    .replace(/-/g, "");
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    key[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return key;
}

async function main() {
  await mkdir(FONT_DIR, { recursive: true });

  const plaintext = buildDeterministicPlaintext(PLAINTEXT_LENGTH);
  await writeFile(`${FIXTURES_DIR}/font-obfuscation-plaintext.bin`, plaintext);

  const idpfKey = await computeIdpfKey(UNIQUE_IDENTIFIER);
  const idpfObfuscated = xorPrefix(plaintext, idpfKey, 1040);
  await writeFile(`${FONT_DIR}/idpf-obfuscated.otf`, idpfObfuscated);

  const adobeKey = computeAdobeKey(UNIQUE_IDENTIFIER);
  const adobeObfuscated = xorPrefix(plaintext, adobeKey, 1024);
  await writeFile(`${FONT_DIR}/adobe-obfuscated.otf`, adobeObfuscated);

  console.log(
    "Generated font-obfuscation-plaintext.bin, idpf-obfuscated.otf, adobe-obfuscated.otf",
  );
}

await main();
