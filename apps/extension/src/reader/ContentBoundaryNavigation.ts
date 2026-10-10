import { adjacentPrimarySpineIndex, markReaderOwnedContent, ReadingTheme } from "@ambra/engine";
import type { ContentDocumentView, NavPoint, PackageDocument } from "@ambra/engine";
import type { Translate } from "../i18n/LocaleContext.js";

export interface ContentBoundary {
  readonly label: string;
  readonly nextSpineIndex?: number;
}

/** Boundaries follow primary reading order, retaining original package indices. */
export function contentBoundary(
  spineIndex: number,
  fixedLayout: boolean,
  pkg: Pick<PackageDocument, "spine">,
  toc: readonly NavPoint[],
  translate: Translate,
  direction: 1 | -1 = 1,
): ContentBoundary {
  const nextSpineIndex = adjacentPrimarySpineIndex(pkg.spine, spineIndex, direction);
  if (nextSpineIndex === undefined) return { label: translate("readingBoundary.endOfBook") };
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
      ? translate(direction === 1 ? "readingBoundary.nextChapter" : "readingBoundary.previousChapter", { title })
      : translate(direction === 1 ? "readingBoundary.nextSection" : "shortcuts.previousSection"),
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

const boundaryControls = new WeakMap<Document, HTMLElement>();

/** Update shortcut metadata without replacing a focused native boundary control. */
export function setContentBoundaryShortcut(document: Document, shortcut: string | undefined): void {
  const control = boundaryControls.get(document);
  if (shortcut) control?.setAttribute("aria-keyshortcuts", shortcut);
  else control?.removeAttribute("aria-keyshortcuts");
}

/**
 * Native navigation at the actual document end, not a sibling of the iframe.
 * Shadow DOM isolates reader strings/styles from publication text and selectors.
 * A manual, nonmodal popover escapes the paginated body's transform/overflow;
 * it stays open without autofocus or light-dismiss, clipped until keyboard focus.
 * Scroll placements instead use visible native flow, leaving publication text
 * unobscured and keeping reader controls outside text measurement and CFIs.
 */
export function attachContentBoundary(
  view: ContentDocumentView,
  boundary: ContentBoundary,
  navigationLabel: string,
  activate: (nextSpineIndex: number) => Promise<void>,
  language: string,
  placement?: "start" | "end",
): () => void {
  const doc = view.document;
  if (!doc.body || doc.defaultView?.frameElement?.getAttribute("aria-hidden") === "true") return () => {};
  const root = doc.createElement("div");
  root.dataset.ambraBoundary = "";
  root.style.setProperty("all", "initial", "important");
  root.style.setProperty("position", "fixed", "important");
  root.style.setProperty("width", "0", "important");
  root.style.setProperty("height", "0", "important");
  if (placement) {
    root.dataset.ambraScrollBoundary = placement;
    const mode = doc.defaultView!.getComputedStyle(doc.body).writingMode;
    const vertical = mode === "vertical-rl" || mode === "vertical-lr";
    root.style.setProperty("position", "static", "important");
    root.style.setProperty("display", "block", "important");
    root.style.setProperty("width", vertical ? "180px" : "auto", "important");
    root.style.setProperty("height", "auto", "important");
  }
  markReaderOwnedContent(root);
  const shadow = root.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = CSS;
  if (placement) {
    const mode = doc.defaultView!.getComputedStyle(doc.body).writingMode;
    // The parent translates scroll content down while chrome is visible.
    const bottomSpace = placement === "end" && mode !== "vertical-rl" && mode !== "vertical-lr"
      ? ReadingTheme.PAGE_INSET_TOP + ReadingTheme.PAGE_INSET_BOTTOM + 12 : 12;
    style.textContent += `
nav {
  display: block;
  position: static;
  transform: none;
  writing-mode: horizontal-tb;
  width: auto;
  max-width: 100%;
  border: 0;
  border-radius: 0;
  text-align: center;
}
nav:not(:focus-within) {
  width: auto;
  height: auto;
  padding: 12px;
  overflow: visible;
  clip-path: none;
}
nav, nav:not(:focus-within) { padding-bottom: ${bottomSpace}px; }`;
  }
  const nav = doc.createElement("nav");
  nav.lang = language;
  nav.dir = "auto";
  nav.setAttribute("aria-label", navigationLabel);
  if (!placement) nav.setAttribute("popover", "manual");
  const control = doc.createElement(boundary.nextSpineIndex === undefined ? "p" : "button");
  control.textContent = boundary.label;
  if (control.localName === "button") (control as HTMLButtonElement).type = "button";
  else control.tabIndex = 0;
  if (control.localName === "button" && placement !== "start") boundaryControls.set(doc, control);
  nav.append(control);
  shadow.append(style, nav);
  if (placement === "start") doc.body.prepend(root);
  else doc.body.append(root);
  if (!placement) nav.showPopover();

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
    if (boundaryControls.get(doc) === control) boundaryControls.delete(doc);
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
