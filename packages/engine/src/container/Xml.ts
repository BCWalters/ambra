/**
 * Namespace-aware element lookup helpers, used instead of the DOM's native
 * `getElementsByTagNameNS` throughout the engine's XML parsing.
 *
 * This isn't just a workaround for our test environment (happy-dom's
 * `getElementsByTagNameNS` doesn't reliably match prefixed elements in
 * `application/xml` documents) — filtering by `namespaceURI`/`localName`
 * after a plain `querySelectorAll("*")` is standards-compliant and correct
 * in real browsers too, so this is the one implementation used everywhere,
 * not a test-only shim layered on top of "real" production code.
 */

export function getDescendantElementsByNS(
  root: ParentNode,
  namespaceURI: string,
  localName: string,
): Element[] {
  return Array.from(root.querySelectorAll("*")).filter(
    (element) => element.namespaceURI === namespaceURI && element.localName === localName,
  );
}

export function getFirstDescendantElementByNS(
  root: ParentNode,
  namespaceURI: string,
  localName: string,
): Element | undefined {
  return getDescendantElementsByNS(root, namespaceURI, localName)[0];
}
