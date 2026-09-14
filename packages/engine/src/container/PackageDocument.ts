import { resolveEpubPath } from "./EpubPath.js";
import { getDescendantElementsByNS, getFirstDescendantElementByNS } from "./Xml.js";

const OPF_NAMESPACE = "http://www.idpf.org/2007/opf";
const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";

/** Thrown when an OPF package document is missing required elements/
 * attributes or otherwise doesn't conform to the EPUB3 package document
 * spec closely enough to be read safely. */
export class PackageDocumentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PackageDocumentError";
  }
}

/** The rendition layout mode declared by `<meta property="rendition:layout">`,
 * either at the package level (default for the whole book) or overridden per
 * spine item — the central signal for reflowable vs fixed-layout rendering. */
export type RenditionLayout = "reflowable" | "pre-paginated";

/** A single `<item>` in the OPF `<manifest>`: a resource belonging to the
 * publication (spine content, images, fonts, styles, nav document, etc.). */
export class ManifestItem {
  public constructor(
    public readonly id: string,
    /** Path to this resource, relative to the zip archive root (already
     * resolved from the OPF-relative `href` in the source XML). */
    public readonly path: string,
    public readonly mediaType: string,
    public readonly properties: ReadonlySet<string>,
  ) {}

  public hasProperty(property: string): boolean {
    return this.properties.has(property);
  }

  /** True for the manifest item marked `properties="nav"` — the single
   * EPUB3 Nav Document for the publication. */
  public get isNavDocument(): boolean {
    return this.hasProperty("nav");
  }
}

/** A single `<itemref>` in the OPF `<spine>`: one entry in the book's
 * linear (or non-linear) reading order, referencing a `ManifestItem`. */
export class SpineItemRef {
  public constructor(
    public readonly manifestItem: ManifestItem,
    /** False for content excluded from the primary linear reading order
     * (e.g. supplementary/ancillary content) per the OPF `linear` attribute. */
    public readonly linear: boolean,
    public readonly properties: ReadonlySet<string>,
  ) {}

  public hasProperty(property: string): boolean {
    return this.properties.has(property);
  }

  /** This spine item's effective rendition layout, applying its own
   * `rendition:layout-*` override property if present, else falling back to
   * the publication-wide default passed in from `PackageDocument`. */
  public resolveRenditionLayout(packageDefault: RenditionLayout): RenditionLayout {
    if (this.hasProperty("rendition:layout-pre-paginated")) {
      return "pre-paginated";
    }
    if (this.hasProperty("rendition:layout-reflowable")) {
      return "reflowable";
    }
    return packageDefault;
  }
}

/** Core Dublin Core / package metadata read from the OPF `<metadata>`
 * element, plus the `rendition:*` metadata used to pick reflowable vs
 * fixed-layout rendering. */
export class PackageMetadata {
  public constructor(
    /** The value of the `dc:identifier` element specifically referenced by
     * `<package unique-identifier="...">` — not merely "the first
     * `dc:identifier`", which real-world books may have several of (e.g.
     * an ISBN alongside a UUID). This distinction matters beyond just
     * correctness of the metadata itself: it's the exact value the EPUB
     * font obfuscation algorithm is defined against (see
     * `font-obfuscation`), so getting the wrong identifier here would
     * silently produce the wrong de-obfuscation key. */
    public readonly identifier: string,
    public readonly title: string,
    public readonly language: string,
    /** Publication-wide default rendition layout. Individual spine items
     * may override this — see `SpineItemRef.resolveRenditionLayout`. */
    public readonly renditionLayout: RenditionLayout,
  ) {}
}

/**
 * A parsed EPUB3 OPF package document: metadata, manifest, and spine. All
 * manifest item paths are pre-resolved to zip-archive-relative paths (not
 * left as OPF-relative hrefs), so downstream consumers never need to know
 * where the OPF file itself lives.
 */
export const NCX_MEDIA_TYPE = "application/x-dtbncx+xml";

export class PackageDocument {
  private readonly manifestById: ReadonlyMap<string, ManifestItem>;

  private constructor(
    public readonly metadata: PackageMetadata,
    manifestItems: readonly ManifestItem[],
    public readonly spine: readonly SpineItemRef[],
    /** The manifest item id referenced by the legacy `<spine toc="...">`
     * attribute, if present — the standard way to locate a fallback NCX
     * document even in an EPUB3 package (kept for backward compatibility,
     * per spec). See `findNcxDocument`. */
    private readonly tocManifestId: string | undefined,
  ) {
    this.manifestById = new Map(manifestItems.map((item) => [item.id, item]));
  }

  public get manifest(): readonly ManifestItem[] {
    return [...this.manifestById.values()];
  }

  public getManifestItem(id: string): ManifestItem | undefined {
    return this.manifestById.get(id);
  }

  /** Finds the manifest item whose (already archive-relative) `path`
   * matches, e.g. for resolving a resource reference discovered within a
   * content document back to its manifest entry (to read its media type). */
  public findManifestItemByPath(path: string): ManifestItem | undefined {
    return this.manifest.find((item) => item.path === path);
  }

  /** The publication's single EPUB3 Nav Document, if declared. Absent for
   * EPUB2-authored content relying solely on an NCX — see `findNcxDocument`. */
  public findNavDocument(): ManifestItem | undefined {
    return this.manifest.find((item) => item.isNavDocument);
  }

  /** The legacy NCX document to fall back to when there's no EPUB3 Nav
   * Document, resolved first via the spine's `toc` attribute (the
   * spec-sanctioned way to reference it), then by media type as a looser
   * fallback for real-world files that omit the `toc` attribute. */
  public findNcxDocument(): ManifestItem | undefined {
    if (this.tocManifestId) {
      const byId = this.manifestById.get(this.tocManifestId);
      if (byId) {
        return byId;
      }
    }
    return this.manifest.find((item) => item.mediaType === NCX_MEDIA_TYPE);
  }

  /** Parses `xml` (the OPF package document's raw text) into a
   * `PackageDocument`. `opfPath` is this file's own path within the zip
   * archive, needed to resolve manifest hrefs (which are relative to the
   * OPF file's directory, not the archive root) into archive-relative paths. */
  public static parse(xml: string, opfPath: string): PackageDocument {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      throw new PackageDocumentError(`Malformed XML in OPF package document at ${opfPath}.`);
    }

    const packageEl = getFirstDescendantElementByNS(doc, OPF_NAMESPACE, "package");
    if (!packageEl) {
      throw new PackageDocumentError(`No <package> root element found in OPF at ${opfPath}.`);
    }

    const metadataEl = getRequiredChild(packageEl, OPF_NAMESPACE, "metadata", opfPath);
    const manifestEl = getRequiredChild(packageEl, OPF_NAMESPACE, "manifest", opfPath);
    const spineEl = getRequiredChild(packageEl, OPF_NAMESPACE, "spine", opfPath);

    const metadata = PackageDocument.parseMetadata(packageEl, metadataEl, opfPath);
    const manifestItems = PackageDocument.parseManifest(manifestEl, opfPath);
    const manifestById = new Map(manifestItems.map((item) => [item.id, item]));
    const spine = PackageDocument.parseSpine(spineEl, manifestById, opfPath);
    const tocManifestId = spineEl.getAttribute("toc") ?? undefined;

    return new PackageDocument(metadata, manifestItems, spine, tocManifestId);
  }

  private static parseMetadata(
    packageEl: Element,
    metadataEl: Element,
    opfPath: string,
  ): PackageMetadata {
    const identifier = PackageDocument.parseUniqueIdentifier(packageEl, metadataEl, opfPath);
    const title = getFirstElementTextNS(metadataEl, DC_NAMESPACE, "title");
    const language = getFirstElementTextNS(metadataEl, DC_NAMESPACE, "language");

    if (!title || !language) {
      throw new PackageDocumentError(
        `OPF metadata at ${opfPath} is missing a required dc:title or dc:language.`,
      );
    }

    const renditionLayout = PackageDocument.parseRenditionLayoutMeta(metadataEl);

    return new PackageMetadata(identifier, title, language, renditionLayout);
  }

  /** Resolves the `dc:identifier` element specifically referenced by
   * `<package unique-identifier="...">` (per spec, this attribute is
   * required and must reference a `dc:identifier`'s `id`). Falls back to
   * the first `dc:identifier` present if the reference is missing or
   * doesn't resolve, for resilience against real-world non-conformant
   * files — consistent with this engine's general approach to malformed
   * content elsewhere (e.g. the NCX fallback). */
  private static parseUniqueIdentifier(
    packageEl: Element,
    metadataEl: Element,
    opfPath: string,
  ): string {
    const identifierElements = getDescendantElementsByNS(metadataEl, DC_NAMESPACE, "identifier");
    const uniqueIdentifierId = packageEl.getAttribute("unique-identifier");

    if (uniqueIdentifierId) {
      const match = identifierElements.find((el) => el.getAttribute("id") === uniqueIdentifierId);
      const text = match?.textContent?.trim();
      if (text) {
        return text;
      }
    }

    const firstText = identifierElements[0]?.textContent?.trim();
    if (!firstText) {
      throw new PackageDocumentError(`OPF metadata at ${opfPath} has no dc:identifier element.`);
    }
    return firstText;
  }

  private static parseRenditionLayoutMeta(metadataEl: Element): RenditionLayout {
    const metaElements = getDescendantElementsByNS(metadataEl, OPF_NAMESPACE, "meta");
    const layoutMeta = metaElements.find(
      (meta) => meta.getAttribute("property") === "rendition:layout",
    );
    const content = layoutMeta?.textContent?.trim();
    return content === "pre-paginated" ? "pre-paginated" : "reflowable";
  }

  private static parseManifest(manifestEl: Element, opfPath: string): ManifestItem[] {
    const itemElements = getDescendantElementsByNS(manifestEl, OPF_NAMESPACE, "item");

    return itemElements.map((itemEl) => {
      const id = requireAttribute(itemEl, "id", opfPath, "manifest item");
      const href = requireAttribute(itemEl, "href", opfPath, "manifest item");
      const mediaType = requireAttribute(itemEl, "media-type", opfPath, "manifest item");
      const properties = parsePropertyList(itemEl.getAttribute("properties"));

      // Manifest hrefs are relative to the OPF file's own directory, not
      // the archive root — resolveEpubPath resolves relative to opfPath's
      // directory (dropping opfPath's own final path segment).
      const path = resolveEpubPath(opfPath, href);

      return new ManifestItem(id, path, mediaType, properties);
    });
  }

  private static parseSpine(
    spineEl: Element,
    manifestById: ReadonlyMap<string, ManifestItem>,
    opfPath: string,
  ): SpineItemRef[] {
    const itemRefElements = getDescendantElementsByNS(spineEl, OPF_NAMESPACE, "itemref");

    return itemRefElements.map((itemRefEl) => {
      const idref = requireAttribute(itemRefEl, "idref", opfPath, "spine itemref");
      const manifestItem = manifestById.get(idref);
      if (!manifestItem) {
        throw new PackageDocumentError(
          `Spine itemref idref="${idref}" in ${opfPath} does not match any manifest item.`,
        );
      }

      const linear = itemRefEl.getAttribute("linear") !== "no";
      const properties = parsePropertyList(itemRefEl.getAttribute("properties"));

      return new SpineItemRef(manifestItem, linear, properties);
    });
  }
}

function getRequiredChild(
  parent: Element,
  namespace: string,
  localName: string,
  opfPath: string,
): Element {
  const child = getFirstDescendantElementByNS(parent, namespace, localName);
  if (!child) {
    throw new PackageDocumentError(
      `OPF at ${opfPath} is missing a required <${localName}> element.`,
    );
  }
  return child;
}

function getFirstElementTextNS(
  parent: Element,
  namespace: string,
  localName: string,
): string | undefined {
  const element = getFirstDescendantElementByNS(parent, namespace, localName);
  return element?.textContent?.trim() || undefined;
}

function requireAttribute(
  element: Element,
  name: string,
  opfPath: string,
  context: string,
): string {
  const value = element.getAttribute(name);
  if (!value) {
    throw new PackageDocumentError(
      `A ${context} in ${opfPath} is missing its required "${name}" attribute.`,
    );
  }
  return value;
}

/** OPF `properties` attributes are space-separated lists (e.g.
 * `properties="nav scripted"`). */
function parsePropertyList(value: string | null): ReadonlySet<string> {
  if (!value) {
    return new Set();
  }
  return new Set(value.trim().split(/\s+/));
}
