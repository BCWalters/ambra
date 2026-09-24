// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Page } from "../layout/Page.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";

function fixture() {
  const host = new PaginatedContentHost(600, 900);
  const doc = document.implementation.createHTMLDocument();
  doc.body.textContent = "Original viewport-relative page content.";
  Object.defineProperty(host.element, "contentDocument", { value: doc });
  Reflect.set(host, "insetTop", 80);
  Reflect.set(host, "insetBottom", 80);
  Reflect.set(host, "pages", [
    new Page(0, { node: doc.body }, { node: doc.body, offset: 1 }, 0, 600),
    new Page(1, { node: doc.body }, { node: doc.body, offset: 1 }, 600, 1000),
  ]);
  doc.body.getBoundingClientRect = () => ({
    top: host.currentPageIndex === 0 ? 80 : -520,
  }) as DOMRect;
  host.goToPageIndex(0);
  return { host, body: doc.body };
}

describe("paginated viewport and animation paint clipping", () => {
  it("keeps the pagination viewport while clipping short and later pages exactly", () => {
    const { host, body } = fixture();
    expect(host.element.style.height).toBe("900px");
    expect(host.element.style.clipPath).toBe("inset(80px 0 220px 0)");
    host.goToPageIndex(1);
    expect(body.style.transform).toBe("translateY(-520px)");
    expect(host.element.style.height).toBe("900px");
    expect(host.element.style.clipPath).toBe("inset(80px 0 420px 0)");
    host.dispose();
  });

  it.each([0, 1])("moves page %i clipping inside the iframe without resizing or changing translation", page => {
    const { host, body } = fixture();
    host.goToPageIndex(page);
    body.style.setProperty("clip-path", "inset(2px)", "important");
    const transform = body.style.transform;
    host.suppressClipPathForAnimation();
    host.growToFullHeight(900);
    expect(host.element.style.height).toBe("900px");
    expect(host.element.style.clipPath).toBe("");
    expect(body.style.transform).toBe(transform);
    expect(body.style.clipPath).toBe(page === 0
      ? "polygon(0 0px, 100% 0px, 100% 600px, 0 600px)"
      : "polygon(0 600px, 100% 600px, 100% 1000px, 0 1000px)");
    expect(body.style.getPropertyPriority("clip-path")).toBe("important");
    host.restoreNaturalHeight();
    host.restoreNaturalHeight();
    expect(host.element.style.height).toBe("900px");
    expect(body.style.clipPath).toBe("inset(2px)");
    expect(body.style.getPropertyPriority("clip-path")).toBe("important");
    expect(host.element.style.clipPath).toBe(page === 0
      ? "inset(80px 0 220px 0)" : "inset(80px 0 420px 0)");
    host.dispose();
  });

  it.each(["overlay-first", "animation-first"] as const)(
    "%s preserves both clip owners until their respective cleanup", order => {
      const { host, body } = fixture();
      body.style.clipPath = "inset(3px)";
      if (order === "animation-first") host.suppressClipPathForAnimation();
      const close = host.revealReaderOverlay();
      if (order === "overlay-first") host.suppressClipPathForAnimation();
      if (order === "overlay-first") close();
      else host.restoreNaturalHeight();
      expect(host.element.style.clipPath).toBe("");
      expect(body.style.clipPath).toMatch(/^polygon/);
      if (order === "overlay-first") host.restoreNaturalHeight();
      else close();
      expect(body.style.clipPath).toBe("inset(3px)");
      expect(body.style.getPropertyPriority("clip-path")).toBe("");
      expect(host.element.style.clipPath).toBe("inset(80px 0 220px 0)");
      host.dispose();
    },
  );
});
