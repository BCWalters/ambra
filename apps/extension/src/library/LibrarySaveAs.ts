import type { Translate } from "../i18n/translate.js";
import type { LibraryDatabase } from "./LibraryDatabase.js";

function downloadFileName(fileName: string | undefined): string {
  // Chrome interprets slashes as directories and rejects reserved characters.
  return (fileName ?? "book.epub").replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    .replace(/^\.+/, "_").trim() || "book.epub";
}

function isPickerCancellation(message: string): boolean {
  return /^(?:user cancel(?:ed|led)(?: the download)?|download cancel(?:ed|led)|USER_CANCELED)\.?$/i.test(message);
}

/** Saves the original stored bytes, never the publication's network source. */
export async function saveLibraryBookAs(
  database: Pick<LibraryDatabase, "getBookMetadata" | "getBookFile">,
  bookId: string,
  t: Translate,
): Promise<void> {
  const [metadata, blob] = await Promise.all([
    database.getBookMetadata(bookId),
    database.getBookFile(bookId),
  ]);
  if (!metadata || !blob) throw new Error(t("library.fileMissing"));
  const url = URL.createObjectURL(blob);
  let terminalCleanup: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let downloadId: number | undefined;
      const earlyTerminals = new Map<number, chrome.downloads.DownloadDelta>();
      const settle = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.state?.current === "complete") resolve();
        if (delta.state?.current === "interrupted") {
          if (delta.error?.current === "USER_CANCELED") resolve();
          else reject(new Error(delta.error?.current ?? "Download interrupted"));
        }
      };
      const changed = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.state?.current !== "complete" && delta.state?.current !== "interrupted") return;
        if (downloadId === undefined) earlyTerminals.set(delta.id, delta);
        else if (delta.id === downloadId) settle(delta);
      };
      chrome.downloads.onChanged.addListener(changed);
      const cleanup = () => chrome.downloads.onChanged.removeListener(changed);
      terminalCleanup = cleanup;
      try {
        chrome.downloads.download({ url, filename: downloadFileName(metadata.fileName), saveAs: true }, (id) => {
          const error = chrome.runtime.lastError;
          if (error || id === undefined) {
            if (error?.message && isPickerCancellation(error.message)) resolve();
            else reject(new Error(error?.message ?? "Download could not be started"));
            return;
          }
          downloadId = id;
          const early = earlyTerminals.get(id);
          earlyTerminals.clear();
          if (early) settle(early);
        });
      } catch (error) {
        reject(error);
      }
    });
  } finally {
    // Keep the blob URL alive through the picker and until the browser finishes.
    terminalCleanup?.();
    URL.revokeObjectURL(url);
  }
}
