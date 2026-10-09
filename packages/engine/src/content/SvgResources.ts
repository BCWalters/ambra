import { classifyEpubReference } from "../container/EpubReference.js";
import { getDescendantElementsByNS, getNamespacedAttributeName } from "../container/Xml.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const PRESENTATION_ATTRIBUTES = new Set([
  "fill", "stroke", "filter", "clip-path", "mask", "cursor",
  "marker", "marker-start", "marker-mid", "marker-end",
]);

export function getSvgHrefAttributes(document: Document): { element: Element; attributeName: string }[] {
  return getDescendantElementsByNS(document, SVG_NAMESPACE, "*").flatMap(element => {
    if (!["image", "use", "feImage"].includes(element.localName)) return [];
    const attributeName = element.hasAttribute("href") ? "href"
      : getNamespacedAttributeName(element, XLINK_NAMESPACE, "href");
    return attributeName ? [{ element, attributeName }] : [];
  });
}

export function getSvgPresentationAttributes(document: Document): { element: Element; attributeName: string }[] {
  return getDescendantElementsByNS(document, SVG_NAMESPACE, "*").flatMap(element =>
    Array.from(element.attributes).filter(attribute => PRESENTATION_ATTRIBUTES.has(attribute.name))
      .map(attribute => ({ element, attributeName: attribute.name })),
  );
}

export function sameDocumentSvgFragment(documentPath: string, href: string, baseHref?: string): string | undefined {
  const reference = classifyEpubReference(documentPath, href, baseHref);
  return reference.kind === "package" && reference.path === documentPath && reference.fragment !== undefined
    ? `#${encodeURIComponent(reference.fragment)}` : undefined;
}
