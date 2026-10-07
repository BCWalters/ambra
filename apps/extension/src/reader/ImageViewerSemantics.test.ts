import { afterEach, expect, it } from "vitest";
import { isReaderOwnedContent } from "@ambra/engine";
import { getInterfaceTheme } from "@ambra/shell/theme";
import { attachImageControlTheme, updateImageControlTheme } from "./ImageViewerSemantics.js";
import { prepareTableViewer } from "./TableViewerContent.js";

afterEach(() => { document.body.innerHTML = ""; });

it("installs reader-owned SVG styles without creating an HTML head or changing artwork", () => {
  const doc = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><defs><style>.art{fill:green}</style></defs><path class="art" d="M0 0h20v20z"/></svg>',
    "application/xhtml+xml",
  );
  const original = new XMLSerializer().serializeToString(doc);
  const artwork = doc.querySelector("path")!.outerHTML;
  const cleanup = attachImageControlTheme(doc, getInterfaceTheme("ambra", "light"));
  const style = doc.querySelector("style[data-ambra-image-controls]")!;
  expect(doc.head).toBeNull();
  expect(doc.body).toBeNull();
  expect(style.namespaceURI).toBe("http://www.w3.org/2000/svg");
  expect(isReaderOwnedContent(style)).toBe(true);
  expect(style.textContent).toContain("img[data-ambra-image-zoom]:focus-visible");
  updateImageControlTheme(doc, getInterfaceTheme("blue", "dark"));
  expect(doc.querySelector("path")!.outerHTML).toBe(artwork);
  expect(doc.querySelector("defs style")!.textContent).toBe(".art{fill:green}");
  cleanup();
  expect(new XMLSerializer().serializeToString(doc)).toBe(original);
});

it("themes only the image-button focus affordance and excludes it from publication clones", () => {
  document.body.innerHTML = '<table><tbody><tr><td><img src="blob:image" alt="Ink" style="color:red;filter:none" data-ambra-image-zoom></td></tr></tbody></table>';
  const table = document.querySelector("table")!;
  const original = table.outerHTML;
  const rootStyle = document.documentElement.getAttribute("style");
  const bodyStyle = document.body.getAttribute("style");
  const cleanup = attachImageControlTheme(document, getInterfaceTheme("ambra", "light"));
  const style = document.querySelector<HTMLStyleElement>("style[data-ambra-image-controls]")!;
  expect(isReaderOwnedContent(style)).toBe(true);
  for (const appearance of ["light", "dark"] as const) {
    for (const choice of ["ambra", "silver", "green", "blue", "purple"] as const) {
      const palette = getInterfaceTheme(choice, appearance);
      updateImageControlTheme(document, palette);
      expect(style.textContent).toContain(`outline: 2px solid ${palette.focus}`);
      expect(style.textContent).toContain(`box-shadow: 0 0 0 2px ${palette.surface}`);
      expect(style.textContent).toContain("img[data-ambra-image-zoom]:focus-visible");
      expect(table.outerHTML).toBe(original);
      expect(document.documentElement.getAttribute("style")).toBe(rootStyle);
      expect(document.body.getAttribute("style")).toBe(bodyStyle);
    }
  }
  expect(style.textContent).toContain("outline-color: Highlight");
  expect(prepareTableViewer(table).xhtml).not.toContain("data-ambra-image-controls");
  cleanup();
  expect(style.isConnected).toBe(false);
});
