/**
 * Notices when the browser downloads a `.epub` file anywhere on the web and
 * offers a one-click way to add it to the library — the "EPUB mimetype
 * handling" a reader like this should have, rather than leaving a
 * downloaded book to sit in the Downloads folder as an unrecognized binary
 * the way it does with no handling at all.
 *
 * Deliberately scoped to *detection + a prompt*, not a fully silent
 * one-click import: reading a just-downloaded file's actual bytes back
 * into the extension would need either the user's own (off-by-default,
 * per-extension, manually-toggled) "Allow access to file URLs" setting, or
 * broad `host_permissions` letting the extension `fetch()` arbitrary sites
 * directly (bypassing this entirely by intercepting the *link click*
 * before Chrome ever downloads it) — both are real, separate product/
 * permission-scope decisions (the latter especially: it's a
 * "read/change all your data on every site you visit" -grade permission,
 * with real Chrome Web Store review and user-trust implications) rather
 * than something to reach for silently. This first version only needs the
 * plain `downloads`/`notifications` permissions, asks for nothing new the
 * user wouldn't expect a download-aware extension to have, and still
 * removes the single biggest bit of friction: *noticing* a book was just
 * downloaded at all. Finishing the import still goes through the
 * library's own existing (already fully-trusted, user-gesture-driven)
 * file picker.
 */
import { openLibraryTab } from "../navigation.js";

/** Chrome's own `DownloadItem.mime` is populated from the server's
 * `Content-Type` response header when present — a genuine EPUB server
 * usually gets this right, but plenty of real-world hosts (a plain static
 * file server, a misconfigured CMS) serve `.epub` files as
 * `application/octet-stream` or omit the header entirely. Treating either
 * the declared mime type *or* the filename extension as sufficient (rather
 * than requiring both) means a correctly-configured server's download is
 * recognized just as reliably as a sloppy one's. */
function isLikelyEpubDownload(item: Pick<chrome.downloads.DownloadItem, "filename" | "mime">): boolean {
  return item.mime === "application/epub+zip" || /\.epub$/i.test(item.filename);
}

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
      const item = items[0];
      if (!item || !isLikelyEpubDownload(item)) {
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
