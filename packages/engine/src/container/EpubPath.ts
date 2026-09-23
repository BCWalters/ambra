/**
 * Resolves an href found inside an EPUB content document (e.g. a manifest
 * item's `href`, or a link within XHTML content) against the path of the
 * file that referenced it, producing a path relative to the zip archive
 * root. EPUB hrefs are relative URL references — not zip paths — so `.`/
 * `..` segments and percent-encoding must be handled per URL semantics.
 *
 * This is a small, pure, standalone utility (no state, no class needed).
 */
export function resolveEpubPath(referencingFilePath: string, href: string): string {
  // Use the URL parser (via an opaque base) rather than hand-rolling `.`/
  // `..` segment resolution, since that's exactly what URL path resolution
  // already does correctly, including edge cases.
  // The base is an archive path, not a URL: literal %, # and ? in its
  // filenames must not become URL syntax. The href is already a URL
  // reference, so decode only its resolved pathname, never before parsing.
  const encodedBasePath = referencingFilePath.split("/").map(encodeURIComponent).join("/");
  const base = new URL(`epub-path:///${encodedBasePath}`);
  const resolved = new URL(href, base);

  // Strip the fake scheme and leading slash back down to a zip-relative path.
  return safeDecodeUriComponent(resolved.pathname).replace(/^\/+/, "");
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding: fall back to the raw string rather than
    // throwing when a publisher used a literal percent sign in a filename.
    return value;
  }
}

/** Returns the directory portion of a zip-relative path (no trailing
 * slash), or `""` for a path with no directory component. */
export function directoryOf(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

/** Splits a raw href like `"chapter1.xhtml#section2"` into its path and
 * fragment parts. Used by navigation parsing (Nav Document / NCX), where a
 * link's target position within a content document (the fragment) needs to
 * be kept separate from the document path (which gets resolved via
 * `resolveEpubPath`). */
export function splitHrefFragment(href: string): { path: string; fragment: string | undefined } {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) {
    return { path: href, fragment: undefined };
  }
  return { path: href.slice(0, hashIndex), fragment: href.slice(hashIndex + 1) };
}
