import { EpubContainer } from "../container/EpubContainer.js";
import { resolveEpubPath, splitHrefFragment } from "../container/EpubPath.js";
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
    /** The fragment (anchor) portion of the target href, if any — e.g.
     * `"section2"` for a target of `chapter1.xhtml#section2`. */
    public readonly fragment: string | undefined,
    public readonly children: readonly NavPoint[],
  ) {}

  public get isLinked(): boolean {
    return this.path !== undefined;
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
  ) {}

  /** Loads a publication's navigation, preferring its EPUB3 Nav Document
   * and falling back to an NCX (via the spine's `toc` attribute, or by
   * media type) for EPUB2-authored or hybrid content. Throws
   * `NavigationDocumentError` if neither is present/parseable. */
  public static async load(container: EpubContainer): Promise<NavigationDocument> {
    const pkg = await container.getPackageDocument();

    const navItem = pkg.findNavDocument();
    if (navItem) {
      const xml = await container.requireEntry(navItem.path).readText();
      return NavigationDocument.parseNavDocument(xml, navItem.path);
    }

    const ncxItem = pkg.findNcxDocument();
    if (ncxItem) {
      const xml = await container.requireEntry(ncxItem.path).readText();
      return NavigationDocument.parseNcx(xml, ncxItem.path);
    }

    throw new NavigationDocumentError(
      "No navigation found: package declares neither an EPUB3 Nav Document nor a fallback NCX.",
    );
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
    const href = anchor?.getAttribute("href");
    if (href) {
      const split = splitHrefFragment(href);
      path = resolveEpubPath(navDocPath, split.path);
      fragment = split.fragment;
    }

    const nestedOl = getFirstChildElementByNS(liEl, XHTML_NAMESPACE, "ol");
    const children = nestedOl ? NavigationDocument.parseOl(nestedOl, navDocPath) : [];

    return new NavPoint(label, path, fragment, children);
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

    return new NavigationDocument(toc, pageList, undefined);
  }

  private static parseNcxNavPoint(navPointEl: Element, ncxPath: string): NavPoint {
    const { path, fragment, label } = NavigationDocument.parseNcxLabelAndTarget(
      navPointEl,
      ncxPath,
    );
    const children = getChildElementsByNS(navPointEl, NCX_NAMESPACE, "navPoint").map((child) =>
      NavigationDocument.parseNcxNavPoint(child, ncxPath),
    );
    return new NavPoint(label, path, fragment, children);
  }

  private static parseNcxLabeledTarget(targetEl: Element, ncxPath: string): NavPoint {
    const { path, fragment, label } = NavigationDocument.parseNcxLabelAndTarget(targetEl, ncxPath);
    return new NavPoint(label, path, fragment, []);
  }

  /** Shared shape of NCX `<navPoint>` and `<pageTarget>`: both have a
   * `<navLabel><text>` and a `<content src="...">`. */
  private static parseNcxLabelAndTarget(
    el: Element,
    ncxPath: string,
  ): { label: string; path: string | undefined; fragment: string | undefined } {
    const navLabelEl = getFirstChildElementByNS(el, NCX_NAMESPACE, "navLabel");
    const textEl = navLabelEl
      ? getFirstChildElementByNS(navLabelEl, NCX_NAMESPACE, "text")
      : undefined;
    const label = textEl?.textContent?.trim() ?? "";

    const contentEl = getFirstChildElementByNS(el, NCX_NAMESPACE, "content");
    const src = contentEl?.getAttribute("src");

    let path: string | undefined;
    let fragment: string | undefined;
    if (src) {
      const split = splitHrefFragment(src);
      path = resolveEpubPath(ncxPath, split.path);
      fragment = split.fragment;
    }

    return { label, path, fragment };
  }
}

/** Checks whether an element's `epub:type` attribute (a space-separated
 * list of tokens, e.g. `epub:type="toc bodymatter"`) contains `token`. */
function hasEpubType(element: Element, token: string): boolean {
  const value = getNamespacedAttribute(element, OPS_NAMESPACE, "type");
  return value ? value.trim().split(/\s+/).includes(token) : false;
}
