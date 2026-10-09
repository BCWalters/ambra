import { HighlightTheme } from "@ambra/engine";

function isSvgText(element: Element): element is SVGElement {
  return element.namespaceURI === "http://www.w3.org/2000/svg" &&
    ["text", "tspan", "textpath"].includes(element.localName.toLowerCase());
}

export function applySvgNarrationPaint(element: Element): () => void {
  const window = element.ownerDocument.defaultView;
  if (!window) {
    console.warn("Ambra could not paint SVG narration in a detached content document.");
    return () => {};
  }
  const texts = [element, ...element.querySelectorAll("text, tspan, textPath")].filter(isSvgText);
  // Capture inherited author shadows before adding any reader-owned paint.
  const original = texts.map(text => ({
    text,
    hadStyle: text.hasAttribute("style"),
    value: text.style.getPropertyValue("text-shadow"),
    priority: text.style.getPropertyPriority("text-shadow"),
    computed: window.getComputedStyle(text).getPropertyValue("text-shadow"),
  }));
  const halo = `0 0 1px ${HighlightTheme.NARRATION_BACKGROUND}, 0 0 1px ${HighlightTheme.NARRATION_BACKGROUND}`;
  for (const { text, computed } of original) {
    text.style.setProperty("text-shadow", computed && computed !== "none" ? `${computed}, ${halo}` : halo, "important");
  }
  return () => {
    for (const { text, hadStyle, value, priority } of original) {
      if (value) text.style.setProperty("text-shadow", value, priority);
      else text.style.removeProperty("text-shadow");
      if (!hadStyle && text.style.length === 0) text.removeAttribute("style");
    }
  };
}
