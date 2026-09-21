/**
 * Finds every case-insensitive occurrence of `needle` in `doc` and
 * returns each as a live `Range` — the on-screen counterpart to the
 * engine's own `BookSearch` (which walks a *not-necessarily-rendered*
 * document loaded via `ContentLoader` and produces CFIs, since results
 * must survive long after that document is gone). This instead operates
 * directly on a document already mounted in a content host, so it can
 * hand back real `Range`s with no CFI round-trip a document already in
 * hand doesn't need — used by `ReaderController.applySearchHighlightToCurrentHost`
 * (issue #100) to paint every match currently visible on screen via the
 * CSS Custom Highlight API, the same mechanism `HighlightRenderer`
 * already uses for reader-authored highlights.
 *
 * Deliberately the same simple per-text-node substring scan
 * `BookSearch.searchDocument` uses (not, say, a single "flatten the
 * whole document to one string and re-map offsets back to nodes"
 * pass) — a match can't span two text nodes either way, so nothing here
 * needs to detect one, and this stays a direct line-for-line match with
 * the engine's own already-tested walk.
 */
export function findTextRangesInDocument(doc: Document, needle: string): Range[] {
  const root = doc.body ?? doc.documentElement;
  if (!root || needle.length === 0) {
    return [];
  }
  const lowerNeedle = needle.toLowerCase();
  const ranges: Range[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    const lowerText = text.toLowerCase();
    let fromIndex = 0;
    let matchIndex = lowerText.indexOf(lowerNeedle, fromIndex);
    while (matchIndex !== -1) {
      const range = doc.createRange();
      range.setStart(node, matchIndex);
      range.setEnd(node, matchIndex + needle.length);
      ranges.push(range);
      fromIndex = matchIndex + needle.length;
      matchIndex = lowerText.indexOf(lowerNeedle, fromIndex);
    }
    node = walker.nextNode();
  }
  return ranges;
}
