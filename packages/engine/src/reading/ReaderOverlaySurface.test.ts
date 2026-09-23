// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Page } from "../layout/Page.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";

afterEach(() => vi.restoreAllMocks());

describe("paginated reader overlay surface", () => {
  function surface() {
    const host = new PaginatedContentHost(600, 900);
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = "<p>A very short final page.</p>";
    doc.body.style.setProperty("clip-path", "inset(2px)", "important");
    Object.defineProperty(host.element, "contentDocument", { configurable: true, value: doc });
    const pages = [
      new Page(0, { node: doc.body, offset: 0 }, { node: doc.body, offset: 1 }, 200, 215),
      new Page(1, { node: doc.body, offset: 0 }, { node: doc.body, offset: 1 }, 400, 420),
    ];
    Reflect.set(host, "pages", pages);
    vi.spyOn(doc.body, "getBoundingClientRect").mockImplementation(() => ({
      top: Number.parseFloat(doc.body.style.transform.slice("translateY(".length)),
    }) as DOMRect);
    host.goToPageIndex(0);
    return { host, doc, pages };
  }

  it("gives native controls room while preserving the current publication band and page count", () => {
    const { host, doc, pages } = surface();
    const height = host.element.style.height;
    const clip = host.element.style.clipPath;
    const text = doc.body.textContent;
    const restore = host.revealReaderOverlay();
    expect(host.element.style.height).toBe("900px");
    expect(host.element.style.clipPath).toBe("");
    expect(doc.body.style.clipPath).toBe("polygon(0 200px, 100% 200px, 100% 215px, 0 215px)");
    expect(doc.body.textContent).toBe(text);
    expect(Reflect.get(host, "pages")).toBe(pages);
    expect(host.pageCount).toBe(2);
    restore();
    expect(host.element.style.height).toBe(height);
    expect(host.element.style.clipPath).toBe(clip);
    expect(doc.body.style.clipPath).toBe("inset(2px)");
    expect(doc.body.style.getPropertyPriority("clip-path")).toBe("important");
    host.dispose();
  });

  it("uses current page geometry while open and ignores a stale restoration after disposal", () => {
    const { host, doc } = surface();
    const restore = host.revealReaderOverlay();
    host.goToPageIndex(1);
    expect(host.element.style.height).toBe("900px");
    expect(doc.body.style.clipPath).toBe("polygon(0 400px, 100% 400px, 100% 420px, 0 420px)");
    restore();
    expect(host.currentPageIndex).toBe(1);
    expect(host.element.style.clipPath).not.toBe("");
    host.revealReaderOverlay();
    host.dispose();
    restore();
    expect(Reflect.get(host, "readerOverlay")).toBeUndefined();
  });
});
