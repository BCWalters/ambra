/**
 * Proactively intercepts an EPUB download the instant it begins (issue
 * #122) — before Chrome saves anything to disk — cancels it, and opens
 * the library with the original source URL so the library page itself
 * can fetch and import it directly, without ever landing in the
 * Downloads folder at all. Matches how established EPUB reader
 * extensions (e.g. EPUBReader) handle this: fetching an arbitrary
 * third-party URL from an extension context is subject to the same
 * host-permission gate as any other cross-origin request, so this
 * needs the broad `host_permissions` declared in `manifest.json` (a
 * deliberate, user-confirmed product decision — see this repository's
 * own history for the discussion — not something requested quietly).
 *
 * `chrome.downloads.onCreated` fires the moment Chrome commits to a
 * download, with the response's URL/MIME type already known — so
 * cancelling here loses at most a few already-buffered bytes, discarded
 * along with the rest of the (never actually saved) file. If
 * `chrome.downloads.cancel` doesn't win the race for some reason,
 * `epubDownloadDetection.ts`'s own post-download notification still
 * catches the completed download as a fallback — including the one
 * genuine race this can lose to: a *freshly (re)started* MV3 service
 * worker (right after a browser launch, or after this one goes idle and
 * Chrome wakes it back up for the very event that would register this
 * listener) can take a brief moment to finish evaluating its top-level
 * module code and attach `onCreated`'s listener at all, during which a
 * download that begins can slip through uncaught. Confirmed directly
 * while building this (a fresh profile's very first download sometimes
 * missed interception until the service worker had been alive for a
 * moment) — there's no reliable "the service worker is fully ready" event
 * to wait for from here, so rather than adding a synthetic delay that
 * would just move the same race to a different, arbitrary point in
 * time, this leans on the fallback notification already covering it
 * gracefully instead.
 */
import { openLibraryImportTab } from "../navigation.js";
import { isLikelyEpubDownload } from "./epubUrlHeuristic.js";

export function registerEpubDirectImport(): void {
  chrome.downloads.onCreated.addListener((item) => {
    if (!isLikelyEpubDownload(item)) {
      return;
    }
    chrome.downloads.cancel(item.id, () => {
      // Cancelling still leaves a "canceled" entry in the downloads
      // list/shelf — erase it so no partial/zero-byte file or history
      // entry lingers for something that was never really a download
      // from the reader's own point of view.
      chrome.downloads.erase({ id: item.id });
    });
    void openLibraryImportTab(item.url);
  });
}
