import type { ContentDocument } from "../content/ContentLoader.js";
import { ContentLoaderError, findResourceReferencesInDocument } from "../content/ContentLoader.js";
import { EPUB_CSS_RESET } from "./EpubCssReset.js";
import { ReadingTheme } from "./ReadingTheme.js";
import { HighlightTheme } from "./HighlightTheme.js";
import { resourceResolutionKey } from "./ResourceFallbackSelector.js";
import type { ResolvedResource, ResourceUrlResolver } from "./ResourceUrlResolver.js";
import { classifyEpubReference, externalNavigationUrl, getDocumentBaseHref } from "../container/EpubReference.js";
import { getNamespacedAttributeName } from "../container/Xml.js";
import { CONTENT_SECURITY_POLICY, NESTED_CONTENT_SECURITY_POLICY } from "./ContentSecurityPolicy.js";
import { getSvgHrefAttributes, getSvgPresentationAttributes, sameDocumentSvgFragment } from "../content/SvgResources.js";

export const MAX_NESTED_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_NESTED_RESOURCE_BYTES = 32 * 1024 * 1024;
export interface NestedResourceBudget { remaining: number }

/**
 * Assembles a self-contained, sandboxed-iframe-ready XHTML document from a
 * `ContentDocument`: rewrites every resource reference to the `blob:` URL
 * provided for it, injects a restrictive CSP `<meta>` tag and the base
 * `EPUB_CSS_RESET` stylesheet (ahead of the book's own CSS in source
 * order, so book styles still win the cascade), and serializes the result
 * back to an XML string.
 *
 * Deliberately a stateless, pure-function-shaped class (no instance state)
 * rather than a free function, since it groups a small family of related
 * assembly steps under one clear, discoverable name.
 */
export class ContentDocumentAssembler {
  public static async prepare(
    contentDocument: ContentDocument,
    resolver: ResourceUrlResolver,
    options: { applyReadingTheme?: boolean; nestedDocument?: boolean } = {},
    documentAncestors: ReadonlySet<string> = new Set(),
    budget: NestedResourceBudget = { remaining: MAX_NESTED_RESOURCE_BYTES },
  ): Promise<string> {
    const path = contentDocument.manifestItem.path;
    const baseHref = getDocumentBaseHref(contentDocument.document);
    const ancestors = new Set([...documentAncestors, path]);
    const references = findResourceReferencesInDocument(
      contentDocument.document, path, { includeUnavailable: true },
    );
    const nested = options.nestedDocument ?? false;
    if (nested && contentDocument.rawText.length > MAX_NESTED_DOCUMENT_BYTES) {
      throw new ContentLoaderError(`Packaged child document exceeds the ${MAX_NESTED_DOCUMENT_BYTES}-byte limit: ${path}`);
    }
    const resourceResolutions = await resolver.resolveReferences(references, ancestors, nested, budget);
    const publisherCss = new Map<string, string>();
    for (const style of publisherStyles(contentDocument.document)) {
      const source = style.textContent ?? "";
      publisherCss.set(source, await resolver.rewriteCss(source, path, false, ancestors, nested, budget, baseHref));
    }
    const publisherStyleAttributes = new Map<string, string>();
    for (const element of Array.from(contentDocument.document.querySelectorAll("[style]"))) {
      const source = element.getAttribute("style")!;
      publisherStyleAttributes.set(source, await resolver.rewriteCss(source, path, true, ancestors, nested, budget, baseHref));
    }
    const publisherPresentationAttributes = new Map<string, string>();
    const presentationAttributes = getSvgPresentationAttributes(contentDocument.document);
    for (const { element, attributeName } of presentationAttributes) {
      const source = element.getAttribute(attributeName)!;
      if (!publisherPresentationAttributes.has(source)) {
        publisherPresentationAttributes.set(source,
          await resolver.rewriteCss(source, path, "value", ancestors, nested, budget, baseHref));
      }
    }
    if (nested) {
      let expandedBytes = new TextEncoder().encode(contentDocument.rawText).byteLength + 16_384;
      for (const reference of references) {
        expandedBytes += resourceResolutions.get(resourceResolutionKey(reference.path, reference.consumer))?.url.length ?? 0;
      }
      for (const style of publisherStyles(contentDocument.document)) {
        expandedBytes += publisherCss.get(style.textContent ?? "")?.length ?? 0;
      }
      for (const element of Array.from(contentDocument.document.querySelectorAll("[style]"))) {
        expandedBytes += publisherStyleAttributes.get(element.getAttribute("style")!)?.length ?? 0;
      }
      for (const { element, attributeName } of presentationAttributes) {
        expandedBytes += publisherPresentationAttributes.get(element.getAttribute(attributeName)!)?.length ?? 0;
      }
      if (expandedBytes > MAX_NESTED_DOCUMENT_BYTES || expandedBytes > budget.remaining) {
        throw new ContentLoaderError(`Packaged child resources exceed the bounded assembly budget: ${path}`);
      }
      budget.remaining -= expandedBytes;
    }
    return this.assemble(contentDocument, new Map(), {
      ...options, publisherCss, publisherStyleAttributes, publisherPresentationAttributes, resourceResolutions,
    });
  }

  /** `resourceUrls` maps archive-relative resource paths (as produced by
   * `ContentLoader.findResourceReferences`) to their `blob:` URLs, e.g.
   * from `ResourceUrlResolver.resolveAll`. References with no entry in the
   * map are left untouched (this can legitimately happen for a resource
   * reference that failed to resolve; leaving it as-is means the sandboxed
   * frame simply fails to load that one resource, rather than the whole
   * page failing). */
  public static assemble(
    contentDocument: ContentDocument,
    resourceUrls: ReadonlyMap<string, string>,
    options: {
      applyReadingTheme?: boolean;
      publisherCss?: ReadonlyMap<string, string>;
      publisherStyleAttributes?: ReadonlyMap<string, string>;
      publisherPresentationAttributes?: ReadonlyMap<string, string>;
      resourceResolutions?: ReadonlyMap<string, ResolvedResource | null>;
      nestedDocument?: boolean;
    } = {},
  ): string {
    // Re-parse from the original raw text rather than cloning
    // `contentDocument.document`, guaranteeing a fully independent DOM tree
    // to mutate — the original parsed document is left untouched for other
    // consumers (e.g. future CFI resolution) that need pristine hrefs.
    const doc = new DOMParser().parseFromString(contentDocument.rawText, "application/xhtml+xml");
    const baseHref = getDocumentBaseHref(doc);
    for (const { element, attributeName } of getSvgHrefAttributes(doc)) {
      const fragment = sameDocumentSvgFragment(contentDocument.manifestItem.path, element.getAttribute(attributeName)!, baseHref);
      if (fragment !== undefined) element.setAttribute(attributeName, fragment);
    }
    for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
      frame.removeAttribute("srcdoc");
      frame.setAttribute("sandbox", "");
      frame.setAttribute("csp", NESTED_CONTENT_SECURITY_POLICY);
      frame.setAttribute("referrerpolicy", "no-referrer");
    }
    for (const anchor of Array.from(doc.querySelectorAll("a"))) {
      const attribute = anchor.hasAttribute("href") ? "href"
        : getNamespacedAttributeName(anchor, "http://www.w3.org/1999/xlink", "href");
      if (!attribute) continue;
      const reference = classifyEpubReference(contentDocument.manifestItem.path, anchor.getAttribute(attribute)!, baseHref);
      if (reference.kind !== "package" && reference.kind !== "fragment" && !externalNavigationUrl(reference)) {
        anchor.setAttribute(attribute, "#");
        anchor.setAttribute("data-ambra-blocked-link", reference.kind);
      } else if (baseHref !== undefined) {
        const fragment = reference.kind === "package" || reference.kind === "fragment"
          ? reference.fragment === undefined ? "" : `#${encodeURIComponent(reference.fragment)}`
          : "";
        anchor.setAttribute(attribute, reference.kind === "package"
          ? `/${reference.path.split("/").map(encodeURIComponent).join("/")}${fragment}`
          : reference.kind === "fragment" ? fragment : externalNavigationUrl(reference)!);
      }
    }

    const references = findResourceReferencesInDocument(doc, contentDocument.manifestItem.path, { includeUnavailable: true });
    const sourceTypes = new Map<Element, Set<string>>();
    const objectImages = new Map<Element, string>();
    // Replace candidates from right to left so original URL offsets stay valid.
    for (const reference of references.reverse()) {
      const resolution = options.resourceResolutions?.get(resourceResolutionKey(reference.path, reference.consumer));
      const { element, attributeName, attributeRange, candidateRange } = reference;
      if (element.localName === "iframe" && !resolution?.isolatedDocument) {
        element.removeAttribute(attributeName);
        continue;
      }
      if (resolution === null) {
        const value = element.getAttribute(attributeName)!;
        if (candidateRange) {
          const remaining = value.slice(0, candidateRange.start) + value.slice(candidateRange.end);
          if (/^[\t\n\f\r ,]*$/.test(remaining)) element.removeAttribute(attributeName);
          else element.setAttribute(attributeName, remaining);
        } else {
          element.removeAttribute(attributeName);
        }
        if (["source", "object", "embed"].includes(element.localName)) element.removeAttribute("type");
        continue;
      }
      const url = resolution?.url ?? resourceUrls.get(reference.path);
      if (url) {
        const value = element.getAttribute(attributeName)!;
        const fragment = attributeRange ? "" : value.includes("#") ? value.slice(value.indexOf("#")) : "";
        element.setAttribute(attributeName, attributeRange
          ? value.slice(0, attributeRange.start) + url + value.slice(attributeRange.end)
          : url + fragment);
        if (resolution && element.localName === "source") {
          const types = sourceTypes.get(element) ?? new Set<string>();
          types.add(resolution.mediaType);
          sourceTypes.set(element, types);
        }
        if (resolution && ["object", "embed"].includes(element.localName)) objectImages.set(element, url + fragment);
      }
    }
    for (const [source, types] of sourceTypes) {
      if (types.size === 1) source.setAttribute("type", [...types][0]!);
      else source.removeAttribute("type");
    }
    // Render image objects with <img>, not object-src: allowing nested
    // documents would bypass the assembler's resource rewriting and CSP.
    for (const [object, url] of objectImages) {
      const image = doc.createElementNS(object.namespaceURI, "img");
      for (const attribute of Array.from(object.attributes)) {
        if (!["data", "type", "classid", "codebase", "archive", "name"].includes(attribute.name) &&
            !attribute.name.toLowerCase().startsWith("on")) {
          image.setAttribute(attribute.name, attribute.value);
        }
      }
      image.setAttribute("src", url);
      image.setAttribute("alt", object.getAttribute("aria-label") ?? object.textContent?.trim() ?? "");
      object.replaceWith(image);
    }
    for (const style of publisherStyles(doc)) {
      const rewritten = options.publisherCss?.get(style.textContent ?? "");
      if (rewritten !== undefined) style.textContent = rewritten;
    }
    for (const element of Array.from(doc.querySelectorAll("[style]"))) {
      const rewritten = options.publisherStyleAttributes?.get(element.getAttribute("style")!);
      if (rewritten !== undefined) element.setAttribute("style", rewritten);
    }
    for (const { element, attributeName } of getSvgPresentationAttributes(doc)) {
      const rewritten = options.publisherPresentationAttributes?.get(element.getAttribute(attributeName)!);
      if (rewritten === undefined) continue;
      if (rewritten.trim()) element.setAttribute(attributeName, rewritten);
      else element.removeAttribute(attributeName);
    }
    // The reader consumes canonical links and resolved resources. Never let
    // the original base affect blob-frame navigation or publisher targets.
    for (const base of Array.from(doc.querySelectorAll("base"))) base.remove();

    injectContentSecurityPolicy(doc, options.nestedDocument ? NESTED_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY);
    injectCssReset(doc);
    // Reading theme (typography, margins, colors) applies to reflowable
    // content only, never fixed-layout — see `ReadingTheme`'s doc comment.
    // Defaults to on since most callers (paginated/scroll mode) want it;
    // `FixedContentHost` is the one caller that opts out.
    if (options.applyReadingTheme ?? true) {
      injectReadingTheme(doc);
      injectHighlightTheme(doc);
    }

    return new XMLSerializer().serializeToString(doc);
  }
}

function publisherStyles(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll("*")).filter(element => element.localName === "style");
}

function injectContentSecurityPolicy(doc: Document, policy: string): void {
  const head = doc.getElementsByTagName("head")[0];
  if (!head) {
    return;
  }

  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", policy);
  head.insertBefore(meta, head.firstChild);
}

/** Injects the base `EPUB_CSS_RESET` stylesheet as the first `<style>` in
 * `<head>` — after the CSP `<meta>` (which should stay the very first
 * element for defense-in-depth: some user agents only honor a CSP
 * `<meta>` if it precedes other content), but before anything else in the
 * document's original `<head>` (its `<title>`, the book's own
 * `<link rel="stylesheet">`/`<style>`, viewport `<meta>`, etc.). Later
 * source-order rules of equal specificity win the CSS cascade, so the
 * book's own styles naturally override this reset wherever they disagree. */
function injectCssReset(doc: Document): void {
  const head = doc.getElementsByTagName("head")[0];
  if (!head) {
    return;
  }

  const style = doc.createElement("style");
  style.textContent = EPUB_CSS_RESET;

  const cspMeta = head.querySelector('meta[http-equiv="Content-Security-Policy"]');
  head.insertBefore(style, cspMeta ? cspMeta.nextSibling : head.firstChild);
}

/** Injects `ReadingTheme.CSS` as the `<style>` immediately after the CSS
 * reset — later in source order, so it can layer typography on top of the
 * reset's box-model rules for the same selectors (e.g. both declare rules
 * for `html, body`) — but still before anything from the book's own
 * `<head>`, so publisher typography keeps final say. Explicit page-color
 * themes use narrowly scoped overrides in `ReadingTheme.CSS`. */
function injectReadingTheme(doc: Document): void {
  const head = doc.getElementsByTagName("head")[0];
  if (!head) {
    return;
  }

  const style = doc.createElement("style");
  style.textContent = ReadingTheme.CSS;

  const resetStyle = Array.from(head.getElementsByTagName("style")).find((s) => s.textContent === EPUB_CSS_RESET);
  head.insertBefore(style, resetStyle ? resetStyle.nextSibling : head.firstChild);
}

/** Injects `HighlightTheme.CSS` (the `::highlight()` style definitions
 * for every highlight color/underline — see `HighlightTheme`) right
 * after the reading theme, same reasoning: later in source order than
 * the reset, but still ahead of the book's own `<head>` content. Ranges
 * aren't populated here — `ReaderController` does that separately via
 * `CSS.highlights` once the document is loaded and live, since it needs
 * real `Range` objects that don't exist until then. */
function injectHighlightTheme(doc: Document): void {
  const head = doc.getElementsByTagName("head")[0];
  if (!head) {
    return;
  }

  const style = doc.createElement("style");
  style.textContent = HighlightTheme.CSS;

  const themeStyle = Array.from(head.getElementsByTagName("style")).find((s) => s.textContent === ReadingTheme.CSS);
  head.insertBefore(style, themeStyle ? themeStyle.nextSibling : head.firstChild);
}
