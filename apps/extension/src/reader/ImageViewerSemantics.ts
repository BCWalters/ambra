interface ImageSemantics {
  role: string | null;
  label: string | null;
  cursor: string;
  cursorPriority: string;
  marker: string | null;
}

const originals = new WeakMap<HTMLImageElement, ImageSemantics>();

/** Keep publication semantics separately from the reader's image-button affordance. */
export function rememberImageSemantics(image: HTMLImageElement): void {
  if (originals.has(image)) return;
  originals.set(image, {
    role: image.getAttribute("role"),
    label: image.getAttribute("aria-label"),
    cursor: image.style.getPropertyValue("cursor"),
    cursorPriority: image.style.getPropertyPriority("cursor"),
    marker: image.getAttribute("data-ambra-image-zoom"),
  });
}

export function restoreImageSemantics(source: HTMLImageElement, copy: HTMLImageElement): void {
  const original = originals.get(source);
  if (!original) return;
  for (const [name, value] of [
    ["role", original.role], ["aria-label", original.label], ["data-ambra-image-zoom", original.marker],
  ] as const) {
    if (value === null) copy.removeAttribute(name);
    else copy.setAttribute(name, value);
  }
  if (original.cursor) copy.style.setProperty("cursor", original.cursor, original.cursorPriority);
  else copy.style.removeProperty("cursor");
}
