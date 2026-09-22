/**
 * Extension background service worker: minimal lifecycle glue. Opens the
 * full-tab reader page and hosts any future context-menu / file-association
 * entry points for `.epub` files.
 */

export { openReaderTab } from "../navigation.js";
import { registerEpubDownloadDetection } from "./epubDownloadDetection.js";
import { registerEpubDirectImport } from "./epubDirectImport.js";

registerEpubDirectImport();
registerEpubDownloadDetection();

chrome.runtime.onInstalled.addListener(() => {
  // Nothing to initialize on install — `LibraryDatabase` creates its
  // IndexedDB object stores lazily on first open (see its
  // `onupgradeneeded` handler), so there's no separate schema-init step
  // needed here.
});
