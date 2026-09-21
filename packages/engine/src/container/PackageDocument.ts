import { resolveEpubPath } from "./EpubPath.js";
import { getDescendantElementsByNS, getFirstDescendantElementByNS, getNamespacedAttribute } from "./Xml.js";
import { elementCfiSteps } from "../locator/CfiTree.js";
import type { CfiStep } from "../locator/EpubCfi.js";

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

/** The publication-wide `rendition:spread` hint (`<meta property=
 * "rendition:spread">`): whether/when a fixed-layout reading system should
 * combine two adjacent spine items into one synthetic two-page spread.
 * `"portrait"` is a deprecated value the spec now says to treat exactly
 * like `"both"` (unconditional spreading) — see `parseRenditionSpreadMeta`
 * — so it's folded in at parse time rather than kept as its own case
 * every consumer would otherwise have to remember to treat identically.
 * Absent/unrecognized defaults to `"auto"` (reading-system's choice —
 * this engine treats that the same as `"both"`, spreading whenever the
 * viewport is wide enough, mirroring how reflowable spread-mode already
 * decides eligibility purely from available width). */
export type RenditionSpread = "none" | "landscape" | "both" | "auto";

/** The `rendition:orientation` hint (`<meta property="rendition:orientation">`,
 * package-wide, or a `rendition:orientation-portrait`/`-landscape` spine
 * itemref property override — see `SpineItemRef.resolveRenditionOrientation`):
 * which device orientation fixed-layout content is authored for. A browser
 * extension has no way to lock device/window orientation the way a native
 * reading app might, so this engine only surfaces the declared value (e.g.
 * for the EPUB Inspector) rather than acting on it — there's no reader-UI
 * behavior currently gated on it. Absent/unrecognized defaults to `"auto"`
 * (the spec's own default: no preference). */
export type RenditionOrientation = "portrait" | "landscape" | "auto";

/** The spine's `page-progression-direction` attribute: which visual
 * direction "forward" advances in, and (per spec) the side a spine item
 * with no explicit `page-spread-*` property defaults to within a
 * synthetic spread — see `SpineItemRef.pageSpread` and
 * `FixedLayoutSpreadPlanner`. `"default"` (the OPF default, spec-wise
 * equivalent to omitting the attribute entirely) lets the reading system
 * choose; this engine treats it identically to `"ltr"`, the overwhelmingly
 * common case for the vast majority of scripts/books that don't declare
 * this attribute at all. */
export type PageProgressionDirection = "ltr" | "rtl" | "default";

/** One of the three mutually-exclusive `page-spread-*` spine itemref
 * properties (with or without their `rendition:` prefix — both forms are
 * explicitly valid per spec, see `SpineItemRef.pageSpread`'s doc comment)
 * — which physical slot of a synthetic spread this spine item must
 * render in, overriding the default left/right alternation. `"center"`
 * additionally means "never pair with a neighbor at all" (spec: an alias
 * of `rendition:spread-none` scoped to just this one item). */
export type PageSpreadSide = "left" | "right" | "center";

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
    /** The CFI step path from the OPF `<package>` element down to this
     * `<itemref>` (per EPUB CFI §3.1.1), computed from the actual raw OPF
     * DOM at parse time — this is the "package steps" prefix every CFI
     * pointing into this spine item's content must start with. Computed
     * from the real DOM (not derived from this class's own structure)
     * because CFI step numbering depends on the exact child-node makeup
     * of the OPF file, including whitespace text nodes between elements,
     * which this engine's own `PackageDocument`/`SpineItemRef` model
     * intentionally discards for everything else. */
    public readonly packageCfiSteps: readonly CfiStep[],
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

  /** This spine item's explicit `page-spread-*` override, or `undefined`
   * if it declares none (in which case `FixedLayoutSpreadPlanner` falls
   * back to the default left/right alternation). Checks both the
   * `rendition:`-prefixed and unprefixed property spellings — the spec
   * explicitly allows (and real books sometimes declare) both on the same
   * itemref at once, "in case reading systems only support one of [the]
   * properties" (e.g. `properties="rendition:page-spread-left
   * page-spread-left"`), so this must never require exactly one spelling
   * to be present. Only one *side* (left vs. right vs. center) is ever
   * legal per itemref per spec — epubcheck rejects a book that declares
   * conflicting sides — so encountering more than one here (a malformed
   * book epubcheck would have already flagged) resolves by simple
   * priority (left, then right, then center) rather than throwing; this
   * engine already generally prefers tolerating malformed real-world
   * input over failing to open a book at all. */
  public get pageSpread(): PageSpreadSide | undefined {
    if (this.hasProperty("page-spread-left") || this.hasProperty("rendition:page-spread-left")) {
      return "left";
    }
    if (this.hasProperty("page-spread-right") || this.hasProperty("rendition:page-spread-right")) {
      return "right";
    }
    if (this.hasProperty("page-spread-center") || this.hasProperty("rendition:page-spread-center")) {
      return "center";
    }
    return undefined;
  }

  /** This spine item's effective `rendition:orientation`, applying its own
   * `rendition:orientation-portrait`/`-landscape` override property if
   * present, else falling back to the publication-wide default — same
   * override shape as `resolveRenditionLayout`. */
  public resolveRenditionOrientation(packageDefault: RenditionOrientation): RenditionOrientation {
    if (this.hasProperty("rendition:orientation-portrait")) {
      return "portrait";
    }
    if (this.hasProperty("rendition:orientation-landscape")) {
      return "landscape";
    }
    return packageDefault;
  }
}

/** An intrinsic pixel size — e.g. a fixed-layout page's authored
 * dimensions, from a `<meta name="viewport">` tag or the package-level
 * `rendition:viewport` property. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** One `<meta>` element from the OPF `<metadata>` block, captured
 * generically (rather than only the handful this parser specifically
 * understands, like `rendition:layout`) so the EPUB Inspector can
 * surface *every* piece of metadata a book declares — including
 * publisher-specific extensions this engine has no special knowledge of
 * at all (e.g. Calibre's `calibre:series`, or EPUB3 collection/series
 * metadata via `belongs-to-collection`). Covers both the EPUB3
 * `<meta property="...">value</meta>` form and the legacy OPF2
 * `<meta name="..." content="...">` form under one shape. */
export interface OpfMetaEntry {
  /** The `property` (EPUB3) or `name` (OPF2) attribute value. */
  readonly key: string;
  readonly value: string;
  /** EPUB3 refinement target: the `refines` attribute with its leading
   * `#` stripped, if present (e.g. a `role`/`file-as` meta refining a
   * particular `dc:creator`'s `id`). `undefined` for a top-level meta. */
  readonly refines: string | undefined;
}

/** One `dc:identifier` element from the OPF metadata — a book commonly
 * has several (e.g. an ISBN alongside a UUID or a publisher's own
 * catalog id), only one of which is *the* unique identifier
 * (`PackageMetadata.identifier`); this is the full list, for display
 * purposes (the Book Details panel), each with its `opf:scheme`
 * attribute if present (the conventional way an ISBN is actually
 * marked as such, e.g. `<dc:identifier opf:scheme="ISBN">`). */
export interface BookIdentifier {
  readonly value: string;
  readonly scheme: string | undefined;
}

/** EPUB Accessibility 1.1 metadata, parsed from the schema.org `a11y`
 * vocabulary's `<meta property="schema:...">` elements. All optional —
 * most real-world books declare none of this at all. */
export interface AccessibilityMetadata {
  /** `schema:accessMode` (e.g. "textual", "visual") — every sensory
   * modality needed to consume the content, one meta element each. */
  readonly accessModes: readonly string[];
  /** `schema:accessibilityFeature` (e.g. "structuralNavigation",
   * "alternativeText", "MathML") — content features present. */
  readonly accessibilityFeatures: readonly string[];
  /** `schema:accessibilityHazard` (e.g. "flashing", "noFlashingHazard")
   * — hazards the content does or doesn't pose. */
  readonly accessibilityHazards: readonly string[];
  /** `schema:accessibilitySummary` — free-text human-readable summary
   * of the book's accessibility, when the publisher provides one. */
  readonly accessibilitySummary: string | undefined;
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
    /** `dc:creator` (author/editor/etc.) — optional per spec, unlike
     * `dc:title`/`dc:language`, so real-world books that omit it (or use
     * non-DC creator conventions this parser doesn't yet special-case)
     * simply have `undefined` here rather than failing to parse. When
     * multiple `dc:creator` elements are present, only the first is used;
     * refiners like `role`/`file-as` are not yet interpreted. */
    public readonly creator: string | undefined,
    /** Publication-wide default rendition layout. Individual spine items
     * may override this — see `SpineItemRef.resolveRenditionLayout`. */
    public readonly renditionLayout: RenditionLayout,
    /** The package-level `rendition:viewport` property (e.g.
     * `<meta property="rendition:viewport">width=1400, height=2100</meta>`)
     * — a fallback intrinsic page size for fixed-layout content whose own
     * content document doesn't declare a `<meta name="viewport">` (the
     * more common, per-content-document mechanism real fixed-layout books
     * use, and preferred when present — see `fixed-layout-rendering`).
     * `undefined` if absent, malformed, or the book isn't fixed-layout. */
    public readonly renditionViewport: ViewportSize | undefined,
    /** `dc:description` — a back-cover-blurb-style summary, when the book
     * provides one. Used by the Book Details panel; nothing else in the
     * reader depends on it. */
    public readonly description: string | undefined,
    /** `dc:publisher`. Used by the Book Details panel only. */
    public readonly publisher: string | undefined,
    /** Every `dc:identifier` element present (not just the unique one —
     * see `identifier`), for the Book Details panel to show alongside
     * whatever scheme each is marked with (e.g. "ISBN"). */
    public readonly identifiers: readonly BookIdentifier[],
    /** `dc:rights` — the book's copyright/license statement (e.g.
     * "Copyright © 2020 Jane Author"). Shown as "Copyright" in the Book
     * Details panel when present; entirely optional per spec. */
    public readonly rights: string | undefined,
    /** `dc:date` — publication date, in whatever form the book declares
     * it (full ISO date, year-month, or bare year are all common). When
     * multiple `dc:date` elements are present (rare, but legal — e.g.
     * distinguishing original vs. this edition's publication date via
     * `opf:event`), the one marked `opf:event="publication"` is
     * preferred, falling back to the first if none is marked. */
    public readonly date: string | undefined,
    /** Every `dc:subject` element (genre/tag/BISAC-code style
     * classifications) — a book may declare several, or none. */
    public readonly subjects: readonly string[],
    /** Every `dc:contributor` element (translator, illustrator, editor,
     * etc. — distinct from `dc:creator`, the primary author(s)). */
    public readonly contributors: readonly string[],
    /** Every `<meta>` element in the OPF metadata, captured generically
     * (see `OpfMetaEntry`) — the EPUB Inspector's Metadata tab surfaces
     * these so an author can see *everything* their OPF declares, not
     * just the handful of fields (rendition layout/viewport) this
     * engine specifically interprets for rendering. */
    public readonly metaEntries: readonly OpfMetaEntry[],
    /** Every `dc:creator` element present (not just the first — see
     * `creator`) — the EPUB Inspector's Metadata tab shows the full list
     * for books with multiple authors/editors; `creator` remains
     * singular for the handful of other consumers (Book Details, the
     * library list) that only ever showed one name anyway. */
    public readonly creators: readonly string[],
    /** The publication-wide `rendition:spread` hint — see
     * `RenditionSpread`'s own doc comment for exactly what each value
     * means and how the deprecated `"portrait"` value is folded in.
     * Individual spine items have no per-item override for this property
     * (unlike `rendition:layout`) — spec defines it package-wide only. */
    public readonly renditionSpread: RenditionSpread,
    /** The publication-wide `rendition:orientation` hint — see
     * `RenditionOrientation`. Individual spine items may override this —
     * see `SpineItemRef.resolveRenditionOrientation`. */
    public readonly renditionOrientation: RenditionOrientation,
    /** EPUB Accessibility 1.1 metadata — see `AccessibilityMetadata`. */
    public readonly accessibility: AccessibilityMetadata,
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
    /** The `<spine page-progression-direction="...">` attribute — see
     * `PageProgressionDirection`'s own doc comment for exactly what each
     * value means for fixed-layout spread pairing (`FixedLayoutSpreadPlanner`)
     * and forward/backward navigation direction. Lives on `<spine>`
     * itself per spec, not `<metadata>`, hence its own top-level field
     * here rather than living on `PackageMetadata` alongside
     * `renditionSpread`/`renditionLayout`. */
    public readonly pageProgressionDirection: PageProgressionDirection,
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

  /** Finds the spine index whose `packageCfiSteps` numerically matches
   * `steps` (as parsed from a CFI's package-steps segment) — the reverse
   * of `SpineItemRef.packageCfiSteps`, used when resolving a CFI back to
   * "which spine item does this point into." Compares step index numbers
   * only, not id assertions (those are a supplementary robustness check,
   * performed separately during content-step resolution). */
  public findSpineIndexByPackageCfiSteps(steps: readonly CfiStep[]): number | undefined {
    const index = this.spine.findIndex(
      (ref) =>
        ref.packageCfiSteps.length === steps.length &&
        ref.packageCfiSteps.every((step, i) => step.index === steps[i]?.index),
    );
    return index === -1 ? undefined : index;
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
    const spine = PackageDocument.parseSpine(packageEl, spineEl, manifestById, opfPath);
    const tocManifestId = spineEl.getAttribute("toc") ?? undefined;
    const pageProgressionDirection = PackageDocument.parsePageProgressionDirection(spineEl);

    return new PackageDocument(metadata, manifestItems, spine, tocManifestId, pageProgressionDirection);
  }

  /** Parses `<spine page-progression-direction="ltr"|"rtl"|"default">` —
   * see `PageProgressionDirection`'s own doc comment for how each value
   * (including the attribute being entirely absent, treated the same as
   * an explicit `"default"`) is interpreted. Any other, non-conformant
   * value is also treated as `"default"` rather than thrown on — this is
   * a presentation hint, not something worth failing to open a book over. */
  private static parsePageProgressionDirection(spineEl: Element): PageProgressionDirection {
    const value = spineEl.getAttribute("page-progression-direction");
    if (value === "ltr" || value === "rtl") {
      return value;
    }
    return "default";
  }

  private static parseMetadata(
    packageEl: Element,
    metadataEl: Element,
    opfPath: string,
  ): PackageMetadata {
    const identifier = PackageDocument.parseUniqueIdentifier(packageEl, metadataEl, opfPath);
    const title = getFirstElementTextNS(metadataEl, DC_NAMESPACE, "title");
    const language = getFirstElementTextNS(metadataEl, DC_NAMESPACE, "language");
    const creator = getFirstElementTextNS(metadataEl, DC_NAMESPACE, "creator");

    if (!title || !language) {
      throw new PackageDocumentError(
        `OPF metadata at ${opfPath} is missing a required dc:title or dc:language.`,
      );
    }

    const renditionLayout = PackageDocument.parseRenditionLayoutMeta(metadataEl);
    const renditionViewport = PackageDocument.parseRenditionViewportMeta(metadataEl);
    const renditionSpread = PackageDocument.parseRenditionSpreadMeta(metadataEl);
    const renditionOrientation = PackageDocument.parseRenditionOrientationMeta(metadataEl);
    const description = getFirstElementTextNS(metadataEl, DC_NAMESPACE, "description");
    const publisher = getFirstElementTextNS(metadataEl, DC_NAMESPACE, "publisher");
    const identifiers = PackageDocument.parseIdentifiers(metadataEl);
    const rights = getFirstElementTextNS(metadataEl, DC_NAMESPACE, "rights");
    const date = PackageDocument.parseDate(metadataEl);
    const subjects = getElementsTextNS(metadataEl, DC_NAMESPACE, "subject");
    const contributors = getElementsTextNS(metadataEl, DC_NAMESPACE, "contributor");
    const metaEntries = PackageDocument.parseMetaEntries(metadataEl);
    const creators = getElementsTextNS(metadataEl, DC_NAMESPACE, "creator");
    const accessibility = PackageDocument.parseAccessibilityMetadata(metadataEl);

    return new PackageMetadata(
      identifier,
      title,
      language,
      creator,
      renditionLayout,
      renditionViewport,
      description,
      publisher,
      identifiers,
      rights,
      date,
      subjects,
      contributors,
      metaEntries,
      creators,
      renditionSpread,
      renditionOrientation,
      accessibility,
    );
  }

  /** Resolves `dc:date`, preferring an element specifically marked
   * `opf:event="publication"` (the conventional way a book distinguishes
   * its original publication date from other dates like this edition's
   * conversion date) over just taking the first `dc:date` present. */
  private static parseDate(metadataEl: Element): string | undefined {
    const dateElements = getDescendantElementsByNS(metadataEl, DC_NAMESPACE, "date");
    const publicationDate = dateElements.find(
      (el) => getNamespacedAttribute(el, OPF_NAMESPACE, "event") === "publication",
    );
    const text = (publicationDate ?? dateElements[0])?.textContent?.trim();
    return text || undefined;
  }

  /** Every `<meta>` element in the OPF metadata, captured generically —
   * see `OpfMetaEntry`. Covers both the EPUB3 `property`/text-content
   * form and the legacy OPF2 `name`/`content`-attribute form; an element
   * matching neither shape (missing both `property` and `name`) is
   * skipped, since it carries no identifiable key. */
  private static parseMetaEntries(metadataEl: Element): OpfMetaEntry[] {
    const metaElements = getDescendantElementsByNS(metadataEl, OPF_NAMESPACE, "meta");
    return metaElements
      .map((meta): OpfMetaEntry | undefined => {
        const key = meta.getAttribute("property") ?? meta.getAttribute("name");
        const value = meta.getAttribute("property") !== null
          ? meta.textContent?.trim()
          : (meta.getAttribute("content")?.trim() ?? undefined);
        if (!key || !value) {
          return undefined;
        }
        const refinesAttr = meta.getAttribute("refines");
        const refines = refinesAttr?.startsWith("#") ? refinesAttr.slice(1) : (refinesAttr ?? undefined);
        return { key, value, refines };
      })
      .filter((entry): entry is OpfMetaEntry => entry !== undefined);
  }

  /** Every `dc:identifier` element in the metadata (not just the unique
   * one — see `parseUniqueIdentifier`), each paired with its
   * `opf:scheme` attribute if present — the conventional way a real
   * book marks one of its several identifiers as specifically an ISBN,
   * e.g. `<dc:identifier opf:scheme="ISBN">978-...</dc:identifier>`. */
  private static parseIdentifiers(metadataEl: Element): BookIdentifier[] {
    return getDescendantElementsByNS(metadataEl, DC_NAMESPACE, "identifier")
      .map((el): BookIdentifier | undefined => {
        const value = el.textContent?.trim();
        if (!value) {
          return undefined;
        }
        return { value, scheme: getNamespacedAttribute(el, OPF_NAMESPACE, "scheme") ?? undefined };
      })
      .filter((identifier): identifier is BookIdentifier => identifier !== undefined);
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

  /** Parses the package-level `rendition:spread` property — see
   * `RenditionSpread`'s own doc comment for exactly what each value
   * means. The deprecated `"portrait"` value is folded into `"both"`
   * here, at the parse boundary, rather than left for every downstream
   * consumer (`FixedLayoutSpreadPlanner`, the EPUB Inspector, etc.) to
   * separately remember are synonyms — current EPUB 3.3 spec text: "RSs
   * SHOULD behave as if the both value had been specified" whenever
   * `"portrait"` is encountered. Absent, empty, or any other
   * unrecognized value defaults to `"auto"` (the spec's own default). */
  private static parseRenditionSpreadMeta(metadataEl: Element): RenditionSpread {
    const metaElements = getDescendantElementsByNS(metadataEl, OPF_NAMESPACE, "meta");
    const spreadMeta = metaElements.find(
      (meta) => meta.getAttribute("property") === "rendition:spread",
    );
    const content = spreadMeta?.textContent?.trim();
    if (content === "none" || content === "landscape" || content === "both") {
      return content;
    }
    if (content === "portrait") {
      return "both";
    }
    return "auto";
  }

  /** Parses the package-level `rendition:orientation` property — see
   * `RenditionOrientation`. Absent or unrecognized defaults to `"auto"`. */
  private static parseRenditionOrientationMeta(metadataEl: Element): RenditionOrientation {
    const metaElements = getDescendantElementsByNS(metadataEl, OPF_NAMESPACE, "meta");
    const orientationMeta = metaElements.find(
      (meta) => meta.getAttribute("property") === "rendition:orientation",
    );
    const content = orientationMeta?.textContent?.trim();
    return content === "portrait" || content === "landscape" ? content : "auto";
  }

  /** Parses the package-level `rendition:viewport` property, e.g.
   * `<meta property="rendition:viewport">width=1400, height=2100</meta>`
   * — a fallback intrinsic page size for fixed-layout content, used when
   * a content document doesn't declare its own `<meta name="viewport">`.
   * Returns `undefined` if absent or the dimensions can't be parsed as
   * two positive numbers, rather than throwing — this is a fallback
   * value, not something that should fail parsing the whole book. */
  private static parseRenditionViewportMeta(metadataEl: Element): ViewportSize | undefined {
    const metaElements = getDescendantElementsByNS(metadataEl, OPF_NAMESPACE, "meta");
    const viewportMeta = metaElements.find(
      (meta) => meta.getAttribute("property") === "rendition:viewport",
    );
    return parseViewportDimensions(viewportMeta?.textContent);
  }

  /** Parses EPUB Accessibility 1.1's `schema:accessMode`/
   * `accessibilityFeature`/`accessibilityHazard`/`accessibilitySummary`
   * `<meta property="...">` elements — unlike `rendition:layout`/
   * `rendition:spread`, the first three are legitimately repeatable
   * (a book can declare several access modes/features/hazards), so
   * every matching element is collected rather than just the first. */
  private static parseAccessibilityMetadata(metadataEl: Element): AccessibilityMetadata {
    const metaElements = getDescendantElementsByNS(metadataEl, OPF_NAMESPACE, "meta");
    const valuesFor = (property: string): string[] =>
      metaElements
        .filter((meta) => meta.getAttribute("property") === property)
        .map((meta) => meta.textContent?.trim())
        .filter((value): value is string => !!value);

    return {
      accessModes: valuesFor("schema:accessMode"),
      accessibilityFeatures: valuesFor("schema:accessibilityFeature"),
      accessibilityHazards: valuesFor("schema:accessibilityHazard"),
      accessibilitySummary: valuesFor("schema:accessibilitySummary")[0],
    };
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
    packageEl: Element,
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
      const packageCfiSteps = elementCfiSteps(packageEl, itemRefEl);

      return new SpineItemRef(manifestItem, linear, properties, packageCfiSteps);
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

/** Every matching element's trimmed text content (not just the first) —
 * for repeatable Dublin Core elements like `dc:subject`/`dc:contributor`
 * where a book may legitimately declare several. Elements with no (or
 * all-whitespace) text content are skipped. */
function getElementsTextNS(parent: Element, namespace: string, localName: string): string[] {
  return getDescendantElementsByNS(parent, namespace, localName)
    .map((el) => el.textContent?.trim())
    .filter((text): text is string => Boolean(text));
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

/** Parses a viewport dimension string in the `width=W, height=H` form
 * used both by the package-level `rendition:viewport` OPF property and
 * (in HTML's more familiar `<meta name="viewport" content="...">` form,
 * which this same key=value shape covers) a fixed-layout content
 * document's own declared page size — see `fixed-layout-rendering`.
 * Returns `undefined` if either dimension is missing or not a positive
 * number, since this is always used as a fallback value that should
 * degrade gracefully rather than throw. */
export function parseViewportDimensions(text: string | null | undefined): ViewportSize | undefined {
  if (!text) {
    return undefined;
  }
  const widthMatch = /width\s*=\s*(\d+(?:\.\d+)?)/i.exec(text);
  const heightMatch = /height\s*=\s*(\d+(?:\.\d+)?)/i.exec(text);
  const width = widthMatch ? Number(widthMatch[1]) : undefined;
  const height = heightMatch ? Number(heightMatch[1]) : undefined;
  if (!width || !height || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}
