import { EpubContainerError, PackageDocumentError, ZipFormatError, ZipIntegrityError } from "@ambra/engine";

export function isInvalidEpubError(error: unknown): boolean {
  return (error instanceof ZipFormatError && error.reason === "invalid") || error instanceof ZipIntegrityError ||
    error instanceof EpubContainerError || error instanceof PackageDocumentError;
}
