import { describe, expect, it, vi } from "vitest";
import { NavPoint, PackageDocument } from "@ambra/engine";
import { ReaderController } from "./ReaderController.js";
import { DiagnosticsLog } from "./DiagnosticsLog.js";

function setup(linear = [false, true, false, true, false]) {
  const pkg = PackageDocument.parse(
    `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">primary</dc:identifier>
      <dc:title>Primary order</dc:title><dc:language>en</dc:language></metadata>
      <manifest>${linear.map((_, index) => `<item id="c${index}" href="c${index}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest>
      <spine>${linear.map((value, index) => `<itemref idref="c${index}" linear="${value ? "yes" : "no"}"/>`).join("")}</spine>
    </package>`, "EPUB/package.opf",
  );
  const reader: ReaderController = Object.create(ReaderController.prototype);
  const open = vi.fn(async () => {});
  Object.assign(reader, {
    pkg, spineIndex: 2, diagnostics: new DiagnosticsLog(), operations: { disposed: false },
    navigation: { toc: { items: [] } }, nativeReading: { current: () => undefined },
    contentDocumentViews: () => [], openSpineItem: open, clearNavigationHighlights: vi.fn(),
  });
  return { reader, open };
}

describe("reader primary order", () => {
  it("leaves a supplement for the nearest primary chapter in either direction", async () => {
    const { reader, open } = setup();
    await reader.goToChapter(1);
    expect(open).toHaveBeenLastCalledWith(3, { history: "jump" });
    await reader.goToChapter(-1);
    expect(open).toHaveBeenLastCalledWith(1, { history: "jump" });
  });

  it("uses only primary slots for coarse progress, previews and seeking", async () => {
    const { reader, open } = setup();
    expect(reader.previewSeek(0).position).toEqual({ kind: "chapter", current: 1, total: 2 });
    expect(reader.previewSeek(1).position).toEqual({ kind: "chapter", current: 2, total: 2 });
    await reader.seekToFraction(0);
    expect(open).toHaveBeenLastCalledWith(1, { landOnFractionInItem: 0, history: "jump" });
    await reader.seekToFraction(0.75);
    expect(open).toHaveBeenLastCalledWith(3, { landOnFractionInItem: 0.5, history: "jump" });
  });

  it("retains direct navigation to supplemental TOC entries", async () => {
    const { reader, open } = setup();
    await reader.goToNavPoint(new NavPoint("Supplement", "EPUB/c2.xhtml", "target", []));
    expect(open).toHaveBeenLastCalledWith(2, { fragment: "target", history: "jump" });
  });

  it("does not invent progression or progress for an all-non-linear publication", async () => {
    const { reader, open } = setup([false, false, false]);
    await reader.goToChapter(1);
    await reader.goToChapter(-1);
    expect(open).not.toHaveBeenCalled();
    expect(() => reader.previewSeek(0.5)).toThrow("no primary reading order");
    await expect(reader.seekToFraction(0.5)).rejects.toThrow("no primary reading order");
  });
});
