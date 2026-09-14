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

/** Like `getDescendantElementsByNS`, but only considers `parent`'s direct
 * children — needed for recursive tree structures (e.g. nested `<ol>`/`<li>`
 * in a Nav Document, or nested `<navPoint>` in an NCX) where a plain
 * descendant search would incorrectly flatten every nesting level together. */
export function getChildElementsByNS(
  parent: Element,
  namespaceURI: string,
  localName: string,
): Element[] {
  return Array.from(parent.children).filter(
    (element) => element.namespaceURI === namespaceURI && element.localName === localName,
  );
}

export function getFirstChildElementByNS(
  parent: Element,
  namespaceURI: string,
  localName: string,
): Element | undefined {
  return getChildElementsByNS(parent, namespaceURI, localName)[0];
}

/**
 * Reads a namespaced attribute (e.g. `epub:type`), working around another
 * happy-dom limitation: for `application/xhtml+xml` documents, its
 * `getAttributeNS` doesn't resolve prefixed attributes correctly (it
 * returns `null` even for a well-formed `epub:type="toc"` attribute).
 *
 * Tries the native `getAttributeNS` first — the correct, spec-compliant
 * path, used as-is in real browsers. Only falls back to manually resolving
 * which prefix(es) are bound to `namespaceURI` (by walking up the tree
 * collecting `xmlns:*` declarations) when that returns nothing, so this
 * remains correct even for documents that bind an unusual prefix to the
 * namespace, not just the conventional `epub:` one.
 */
export function getNamespacedAttribute(
  element: Element,
  namespaceURI: string,
  localName: string,
): string | null {
  const direct = element.getAttributeNS(namespaceURI, localName);
  if (direct !== null) {
    return direct;
  }

  const prefixes = collectPrefixesForNamespace(element, namespaceURI);
  for (const prefix of prefixes) {
    const value = element.getAttribute(prefix ? `${prefix}:${localName}` : localName);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function collectPrefixesForNamespace(element: Element, namespaceURI: string): Set<string> {
  const prefixes = new Set<string>();
  let current: Element | null = element;

  while (current) {
    for (const attr of Array.from(current.attributes)) {
      if (attr.name === "xmlns" && attr.value === namespaceURI) {
        prefixes.add("");
      } else if (attr.name.startsWith("xmlns:") && attr.value === namespaceURI) {
        prefixes.add(attr.name.slice("xmlns:".length));
      }
    }
    current = current.parentElement;
  }

  return prefixes;
}
