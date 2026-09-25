// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { Page } from "../layout/Page.js";
import { PaginationEngine } from "../layout/PaginationEngine.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";
import * as SpineItemAssembler from "./SpineItemAssembler.js";
import { SandboxedContentHost } from "../rendering/SandboxedContentHost.js";
import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { DisclosureState } from "./DisclosureState.js";

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
  it("configures after disclosures and before the only initial pagination", async () => {
    const { host, body } = fixture();
    const doc = body.ownerDocument;
    const assemble = vi.spyOn(SpineItemAssembler, "loadAssembledSpineItem").mockResolvedValue("");
    const render = vi.spyOn(SandboxedContentHost.prototype, "render").mockResolvedValue();
    const attach = vi.fn(() => { body.dataset.disclosure = "applied"; return () => {}; });
    const configure = vi.fn((document: Document) => {
      expect(document).toBe(doc);
      expect(body.dataset.disclosure).toBe("applied");
      body.dataset.configured = "true";
    });
    const paginate = vi.spyOn(PaginationEngine, "paginate").mockImplementation(() => {
      expect(body.dataset.configured).toBe("true");
      return [];
    });
    try {
      await host.open({} as ContentLoader, {} as ResourceUrlResolver, 0,
        { attach } as unknown as DisclosureState, configure);
      expect(attach).toHaveBeenCalledWith(0, doc);
      expect(configure).toHaveBeenCalledOnce();
      expect(paginate).toHaveBeenCalledOnce();
    } finally {
      assemble.mockRestore();
      render.mockRestore();
      paginate.mockRestore();
      host.dispose();
    }
  });

  it("sets the new iframe height before measuring viewport-relative publication styles", () => {
    const { host } = fixture();
    const pages = Reflect.get(host, "pages") as Page[];
    const paginate = vi.spyOn(PaginationEngine, "paginate").mockImplementation(() => {
      expect(host.element.style.width).toBe("580px");
      expect(host.element.style.height).toBe("1000px");
      return pages;
    });
    try {
      host.relayout(580, 1000);
      expect(paginate).toHaveBeenCalledOnce();
    } finally {
      paginate.mockRestore();
      host.dispose();
    }
  });

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
