import { resolveEpubPath, splitHrefFragment } from "@ambra/engine";

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

/** Whether `href` points outside the archive entirely (an absolute URL,
 * or a protocol-relative one) — the common, deliberately-external case
 * (a real reader's own web link, a CDN font, etc.) that `resolveEpubPath`
 * was never meant to handle and shouldn't be offered as "jump to this
 * file" at all. A bare fragment-only href (`"#section2"`, an in-page
 * anchor) is likewise not a *different* file to jump to. */
function isExternalOrFragmentOnlyHref(href: string): boolean {
  if (href.startsWith("#")) {
    return true;
  }
  if (href.startsWith("//")) {
    return true;
  }
  // A URI scheme is a leading run of letters/digits/`+`/`-`/`.` followed
  // by `:` — matches `http:`, `https:`, `mailto:`, `data:`, `tel:`, etc.
  // A Windows-style drive letter never appears in an EPUB href, and a
  // relative path segment can't contain `:` at all per URL syntax, so
  // this can't misfire on a genuine relative archive path.
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
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
): string | undefined {
  const trimmed = rawHref.trim();
  if (!trimmed || isExternalOrFragmentOnlyHref(trimmed)) {
    return undefined;
  }
  const { path } = splitHrefFragment(trimmed);
  if (!path) {
    return undefined;
  }
  let resolved: string;
  try {
    resolved = resolveEpubPath(referencingPath, path);
  } catch {
    // Malformed enough that even `resolveEpubPath`'s own lenient
    // decoding gave up — not a file this book actually has either way.
    return undefined;
  }
  return knownFilePaths.has(resolved) ? resolved : undefined;
}
