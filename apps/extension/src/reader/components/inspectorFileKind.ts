/** Classifies an EPUB archive member for the Inspector's Files tab —
 * deciding whether to show pretty-printed/highlighted text, an
 * image/audio/video preview, or a plain "this is binary, here's its
 * size" indicator, and which icon/color to show it with in the file
 * list. Never lets binary bytes get decoded and displayed as if they
 * were text (the previous behavior: `TextDecoder`'s default non-fatal
 * mode silently turns binary data into mojibake instead of throwing, so
 * a naive "try reading as text" approach couldn't tell the difference).
 *
 * Classification prefers the book's own manifest media type (the most
 * authoritative source) and falls back to a file-extension guess for
 * archive members that aren't manifest resources at all (e.g.
 * `mimetype`, `META-INF/container.xml`). */

/** Maps a lowercase file extension (no leading dot) to the media type an
 * EPUB archive member of that kind almost always has, for files that
 * live outside the manifest and so have no declared media type of their
 * own. */
const EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> = {
  xhtml: "application/xhtml+xml",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  opf: "application/oebps-package+xml",
  ncx: "application/x-dtbncx+xml",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  txt: "text/plain",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  m4v: "video/mp4",
  pdf: "application/pdf",
};

export type InspectorFileCategory =
  | "markup"
  | "css"
  | "script"
  | "json"
  | "text"
  | "image"
  | "audio"
  | "video"
  | "font"
  | "binary";

/** highlight.js language name for each text-like category, or
 * `undefined` for `text` (plain, unhighlighted monospace — still
 * perfectly readable, just without syntax coloring), which is the right
 * fallback for a media type we don't specifically recognize rather than
 * guessing wrong. */
const HIGHLIGHT_LANGUAGE_BY_CATEGORY: Readonly<Partial<Record<InspectorFileCategory, string>>> = {
  markup: "xml",
  css: "css",
  script: "javascript",
  json: "json",
};

export interface InspectorFileClassification {
  readonly category: InspectorFileCategory;
  readonly isText: boolean;
  readonly highlightLanguage: string | undefined;
  /** Whether to run this file's text through the XML pretty-printer
   * before highlighting — true for markup (XHTML/XML/OPF/NCX), since
   * real-world EPUBs are very often minified/single-line and unreadable
   * without reformatting; left false for CSS/JS/JSON, which is usually
   * already reasonably formatted and has its own (different) notion of
   * "pretty" that an XML formatter would corrupt. */
  readonly prettyPrintXml: boolean;
}

function extensionOf(path: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match?.[1]?.toLowerCase();
}

/** Resolves the best-guess media type for an archive member: the
 * manifest's own declaration when this path is a manifest resource,
 * otherwise an extension-based guess (`undefined` if neither is
 * available — an extensionless, non-manifest file, which is rare). */
export function guessMediaType(path: string, manifestMediaType: string | undefined): string | undefined {
  if (manifestMediaType) {
    return manifestMediaType;
  }
  const extension = extensionOf(path);
  return extension ? EXTENSION_MEDIA_TYPES[extension] : undefined;
}

function categoryForMediaType(mediaType: string): InspectorFileCategory {
  if (mediaType.startsWith("image/")) {
    // Includes `image/svg+xml`: SVG is technically markup, but for an
    // EPUB author browsing files, seeing the picture it actually
    // produces is more useful here than its source — unlike actual
    // XHTML content documents, where the markup itself is the point.
    return "image";
  }
  if (mediaType.startsWith("audio/")) {
    return "audio";
  }
  if (mediaType.startsWith("video/")) {
    return "video";
  }
  if (
    mediaType.startsWith("font/") ||
    mediaType === "application/vnd.ms-opentype" ||
    mediaType === "application/font-sfnt"
  ) {
    return "font";
  }
  if (
    mediaType === "application/pdf" ||
    mediaType === "application/zip" ||
    mediaType === "application/epub+zip" ||
    mediaType === "application/octet-stream"
  ) {
    return "binary";
  }
  switch (mediaType) {
    case "application/xhtml+xml":
    case "text/html":
    case "application/xml":
    case "application/oebps-package+xml":
    case "application/x-dtbncx+xml":
      return "markup";
    case "text/css":
      return "css";
    case "application/javascript":
    case "text/javascript":
      return "script";
    case "application/json":
      return "json";
    default:
      // A "+json" structured-syntax suffix (RFC 6839) — e.g.
      // `application/ld+json`, the media type EPUB Annotations 1.0
      // collections actually declare (issue #117) — is just as safely
      // renderable as plain `application/json` and deserves the same
      // treatment rather than falling through to "binary" below.
      if (mediaType.endsWith("+json")) {
        return "json";
      }
      // Any other media type starting with "text/" (e.g. `text/plain`)
      // is still safely displayable as plain text; anything else this
      // table has never heard of is safer treated as binary than risked
      // as mojibake.
      return mediaType.startsWith("text/") ? "text" : "binary";
  }
}

export function classifyInspectionFile(
  path: string,
  manifestMediaType: string | undefined,
): InspectorFileClassification {
  const mediaType = guessMediaType(path, manifestMediaType);
  // Unrecognized extension and not a manifest resource — most such
  // stray archive members (a README, custom metadata, etc.) are text,
  // and there's no size/extension signal to say otherwise.
  const category: InspectorFileCategory = mediaType ? categoryForMediaType(mediaType) : "text";
  const isText =
    category !== "image" && category !== "audio" && category !== "video" && category !== "binary" && category !== "font";

  return {
    category,
    isText,
    highlightLanguage: isText ? HIGHLIGHT_LANGUAGE_BY_CATEGORY[category] : undefined,
    prettyPrintXml: category === "markup",
  };
}

/** The handful of files that establish an EPUB's own structure — given
 * their own dedicated icon in the Files tab (issue #95) rather than the
 * generic per-category one every other markup/XML file gets, since
 * these specific ones are what an author most needs to find at a
 * glance while poking around a book's raw archive layout. */
export type SpecialFileKind = "container" | "opf" | "toc" | "cover";

/** The fixed, spec-mandated path of the OCF container descriptor —
 * never a manifest resource itself (nothing references it *from*
 * inside the package), so it can only ever be recognized by this exact
 * path, unlike every other special kind below. */
const CONTAINER_XML_PATH = "META-INF/container.xml";

const NCX_MEDIA_TYPE = "application/x-dtbncx+xml";

/** The minimal shape `identifySpecialFiles` needs from `EpubInspectionData`
 * — declared locally (rather than importing the real interface from
 * `ReaderController`) so this stays a small, pure, independently
 * testable function with no dependency on the rest of the reader. */
export interface SpecialFileSource {
  readonly files: readonly { path: string }[];
  readonly rootFilePath: string;
  readonly manifest: readonly { id: string; path: string; mediaType: string; properties: readonly string[] }[];
  readonly metaEntries: readonly { key: string; value: string }[];
}

/** Maps each recognized special file's archive path to its `SpecialFileKind`
 * — at most one entry per kind, since there's only ever one container
 * descriptor, one package document, and (practically) one "the TOC" /
 * "the cover" an author would think of as *the* one, even though EPUB
 * technically allows a book to keep a legacy NCX around *alongside* an
 * EPUB3 Nav Document (the Nav Document wins in that case — it's the
 * one that's actually current) or declare a cover via either the EPUB3
 * `cover-image` manifest property or the legacy OPF2 `<meta name="cover"
 * content="...">` form (the former wins if both happen to be present). */
export function identifySpecialFiles(data: SpecialFileSource): ReadonlyMap<string, SpecialFileKind> {
  const result = new Map<string, SpecialFileKind>();

  if (data.files.some((file) => file.path === CONTAINER_XML_PATH)) {
    result.set(CONTAINER_XML_PATH, "container");
  }
  if (data.rootFilePath) {
    result.set(data.rootFilePath, "opf");
  }

  const navItem = data.manifest.find((item) => item.properties.includes("nav"));
  const ncxItem = data.manifest.find((item) => item.mediaType === NCX_MEDIA_TYPE);
  const tocItem = navItem ?? ncxItem;
  if (tocItem) {
    result.set(tocItem.path, "toc");
  }

  const coverImageItem = data.manifest.find((item) => item.properties.includes("cover-image"));
  const legacyCoverMeta = data.metaEntries.find((entry) => entry.key.toLowerCase() === "cover");
  const legacyCoverItem = legacyCoverMeta
    ? data.manifest.find((item) => item.id === legacyCoverMeta.value)
    : undefined;
  const coverItem = coverImageItem ?? legacyCoverItem;
  if (coverItem) {
    result.set(coverItem.path, "cover");
  }

  return result;
}

