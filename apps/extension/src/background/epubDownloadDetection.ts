/**
 * Fallback for an EPUB download that somehow still completed despite
 * `epubDirectImport.ts`'s proactive interception (issue #122's own
 * cancel-before-save path) — e.g. a download `chrome.downloads.cancel`
 * couldn't stop in time, or one whose URL/MIME didn't look like an
 * EPUB until later in the download than `onCreated` fires. Notices the
 * completed download and offers a one-click way to add it to the
 * library, rather than leaving it to sit in the Downloads folder as an
 * unrecognized binary the way it does with no handling at all.
 *
 * Finishing the import still goes through the library's own existing
 * file picker (`openLibraryTab`, not a direct fetch of the already-
 * downloaded local file) — reading a completed download's bytes back
 * off disk would need the user's own (off-by-default, manually
 * toggled) "Allow access to file URLs" setting, a separate permission
 * this extension doesn't ask for.
 */
import { openLibraryTab } from "../navigation.js";
import { isLikelyEpubDownload } from "./epubUrlHeuristic.js";

/** The basename only (no directory) — `DownloadItem.filename` is a full
 * local path, which would otherwise leak the reader's own local folder
 * structure into a notification's visible text for no reason. Handles
 * both `/`- and `\`-separated paths since a download's path uses the
 * host OS's own separator (this extension only ships for Chrome on
 * desktop, but that still means either macOS/Linux or Windows). */
function baseName(fullPath: string): string {
  const parts = fullPath.split(/[/\\]/);
  return parts[parts.length - 1] || fullPath;
}


const NOTIFICATION_ID_PREFIX = "ambra-epub-download-";

/** Wires up the whole feature — call once from the service worker's
 * top-level module scope (not inside a listener), matching how every
 * other `chrome.*` event subscription in this extension is registered. */
export function registerEpubDownloadDetection(): void {
  chrome.downloads.onChanged.addListener((delta) => {
    // Only the transition *into* "complete" matters — `onChanged` also
    // fires for every incremental progress update, which would otherwise
    // notify repeatedly (once per byte-progress tick) for the same
    // download.
    if (delta.state?.current !== "complete") {
      return;
    }
    chrome.downloads.search({ id: delta.id }, (items) => {
      if (chrome.runtime.lastError) return;
      const item = items[0];
      if (!item || item.state !== "complete" || !isLikelyEpubDownload(item)) {
        return;
      }
      chrome.notifications.create(`${NOTIFICATION_ID_PREFIX}${item.id}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Add this book to Ambra?",
        message: `"${baseName(item.filename)}" looks like an EPUB. Click here to open your library and add it.`,
        priority: 1,
      });
    });
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_ID_PREFIX)) {
      return;
    }
    chrome.notifications.clear(notificationId);
    // The user still finishes the import through the library's own
    // existing file picker (see this file's doc comment for why) — this
    // just gets them there in one click instead of having to find the
    // toolbar icon themselves right after downloading a book.
    void openLibraryTab();
  });
}
