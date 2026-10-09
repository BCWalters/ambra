import { classifyEpubReference } from "@ambra/engine";

/** Attribute names, inside an XHTML content document, whose value points
 * at another archive member — issue #95: a link/image reference to
 * another spine item (or any other manifest resource) should be
 * clickable in the Inspector's markup preview, jumping the Files tab
 * straight to it, the same as an actual reader following that link
 * would land on that chapter. Deliberately just these two (not, say,
 * `poster`/`xlink:href`) — "a link or image source," the literal ask,
 * covers the overwhelmingly common case (`<a href>`, `<img src>`) without
 * guessing at every attribute that could conceivably hold a URL. */
const NAVIGABLE_LINK_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src"]);

export function isNavigableLinkAttribute(attributeName: string): boolean {
  return NAVIGABLE_LINK_ATTRIBUTES.has(attributeName.toLowerCase());
}

/**
 * Resolves a raw `href`/`src` attribute value found in `referencingPath`'s
 * own markup to the archive-relative path it points at, but only if
 * that path is both resolvable and actually present in this book's own
 * archive (`knownFilePaths`) — an author's own typo'd or intentionally
 * external reference should never be offered as a false "jump to this
 * file" link. Returns `undefined` for anything not navigable within the
 * archive (external URLs, fragment-only anchors, or a reference to a
 * file this archive doesn't actually contain).
 */
export function resolveNavigableLinkTarget(
  referencingPath: string,
  rawHref: string,
  knownFilePaths: ReadonlySet<string>,
  baseHref?: string,
): string | undefined {
  const trimmed = rawHref.trim();
  if (!trimmed) return undefined;
  try {
    const reference = classifyEpubReference(referencingPath, trimmed, baseHref);
    return reference.kind === "package" && knownFilePaths.has(reference.path) ? reference.path : undefined;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    console.warn("Cannot resolve an Inspector source link.", error);
    return undefined;
  }
}
