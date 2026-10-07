// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { contentDocumentRoot, isSvgRoot } from "./ContentDocumentRoot.js";

it("uses the existing XHTML body without changing its root", () => {
  const doc = document.implementation.createHTMLDocument();
  expect(contentDocumentRoot(doc)).toBe(doc.body);
  expect(isSvgRoot(doc.documentElement)).toBe(false);
});

it.each(["image/svg+xml", "application/xhtml+xml"] as const)(
  "uses original SVG parsed as %s without inserting a body",
  (type) => {
    const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"/>', type);
    const root = contentDocumentRoot(doc);
    expect(isSvgRoot(root)).toBe(true);
    expect(root).toBe(doc.documentElement);
    expect(doc.body).toBeNull();
    root.style.transform = "translateY(20px)";
    expect(root.style.transform).toBe("translateY(20px)");
  },
);

it("rejects an unsupported XML root explicitly", () => {
  const doc = document.implementation.createDocument("urn:foreign", "svg");
  expect(() => contentDocumentRoot(doc)).toThrow("neither an XHTML body nor an SVG root");
});
