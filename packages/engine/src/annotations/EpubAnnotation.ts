/**
 * EPUB Annotations 1.0 (part of EPUB 3.4): the interoperable JSON format
 * for both a publisher-embedded, read-only annotation collection (issue
 * #109 — a manifest item marked `properties="annotations"`, see
 * `PackageDocument.findAnnotationsDocument`) and this reader's own
 * export/import of the user's highlights and bookmarks (issues #107/
 * #108). A restricted profile of the W3C Web Annotation Data Model —
 * only the sub-properties/selector types this specification actually
 * defines are modeled here, not the full open-ended upstream vocabulary.
 */

/** "highlighting"/"bookmarking" cover this app's own two annotation
 * kinds; "commenting" is a highlight that also carries a note (a
 * `body`), per the spec's own guidance on choosing a motivation. */
export type AnnotationMotivation = "bookmarking" | "commenting" | "highlighting";

export interface AnnotationCreator {
  id: string;
  type: "Person" | "Organization" | "Software";
  name?: string;
}

/** The only selector type this reader writes (an EPUB CFI in `value`,
 * either a point or — for a highlight's start/end — a joined range, see
 * `EpubCfi.joinRange`) and the only one it resolves back on import.
 * `CssSelector`/`TextPositionSelector` (also legal per spec) are parsed
 * structurally but never resolved — an annotation using one of those
 * instead is reported as unsupported rather than silently dropped, see
 * `parseAnnotationCollection`'s caller in `AnnotationImport.ts`. */
export interface FragmentSelector {
  type: "FragmentSelector";
  value: string;
  conformsTo?: string;
}

export interface CssSelector {
  type: "CssSelector";
  value: string;
}

export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

export type AnnotationSelector = FragmentSelector | CssSelector | TextPositionSelector;

export interface AnnotationTarget {
  /** The href (relative to the OPF, matching `ManifestItem.path`/
   * `SpineItemRef`) of the target content document. */
  source: string;
  selector?: AnnotationSelector[];
}

export interface AnnotationBody {
  type: "TextualBody" | "Image" | "Audio" | "Video";
  format?: string;
  value?: string;
}

export interface EpubAnnotation {
  id: string;
  type: "Annotation";
  motivation?: AnnotationMotivation;
  created: string;
  modified?: string;
  creator?: AnnotationCreator;
  target: AnnotationTarget;
  body?: AnnotationBody;
}

export class AnnotationParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AnnotationParseError";
  }
}

/** The EPUB CFI spec's own canonical reference — used as `conformsTo`
 * on every `FragmentSelector` this reader writes. Parsing accepts a
 * `FragmentSelector` regardless of its own `conformsTo` value (or its
 * absence) as long as its `value` is itself CFI-shaped, since
 * `conformsTo` is only a "SHOULD", not required for correctness here. */
export const EPUB_CFI_CONFORMS_TO = "https://www.w3.org/publishing/epub-cfi/";

/** Parses a serialized annotation collection — tolerant of the shapes a
 * real annotation file might use: a bare array of Annotation objects
 * (what this reader itself writes), a single Annotation object, or a
 * W3C `AnnotationCollection`/`AnnotationPage`-style wrapper with an
 * `items` array (a plausible shape for a third-party or publisher tool
 * to have produced instead). Throws `AnnotationParseError` for anything
 * that doesn't resolve to at least a plausible list of objects; does
 * *not* throw on an individual malformed entry — `toEpubAnnotation`
 * returns `undefined` for those instead, so one bad entry in a large
 * file never sinks the whole import. */
export function parseAnnotationCollection(jsonText: string): EpubAnnotation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new AnnotationParseError(
      `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const rawItems = toRawItemArray(parsed);
  const annotations: EpubAnnotation[] = [];
  for (const raw of rawItems) {
    const annotation = toEpubAnnotation(raw);
    if (annotation) {
      annotations.push(annotation);
    }
  }
  return annotations;
}

function toRawItemArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) {
      return obj.items;
    }
    if (obj.type === "Annotation") {
      return [obj];
    }
  }
  throw new AnnotationParseError(
    "Expected a JSON array of annotations, or an object with an `items` array.",
  );
}

function toEpubAnnotation(raw: unknown): EpubAnnotation | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || obj.type !== "Annotation" || typeof obj.created !== "string") {
    return undefined;
  }
  const target = toAnnotationTarget(obj.target);
  if (!target) {
    return undefined;
  }
  const motivation =
    obj.motivation === "bookmarking" ||
    obj.motivation === "commenting" ||
    obj.motivation === "highlighting"
      ? obj.motivation
      : undefined;
  return {
    id: obj.id,
    type: "Annotation",
    motivation,
    created: obj.created,
    modified: typeof obj.modified === "string" ? obj.modified : undefined,
    creator: toAnnotationCreator(obj.creator),
    target,
    body: toAnnotationBody(obj.body),
  };
}

function toAnnotationCreator(raw: unknown): AnnotationCreator | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.id !== "string" ||
    (obj.type !== "Person" && obj.type !== "Organization" && obj.type !== "Software")
  ) {
    return undefined;
  }
  return { id: obj.id, type: obj.type, name: typeof obj.name === "string" ? obj.name : undefined };
}

function toAnnotationTarget(raw: unknown): AnnotationTarget | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.source !== "string") {
    return undefined;
  }
  const selectorList = Array.isArray(obj.selector) ? obj.selector : undefined;
  const selector = selectorList
    ?.map((entry) => toAnnotationSelector(entry))
    .filter((entry): entry is AnnotationSelector => entry !== undefined);
  return { source: obj.source, selector: selector && selector.length > 0 ? selector : undefined };
}

function toAnnotationSelector(raw: unknown): AnnotationSelector | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (obj.type === "FragmentSelector" && typeof obj.value === "string") {
    return {
      type: "FragmentSelector",
      value: obj.value,
      conformsTo: typeof obj.conformsTo === "string" ? obj.conformsTo : undefined,
    };
  }
  if (obj.type === "CssSelector" && typeof obj.value === "string") {
    return { type: "CssSelector", value: obj.value };
  }
  if (
    obj.type === "TextPositionSelector" &&
    typeof obj.start === "number" &&
    typeof obj.end === "number"
  ) {
    return { type: "TextPositionSelector", start: obj.start, end: obj.end };
  }
  return undefined;
}

function toAnnotationBody(raw: unknown): AnnotationBody | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  if (
    obj.type !== "TextualBody" &&
    obj.type !== "Image" &&
    obj.type !== "Audio" &&
    obj.type !== "Video"
  ) {
    return undefined;
  }
  return {
    type: obj.type,
    format: typeof obj.format === "string" ? obj.format : undefined,
    value: typeof obj.value === "string" ? obj.value : undefined,
  };
}

/** Serializes a plain array of annotations back to JSON text — the
 * inverse of `parseAnnotationCollection`, always writing the simple
 * bare-array shape (not a wrapped collection) since that's the one this
 * reader's own import path is guaranteed to round-trip. */
export function serializeAnnotationCollection(annotations: readonly EpubAnnotation[]): string {
  return JSON.stringify(annotations, undefined, 2);
}
