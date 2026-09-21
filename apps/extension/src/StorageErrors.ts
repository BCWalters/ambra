/** A friendlier message for a failed storage write, specifically
 * detecting the one case worth calling out differently: the browser
 * refusing to write any more data because the device is actually low on
 * disk space (`DOMException` named `QuotaExceededError` — the one real,
 * if rare, storage-limit scenario `LibraryDatabase.estimateStorageUsage`'s
 * own doc comment describes: the manifest's `unlimitedStorage`
 * permission exempts this origin from Chrome's usual *quota*
 * enforcement, but obviously can't manufacture disk space that isn't
 * there). Every other failure (a corrupt/non-EPUB file, a parse error,
 * a plain bug, etc.) keeps its own original message unchanged — this
 * only adds context for the one case a reader could otherwise misread
 * as "this app is broken" when it's actually "your disk is full".
 *
 * `action`/`subject` fill in "Couldn't {action} {subject}" (e.g.
 * `"import", '"moby-dick.epub"'` or `"save", "that bookmark"`) — kept as
 * two separate parameters (rather than one pre-joined string) so every
 * caller's phrasing reads naturally without each needing to know the
 * exact sentence shape.
 *
 * Shared by the Library's import-failure surface (`useLibrary.ts`) and
 * the reader's bookmark/highlight-save failure surface
 * (`ReaderController.reportTransientError`) — both are, ultimately, the
 * same one underlying failure mode against the same `LibraryDatabase`. */
export function describeStorageError(err: unknown, action: string, subject: string): string {
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    return `Couldn't ${action} ${subject} — your device appears to be out of storage space. Free up some disk space and try again.`;
  }
  return err instanceof Error ? err.message : String(err);
}
