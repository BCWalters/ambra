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
