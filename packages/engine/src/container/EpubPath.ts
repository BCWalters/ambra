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
  const decodedHref = safeDecodeUriComponent(href);

  // Use the URL parser (via an opaque base) rather than hand-rolling `.`/
  // `..` segment resolution, since that's exactly what URL path resolution
  // already does correctly, including edge cases.
  const base = new URL(`epub-path:///${referencingFilePath}`);
  const resolved = new URL(decodedHref, base);

  // Strip the fake scheme and leading slash back down to a zip-relative path.
  return decodeURIComponent(resolved.pathname).replace(/^\/+/, "");
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed percent-encoding: fall back to the raw string rather than
    // throwing, since URL resolution below will still handle it reasonably.
    return value;
  }
}

/** Returns the directory portion of a zip-relative path (no trailing
 * slash), or `""` for a path with no directory component. */
export function directoryOf(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}
