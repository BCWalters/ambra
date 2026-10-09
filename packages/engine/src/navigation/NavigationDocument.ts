import { EpubContainer } from "../container/EpubContainer.js";
import { ZipFormatError, ZipIntegrityError } from "../container/ZipArchive.js";
import type { ManifestItem, PackageDocument } from "../container/PackageDocument.js";
import { classifyEpubReference, getDocumentBaseHref, type NonPackageEpubReference } from "../container/EpubReference.js";
import {
  getChildElementsByNS,
  getDescendantElementsByNS,
  getFirstChildElementByNS,
  getNamespacedAttribute,
} from "../container/Xml.js";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const OPS_NAMESPACE = "http://www.idpf.org/2007/ops";
const NCX_NAMESPACE = "http://www.daisy.org/z3986/2005/ncx/";

/** Thrown when neither an EPUB3 Nav Document nor a fallback NCX can be
 * found or parsed for a publication — a book with no usable navigation. */
export class NavigationDocumentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NavigationDocumentError";
  }
}

/** The three kinds of navigation list an EPUB3 Nav Document (or NCX) can
 * provide. Only `toc` is mandatory. */
export type NavigationListType = "toc" | "page-list" | "landmarks";

/**
 * A single entry in a navigation list (table of contents, page list, or
 * landmarks), and its nested sub-entries. Represents both EPUB3 Nav
 * Document `<li>` entries and NCX `<navPoint>`/`<pageTarget>` entries
 * uniformly, since consumers (TOC UI, CFI/locator resolution) shouldn't
 * need to care which source format produced them.
 */
export class NavPoint {
  public constructor(
    public readonly label: string,
    /** Archive-relative path to the target content document. Absent for
     * structural headings with no link of their own (EPUB3 permits a
     * `<span>` in place of `<a>` for a heading that only groups children). */
    public readonly path: string | undefined,
    /** The decoded element ID from the target href, if any — e.g.
     * `"arrivée"` for a target of `chapter1.xhtml#arriv%C3%A9e`. */
    public readonly fragment: string | undefined,
    public readonly children: readonly NavPoint[],
    /** Semantic roles on an EPUB navigation link, notably bodymatter/backmatter landmarks. */
    public readonly epubTypes: readonly string[] = [],
    public readonly externalReference?: NonPackageEpubReference,
  ) {}

  public get isLinked(): boolean {
    return this.path !== undefined;
  }

  /** Full navigation target: entries in the same document can name different sections. */
  public get target(): string | undefined {
    return this.path === undefined ? undefined
      : this.fragment ? `${this.path}#${this.fragment}` : this.path;
  }
}

/** One navigation list (e.g. the table of contents) — its type and
 * top-level entries. */
export class NavigationList {
  public constructor(
    public readonly type: NavigationListType,
    public readonly items: readonly NavPoint[],
  ) {}
}

export interface AuxiliaryNavigationList {
  readonly label: string | undefined;
  readonly items: readonly NavPoint[];
}

/**
 * A publication's navigation data: table of contents (required), plus
 * optional page list and landmarks. Parsed from either an EPUB3 Nav
 * Document (preferred) or, for EPUB2-authored/hybrid content, a fallback
 * NCX document — see `NavigationDocument.load`.
 */
export class NavigationDocument {
  public constructor(
    public readonly toc: NavigationList,
    public readonly pageList: NavigationList | undefined,
    public readonly landmarks: NavigationList | undefined,
    public readonly additionalLists: readonly AuxiliaryNavigationList[] = [],
    public readonly diagnostics: readonly string[] = [],
  ) {}

  /** Loads a publication's navigation, preferring its EPUB3 Nav Document
   * and falling back to an NCX (via the spine's `toc` attribute, or by
   * media type) for EPUB2-authored or hybrid content. Throws
   * `NavigationDocumentError` if neither is present/parseable. */
  public static async load(container: EpubContainer): Promise<NavigationDocument> {
    const pkg = await container.getPackageDocument();

    const diagnostics: string[] = [];
    let navigation: NavigationDocument | undefined;
    const navItem = pkg.findNavDocument();
    if (navItem) {
      try {
        navigation = NavigationDocument.parseNavDocument(
          await this.readItem(container, navItem),
          navItem.path,
        );
      } catch (error) {
        if (!(
          error instanceof NavigationDocumentError ||
          error instanceof ZipFormatError ||
          error instanceof ZipIntegrityError
        ))
          throw error;
        diagnostics.push(error.message);
      }
    }

    const ncxItem = pkg.findNcxDocument();
    if (!navigation && ncxItem) {
      navigation = NavigationDocument.parseNcx(
        await this.readItem(container, ncxItem),
        ncxItem.path,
      );
    }

    if (!navigation) {
      throw new NavigationDocumentError(
        diagnostics.length
          ? diagnostics.join(" ")
          : "No navigation found: package declares neither an EPUB3 Nav Document nor a fallback NCX.",
      );
    }
    return new NavigationDocument(
      navigation.toc,
      navigation.pageList,
      navigation.landmarks ?? this.guideLandmarks(pkg, container.rootFilePath),
      navigation.additionalLists,
      diagnostics,
    );
  }

  private static async readItem(container: EpubContainer, item: ManifestItem): Promise<string> {
    if (item.location)
      throw new NavigationDocumentError("Navigation declares a blocked non-package resource.");
    const entry = container.getEntry(item.path);
    if (!entry)
      throw new NavigationDocumentError(`Declared navigation resource is missing: ${item.path}.`);
    return entry.readText();
  }

  private static guideLandmarks(pkg: PackageDocument, opfPath: string): NavigationList | undefined {
    const items = new Map<string, NavPoint>();
    for (const guide of pkg.guide) {
      const reference = classifyEpubReference(opfPath, guide.href);
      const path =
        reference.kind === "package"
          ? reference.path
          : reference.kind === "fragment"
            ? opfPath
            : reference.url;
      const fragment =
        reference.kind === "package" || reference.kind === "fragment"
          ? reference.fragment
          : undefined;
      const externalReference =
        reference.kind === "package" || reference.kind === "fragment" ? undefined : reference;
      const type =
        guide.type === "text"
          ? "bodymatter"
          : guide.type === "acknowledgements"
            ? "acknowledgments"
            : guide.type;
      const key = JSON.stringify([path, fragment]);
      const previous = items.get(key);
      items.set(
        key,
        new NavPoint(
          previous?.label || guide.title,
          path,
          fragment,
          [],
          [...new Set([...(previous?.epubTypes ?? []), ...(type ? [type] : [])])],
          externalReference,
        ),
      );
    }
    return items.size ? new NavigationList("landmarks", [...items.values()]) : undefined;
  }

  // ---- EPUB3 Nav Document ----

  /** Parses `xml` (an EPUB3 Nav Document's raw text) into a
   * `NavigationDocument`. `navDocPath` is this file's own archive-relative
   * path, needed to resolve the `<a href>`s within it. */
  public static parseNavDocument(xml: string, navDocPath: string): NavigationDocument {
    const doc = new DOMParser().parseFromString(xml, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      throw new NavigationDocumentError(`Malformed XML in Nav Document at ${navDocPath}.`);
    }

    const navElements = getDescendantElementsByNS(doc, XHTML_NAMESPACE, "nav");

    const tocNav = navElements.find((nav) => hasEpubType(nav, "toc"));
    if (!tocNav) {
      throw new NavigationDocumentError(
        `Nav Document at ${navDocPath} has no <nav epub:type="toc">, which is required.`,
      );
    }
    const toc = new NavigationList("toc", NavigationDocument.parseNavList(tocNav, navDocPath));
    if (!toc.items.length) {
      throw new NavigationDocumentError(`Nav Document at ${navDocPath} has no usable TOC entries.`);
    }

    const pageListNav = navElements.find((nav) => hasEpubType(nav, "page-list"));
    const pageList = pageListNav
      ? new NavigationList("page-list", NavigationDocument.parseNavList(pageListNav, navDocPath))
      : undefined;

    const landmarksNav = navElements.find((nav) => hasEpubType(nav, "landmarks"));
    const landmarks = landmarksNav
      ? new NavigationList("landmarks", NavigationDocument.parseNavList(landmarksNav, navDocPath))
      : undefined;

    return new NavigationDocument(toc, pageList, landmarks);
  }

  private static parseNavList(navEl: Element, navDocPath: string): NavPoint[] {
    const listEl = getFirstChildElementByNS(navEl, XHTML_NAMESPACE, "ol");
    // Lenient on purpose: an optional (page-list/landmarks) nav element
    // present but missing its <ol> shouldn't break navigation entirely —
    // only the mandatory toc list is required to be well-formed by the
    // caller (via the required-<nav> check above).
    return listEl ? NavigationDocument.parseOl(listEl, navDocPath) : [];
  }

  private static parseOl(olEl: Element, navDocPath: string): NavPoint[] {
    return getChildElementsByNS(olEl, XHTML_NAMESPACE, "li").map((li) =>
      NavigationDocument.parseLi(li, navDocPath),
    );
  }

  private static parseLi(liEl: Element, navDocPath: string): NavPoint {
    const anchor = getFirstChildElementByNS(liEl, XHTML_NAMESPACE, "a");
    const span = anchor ? undefined : getFirstChildElementByNS(liEl, XHTML_NAMESPACE, "span");
    const label = (anchor ?? span)?.textContent?.trim() ?? "";

    let path: string | undefined;
    let fragment: string | undefined;
    let externalReference: NonPackageEpubReference | undefined;
    const href = anchor?.getAttribute("href");
    if (href && anchor) {
      const reference = classifyEpubReference(navDocPath, href, getDocumentBaseHref(anchor.ownerDocument));
      if (reference.kind === "package" || reference.kind === "fragment") {
        path = reference.kind === "package" ? reference.path : navDocPath;
        fragment = reference.fragment;
      } else {
        path = reference.url;
        externalReference = reference;
      }
    }

    const nestedOl = getFirstChildElementByNS(liEl, XHTML_NAMESPACE, "ol");
    const children = nestedOl ? NavigationDocument.parseOl(nestedOl, navDocPath) : [];

    const epubTypes = anchor
      ? (getNamespacedAttribute(anchor, OPS_NAMESPACE, "type") ?? "").split(/\s+/).filter(Boolean)
      : [];
    return new NavPoint(label, path, fragment, children, epubTypes, externalReference);
  }

  // ---- NCX fallback ----

  /** Parses `xml` (a legacy NCX document's raw text) into a
   * `NavigationDocument`. NCX has no equivalent of EPUB3's `landmarks`, so
   * that list is always absent when parsed this way. */
  public static parseNcx(xml: string, ncxPath: string): NavigationDocument {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      throw new NavigationDocumentError(`Malformed XML in NCX at ${ncxPath}.`);
    }

    const rootEl = doc.documentElement;
    const navMapEl = getFirstChildElementByNS(rootEl, NCX_NAMESPACE, "navMap");
    if (!navMapEl) {
      throw new NavigationDocumentError(`NCX at ${ncxPath} has no <navMap>, which is required.`);
    }
    const tocItems = getChildElementsByNS(navMapEl, NCX_NAMESPACE, "navPoint").map((navPoint) =>
      NavigationDocument.parseNcxNavPoint(navPoint, ncxPath),
    );
    const toc = new NavigationList("toc", tocItems);

    const pageListEl = getFirstChildElementByNS(rootEl, NCX_NAMESPACE, "pageList");
    const pageList = pageListEl
      ? new NavigationList(
          "page-list",
          getChildElementsByNS(pageListEl, NCX_NAMESPACE, "pageTarget").map((pageTarget) =>
            NavigationDocument.parseNcxLabeledTarget(pageTarget, ncxPath),
          ),
        )
      : undefined;

    const additionalLists = getChildElementsByNS(rootEl, NCX_NAMESPACE, "navList")
      .map((list) => {
        const label = getFirstChildElementByNS(list, NCX_NAMESPACE, "navLabel");
        return {
          label: label
            ? getFirstChildElementByNS(label, NCX_NAMESPACE, "text")?.textContent?.trim() ||
              undefined
            : undefined,
          items: getChildElementsByNS(list, NCX_NAMESPACE, "navTarget").map((target) =>
            NavigationDocument.parseNcxLabeledTarget(target, ncxPath),
          ),
        };
      })
      .filter((list) => list.items.length > 0);
    return new NavigationDocument(toc, pageList, undefined, additionalLists);
  }

  private static parseNcxNavPoint(navPointEl: Element, ncxPath: string): NavPoint {
    const { path, fragment, label, externalReference } = NavigationDocument.parseNcxLabelAndTarget(
      navPointEl,
      ncxPath,
    );
    const children = getChildElementsByNS(navPointEl, NCX_NAMESPACE, "navPoint").map((child) =>
      NavigationDocument.parseNcxNavPoint(child, ncxPath),
    );
    return new NavPoint(label, path, fragment, children, [], externalReference);
  }

  private static parseNcxLabeledTarget(targetEl: Element, ncxPath: string): NavPoint {
    const { path, fragment, label, externalReference } = NavigationDocument.parseNcxLabelAndTarget(targetEl, ncxPath);
    return new NavPoint(label, path, fragment, [], [], externalReference);
  }

  /** Shared shape of NCX `<navPoint>` and `<pageTarget>`: both have a
   * `<navLabel><text>` and a `<content src="...">`. */
  private static parseNcxLabelAndTarget(
    el: Element,
    ncxPath: string,
  ): { label: string; path: string | undefined; fragment: string | undefined; externalReference?: NonPackageEpubReference } {
    const navLabelEl = getFirstChildElementByNS(el, NCX_NAMESPACE, "navLabel");
    const textEl = navLabelEl
      ? getFirstChildElementByNS(navLabelEl, NCX_NAMESPACE, "text")
      : undefined;
    const label = textEl?.textContent?.trim() ?? "";

    const contentEl = getFirstChildElementByNS(el, NCX_NAMESPACE, "content");
    const src = contentEl?.getAttribute("src");

    let path: string | undefined;
    let fragment: string | undefined;
    let externalReference: NonPackageEpubReference | undefined;
    if (src) {
      const reference = classifyEpubReference(ncxPath, src);
      if (reference.kind === "package" || reference.kind === "fragment") {
        path = reference.kind === "package" ? reference.path : ncxPath;
        fragment = reference.fragment;
      } else {
        path = reference.url;
        externalReference = reference;
      }
    }

    return { label, path, fragment, externalReference };
  }
}

/** Checks whether an element's `epub:type` attribute (a space-separated
 * list of tokens, e.g. `epub:type="toc bodymatter"`) contains `token`. */
function hasEpubType(element: Element, token: string): boolean {
  const value = getNamespacedAttribute(element, OPS_NAMESPACE, "type");
  return value ? value.trim().split(/\s+/).includes(token) : false;
}
