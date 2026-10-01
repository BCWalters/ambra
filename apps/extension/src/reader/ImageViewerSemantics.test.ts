import { afterEach, expect, it } from "vitest";
import { isReaderOwnedContent } from "@ambra/engine";
import { getInterfaceTheme } from "@ambra/shell/theme";
import { attachImageControlTheme, updateImageControlTheme } from "./ImageViewerSemantics.js";
import { prepareTableViewer } from "./TableViewerContent.js";

afterEach(() => { document.body.innerHTML = ""; });

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
