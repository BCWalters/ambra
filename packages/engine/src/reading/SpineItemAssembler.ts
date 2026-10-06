import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { ContentDocumentAssembler } from "../rendering/ContentDocumentAssembler.js";

/**
 * Loads a spine item, resolves its resource references to blob URLs (via
 * `resolver`, expected to be reused across every spine item in a book so
 * its cache/dispose lifecycle spans the whole reading session rather than
 * one item), and assembles the final renderable XHTML string. The shared
 * load pipeline both `PaginatedContentHost` and `ScrollContentHost` build
 * on: ContentLoader -> ResourceUrlResolver -> ContentDocumentAssembler.
 */
export async function loadAssembledSpineItem(
  contentLoader: ContentLoader,
  resolver: ResourceUrlResolver,
  spineIndex: number,
  options: { applyReadingTheme?: boolean } = {},
): Promise<string> {
  const spineDoc = await contentLoader.loadSpineDocument(spineIndex);
  const references = contentLoader.findResourceReferences(spineDoc);
  const resourceResolutions = await resolver.resolveReferences(references);
  const publisherCss = new Map<string, string>();
  for (const style of Array.from(spineDoc.document.querySelectorAll("style"))) {
    const source = style.textContent ?? "";
    publisherCss.set(source, await resolver.rewriteCss(source, spineDoc.manifestItem.path));
  }
  const publisherStyleAttributes = new Map<string, string>();
  for (const element of Array.from(spineDoc.document.querySelectorAll("[style]"))) {
    const source = element.getAttribute("style")!;
    publisherStyleAttributes.set(
      source, await resolver.rewriteCss(source, spineDoc.manifestItem.path, true),
    );
  }
  return ContentDocumentAssembler.assemble(spineDoc, new Map(), {
    ...options, publisherCss, publisherStyleAttributes, resourceResolutions,
  });
}
