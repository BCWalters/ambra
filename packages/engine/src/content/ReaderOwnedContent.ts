const roots = new WeakSet<Node>();

/** Ownership is registered, not inferred from attributes a publication can author. */
export function markReaderOwnedContent(root: Node): void {
  roots.add(root);
}

/** Includes shadow descendants, while leaving the publication's DOM untouched. */
export function isReaderOwnedContent(node: Node): boolean {
  for (let current: Node | null = node; current;) {
    if (roots.has(current)) return true;
    current = current.parentNode ?? (current as ShadowRoot).host ?? null;
  }
  return false;
}
