import { findTextMatchesInDocument } from "@ambra/engine";

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
 * Matching and original-source offsets are shared with `BookSearch`,
 * including inline spans and the exclusion of non-content subtrees.
 */
export function findTextRangesInDocument(doc: Document, needle: string): Range[] {
  const ranges: Range[] = [];
  for (const match of findTextMatchesInDocument(doc, needle)) {
    const range = doc.createRange();
    range.setStart(match.start.node, match.start.offset);
    range.setEnd(match.end.node, match.end.offset);
    ranges.push(range);
  }
  return ranges;
}
