import { resolveEpubPath, splitHrefFragment } from "./EpubPath.js";

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
export function classifyEpubReference(documentPath: string, href: string): EpubReference {
  const input = href.replace(/[\t\r\n]/g, "");
  let start = 0;
  let end = input.length;
  while (start < end && input.charCodeAt(start) <= 0x20) start++;
  while (end > start && input.charCodeAt(end - 1) <= 0x20) end--;
  const value = input.slice(start, end);
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
