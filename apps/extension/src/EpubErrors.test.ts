import { describe, expect, it } from "vitest";
import { EpubContainerError, PackageDocumentError, ZipArchive, ZipFormatError, ZipIntegrityError } from "@ambra/engine";
import { isInvalidEpubError } from "./EpubErrors.js";

describe("invalid EPUB classification", () => {
  it.each([
    new ZipFormatError("Malformed ZIP"),
    new ZipIntegrityError("CRC mismatch"),
    new EpubContainerError("Missing container.xml"),
    new PackageDocumentError("Missing OPF metadata"),
  ])("recognizes $name", error => {
    expect(isInvalidEpubError(error)).toBe(true);
  });

  it("recognizes the real non-ZIP error", () => {
    expect.assertions(1);
    try {
      ZipArchive.open(new TextEncoder().encode("not an EPUB"));
    } catch (error) {
      expect(isInvalidEpubError(error)).toBe(true);
    }
  });

  it.each([
    new Error("Network failed"),
    new DOMException("Storage full", "QuotaExceededError"),
    new ZipFormatError("ZIP64 archives are not supported.", "unsupported"),
    new ZipFormatError("Unsupported compression method 99", "unsupported"),
    new Error("Not a valid ZIP archive: End of Central Directory record not found."),
    undefined,
  ])("does not mislabel unrelated failures: %s", error => {
    expect(isInvalidEpubError(error)).toBe(false);
  });
});
