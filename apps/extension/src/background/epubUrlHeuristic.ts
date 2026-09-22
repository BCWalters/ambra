/** Whether a download's own source URL/declared MIME type look like an
 * EPUB — shared by the proactive direct-import interception
 * (`epubDirectImport.ts`, issue #122) and the post-download fallback
 * notification (`epubDownloadDetection.ts`). Treats either the
 * declared MIME type or an ".epub" fragment anywhere in the URL's own
 * path/filename as sufficient (not requiring both): plenty of real-
 * world hosts serve `.epub` files as `application/octet-stream` or
 * omit the header entirely, and not every EPUB-serving URL ends in a
 * literal ".epub" suffix (Project Gutenberg's own direct download
 * links, for example, end in ".epub3.images"). `filename` is optional
 * because `chrome.downloads.onCreated` (used for proactive
 * interception, before Chrome has saved anything) may not have
 * determined one yet — `url` alone still catches the common case. */
export function isLikelyEpubDownload(item: {
  readonly url: string;
  readonly filename?: string;
  readonly mime?: string;
}): boolean {
  if (item.mime === "application/epub+zip") {
    return true;
  }
  if (item.filename && /\.epub$/i.test(item.filename)) {
    return true;
  }
  try {
    return /\.epub\d*(\.|$)/i.test(new URL(item.url).pathname);
  } catch {
    return false;
  }
}
