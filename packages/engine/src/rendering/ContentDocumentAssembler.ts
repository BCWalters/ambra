import type { ContentDocument } from "../content/ContentLoader.js";
import { findResourceReferencesInDocument } from "../content/ContentLoader.js";
import { EPUB_CSS_RESET } from "./EpubCssReset.js";
import { ReadingTheme } from "./ReadingTheme.js";
import { HighlightTheme } from "./HighlightTheme.js";
import { resourceResolutionKey } from "./ResourceFallbackSelector.js";
import type { ResolvedResource } from "./ResourceUrlResolver.js";
import { classifyEpubReference, externalNavigationUrl } from "../container/EpubReference.js";
import { getNamespacedAttributeName } from "../container/Xml.js";

/**
 * A minimal, restrictive Content-Security-Policy applied to every document
 * injected into the sandboxed rendering surface, as defense-in-depth on
 * top of the iframe's `sandbox` attribute (which already fully disables
 * scripting on its own — see `SandboxedContentHost`). Since every resource
 * reference is rewritten to a `blob:` URL before assembly, nothing in the
 * assembled document should ever need to reach the network; this policy
 * makes that structurally true rather than just incidental. `style-src`
 * allows `'unsafe-inline'` because real-world EPUB content legitimately
 * uses inline `<style>` blocks — CSS injection is a materially lower-severity
 * risk than script execution, which remains fully blocked.
 */
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'none'; img-src blob:; style-src blob: 'unsafe-inline'; " +
  "font-src blob:; media-src blob:; base-uri 'none'; form-action 'none';";

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
      resourceResolutions?: ReadonlyMap<string, ResolvedResource | null>;
    } = {},
  ): string {
    // Re-parse from the original raw text rather than cloning
    // `contentDocument.document`, guaranteeing a fully independent DOM tree
    // to mutate — the original parsed document is left untouched for other
    // consumers (e.g. future CFI resolution) that need pristine hrefs.
    const doc = new DOMParser().parseFromString(contentDocument.rawText, "application/xhtml+xml");
    for (const frame of Array.from(doc.querySelectorAll("iframe[srcdoc]"))) frame.removeAttribute("srcdoc");
    for (const anchor of Array.from(doc.querySelectorAll("a"))) {
      const attribute = anchor.hasAttribute("href") ? "href"
        : getNamespacedAttributeName(anchor, "http://www.w3.org/1999/xlink", "href");
      if (!attribute) continue;
      const reference = classifyEpubReference(contentDocument.manifestItem.path, anchor.getAttribute(attribute)!);
      if (reference.kind !== "package" && reference.kind !== "fragment" && !externalNavigationUrl(reference)) {
        anchor.setAttribute(attribute, "#");
        anchor.setAttribute("data-ambra-blocked-link", reference.kind);
      }
    }

    const references = findResourceReferencesInDocument(doc, contentDocument.manifestItem.path, { includeUnavailable: true });
    const sourceTypes = new Map<Element, Set<string>>();
    const objectImages = new Map<Element, string>();
    // Replace candidates from right to left so original URL offsets stay valid.
    for (const reference of references.reverse()) {
      const resolution = options.resourceResolutions?.get(resourceResolutionKey(reference.path, reference.consumer));
      const { element, attributeName, attributeRange, candidateRange } = reference;
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
    for (const style of Array.from(doc.querySelectorAll("style"))) {
      const rewritten = options.publisherCss?.get(style.textContent ?? "");
      if (rewritten !== undefined) style.textContent = rewritten;
    }
    for (const element of Array.from(doc.querySelectorAll("[style]"))) {
      const rewritten = options.publisherStyleAttributes?.get(element.getAttribute("style")!);
      if (rewritten !== undefined) element.setAttribute("style", rewritten);
    }

    injectContentSecurityPolicy(doc);
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

function injectContentSecurityPolicy(doc: Document): void {
  const head = doc.getElementsByTagName("head")[0];
  if (!head) {
    return;
  }

  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", CONTENT_SECURITY_POLICY);
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
