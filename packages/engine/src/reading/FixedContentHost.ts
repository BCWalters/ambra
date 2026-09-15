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
 * `<meta name="viewport">`, falling back to the package-level
 * `rendition:viewport` property, then `DEFAULT_VIEWPORT`), and scales the
 * whole iframe via CSS `transform` to fit the available reader pane —
 * letterboxed and centered, aspect ratio always preserved. Unlike
 * `PaginatedContentHost`/`ScrollContentHost`, resizing never needs to
 * re-measure or re-layout the content itself (fixed-layout content is
 * never reflowed) — it's just a scale-factor recalculation.
 *
 * Deliberately out of scope for this pass: synthetic two-page spreads
 * (`rendition:spread`) — a real, separate feature (odd/even page
 * pairing, orientation, RTL page order) worth its own future work item.
 * Each spine item is always displayed as a single page here.
 */
export class FixedContentHost {
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
    const assembledXhtml = await loadAssembledSpineItem(contentLoader, resolver, spineIndex);
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

  /** A fixed-layout spine item has no sub-page reading position to track
   * (the whole item *is* one page) — this returns the start of its body,
   * purely so callers that generically persist/restore position (see
   * `resume-reading`) don't need to special-case fixed-layout books. */
  public currentPosition(): DomBreakPoint | undefined {
    const body = this.sandboxedHost.element.contentDocument?.body;
    return body ? { node: body, offset: 0 } : undefined;
  }

  /** Explicit `position: absolute` placement (computed from the *scaled*
   * size) rather than relying on a surrounding flex container's centering
   * — a transform only affects paint, not the box's contribution to
   * layout/overflow, so a flex container clipping based on this element's
   * unscaled (much larger) box could wrongly clip the visually-smaller
   * scaled result. */
  private applyScale(): void {
    const scale = Math.min(this.availableWidth / this.pageWidth, this.availableHeight / this.pageHeight);
    const scaledWidth = this.pageWidth * scale;
    const scaledHeight = this.pageHeight * scale;

    const element = this.sandboxedHost.element;
    element.style.position = "absolute";
    element.style.left = `${(this.availableWidth - scaledWidth) / 2}px`;
    element.style.top = `${(this.availableHeight - scaledHeight) / 2}px`;
    element.style.transform = `scale(${scale})`;
  }

  /** Reads `<meta name="viewport" content="width=W, height=H">` from a
   * fixed-layout content document — the near-universal, per-document
   * mechanism real fixed-layout EPUBs use to declare their intrinsic page
   * size (more specific than, and preferred over, the package-level
   * `rendition:viewport` fallback). */
  private static readContentViewport(document: Document): ViewportSize | undefined {
    const meta = document.querySelector('meta[name="viewport"]');
    return parseViewportDimensions(meta?.getAttribute("content"));
  }

  public dispose(): void {
    this.sandboxedHost.dispose();
  }
}
