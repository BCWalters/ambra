import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { SandboxedContentHost } from "../rendering/SandboxedContentHost.js";
import type { DomBreakPoint } from "../layout/Page.js";
import type { ViewportSize } from "../container/PackageDocument.js";
import { parseViewportDimensions } from "../container/PackageDocument.js";
import { loadAssembledSpineItem } from "./SpineItemAssembler.js";

/** Used when neither a content document's own `<meta name="viewport">`
 * nor the package-level `rendition:viewport` property declares an
 * intrinsic page size — real fixed-layout books almost always declare
 * one, so this is purely a last-resort fallback to avoid ever failing to
 * render. A common print-ish portrait page ratio. */
const DEFAULT_VIEWPORT: ViewportSize = { width: 1000, height: 1400 };

/**
 * Production content host for one spine item in fixed-layout mode: owns
 * a `SandboxedContentHost`, loads/assembles a spine item into it at its
 * *intrinsic* page size (from the content document's own
 * `<meta name="viewport">` or SVG `viewBox`, falling back to the package-level
 * `rendition:viewport` property, then `DEFAULT_VIEWPORT`), and scales the
 * whole iframe via CSS `transform` to fit the available reader pane —
 * letterboxed and centered, aspect ratio always preserved. Unlike
 * `PaginatedContentHost`/`ScrollContentHost`, resizing never needs to
 * re-measure or re-layout the content itself (fixed-layout content is
 * never reflowed) — it's just a scale-factor recalculation. Deliberately
 * opts out of `ReadingTheme` (see `loadAssembledSpineItem`'s
 * `applyReadingTheme: false`) — fixed-layout content is a pixel-precise,
 * author-designed page, and our own typography must never be layered
 * onto it.
 *
 * Two-page spreads (`rendition:spread`) are handled one level up, by
 * `FixedSpreadHost` (which owns two of these, one per column, for a
 * `"pair"` spread) — see that class's own doc comment for why a
 * pair's two columns must share exactly one externally-computed scale
 * (`applyExternalScale`, below) rather than each independently
 * scaling itself to fill its own half of the available width the way
 * this class's own `open`/`resize` do for the single-page case.
 */
export class FixedContentHost {
  /** The neutral letterbox color a fixed-layout page's own margins (the
   * space `applyScale`'s centering leaves around a page whose aspect
   * ratio doesn't match the available pane) show through to — shared
   * with `ReaderApp`'s reading-pane background (which normally paints
   * this exact color behind a fixed-layout host's own transparent
   * wrapper) and with `ReaderController.animateFixedSpreadTurn`, which
   * needs to paint it *directly onto* the animating spread's own
   * wrapper for the turn's duration: unlike reflowable content (never
   * shorter than its own clip-boxed page, so nothing else ever shows
   * through it — see that method's own doc comment), a fixed-layout
   * spread's wrapper is exactly pane-sized but the page(s) *inside* it
   * often aren't (any aspect-ratio mismatch at all), so without an
   * opaque background of its own, whichever side is stacked underneath
   * during an animated turn bled through the animating side's own
   * letterboxed margins — a real, confirmed artifact (a stray shadow
   * seam and, worse, the *next* page's colors visibly showing through
   * the current page's own margins mid-rotation) caught via direct
   * screenshot inspection, not a merely theoretical concern. */
  public static readonly LETTERBOX_BACKGROUND = "#e5e5e5";

  private readonly sandboxedHost: SandboxedContentHost;
  private availableWidth: number;
  private availableHeight: number;
  private pageWidth = DEFAULT_VIEWPORT.width;
  private pageHeight = DEFAULT_VIEWPORT.height;

  public constructor(width: number, height: number, ownerDocument?: Document) {
    this.availableWidth = width;
    this.availableHeight = height;
    this.sandboxedHost = new SandboxedContentHost(ownerDocument);
  }

  public get element(): HTMLIFrameElement {
    return this.sandboxedHost.element;
  }

  /** Loads spine item `spineIndex`, determines its intrinsic page size,
   * and scales it to fit the current available size. `packageViewport`
   * is the package-level `rendition:viewport` fallback (see
   * `PackageMetadata.renditionViewport`), used when the content document
   * itself doesn't declare one. */
  public async open(
    contentLoader: ContentLoader,
    resolver: ResourceUrlResolver,
    spineIndex: number,
    packageViewport: ViewportSize | undefined,
  ): Promise<void> {
    const assembledXhtml = await loadAssembledSpineItem(contentLoader, resolver, spineIndex, {
      applyReadingTheme: false,
    });
    await this.sandboxedHost.render(assembledXhtml);

    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      throw new Error("Sandboxed iframe has no contentDocument after loading (unexpected).");
    }

    const viewport = FixedContentHost.readContentViewport(iframeDocument) ?? packageViewport ?? DEFAULT_VIEWPORT;
    this.pageWidth = viewport.width;
    this.pageHeight = viewport.height;

    const element = this.sandboxedHost.element;
    element.style.width = `${this.pageWidth}px`;
    element.style.height = `${this.pageHeight}px`;
    element.style.transformOrigin = "top left";

    this.applyScale();
  }

  /** Recalculates the scale factor for a new available size — never
   * re-paginates or re-measures, since fixed-layout content is never
   * reflowed. */
  public resize(width: number, height: number): void {
    this.availableWidth = width;
    this.availableHeight = height;
    this.applyScale();
  }

  /** This page's own intrinsic (unscaled) size, as read from its own
   * `<meta name="viewport">`/the package-level fallback — only
   * meaningful after `open` resolves. `FixedSpreadHost` reads this for
   * both columns of a `"pair"` spread to compute the one shared scale
   * they both need (see `applyExternalScale`'s own doc comment). */
  public get naturalSize(): ViewportSize {
    return { width: this.pageWidth, height: this.pageHeight };
  }

  /** A fixed-layout spine item has no sub-page reading position to track
   * (the whole item *is* one page) — this returns the start of its body
   * (or SVG document element),
   * purely so callers that generically persist/restore position (see
   * `resume-reading`) don't need to special-case fixed-layout books. */
  public currentPosition(): DomBreakPoint | undefined {
    const document = this.sandboxedHost.element.contentDocument;
    const root = document?.body ?? document?.documentElement;
    return root ? { node: root, offset: 0 } : undefined;
  }

  /** Applies an *externally computed* `scale` (rather than this host's
   * own independently-computed `min(availableWidth/pageWidth, ...)`) —
   * used by `FixedSpreadHost` for a `"pair"` spread, where both columns
   * must share exactly one scale factor rather than each computing its
   * own against its own half-share of the available width. That
   * per-column independence was a real, reported bug of its own: as the
   * reader pane widened past the two pages' own combined aspect ratio,
   * each column kept scaling its own page up to fill its own
   * (increasingly generous) half, letterboxing the *extra* space on
   * both sides of *each* page individually — which visibly pushed the
   * two pages apart from each other, when spread-heavy fixed-layout
   * content (art spanning both pages, a common case in comics/picture
   * books) needs them to stay tightly adjacent, with any leftover
   * space pushed to the *outside* edges of the whole spread instead.
   *
   * `availableWidth`/`availableHeight` here describe *this column's own
   * wrapper box* (not the whole spread) — same as `resize`'s own
   * parameters, just paired with a scale the caller already computed
   * instead of asking this host to compute its own. `FixedSpreadHost`
   * always sizes a column's wrapper to exactly this page's own scaled
   * width (so the centering math below reduces to a horizontal no-op —
   * the page already exactly fills its wrapper's width), while the
   * wrapper's height stays the full pane height (so this page still
   * verticaly centers within it exactly as a lone `"single"` spread's
   * page would, in case the two columns' own natural aspect ratios
   * differ enough that one column's scaled page is shorter than the
   * pane while the other's isn't). */
  public applyExternalScale(scale: number, availableWidth: number, availableHeight: number): void {
    this.availableWidth = availableWidth;
    this.availableHeight = availableHeight;
    this.applyScale(scale);
  }

  /** Explicit `position: absolute` placement (computed from the *scaled*
   * size) rather than relying on a surrounding flex container's centering
   * — a transform only affects paint, not the box's contribution to
   * layout/overflow, so a flex container clipping based on this element's
   * unscaled (much larger) box could wrongly clip the visually-smaller
   * scaled result. `overrideScale`, if given (see `applyExternalScale`),
   * is used in place of this host's own independently-computed scale —
   * every other part of the centering math is identical either way. */
  private applyScale(overrideScale?: number): void {
    const scale = overrideScale ?? Math.min(this.availableWidth / this.pageWidth, this.availableHeight / this.pageHeight);
    const scaledWidth = this.pageWidth * scale;
    const scaledHeight = this.pageHeight * scale;

    const element = this.sandboxedHost.element;
    element.style.position = "absolute";
    element.style.left = `${(this.availableWidth - scaledWidth) / 2}px`;
    element.style.top = `${(this.availableHeight - scaledHeight) / 2}px`;
    element.style.transform = `scale(${scale})`;
  }

  /** Reads an SVG root's viewBox/pixel dimensions or an XHTML
   * `<meta name="viewport" content="width=W, height=H">` — the per-document
   * mechanism real fixed-layout EPUBs use to declare their intrinsic page
   * size (more specific than, and preferred over, the package-level
   * `rendition:viewport` fallback). */
  private static readContentViewport(document: Document): ViewportSize | undefined {
    const root = document.documentElement;
    if (root.namespaceURI === "http://www.w3.org/2000/svg" && root.localName === "svg") {
      const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
      if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0) {
        return { width: viewBox[2]!, height: viewBox[3]! };
      }
      // Percentage dimensions need a containing viewport; they are not
      // intrinsic pixel sizes (e.g. width="100%" must not become 100px).
      const length = (name: string): number => {
        const value = root.getAttribute(name)?.trim() ?? "";
        return /^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(value)
          ? Number(value.replace(/px$/i, "")) : NaN;
      };
      const width = length("width");
      const height = length("height");
      return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
        ? { width, height } : undefined;
    }
    const meta = document.querySelector('meta[name="viewport"]');
    return parseViewportDimensions(meta?.getAttribute("content"));
  }

  public dispose(): void {
    this.sandboxedHost.dispose();
  }
}
