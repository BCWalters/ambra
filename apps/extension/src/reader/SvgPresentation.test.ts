import { describe, expect, it } from "vitest";
import { PackageDocument } from "@ambra/engine";
import { canStackSvgSpine, svgCanvasSpine } from "./SvgPresentation.js";

function fixture(types: readonly string[], layout = "reflowable", auxiliary = false) {
  return PackageDocument.parse(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">svg-presentation</dc:identifier>
      <dc:title>SVG presentation</dc:title><dc:language>en</dc:language><meta property="rendition:layout">${layout}</meta></metadata>
    <manifest>${types.map((type, index) => `<item id="s${index}" href="s${index}" media-type="${type}"/>`).join("")}</manifest>
    <spine>${types.map((_, index) => `<itemref idref="s${index}" ${auxiliary && index === types.length - 1 ? 'linear="no"' : ""}
      properties="rendition:layout-${layout === "roll" ? "reflowable" : layout} ${index === 1 ? "page-spread-right" : ""}"/>`).join("")}</spine></package>`, "EPUB/package.opf");
}

describe("SVG canvas presentation", () => {
  it("projects only SVG pages and retains manifest identity, linearity, sides and exact raw package CFI steps", () => {
    const pkg = fixture(["application/xhtml+xml", "image/svg+xml"]);
    const projected = svgCanvasSpine(pkg);
    expect(projected[0]).toBe(pkg.spine[0]);
    expect(projected[1]).not.toBe(pkg.spine[1]);
    expect(projected[1]?.resolveRenditionLayout(pkg.metadata.renditionLayout)).toBe("pre-paginated");
    expect(projected[1]?.manifestItem).toBe(pkg.spine[1]?.manifestItem);
    expect(projected[1]?.packageCfiSteps).toBe(pkg.spine[1]?.packageCfiSteps);
    expect(projected[1]?.linear).toBe(pkg.spine[1]?.linear);
    expect(projected[1]?.hasProperty("page-spread-right")).toBe(true);
    expect(pkg.spine[1]?.resolveRenditionLayout(pkg.metadata.renditionLayout)).toBe("reflowable");
    expect(pkg.metadata.renditionLayout).toBe("reflowable");
  });

  it("permits continuous stacking only for authored reflowable SVG primary spines", () => {
    expect(canStackSvgSpine(fixture(["image/svg+xml", "image/svg+xml"]))).toBe(true);
    expect(canStackSvgSpine(fixture(["image/svg+xml", "application/xhtml+xml"]))).toBe(false);
    expect(canStackSvgSpine(fixture(["image/svg+xml", "application/xhtml+xml"], "reflowable", true))).toBe(true);
    expect(canStackSvgSpine(fixture(["image/svg+xml"], "roll"))).toBe(false);
    expect(canStackSvgSpine(fixture(["image/svg+xml"], "pre-paginated"))).toBe(false);
  });

  it("retains authored roll planning without projecting canvases again", () => {
    const pkg = fixture(["image/svg+xml", "application/xhtml+xml"], "roll");
    expect(svgCanvasSpine(pkg)).toEqual(pkg.spine);
  });

  it("honors the single-page preference only on renderer-projected SVGs, leaving authored fixed pages intact", () => {
    const reflow = fixture(["image/svg+xml", "application/xhtml+xml"]);
    const projected = svgCanvasSpine(reflow, true);
    expect(projected[0]?.hasProperty("rendition:spread-none")).toBe(true);
    expect(reflow.spine[0]?.hasProperty("rendition:spread-none")).toBe(false);
    expect(projected[1]).toBe(reflow.spine[1]);
    const fixed = fixture(["image/svg+xml"], "pre-paginated");
    expect(svgCanvasSpine(fixed, true)[0]).toBe(fixed.spine[0]);
  });
});
