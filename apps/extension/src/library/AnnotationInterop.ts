import {
  EpubCfi,
  EpubCfiParseError,
  Locator,
  LocatorResolver,
  PackageDocument,
  EPUB_CFI_CONFORMS_TO,
} from "@ambra/engine";
import type { EpubAnnotation, FragmentSelector, AnnotationMotivation } from "@ambra/engine";
import type { LibraryDatabase, Bookmark, Highlight } from "./LibraryDatabase.js";

/** Both of this reader's own annotation kinds, side by side, purely so
 * `buildAnnotationCollection` can take one flat list from its caller
 * instead of two separate parameters in a fixed order. */
export interface UserAnnotations {
  highlights: readonly Highlight[];
  bookmarks: readonly Bookmark[];
}

/** Classifies a read-only, publisher-embedded annotation (issue #109)
 * as either a "highlight" (merged into the Highlights tab) or
 * "bookmark" (merged into the Bookmarks tab) — see issue #116, which
 * removed the dedicated "Notes" tab these used to get a whole tab of
 * their own for what's usually zero or one item. Trusts the
 * annotation's own `motivation` when present (per spec,
 * "highlighting"/"commenting" are both a highlight — a plain one and
 * one that also carries a note, respectively); without one, falls back
 * to whether the resolved selector spans a range (a highlight) or a
 * single point (a bookmark). */
export function classifyReadOnlyAnnotationKind(
  motivation: AnnotationMotivation | undefined,
  isRange: boolean,
): "highlight" | "bookmark" {
  if (motivation === "bookmarking") {
    return "bookmark";
  }
  if (motivation === "highlighting" || motivation === "commenting") {
    return "highlight";
  }
  return isRange ? "highlight" : "bookmark";
}

/** The `Creator` this reader stamps onto every annotation it exports —
 * a software agent, not a person, since there's no reader account/name
 * to attribute it to. */
function ambraCreator(): EpubAnnotation["creator"] {
  return { id: "https://github.com/BCWalters/ambra", type: "Software", name: "Ambra" };
}

/** Resolves a spine index to the `target.source` this reader writes for
 * every annotation: the manifest item's own archive-relative path,
 * consistent with how `PackageDocument.findManifestItemByPath` already
 * looks resources up elsewhere in this app. */
function sourceForSpineIndex(pkg: PackageDocument, spineIndex: number): string | undefined {
  return pkg.spine[spineIndex]?.manifestItem.path;
}

/** Builds an EPUB Annotations 1.0 collection (issue #107) from this
 * book's current highlights and bookmarks — the reader's own export
 * format, always written as a plain array (see
 * `serializeAnnotationCollection`). A highlight's two point CFIs are
 * joined into one canonical range CFI (`EpubCfi.joinRange`) since that's
 * the form other reading systems actually expect a text selection to
 * take; a bookmark is a single-point `FragmentSelector` with no note
 * body. Any highlight/bookmark whose CFI happens to be unparseable
 * (stale/corrupted, same defensive stance as every other CFI-resolving
 * call site in this app) is skipped rather than aborting the whole
 * export. */
export function buildAnnotationCollection(
  pkg: PackageDocument,
  { highlights, bookmarks }: UserAnnotations,
): EpubAnnotation[] {
  const annotations: EpubAnnotation[] = [];

  for (const highlight of highlights) {
    const source = sourceForSpineIndex(pkg, highlight.spineIndex);
    if (!source) {
      continue;
    }
    let rangeCfi: string;
    try {
      rangeCfi = EpubCfi.joinRange(
        EpubCfi.parse(highlight.startCfi),
        EpubCfi.parse(highlight.endCfi),
      );
    } catch (err) {
      if (err instanceof EpubCfiParseError) {
        continue;
      }
      throw err;
    }
    const selector: FragmentSelector = {
      type: "FragmentSelector",
      value: rangeCfi,
      conformsTo: EPUB_CFI_CONFORMS_TO,
    };
    annotations.push({
      id: `urn:uuid:${highlight.id}`,
      type: "Annotation",
      motivation: highlight.note ? "commenting" : "highlighting",
      created: new Date(highlight.createdAt).toISOString(),
      creator: ambraCreator(),
      target: { source, selector: [selector] },
      body: highlight.note
        ? { type: "TextualBody", format: "text/plain", value: highlight.note }
        : undefined,
    });
  }

  for (const bookmark of bookmarks) {
    let cfi: EpubCfi;
    try {
      cfi = EpubCfi.parse(bookmark.cfi);
    } catch (err) {
      if (err instanceof EpubCfiParseError) {
        continue;
      }
      throw err;
    }
    const spineIndex = pkg.findSpineIndexByPackageCfiSteps(cfi.packageSteps);
    const source = spineIndex !== undefined ? sourceForSpineIndex(pkg, spineIndex) : undefined;
    if (!source) {
      continue;
    }
    const selector: FragmentSelector = {
      type: "FragmentSelector",
      value: bookmark.cfi,
      conformsTo: EPUB_CFI_CONFORMS_TO,
    };
    annotations.push({
      id: `urn:uuid:${bookmark.id}`,
      type: "Annotation",
      motivation: "bookmarking",
      created: new Date(bookmark.createdAt).toISOString(),
      creator: ambraCreator(),
      target: { source, selector: [selector] },
      body: bookmark.label
        ? { type: "TextualBody", format: "text/plain", value: bookmark.label }
        : undefined,
    });
  }

  return annotations;
}

/** One imported (or skipped) annotation's outcome — returned in bulk by
 * `importAnnotations` so the UI can report a real count of each rather
 * than a single opaque success/failure. */
export interface AnnotationImportResult {
  importedHighlights: number;
  importedBookmarks: number;
  /** Resolved fine but matched a highlight/bookmark already in this book
   * (either already there before the import, or earlier in this same
   * file — see `isDuplicateHighlight`/`isDuplicateBookmark`) — not
   * counted in `skipped`, since that's specifically for annotations this
   * reader *couldn't* resolve at all. */
  duplicateHighlights: number;
  duplicateBookmarks: number;
  /** Skipped because its `target.source` doesn't match any content
   * document in *this* book (most likely: the file was exported from a
   * different book entirely), because its only selector is a type this
   * reader can't resolve (`CssSelector`/`TextPositionSelector` — see
   * `EpubAnnotation`'s own doc comment), or because it has no selector
   * at all (applies to the whole resource, not a specific position this
   * reader's bookmark/highlight model can represent). */
  skipped: number;
}

/** Whether a reader importing an annotation file needs to hear anything
 * at all — see issues #114/#115. Most imports don't (the panel itself
 * updates to show what's new), but two outcomes are otherwise silent
 * and confusing: nothing in the file resolved against this book at all
 * ("wrongBook" — overwhelmingly likely it's a different book's export,
 * though a literally empty file lands here too) or everything resolved
 * but turned out to already be present ("allDuplicates" — not an error,
 * but importing and getting nothing new deserves an acknowledgement).
 * Pulled out of `ReaderController` as its own pure decision so it can be
 * exhaustively unit-tested without needing a full controller instance. */
export type ImportOutcome = "imported" | "allDuplicates" | "wrongBook";

export function classifyImportOutcome(result: AnnotationImportResult): ImportOutcome {
  if (result.importedHighlights + result.importedBookmarks > 0) {
    return "imported";
  }
  if (result.duplicateHighlights + result.duplicateBookmarks > 0) {
    return "allDuplicates";
  }
  return "wrongBook";
}

/** Loosely normalizes text for the "almost identical" half of duplicate
 * detection — collapses whitespace and ignores case, so two highlights
 * of "the same" passage don't count as distinct just because one has a
 * trailing space or a reflow-related line break the other doesn't. */
function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A highlight is a duplicate of one already known (either already saved
 * in this book, or imported earlier in this same file) if it's an exact
 * CFI match — the common case: re-importing a file this reader itself
 * already exported — or, short of that, it highlights the same-looking
 * text in the same spine item with the same note — the "almost
 * identical" case: a slightly different CFI encoding (e.g. from another
 * reading system) landing on what reads as the same passage. Two
 * highlights of identical text with *different* notes are deliberately
 * kept distinct — a differing note is meaningful content, not noise. */
function isDuplicateHighlight(
  known: readonly Pick<Highlight, "spineIndex" | "startCfi" | "endCfi" | "text" | "note">[],
  candidate: { spineIndex: number; startCfi: string; endCfi: string; text: string; note: string | undefined },
): boolean {
  return known.some(
    (existing) =>
      existing.spineIndex === candidate.spineIndex &&
      ((existing.startCfi === candidate.startCfi && existing.endCfi === candidate.endCfi) ||
        (normalizeForComparison(existing.text) === normalizeForComparison(candidate.text) &&
          normalizeForComparison(existing.note ?? "") === normalizeForComparison(candidate.note ?? ""))),
  );
}

/** A bookmark is a duplicate of one already known if it's the exact same
 * point CFI — the only well-defined notion of "same bookmark" for a
 * single point (unlike a highlight, there's no underlying text to fall
 * back on for an "almost identical" match). */
function isDuplicateBookmark(
  known: readonly Pick<Bookmark, "cfi">[],
  candidateCfi: string,
): boolean {
  return known.some((existing) => existing.cfi === candidateCfi);
}

/** Finds which spine index `target.source` refers to — first by an
 * exact manifest-path match (works whenever the annotation came from
 * this exact book, regardless of which reading system produced it),
 * falling back to the selector's own CFI package-steps (works when the
 * href doesn't match but the CFI still numerically resolves — e.g. a
 * slightly different but spine-compatible copy of the same book). */
function resolveSpineIndex(pkg: PackageDocument, source: string, cfi: EpubCfi): number | undefined {
  const byPath = pkg.spine.findIndex((ref) => ref.manifestItem.path === source);
  if (byPath !== -1) {
    return byPath;
  }
  return pkg.findSpineIndexByPackageCfiSteps(cfi.packageSteps);
}

/** Re-anchors a parsed CFI's package-steps to `spineIndex` — needed
 * when `resolveSpineIndex` had to fall back past a mismatched `source`,
 * since the CFI's own package-steps might otherwise point at the wrong
 * spine item once re-serialized. */
function withSpineIndex(pkg: PackageDocument, cfi: EpubCfi, spineIndex: number): EpubCfi {
  const packageCfiSteps = pkg.spine[spineIndex]?.packageCfiSteps ?? cfi.packageSteps;
  return new EpubCfi(packageCfiSteps, cfi.contentSteps, cfi.characterOffset);
}

/** Extracts the live text a resolved CFI range currently selects — the
 * same `range.toString()` a fresh in-app selection already captures in
 * `HighlightManager.add`, just built from two independently-resolved
 * locators instead of a live user `Range`. Resolves both ends via
 * `resolvePair` (one document load, not two) — a `Range`'s start/end
 * must share a document, and resolving them separately would silently
 * collapse the range instead of throwing (see `resolvePair`'s doc
 * comment). */
async function extractRangeText(
  resolver: LocatorResolver,
  startCfi: string,
  endCfi: string,
): Promise<string> {
  const { start, end, document } = await resolver.resolvePair(
    new Locator(startCfi),
    new Locator(endCfi),
  );
  const range = document.createRange();
  if (start.characterOffset !== undefined) {
    range.setStart(start.node, start.characterOffset);
  } else {
    range.setStartBefore(start.node);
  }
  if (end.characterOffset !== undefined) {
    range.setEnd(end.node, end.characterOffset);
  } else {
    range.setEndAfter(end.node);
  }
  return range.toString();
}

/** Imports an externally-produced EPUB Annotations 1.0 collection
 * (issue #108) into this book's own highlights/bookmarks. Only
 * annotations whose selector is a `FragmentSelector` (an EPUB CFI) are
 * resolvable here — anything else is counted in `skipped` rather than
 * silently dropped without a trace. Loads whichever spine items'
 * content documents it actually needs (to recover a highlight's
 * selected text, since the imported file doesn't carry the original
 * app's own text snapshot), same as reading normally would. */
export async function importAnnotations(
  pkg: PackageDocument,
  locatorResolver: LocatorResolver,
  library: LibraryDatabase,
  bookId: string,
  annotations: readonly EpubAnnotation[],
): Promise<AnnotationImportResult> {
  const result: AnnotationImportResult = {
    importedHighlights: 0,
    importedBookmarks: 0,
    duplicateHighlights: 0,
    duplicateBookmarks: 0,
    skipped: 0,
  };

  // Seeded with what's already saved, then grown as this batch imports —
  // so both "already existed before this import" and "appears twice
  // within this same file" are caught by the same check.
  const knownHighlights: Pick<Highlight, "spineIndex" | "startCfi" | "endCfi" | "text" | "note">[] =
    [...(await library.listHighlightsForBook(bookId))];
  const knownBookmarks: Pick<Bookmark, "cfi">[] = [...(await library.listBookmarksForBook(bookId))];

  for (const annotation of annotations) {
    const selector = annotation.target.selector?.find(
      (candidate): candidate is FragmentSelector => candidate.type === "FragmentSelector",
    );
    if (!selector) {
      result.skipped++;
      continue;
    }

    const isRange = selector.value.includes(",");
    try {
      if (isRange) {
        const { start, end } = EpubCfi.parseRange(selector.value);
        const spineIndex = resolveSpineIndex(pkg, annotation.target.source, start);
        if (spineIndex === undefined) {
          result.skipped++;
          continue;
        }
        const startCfi = withSpineIndex(pkg, start, spineIndex).toString();
        const endCfi = withSpineIndex(pkg, end, spineIndex).toString();
        const note = annotation.body?.type === "TextualBody" ? annotation.body.value : undefined;

        // The exact-CFI half of duplicate detection doesn't need the
        // (re-extracted, so comparatively expensive) text yet — check it
        // first and skip the extraction entirely for the common re-
        // import-the-same-file case.
        if (isDuplicateHighlight(knownHighlights, { spineIndex, startCfi, endCfi, text: "", note })) {
          result.duplicateHighlights++;
          continue;
        }
        const text = await extractRangeText(locatorResolver, startCfi, endCfi);
        if (isDuplicateHighlight(knownHighlights, { spineIndex, startCfi, endCfi, text, note })) {
          result.duplicateHighlights++;
          continue;
        }
        const highlight = await library.addHighlight({
          bookId,
          spineIndex,
          startCfi,
          endCfi,
          style: "yellow",
          text,
          note,
        });
        knownHighlights.push(highlight);
        result.importedHighlights++;
      } else {
        const point = EpubCfi.parse(selector.value);
        const spineIndex = resolveSpineIndex(pkg, annotation.target.source, point);
        if (spineIndex === undefined) {
          result.skipped++;
          continue;
        }
        const cfi = withSpineIndex(pkg, point, spineIndex).toString();
        if (isDuplicateBookmark(knownBookmarks, cfi)) {
          result.duplicateBookmarks++;
          continue;
        }
        const label =
          annotation.body?.type === "TextualBody" && annotation.body.value
            ? annotation.body.value
            : "";
        const bookmark = await library.addBookmark(bookId, cfi, label);
        knownBookmarks.push(bookmark);
        result.importedBookmarks++;
      }
    } catch (err) {
      if (err instanceof EpubCfiParseError) {
        result.skipped++;
        continue;
      }
      throw err;
    }
  }

  return result;
}
