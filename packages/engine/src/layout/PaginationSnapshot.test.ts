// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { markReaderOwnedContent } from "../content/ReaderOwnedContent.js";
import { Page } from "./Page.js";
import { bodyPaint, paginationIdentity, restoreSnapshotPages, snapshotPages } from "./PaginationSnapshot.js";

function fixture() {
  const document = window.document.implementation.createHTMLDocument("Snapshot");
  document.body.innerHTML = '<p>First paragraph text.</p><details><summary>More</summary><p>Disclosure text.</p></details>';
  document.body.style.overflow = "hidden";
  const text = document.querySelector("p")!.firstChild!;
  const pages = [
    new Page(0, { node: text, offset: 0 }, { node: text, offset: 8 }, 20, 60),
    new Page(1, { node: text, offset: 8 }, { node: document.body, offset: 2 }, 60, 110),
  ];
  const paint = bodyPaint(document);
  const identity = () => paginationIdentity(document, "same assembled source", "600px", 900, 740, paint)!;
  return { document, text, pages, identity };
}

describe("DOM-free pagination snapshots", () => {
  it("round-trips through JSON into independent nodes without retaining the old document", () => {
    const source = fixture();
    const target = fixture();
    const snapshot = JSON.parse(JSON.stringify(snapshotPages(source.document, source.identity(), source.pages)));
    const restored = restoreSnapshotPages(target.document, target.identity(), snapshot)!;
    expect(restored).toHaveLength(2);
    expect(restored[0]!.startBreak.node).toBe(target.text);
    expect(restored[0]!.startBreak.node).not.toBe(source.text);
    expect(restored[1]!.startBreak.offset).toBe(8);
    expect(restored[1]!.endBreak).toEqual({ node: target.document.body, offset: 2 });
    expect(restored.map(page => [page.topY, page.bottomY])).toEqual([[20, 60], [60, 110]]);
  });

  it("ignores registered reader-owned nodes and page paint, but not authored DOM", () => {
    const source = fixture();
    const target = fixture();
    const original = source.identity();
    const overlay = source.document.createElement("aside");
    overlay.textContent = "Reader controls";
    markReaderOwnedContent(overlay);
    source.document.body.prepend(overlay);
    source.document.body.style.transform = "translateY(-500px)";
    source.document.body.style.clipPath = "inset(40px)";
    expect(source.identity()).toBe(original);
    const snapshot = snapshotPages(source.document, original, [
      new Page(0, { node: source.text, offset: 0 }, { node: source.document.body, offset: 3 }, 0, 100),
    ]);
    expect(restoreSnapshotPages(target.document, target.identity(), snapshot)![0]!.endBreak.offset).toBe(2);
    source.document.body.append(source.document.createElement("aside"));
    expect(source.identity()).not.toBe(original);
  });

  it.each([
    (doc: Document) => doc.querySelector("details")!.setAttribute("open", ""),
    (doc: Document) => { doc.body.style.fontSize = "24px"; },
    (doc: Document) => { doc.body.dir = "rtl"; },
    (doc: Document) => doc.querySelector("p")!.setAttribute("tabindex", "-1"),
    (doc: Document) => { doc.querySelector("p")!.textContent = "Changed publication"; },
    (doc: Document) => doc.head.append(doc.createElement("style")),
  ])("falls back after a publication or configuration change", change => {
    const source = fixture();
    const target = fixture();
    const snapshot = snapshotPages(source.document, source.identity(), source.pages);
    change(target.document);
    expect(restoreSnapshotPages(target.document, target.identity(), snapshot)).toBeUndefined();
  });

  it("rejects changed source/geometry and invalid serialized positions", () => {
    const source = fixture();
    const target = fixture();
    const snapshot = snapshotPages(source.document, source.identity(), source.pages)!;
    const resized = paginationIdentity(target.document, "same assembled source", "601px", 900, 740, bodyPaint(target.document));
    const changedSource = paginationIdentity(target.document, "different source", "600px", 900, 740, bodyPaint(target.document));
    expect(restoreSnapshotPages(target.document, resized, snapshot)).toBeUndefined();
    expect(restoreSnapshotPages(target.document, changedSource, snapshot)).toBeUndefined();
    const malformed = { ...snapshot, pages: [{ ...snapshot.pages[0]!, start: { path: [999], offset: 0 } }] };
    expect(restoreSnapshotPages(target.document, target.identity(), malformed)).toBeUndefined();
  });

  it("detects CSSOM-only rule changes that do not change the serialized style element", () => {
    const source = fixture();
    const style = source.document.createElement("style");
    style.textContent = "p { font-size: 18px; }";
    source.document.head.append(style);
    const before = source.identity();
    style.sheet!.insertRule("p { font-size: 28px; }", 1);
    expect(style.textContent).toBe("p { font-size: 18px; }");
    expect(source.identity()).not.toBe(before);
  });

  it.each(["animate", "animateMotion", "animateTransform", "animateColor", "set", "discard"])(
    "rejects SVG %s even when the Web Animations API reports no animations", tag => {
      const source = fixture();
      const svg = source.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.append(source.document.createElementNS(svg.namespaceURI, tag));
      source.document.body.append(svg);
      Object.defineProperty(source.document, "getAnimations", { value: () => [] });
      expect(source.identity()).toBeUndefined();
    },
  );

  it.each(["img", "image", "use", "video", "audio", "canvas", "iframe", "object", "embed"])(
    "rejects potentially dynamic %s layout rather than relying on serialized markup", tag => {
      const source = fixture();
      source.document.body.append(source.document.createElement(tag));
      expect(source.identity()).toBeUndefined();
    },
  );

  it("allows static inline SVG and ignores media inside registered reader-owned overlays", () => {
    const source = fixture();
    source.document.body.innerHTML += '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>';
    const original = source.identity();
    expect(original).toBeDefined();
    const overlay = source.document.createElement("div");
    overlay.append(source.document.createElement("video"), source.document.createElement("img"));
    markReaderOwnedContent(overlay);
    source.document.body.append(overlay);
    expect(source.identity()).toBe(original);
  });
});
