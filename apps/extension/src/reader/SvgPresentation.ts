import { primarySpineIndices, SpineItemRef } from "@ambra/engine";
import type { PackageDocument } from "@ambra/engine";

export function isSvgSpineItem(item: SpineItemRef | undefined): boolean {
  return item?.manifestItem.mediaType.split(";")[0]?.trim().toLowerCase() === "image/svg+xml";
}

/** Render SVG canvases as pages without changing their authored OPF/CFI model. */
export function svgCanvasSpine(pkg: PackageDocument, singlePage = false): readonly SpineItemRef[] {
  return pkg.spine.map(item => {
    if (!isSvgSpineItem(item) || item.resolveRenditionLayout(pkg.metadata.renditionLayout) !== "reflowable") return item;
    const properties = new Set([...item.properties].filter(value => !value.startsWith("rendition:layout-")));
    properties.add("rendition:layout-pre-paginated");
    if (singlePage) {
      for (const value of properties) if (value.startsWith("rendition:spread-")) properties.delete(value);
      properties.add("rendition:spread-none");
    }
    return new SpineItemRef(item.manifestItem, item.linear, properties, item.packageCfiSteps);
  });
}

export function canStackSvgSpine(pkg: PackageDocument): boolean {
  const primary = primarySpineIndices(pkg.spine);
  return primary.length > 0 && primary.every(index => {
    const item = pkg.spine[index]!;
    return isSvgSpineItem(item) && item.resolveRenditionLayout(pkg.metadata.renditionLayout) === "reflowable";
  });
}
