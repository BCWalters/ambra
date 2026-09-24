import type { ContentDocument } from "../content/ContentLoader.js";
import { findResourceReferencesInDocument } from "../content/ContentLoader.js";
import { EPUB_CSS_RESET } from "./EpubCssReset.js";
import { ReadingTheme } from "./ReadingTheme.js";
import { HighlightTheme } from "./HighlightTheme.js";

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
    options: { applyReadingTheme?: boolean } = {},
  ): string {
    // Re-parse from the original raw text rather than cloning
    // `contentDocument.document`, guaranteeing a fully independent DOM tree
    // to mutate — the original parsed document is left untouched for other
    // consumers (e.g. future CFI resolution) that need pristine hrefs.
    const doc = new DOMParser().parseFromString(contentDocument.rawText, "application/xhtml+xml");

    const references = findResourceReferencesInDocument(doc, contentDocument.manifestItem.path);
    for (const reference of references) {
      const url = resourceUrls.get(reference.path);
      if (url) {
        reference.element.setAttribute(reference.attributeName, url);
      }
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
