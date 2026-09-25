import { isReaderOwnedContent } from "../content/ReaderOwnedContent.js";
import { Page, type DomBreakPoint } from "./Page.js";

const DYNAMIC_LAYOUT_ELEMENTS = new Set([
  "animate", "animatemotion", "animatetransform", "animatecolor", "set", "discard",
  "img", "image", "use", "video", "audio", "canvas", "iframe", "object", "embed",
]);

interface SerializedPosition {
  readonly path: readonly number[];
  readonly offset?: number;
}

/** Transferable layout data only: never retains a document, node or Range. */
export interface PaginationSnapshot {
  readonly identity: string;
  readonly pages: readonly {
    readonly start: SerializedPosition;
    readonly end: SerializedPosition;
    readonly top: number;
    readonly bottom: number;
  }[];
}

export interface BodyPaint {
  readonly transform: string;
  readonly transformPriority: string;
  readonly clipPath: string;
  readonly clipPriority: string;
}

export function bodyPaint(document: Document): BodyPaint {
  const style = document.body.style;
  return {
    transform: style.getPropertyValue("transform"),
    transformPriority: style.getPropertyPriority("transform"),
    clipPath: style.getPropertyValue("clip-path"),
    clipPriority: style.getPropertyPriority("clip-path"),
  };
}

/** Compare exact configured markup, not a collision-prone hash. Reader-owned
 * overlays and this host's display-only body paint are the only exclusions.
 * Authored attributes (including tabindex/ARIA, which CSS can select) remain. */
export function paginationIdentity(
  document: Document,
  source: string,
  width: string,
  height: number,
  pageHeight: number,
  paint: BodyPaint,
): string | undefined {
  if (document.fonts?.status === "loading" || document.getAnimations?.().length) return undefined;
  const authoredElements = Array.from(document.querySelectorAll("*")).filter(element => !isReaderOwnedContent(element));
  // SMIL is absent from getAnimations(). External images/SVG references use
  // opaque resource URLs: their animation and intrinsic-size stability cannot
  // be established synchronously. Fall back instead of guessing from markup.
  if (authoredElements.some(element => DYNAMIC_LAYOUT_ELEMENTS.has(element.localName.toLowerCase()))) {
    return undefined;
  }
  const clone = (node: Node): Node | undefined => {
    if (isReaderOwnedContent(node)) return undefined;
    const copy = node.cloneNode(false);
    for (const child of node.childNodes) {
      const childCopy = clone(child);
      if (childCopy) copy.appendChild(childCopy);
    }
    return copy;
  };
  const root = clone(document.documentElement) as HTMLElement;
  const body = root.querySelector("body");
  if (!body) return undefined;
  body.style.setProperty("transform", paint.transform, paint.transformPriority);
  body.style.setProperty("clip-path", paint.clipPath, paint.clipPriority);
  // CSSOM writes may reorder declarations without changing their meaning.
  for (const element of [root, ...root.querySelectorAll<HTMLElement>("[style]")]) {
    if (!element.hasAttribute("style")) continue;
    const declarations = Array.from(element.style).sort().map(property =>
      `${property}:${element.style.getPropertyValue(property)}${element.style.getPropertyPriority(property) ? " !important" : ""};`,
    );
    element.setAttribute("style", declarations.join(""));
  }
  const view = document.defaultView;
  let stylesheets: unknown[];
  const cssTexts: string[] = [];
  try {
    stylesheets = [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])]
      .filter(sheet => !sheet.ownerNode || !isReaderOwnedContent(sheet.ownerNode))
      .map(sheet => {
        const rules = Array.from(sheet.cssRules, rule => rule.cssText);
        cssTexts.push(...rules);
        return [sheet.disabled, rules];
      });
  } catch {
    // An unreadable stylesheet cannot establish equivalent configured layout.
    return undefined;
  }
  const controls = Array.from(document.querySelectorAll("input,textarea,select")).filter(element =>
    !isReaderOwnedContent(element),
  ).map(element => {
    const control = element as HTMLInputElement & HTMLSelectElement;
    return [control.value, control.checked, control.selectedIndex];
  });
  const interaction = Array.from(document.querySelectorAll(":hover,:focus,:focus-within,:target"))
    .filter(element => !isReaderOwnedContent(element))
    .map(element => authoredElements.indexOf(element));
  const css = cssTexts.join("\n");
  const media = Array.from(css.matchAll(/@media\s+([^{}]+)\{/g), match =>
    [match[1], view?.matchMedia(match[1]!).matches],
  );
  const fonts = Array.from(document.fonts ?? [], face =>
    [face.family, face.style, face.weight, face.stretch, face.unicodeRange, face.status],
  );
  // Programmatically added FontFaces do not expose their binary source.
  if (fonts.length > Array.from(css.matchAll(/@font-face\s*\{/g)).length) return undefined;
  return JSON.stringify([
    source, width, height, pageHeight, view?.devicePixelRatio, view?.innerWidth, view?.innerHeight,
    root.outerHTML, stylesheets, controls, interaction, media, fonts,
  ]);
}

function authoredChildren(node: Node): Node[] {
  return Array.from(node.childNodes).filter(child => !isReaderOwnedContent(child));
}

function serializePosition(paths: ReadonlyMap<Node, readonly number[]>, position: DomBreakPoint): SerializedPosition | undefined {
  const path = paths.get(position.node);
  if (!path) return undefined;
  const offset = position.offset;
  return {
    path,
    offset: offset === undefined || position.node.nodeType === 3 || position.node.nodeType === 4
      ? offset
      : Array.from(position.node.childNodes).slice(0, offset).filter(child => !isReaderOwnedContent(child)).length,
  };
}

export function snapshotPages(document: Document, identity: string, pages: readonly Page[]): PaginationSnapshot | undefined {
  const paths = new Map<Node, readonly number[]>();
  const visit = (node: Node, path: readonly number[]): void => {
    paths.set(node, path);
    authoredChildren(node).forEach((child, index) => visit(child, [...path, index]));
  };
  visit(document.documentElement, []);
  const serialized = [];
  for (const page of pages) {
    const start = serializePosition(paths, page.startBreak);
    const end = serializePosition(paths, page.endBreak);
    if (!start || !end) return undefined;
    serialized.push({ start, end, top: page.topY, bottom: page.bottomY });
  }
  return { identity, pages: serialized };
}

function resolvePosition(
  root: Element,
  position: SerializedPosition,
  childrenOf: (node: Node) => Node[],
): DomBreakPoint | undefined {
  let node: Node = root;
  for (const index of position.path) {
    if (!Number.isInteger(index) || index < 0) return undefined;
    const child = childrenOf(node)[index];
    if (!child) return undefined;
    node = child;
  }
  const offset = position.offset;
  if (offset === undefined) return { node };
  if (!Number.isInteger(offset) || offset < 0) return undefined;
  if (node.nodeType === 3 || node.nodeType === 4) {
    return offset <= (node as Text).length ? { node, offset } : undefined;
  }
  const children = childrenOf(node);
  if (offset > children.length) return undefined;
  const next = children[offset];
  const previous = children[offset - 1];
  return {
    node,
    offset: next ? Array.prototype.indexOf.call(node.childNodes, next)
      : previous ? Array.prototype.indexOf.call(node.childNodes, previous) + 1 : 0,
  };
}

export function restoreSnapshotPages(
  document: Document,
  identity: string | undefined,
  snapshot: PaginationSnapshot | undefined,
): Page[] | undefined {
  if (!identity || snapshot?.identity !== identity) return undefined;
  const children = new Map<Node, Node[]>();
  const childrenOf = (node: Node): Node[] => {
    let result = children.get(node);
    if (!result) {
      result = authoredChildren(node);
      children.set(node, result);
    }
    return result;
  };
  const pages = [];
  for (const page of snapshot.pages) {
    const start = resolvePosition(document.documentElement, page.start, childrenOf);
    const end = resolvePosition(document.documentElement, page.end, childrenOf);
    if (!start || !end || !Number.isFinite(page.top) || !Number.isFinite(page.bottom) || page.bottom < page.top) {
      return undefined;
    }
    pages.push(new Page(pages.length, start, end, page.top, page.bottom));
  }
  return pages;
}
