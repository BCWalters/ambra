import { isReaderOwnedContent, markReaderOwnedContent } from "@ambra/engine";
import type { InterfaceTheme } from "@ambra/shell/theme";

export function updateImageControlTheme(doc: Document, palette: InterfaceTheme): void {
  const style = Array.from(doc.querySelectorAll<HTMLStyleElement>("style[data-ambra-image-controls]"))
    .find(isReaderOwnedContent);
  if (!style) return;
  style.textContent = `
    img[data-ambra-image-zoom]:focus-visible {
      outline: 2px solid ${palette.focus} !important; outline-offset: 2px !important;
      box-shadow: 0 0 0 2px ${palette.surface} !important;
    }
    @media (forced-colors: active) {
      img[data-ambra-image-zoom]:focus-visible { outline-color: Highlight !important; box-shadow: none !important; }
    }
  `;
}

/** Only the reader's image-button focus affordance is styled, never artwork or publication roots. */
export function attachImageControlTheme(doc: Document, palette: InterfaceTheme): () => void {
  const style = doc.createElement("style");
  style.dataset.ambraImageControls = "";
  markReaderOwnedContent(style);
  doc.head.append(style);
  updateImageControlTheme(doc, palette);
  return () => style.remove();
}

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
