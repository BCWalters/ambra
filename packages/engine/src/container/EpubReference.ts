import { resolveEpubPath, splitHrefFragment } from "./EpubPath.js";
import { getDescendantElementsByNS } from "./Xml.js";

export interface NonPackageEpubReference {
  readonly kind:
    "data" | "https" | "http" | "file" | "protocol-relative" | "mailto" | "unsupported";
  readonly url: string;
}

export type EpubReference =
  | { readonly kind: "package"; readonly path: string; readonly fragment: string | undefined }
  | { readonly kind: "fragment"; readonly fragment: string | undefined }
  | NonPackageEpubReference;

/** Match URL preprocessing before classifying, so whitespace/control characters
 * cannot disguise a scheme as an archive path. Decode package filenames only
 * after URL resolution, using the same rules as navigation and raw inspection. */
export function classifyEpubReference(documentPath: string, href: string, baseHref?: string): EpubReference {
  const value = normalizeUrl(href);
  if (baseHref !== undefined && !/^[\\/]{2}/.test(value) && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    const baseValue = normalizeUrl(baseHref);
    let base: EpubReference | undefined;
    if (/^(data|javascript):/i.test(baseValue)) {
      console.warn("Ignoring a forbidden data/javascript HTML base URL.");
    } else {
      try {
        new URL(baseValue, "epub-path:///");
        base = classifyEpubReference(documentPath, baseValue);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        console.warn("Ignoring an invalid HTML base URL.", error);
      }
    }
    if (base?.kind === "package") {
      const path = resolveEpubPath(base.path, value);
      const fragment = splitHrefFragment(value).fragment;
      return path === documentPath && (!value || value.startsWith("#"))
        ? { kind: "fragment", fragment }
        : { kind: "package", path, fragment };
    }
    if (base && base.kind !== "fragment") {
      const url = base.kind === "protocol-relative" ? `https:${base.url.replace(/\\/g, "/")}` : base.url;
      try {
        return classifyEpubReference(documentPath, new URL(value, url).href);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        // A valid opaque base cannot resolve a relative URL. Keep the base's
        // scheme in the unavailable identity so it cannot alias a ZIP entry.
        console.warn("Unable to resolve a relative reference against an opaque HTML base.");
        return { kind: "unsupported", url: base.url };
      }
    }
  }
  if (!value || value.startsWith("#"))
    return { kind: "fragment", fragment: splitHrefFragment(value).fragment };
  if (/^[\\/]{2}/.test(value)) return { kind: "protocol-relative", url: value };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme) {
    const kind =
      scheme === "data" ||
      scheme === "https" ||
      scheme === "http" ||
      scheme === "file" ||
      scheme === "mailto"
        ? scheme
        : "unsupported";
    if (kind === "http" || kind === "https" || kind === "mailto") {
      try {
        return { kind, url: new URL(value).href };
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return { kind: "unsupported", url: value };
      }
    }
    return { kind, url: value };
  }
  const split = splitHrefFragment(value);
  return {
    kind: "package",
    path: resolveEpubPath(documentPath, split.path),
    fragment: split.fragment,
  };
}

/** Only the first HTML base with href applies; SVG/xml:base are separate. */
export function getDocumentBaseHref(document: Document): string | undefined {
  const namespace = "http://www.w3.org/1999/xhtml";
  if (document.documentElement.namespaceURI !== namespace) return undefined;
  return getDescendantElementsByNS(document, namespace, "base")
    .find(element => element.hasAttribute("href"))?.getAttribute("href") ?? undefined;
}

function normalizeUrl(href: string): string {
  const input = href.replace(/[\t\r\n]/g, "");
  let start = 0;
  let end = input.length;
  while (start < end && input.charCodeAt(start) <= 0x20) start++;
  while (end > start && input.charCodeAt(end - 1) <= 0x20) end--;
  return input.slice(start, end);
}

/** Subresources remain offline-only. External navigation is allowed solely
 * from an explicit reader-controlled link action, never automatic loading. */
export function externalNavigationUrl(reference: EpubReference): string | undefined {
  if (reference.kind === "https" || reference.kind === "http" || reference.kind === "mailto")
    return reference.url;
  if (reference.kind !== "protocol-relative") return undefined;
  try {
    const url = new URL(reference.url.replace(/\\/g, "/"), "https://epub.invalid/");
    return url.protocol === "https:" ? url.href : undefined;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return undefined;
  }
}
