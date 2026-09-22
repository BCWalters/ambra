import {
  EpubCfi,
  EpubCfiParseError,
  Locator,
  LocatorResolver,
  PackageDocument,
  EPUB_CFI_CONFORMS_TO,
} from "@ambra/engine";
import type { EpubAnnotation, FragmentSelector } from "@ambra/engine";
import type { LibraryDatabase, Bookmark, Highlight } from "./LibraryDatabase.js";

/** Both of this reader's own annotation kinds, side by side, purely so
 * `buildAnnotationCollection` can take one flat list from its caller
 * instead of two separate parameters in a fixed order. */
export interface UserAnnotations {
  highlights: readonly Highlight[];
  bookmarks: readonly Bookmark[];
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
  /** Skipped because its `target.source` doesn't match any content
   * document in *this* book (most likely: the file was exported from a
   * different book entirely), because its only selector is a type this
   * reader can't resolve (`CssSelector`/`TextPositionSelector` — see
   * `EpubAnnotation`'s own doc comment), or because it has no selector
   * at all (applies to the whole resource, not a specific position this
   * reader's bookmark/highlight model can represent). */
  skipped: number;
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
 * locators instead of a live user `Range`. */
async function extractRangeText(
  resolver: LocatorResolver,
  startCfi: string,
  endCfi: string,
): Promise<string> {
  const start = await resolver.resolve(new Locator(startCfi));
  const end = await resolver.resolve(new Locator(endCfi));
  const range = start.node.ownerDocument?.createRange() ?? new Range();
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
    skipped: 0,
  };

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
        const text = await extractRangeText(locatorResolver, startCfi, endCfi);
        await library.addHighlight({
          bookId,
          spineIndex,
          startCfi,
          endCfi,
          style: "yellow",
          text,
          note: annotation.body?.type === "TextualBody" ? annotation.body.value : undefined,
        });
        result.importedHighlights++;
      } else {
        const point = EpubCfi.parse(selector.value);
        const spineIndex = resolveSpineIndex(pkg, annotation.target.source, point);
        if (spineIndex === undefined) {
          result.skipped++;
          continue;
        }
        const cfi = withSpineIndex(pkg, point, spineIndex).toString();
        const label =
          annotation.body?.type === "TextualBody" && annotation.body.value
            ? annotation.body.value
            : "";
        await library.addBookmark(bookId, cfi, label);
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
