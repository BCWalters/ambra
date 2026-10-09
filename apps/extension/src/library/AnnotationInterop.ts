import {
  EpubCfi,
  EpubCfiParseError,
  LocatorResolver,
  PackageDocument,
  EPUB_CFI_CONFORMS_TO,
  AnnotationSelectorResolver,
  AnnotationSelectorResolutionError,
  isAnnotationSelectorFailure,
  parseAnnotationCfi,
  getAnnotationTextBody,
  hasAnnotationMotivation,
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
  if (hasAnnotationMotivation(motivation, "bookmarking")) {
    return "bookmark";
  }
  if (hasAnnotationMotivation(motivation, "highlighting") || hasAnnotationMotivation(motivation, "commenting")) {
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

function retainedAnnotation(annotation: EpubAnnotation, note: string | undefined): EpubAnnotation {
  const originalNote = getAnnotationTextBody(annotation);
  if ((note ?? "") === (originalNote ?? "")) return annotation;
  const bodies: unknown[] = Array.isArray(annotation.body) ? [...annotation.body]
    : annotation.body === undefined ? [] : [annotation.body];
  const index = bodies.findIndex(body => body && typeof body === "object" &&
    "type" in body && body.type === "TextualBody" && "value" in body && typeof body.value === "string");
  if (note) {
    const original = bodies[index];
    const body = {
      ...(original && typeof original === "object" ? original : {}),
      type: "TextualBody", format: "text/plain", value: note,
    };
    if (index === -1) bodies.push(body);
    else bodies[index] = body;
  } else if (index !== -1) bodies.splice(index, 1);
  return {
    ...annotation,
    modified: new Date().toISOString(),
    body: bodies.length ? bodies : undefined,
  };
}

/** Builds an EPUB Annotations 1.0 collection (issue #107) from this
 * book's current highlights and bookmarks. Imported records retain authored
 * metadata and targets; locally created records use the reader's own export
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
    if (highlight.importedAnnotation) {
      annotations.push(retainedAnnotation(highlight.importedAnnotation, highlight.note));
      continue;
    }
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
    if (bookmark.importedAnnotation) {
      annotations.push(retainedAnnotation(bookmark.importedAnnotation, bookmark.label));
      continue;
    }
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
 * CFI match with the same note — the common case: re-importing this
 * reader's own export — or, short of that, it highlights the same-looking
 * text in the same spine item with the same note — the "almost
 * identical" case: a slightly different CFI encoding (e.g. from another
 * reading system) landing on what reads as the same passage. Two
 * highlights of identical text with *different* notes are deliberately
 * kept distinct — a differing note is meaningful content, not noise. */
function isDuplicateHighlight(
  known: readonly Pick<Highlight, "spineIndex" | "startCfi" | "endCfi" | "text" | "note">[],
  candidate: { spineIndex: number; startCfi: string; endCfi: string; text?: string; note: string | undefined },
): boolean {
  return known.some(
    (existing) =>
      existing.spineIndex === candidate.spineIndex &&
      normalizeForComparison(existing.note ?? "") === normalizeForComparison(candidate.note ?? "") &&
      ((existing.startCfi === candidate.startCfi && existing.endCfi === candidate.endCfi) ||
        (candidate.text !== undefined &&
          normalizeForComparison(existing.text) === normalizeForComparison(candidate.text))),
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

export const parseSelectorCfi = parseAnnotationCfi;

/** Imports an externally-produced EPUB Annotations 1.0 collection
 * into this book's own highlights/bookmarks. Selectors are tried in authored
 * order; known resolution failures may recover through a later selector.
 * One exhausted annotation counts as one skip, not one per failed selector. */
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
  const selectors = new AnnotationSelectorResolver(pkg, locatorResolver);

  annotationLoop: for (const annotation of annotations) {
    if (!annotation.target.selector?.length)
      console.warn(`Imported annotation ${annotation.id} has no supported selector.`);
    for (const selector of annotation.target.selector ?? []) {
      try {
        const note = getAnnotationTextBody(annotation);
        if (selector.type === "FragmentSelector" && selector.refinedBy === undefined &&
          !hasAnnotationMotivation(annotation.motivation, "bookmarking")) {
          const candidate = selectors.fragmentSelection(annotation.target.source, selector);
          if (candidate.endCfi && isDuplicateHighlight(knownHighlights, {
            spineIndex: candidate.spineIndex, startCfi: candidate.startCfi, endCfi: candidate.endCfi, note,
          })) {
            result.duplicateHighlights++;
            continue annotationLoop;
          }
        }
        const selection = await selectors.resolve(annotation.target.source, selector);
        const { spineIndex, startCfi, endCfi } = selection;
        if (endCfi && !hasAnnotationMotivation(annotation.motivation, "bookmarking")) {
          const text = selection.text;
          if (text === undefined) throw new AnnotationSelectorResolutionError("The annotation range has no text representation.");
          if (isDuplicateHighlight(knownHighlights, { spineIndex, startCfi, endCfi, text, note })) {
            result.duplicateHighlights++;
            continue annotationLoop;
          }
          const highlight = await library.addHighlight({
            bookId, spineIndex, startCfi, endCfi, style: "yellow", text, note, importedAnnotation: annotation,
          });
          knownHighlights.push(highlight);
          result.importedHighlights++;
        } else {
          if (isDuplicateBookmark(knownBookmarks, startCfi)) {
            result.duplicateBookmarks++;
            continue annotationLoop;
          }
          const bookmark = await library.addBookmark(bookId, startCfi, note ?? "", annotation);
          knownBookmarks.push(bookmark);
          result.importedBookmarks++;
        }
        continue annotationLoop;
      } catch (error) {
        if (!isAnnotationSelectorFailure(error)) throw error;
        console.warn(`Unable to resolve selector ${selector.type} for imported annotation ${annotation.id}; trying its next alternative.`, error);
      }
    }
    result.skipped++;
  }

  return result;
}
