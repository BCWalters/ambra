import { isReaderOwnedContent } from "@ambra/engine";
import { restoreImageSemantics } from "./ImageViewerSemantics.js";

export interface PreparedTable {
  readonly xhtml: string;
  readonly caption: string;
  readonly unavailableResources: boolean;
}

const XHTML = "http://www.w3.org/1999/xhtml";
const INHERITED = ["font-family", "font-size", "font-weight", "font-style", "line-height",
  "letter-spacing", "word-spacing", "color", "text-align", "direction", "writing-mode"];

/**
 * Copy only a table and its ancestor chain from the already resource-resolved
 * reading surface. Publisher markup never enters the extension document.
 */
export function prepareTableViewer(table: HTMLTableElement): PreparedTable {
  const source = table.ownerDocument;
  const win = source.defaultView;
  if (!win || !table.isConnected) throw new Error("The source table is no longer available.");
  const doc = document.implementation.createDocument(XHTML, "html");
  const html = doc.documentElement;
  const copyAttributes = (from: Element, to: Element): void => {
    for (const attribute of Array.from(from.attributes)) {
      to.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }
  };
  copyAttributes(source.documentElement, html);
  const head = doc.createElementNS(XHTML, "head");
  const csp = doc.createElementNS(XHTML, "meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", "default-src 'none'; script-src 'none'; img-src blob:; " +
    "style-src blob: 'unsafe-inline'; font-src blob:; media-src 'none'; base-uri 'none'; form-action 'none';");
  head.append(csp);
  for (const node of source.head?.querySelectorAll("style, link[rel~='stylesheet']") ?? []) {
    if (!isReaderOwnedContent(node)) head.append(doc.importNode(node, true));
  }
  html.append(head);
  const ancestors: Element[] = [];
  for (let node = table.parentElement; node; node = node.parentElement) {
    if (node === source.documentElement) break;
    ancestors.unshift(node);
  }
  let parent: Element = html;
  for (const ancestor of ancestors) {
    const clone = doc.importNode(ancestor, false) as HTMLElement;
    const computed = win.getComputedStyle(ancestor);
    // Keep selector/inheritance context, but not pagination transforms, clipping,
    // fixed positioning or container constraints that would hide wide columns.
    for (const property of INHERITED) clone.style.setProperty(property, computed.getPropertyValue(property), "important");
    for (const [property, value] of Object.entries({
      position: "static", transform: "none", translate: "none", rotate: "none", scale: "none",
      overflow: "visible", contain: "none", columns: "auto", "clip-path": "none",
      height: "auto", "max-height": "none", "min-height": "0", width: "max-content", "max-width": "none",
      margin: "0", padding: "0", "content-visibility": "visible",
    })) clone.style.setProperty(property, value, "important");
    parent.append(clone);
    parent = clone;
  }
  const clone = doc.importNode(table, true) as HTMLTableElement;
  // Keep the rendered table size, not empty chapter/container width. Freezing
  // the resolved width also keeps percentage tables stable in the fitted frame.
  const tableWidth = win.getComputedStyle(table).width;
  if (tableWidth.endsWith("px")) clone.style.setProperty("width", tableWidth, "important");
  const sourceElements = Array.from(table.querySelectorAll("*"));
  const copiedElements = Array.from(clone.querySelectorAll("*"));
  sourceElements.forEach((element, index) => {
    if (isReaderOwnedContent(element)) copiedElements[index]?.remove();
    else if (element.localName === "img") {
      restoreImageSemantics(element as HTMLImageElement, copiedElements[index] as HTMLImageElement);
    }
  });
  parent.append(clone);
  // Theme custom properties and publisher root selectors survive; only the
  // reading surface's viewport mechanics are reset.
  const htmlStyle = (html as HTMLElement).style;
  htmlStyle.setProperty("direction", win.getComputedStyle(table).direction, "important");
  for (const [property, value] of Object.entries({
    overflow: "auto", height: "100%", width: "100%", margin: "0", padding: "0",
    transform: "none", columns: "auto", "scroll-behavior": "auto", "scrollbar-gutter": "auto",
  })) htmlStyle.setProperty(property, value, "important");
  const unavailableResources = sanitize(doc);
  return {
    xhtml: new XMLSerializer().serializeToString(doc),
    caption: table.caption?.textContent?.trim() ?? "",
    unavailableResources,
  };
}

function sanitize(doc: XMLDocument): boolean {
  let unavailableResources = false;
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    if (["script", "iframe", "object", "embed", "base", "audio", "video", "animate", "animateMotion",
      "animateTransform", "set"].includes(element.localName)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase();
      if (name.startsWith("on") || ["srcdoc", "action", "formaction", "autofocus", "contenteditable",
        "tabindex", "target", "download", "ping", "srcset"].includes(name)) {
        element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
      } else if (["href", "src", "poster", "data"].includes(name)) {
        const isResource = element.localName !== "a" && element.localName !== "area";
        const prepared = attribute.value.startsWith("blob:") ||
          (element.namespaceURI === "http://www.w3.org/2000/svg" && attribute.value.startsWith("#"));
        if (isResource && !prepared) {
          unavailableResources = true;
        }
        if (!isResource || !prepared) {
          element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
        }
      }
    }
    if (["input", "button", "select", "textarea", "fieldset"].includes(element.localName)) {
      element.setAttribute("disabled", "");
    }
  }
  return unavailableResources;
}
