export function isSvgRoot(element: Element | null): element is SVGSVGElement {
  return (
    element?.namespaceURI === "http://www.w3.org/2000/svg" &&
    element.localName === "svg" &&
    "style" in element
  );
}

export function contentDocumentRoot(document: Document): HTMLElement | SVGSVGElement {
  if (document.body) return document.body;
  if (isSvgRoot(document.documentElement)) return document.documentElement;
  throw new Error("Content document has neither an XHTML body nor an SVG root.");
}
