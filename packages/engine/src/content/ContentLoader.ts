import { EpubContainer } from "../container/EpubContainer.js";
import type { ZipEntry } from "../container/ZipArchive.js";
import { ManifestItem, PackageDocument } from "../container/PackageDocument.js";
import { resolveEpubPath, splitHrefFragment } from "../container/EpubPath.js";
import { getDescendantElementsByNS, getNamespacedAttributeName } from "../container/Xml.js";
import type { EncryptionDocument } from "../encryption/EncryptionDocument.js";
import { FontDeobfuscator } from "../encryption/FontDeobfuscator.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** Thrown when a spine/content document can't be loaded or parsed, or a
 * requested manifest resource doesn't exist. */
export class ContentLoaderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ContentLoaderError";
  }
}

/** A parsed spine or content XHTML document, alongside the manifest item it
 * came from and its raw source text (kept around since some consumers —
 * e.g. a future CFI range serializer — may need the exact original markup,
 * not a re-serialization of the parsed DOM). */
export class ContentDocument {
  public constructor(
    public readonly manifestItem: ManifestItem,
    public readonly document: Document,
    public readonly rawText: string,
  ) {}
}

/** A single resource reference found within a `ContentDocument` — e.g. an
 * `<img src="...">` — resolved to its archive-relative path. `element` and
 * `attributeName` are included so a caller (the future sandboxed rendering
 * surface) can rewrite the reference in place, e.g. to a blob URL. */
export interface ResourceReference {
  readonly element: Element;
  readonly attributeName: string;
  readonly path: string;
}

const RESOURCE_ATTRIBUTE_SELECTORS: readonly { selector: string; attribute: string }[] = [
  { selector: "img", attribute: "src" },
  { selector: "source", attribute: "src" },
  { selector: "audio", attribute: "src" },
  { selector: "video", attribute: "src" },
  { selector: "track", attribute: "src" },
  { selector: 'link[rel~="stylesheet"]', attribute: "href" },
  { selector: "object", attribute: "data" },
];

/**
 * Resolves and loads spine content documents and the resources they
 * reference (images, audio/video, stylesheets, embedded SVG) from an
 * `EpubContainer`. Deliberately scoped to XHTML/SVG attribute-level
 * references — resources referenced from *within* CSS (e.g. `@font-face`
 * `url(...)`, background images) are out of scope here, since resolving
 * those requires actually parsing CSS text, which belongs with the
 * rendering surface that decides how stylesheets are delivered into the
 * sandboxed content host.
 *
 * `loadResourceBytes`/`loadResourceBytesById` transparently reverse font
 * obfuscation (see `FontDeobfuscator`) when `META-INF/encryption.xml`
 * declares a resource as obfuscated, so callers never need to know or
 * care whether a given font was obfuscated in the source file.
 */
export class ContentLoader {
  private constructor(
    private readonly container: EpubContainer,
    private readonly pkg: PackageDocument,
    private readonly encryptionDocument: EncryptionDocument | undefined,
  ) {}

  public static async create(container: EpubContainer): Promise<ContentLoader> {
    const pkg = await container.getPackageDocument();
    const encryptionDocument = await container.getEncryptionDocument();
    return new ContentLoader(container, pkg, encryptionDocument);
  }

  public get packageDocument(): PackageDocument {
    return this.pkg;
  }

  /** Every entry in the underlying ZIP archive — the raw "file
   * structure" of the EPUB, for the EPUB-author-facing inspection
   * feature (issue #46). See `EpubContainer.entries`. */
  public get archiveEntries(): readonly ZipEntry[] {
    return this.container.entries;
  }

  /** Reads the raw text of an arbitrary archive path — not scoped to
   * manifest items the way `loadContentDocument` is, so it also works
   * for `META-INF/container.xml`, the OPF/NCX/Nav documents themselves,
   * or any other file the inspection feature's file browser lets an
   * EPUB author open, as-is (no XHTML parsing, no CSP/resource
   * rewriting — this is for *looking at* the source, not rendering it). */
  public async readArchiveFileText(path: string): Promise<string> {
    return this.container.requireEntry(path).readText();
  }

  /** Reads the raw bytes of an arbitrary archive path — the binary
   * counterpart to `readArchiveFileText`, for the inspection feature's
   * image/audio/video previews (issue #46 follow-up), where decoding as
   * text would silently produce mojibake instead of a usable preview. */
  public async readArchiveFileBytes(path: string): Promise<Uint8Array> {
    return this.container.requireEntry(path).read();
  }

  /** Loads and parses the spine item at `spineIndex` as a `ContentDocument`. */
  public async loadSpineDocument(spineIndex: number): Promise<ContentDocument> {
    const spineRef = this.pkg.spine[spineIndex];
    if (!spineRef) {
      throw new ContentLoaderError(
        `Spine index ${spineIndex} is out of range (spine has ${this.pkg.spine.length} items).`,
      );
    }
    return this.loadContentDocument(spineRef.manifestItem);
  }

  /** Loads and parses any manifest item as a `ContentDocument` (not just
   * spine items — e.g. the Nav Document, or a content document reached via
   * an internal link rather than linear spine order). */
  public async loadContentDocument(manifestItem: ManifestItem): Promise<ContentDocument> {
    const rawText = await this.container.requireEntry(manifestItem.path).readText();
    const document = new DOMParser().parseFromString(rawText, "application/xhtml+xml");

    if (document.getElementsByTagName("parsererror").length > 0) {
      throw new ContentLoaderError(`Malformed XHTML in content document at ${manifestItem.path}.`);
    }

    return new ContentDocument(manifestItem, document, rawText);
  }

  /** Reads the raw (already-decompressed) bytes of any resource in the
   * container, given its archive-relative path. Transparently reverses
   * font obfuscation (per `META-INF/encryption.xml`) when present, so
   * callers always get plain, usable bytes regardless of whether the
   * underlying resource happened to be obfuscated in the source file. */
  public async loadResourceBytes(path: string): Promise<Uint8Array> {
    const bytes = await this.container.requireEntry(path).read();

    const encryptionEntry = this.encryptionDocument?.getEntry(path);
    if (!encryptionEntry) {
      return bytes;
    }

    return FontDeobfuscator.deobfuscate(
      bytes,
      encryptionEntry.algorithmUri,
      this.pkg.metadata.identifier,
    );
  }

  /** Like `loadResourceBytes`, but by manifest item id rather than path. */
  public async loadResourceBytesById(manifestId: string): Promise<Uint8Array> {
    return this.loadResourceBytes(this.requireManifestItem(manifestId).path);
  }

  /** Finds every resource reference (images, audio/video, stylesheets,
   * embedded SVG images) within `contentDocument`, resolved to
   * archive-relative paths. Hyperlinks (`<a href>`) are deliberately
   * excluded — they're navigation, not embedded resources. */
  public findResourceReferences(contentDocument: ContentDocument): ResourceReference[] {
    return findResourceReferencesInDocument(
      contentDocument.document,
      contentDocument.manifestItem.path,
    );
  }

  private requireManifestItem(id: string): ManifestItem {
    const item = this.pkg.getManifestItem(id);
    if (!item) {
      throw new ContentLoaderError(`Manifest item not found: ${id}`);
    }
    return item;
  }
}

/** Standalone version of `ContentLoader.findResourceReferences`, operating
 * directly on any parsed `Document` rather than a `ContentLoader`-owned
 * `ContentDocument`. Exists so the future rendering surface can re-run
 * discovery against a freshly (re-)parsed clone of a content document —
 * e.g. right before rewriting references to blob URLs — without needing
 * to identity-match elements across two separately parsed DOM trees. */
export function findResourceReferencesInDocument(
  document: Document,
  documentPath: string,
): ResourceReference[] {
  const references: ResourceReference[] = [];

  for (const { selector, attribute } of RESOURCE_ATTRIBUTE_SELECTORS) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const reference = resolveReference(element, attribute, documentPath);
      if (reference) {
        references.push(reference);
      }
    }
  }

  // SVG <image> elements use either a bare `href` (SVG2) or the legacy
  // `xlink:href` (SVG1.1, still the common case in real-world EPUBs).
  for (const imageEl of getDescendantElementsByNS(document, SVG_NAMESPACE, "image")) {
    const attribute =
      (imageEl.hasAttribute("href") ? "href" : undefined) ??
      getNamespacedAttributeName(imageEl, XLINK_NAMESPACE, "href");
    if (attribute) {
      const reference = resolveReference(imageEl, attribute, documentPath);
      if (reference) {
        references.push(reference);
      }
    }
  }

  return references;
}

function resolveReference(
  element: Element,
  attributeName: string,
  documentPath: string,
): ResourceReference | undefined {
  const rawValue = element.getAttribute(attributeName);
  if (!rawValue) {
    return undefined;
  }

  const { path: rawPath } = splitHrefFragment(rawValue);
  if (!rawPath) {
    // Fragment-only value (e.g. an in-document href) — not an external
    // resource to load.
    return undefined;
  }

  return { element, attributeName, path: resolveEpubPath(documentPath, rawPath) };
}
