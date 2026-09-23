import { markReaderOwnedContent } from "@ambra/engine";
import type { ContentDocumentView, NavPoint, PackageDocument } from "@ambra/engine";
import type { Translate } from "../i18n/LocaleContext.js";

export interface ContentBoundary {
  readonly label: string;
  readonly nextSpineIndex?: number;
}

/** Like chapter/page navigation, boundaries follow the spine, including linear="no". */
export function contentBoundary(
  spineIndex: number,
  fixedLayout: boolean,
  pkg: Pick<PackageDocument, "spine">,
  toc: readonly NavPoint[],
  translate: Translate,
): ContentBoundary {
  const nextSpineIndex = spineIndex + 1;
  const next = pkg.spine[nextSpineIndex];
  if (!next) return { label: translate("readingBoundary.endOfBook") };
  if (fixedLayout) return { label: translate("readingBoundary.nextPage"), nextSpineIndex };
  // Only a TOC entry addressing the document itself names this destination.
  // A preceding chapter or a later fragment can describe something else entirely.
  const titleFor = (items: readonly NavPoint[]): string | undefined => {
    for (const item of items) {
      if (item.path === next.manifestItem.path && !item.fragment && item.label.trim()) return item.label;
      const title = titleFor(item.children);
      if (title) return title;
    }
    return undefined;
  };
  const title = titleFor(toc);
  return {
    label: title
      ? translate("readingBoundary.nextChapter", { title })
      : translate("readingBoundary.nextSection"),
    nextSpineIndex,
  };
}

const CSS = `
:host { all: initial; }
nav {
  all: initial;
  position: fixed;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  font: 16px/1.5 system-ui, sans-serif;
  color: CanvasText;
  background: Canvas;
  border: 2px solid CanvasText;
  border-radius: 6px;
  padding: 12px;
  max-width: calc(100vw - 24px);
}
nav:not(:focus-within) {
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
}
nav::backdrop { display: none; }
button {
  font: inherit;
  color: inherit;
  background: inherit;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  max-width: 100%;
  overflow-wrap: anywhere;
}
button:focus-visible, p:focus-visible { outline: 2px solid Highlight; outline-offset: 3px; }
p { margin: 0; }
`;

/**
 * Native navigation at the actual document end, not a sibling of the iframe.
 * Shadow DOM isolates reader strings/styles from publication text and selectors.
 * A manual, nonmodal popover escapes the paginated body's transform/overflow;
 * it stays open without autofocus or light-dismiss, clipped until keyboard focus.
 */
export function attachContentBoundary(
  view: ContentDocumentView,
  boundary: ContentBoundary,
  navigationLabel: string,
  activate: (nextSpineIndex: number) => Promise<void>,
  language: string,
): () => void {
  const doc = view.document;
  if (!doc.body || doc.defaultView?.frameElement?.getAttribute("aria-hidden") === "true") return () => {};
  const root = doc.createElement("div");
  root.dataset.ambraBoundary = "";
  root.style.setProperty("all", "initial", "important");
  root.style.setProperty("position", "fixed", "important");
  root.style.setProperty("width", "0", "important");
  root.style.setProperty("height", "0", "important");
  markReaderOwnedContent(root);
  const shadow = root.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = CSS;
  const nav = doc.createElement("nav");
  nav.lang = language;
  nav.dir = "auto";
  nav.setAttribute("aria-label", navigationLabel);
  nav.setAttribute("popover", "manual");
  const control = doc.createElement(boundary.nextSpineIndex === undefined ? "p" : "button");
  control.textContent = boundary.label;
  if (control.localName === "button") (control as HTMLButtonElement).type = "button";
  else control.tabIndex = 0;
  nav.append(control);
  shadow.append(style, nav);
  doc.body.append(root);
  nav.showPopover();

  let disposed = false;
  let pending = false;
  let restoreSurface: (() => void) | undefined;
  const focusIn = (): void => {
    restoreSurface ??= view.revealOverlay?.();
  };
  const focusOut = (event: FocusEvent): void => {
    if (event.relatedTarget && nav.contains(event.relatedTarget as Node)) return;
    restoreSurface?.();
    restoreSurface = undefined;
  };
  nav.addEventListener("focusin", focusIn);
  nav.addEventListener("focusout", focusOut);
  const stopPropagation = (event: Event): void => event.stopPropagation();
  // Composed events otherwise reach publication gestures/keyboard shortcuts with
  // the empty shadow host as their target, hiding the native button's identity.
  for (const type of ["pointerdown", "pointerup", "keydown", "keyup"]) {
    nav.addEventListener(type, stopPropagation);
  }
  const click = async (event: Event): Promise<void> => {
    event.stopPropagation();
    if (disposed || pending || boundary.nextSpineIndex === undefined) return;
    pending = true;
    try {
      await activate(boundary.nextSpineIndex);
    } finally {
      pending = false;
    }
  };
  control.addEventListener("click", click);
  return () => {
    disposed = true;
    restoreSurface?.();
    nav.removeEventListener("focusin", focusIn);
    nav.removeEventListener("focusout", focusOut);
    control.removeEventListener("click", click);
    for (const type of ["pointerdown", "pointerup", "keydown", "keyup"]) {
      nav.removeEventListener(type, stopPropagation);
    }
    root.remove();
  };
}
