import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { ViewportSize } from "../container/PackageDocument.js";
import type { DomBreakPoint } from "../layout/Page.js";
import { FixedContentHost } from "./FixedContentHost.js";
import type { FixedSpread } from "./FixedLayoutSpreadPlanner.js";
import type { ContentDocumentView } from "./ContentDocumentView.js";

/**
 * A two-page fixed-layout spread for wide reader panes: either one
 * `FixedContentHost` shown alone and centered (a `FixedSpread` of kind
 * `"single"` — a lone unpaired page, or one explicitly marked
 * `page-spread-center`), or two directly adjacent pages
 * (a `FixedSpread` of kind `"pair"`, computed by `FixedLayoutSpreadPlanner`
 * — see its own doc comment for the full pairing algorithm this class is
 * deliberately *not* responsible for: this class only ever renders
 * whichever `FixedSpread` it's given, exactly like `SpreadPaginatedHost`
 * only ever renders whichever two page indices it's told to).
 *
 * A `FixedContentHost` for a `"pair"` spread's two columns must share
 * exactly one scale factor between them (`layoutPair`, below) — never
 * each independently scaling its own page to fill its own half of the
 * available width the way an earlier version of this class did. That
 * independence was a real, reported bug: as the reader pane widened
 * past the two pages' own combined aspect ratio, each column kept
 * scaling its own page up to fill its own (increasingly generous)
 * half-width, letterboxing the extra space on *both* sides of *each*
 * page individually — which visibly pushed the two pages apart from
 * each other as the window widened, when spread-heavy fixed-layout
 * content (art spanning both pages, common in comics/picture books)
 * needs them to stay tightly adjacent regardless of window width, with
 * no reserved width or shadow between them and any extra space pushed
 * to the *outside* edges of the whole
 * spread instead. `layoutPair` computes the one scale that fits the
 * two pages' *combined* natural width and each
 * one's own natural height into the available pane, then sizes each
 * column's wrapper to exactly that page's own scaled width (rather
 * than a generic half-share) — the containing flex row's own
 * `justify-content: center` then centers the whole tightly-hugged unit
 * as one piece, exactly like a real open book, with any leftover space
 * only ever appearing outside it, never between the two pages.
 */
export class FixedSpreadHost {
  public static readonly GUTTER_WIDTH = 0;
  public static readonly MAX_ZOOM = 8;
  public static readonly ZOOM_STEP = 1.25;

  private readonly containerEl: HTMLDivElement;
  private readonly canvasEl: HTMLDivElement;
  private userZoom = 1;
  private readonly ownerDocument: Document;
  private width: number;
  private height: number;
  private leftHost: FixedContentHost | undefined;
  private rightHost: FixedContentHost | undefined;
  private singleHost: FixedContentHost | undefined;
  private currentSpread: FixedSpread | undefined;
  // Only set for a `"pair"` spread — the wrapper `<div>`s `layoutPair`
  // resizes (to each page's own scaled width) whenever `resize` is
  // called, and each column's own natural (unscaled) page size, read
  // once at `open` time and reused by every subsequent `layoutPair`
  // call so a resize never needs to re-read anything from either
  // column's own (never-changing) content document.
  private leftWrapperEl: HTMLDivElement | undefined;
  private rightWrapperEl: HTMLDivElement | undefined;
  private leftNaturalSize: ViewportSize | undefined;
  private rightNaturalSize: ViewportSize | undefined;

  public constructor(width: number, height: number, ownerDocument?: Document) {
    this.width = width;
    this.height = height;
    this.ownerDocument = ownerDocument ?? document;
    this.containerEl = this.ownerDocument.createElement("div");
    this.containerEl.style.width = "100%";
    this.containerEl.style.height = "100%";
    this.containerEl.style.overflow = "auto";
    this.canvasEl = this.ownerDocument.createElement("div");
    this.canvasEl.style.position = "relative";
    this.canvasEl.style.display = "flex";
    this.canvasEl.style.alignItems = "center";
    this.canvasEl.style.justifyContent = "center";
    // Clip the unscaled iframe layout boxes, not the magnified page artwork.
    this.canvasEl.style.overflow = "hidden";
    this.containerEl.appendChild(this.canvasEl);
  }

  public get element(): HTMLDivElement {
    return this.containerEl;
  }

  public get zoom(): number {
    return this.userZoom;
  }

  public setZoom(zoom: number, point?: { x: number; y: number }): void {
    if (!Number.isFinite(zoom) || zoom <= 0) throw new RangeError("Fixed-layout zoom must be finite and positive.");
    const anchor = this.zoomAnchor(point);
    this.userZoom = Math.max(1, Math.min(FixedSpreadHost.MAX_ZOOM, zoom));
    this.layoutPair();
    this.restoreAnchor(anchor);
  }

  public panBy(x: number, y: number): void {
    this.containerEl.scrollLeft += x;
    this.containerEl.scrollTop += y;
  }

  private zoomAnchor(point?: { x: number; y: number }) {
    const bounds = this.contentBounds();
    if (!bounds) return undefined;
    const viewport = this.containerEl.getBoundingClientRect();
    const x = point?.x ?? viewport.left + this.containerEl.clientWidth / 2;
    const y = point?.y ?? viewport.top + this.containerEl.clientHeight / 2;
    return bounds.width && bounds.height
      ? { x, y, fractionX: (x - bounds.left) / bounds.width, fractionY: (y - bounds.top) / bounds.height }
      : undefined;
  }

  private contentBounds() {
    const rectangles = [this.singleHost, this.leftHost, this.rightHost]
      .flatMap(host => host ? [host.element.getBoundingClientRect()] : []);
    if (!rectangles.length) return undefined;
    const left = Math.min(...rectangles.map(rect => rect.left));
    const top = Math.min(...rectangles.map(rect => rect.top));
    return { left, top, width: Math.max(...rectangles.map(rect => rect.right)) - left,
      height: Math.max(...rectangles.map(rect => rect.bottom)) - top };
  }

  private restoreAnchor(anchor: ReturnType<FixedSpreadHost["zoomAnchor"]>): void {
    if (this.userZoom === 1) {
      this.containerEl.scrollLeft = 0;
      this.containerEl.scrollTop = 0;
    } else if (anchor) {
      const bounds = this.contentBounds();
      if (bounds) this.panBy(bounds.left + anchor.fractionX * bounds.width - anchor.x,
        bounds.top + anchor.fractionY * bounds.height - anchor.y);
    }
  }

  /** The spine item(s) currently loaded, in reading order (not
   * necessarily left-to-right screen order — see `FixedSpread`'s own
   * doc comment for why those can differ under `page-progression-
   * direction: rtl`). Only meaningful after `open` resolves. */
  public get spineIndices(): readonly number[] {
    if (!this.currentSpread) {
      return [];
    }
    return this.currentSpread.kind === "single"
      ? [this.currentSpread.spineIndex]
      : [this.currentSpread.leftSpineIndex, this.currentSpread.rightSpineIndex].sort((a, b) => a - b);
  }

  public get spread(): FixedSpread | undefined {
    return this.currentSpread;
  }

  /** Legacy physical-order view; use documentViews for publication identity. */
  public contentDocuments(): Document[] {
    return this.physicalDocumentViews().map(view => view.document);
  }

  /** Reading-order documents carry their own physical column and spine index. */
  public documentViews(): ContentDocumentView[] {
    return this.physicalDocumentViews().sort((a, b) => a.spineIndex - b.spineIndex);
  }

  private physicalDocumentViews(): ContentDocumentView[] {
    const spread = this.currentSpread;
    if (!spread) return [];
    const entries: ReadonlyArray<readonly [FixedContentHost | undefined, number, ContentDocumentView["physicalSide"]]> =
      spread.kind === "single"
        ? [[this.singleHost, spread.spineIndex, "single"]]
        : [[this.leftHost, spread.leftSpineIndex, "left"], [this.rightHost, spread.rightSpineIndex, "right"]];
    return entries.flatMap(([host, spineIndex, physicalSide]) => {
      const document = host?.element.contentDocument;
      return document ? [{ document, spineIndex, physicalSide }] : [];
    });
  }

  private get primaryHost(): FixedContentHost | undefined {
    const spread = this.currentSpread;
    if (spread?.kind !== "pair") return this.singleHost;
    return spread.leftSpineIndex < spread.rightSpineIndex ? this.leftHost : this.rightHost;
  }

  public primaryContentDocument(): Document | undefined {
    return this.primaryHost?.element.contentDocument ?? undefined;
  }

  /** The primary column's reading position, for whatever generically
   * persists/restores progress across every host type — see
   * `FixedContentHost.currentPosition`'s own doc comment on why this is
   * always just "the start of this page's body," never a sub-item
   * offset. */
  public currentPosition(): DomBreakPoint | undefined {
    return this.primaryHost?.currentPosition();
  }

  /** Sets every loaded column's iframe `title` to `title` — mirrors
   * `SpreadPaginatedHost.setTitle`. */
  public setTitle(title: string): void {
    if (this.singleHost) {
      this.singleHost.element.title = title;
      return;
    }
    if (this.leftHost) {
      this.leftHost.element.title = title;
    }
    if (this.rightHost) {
      this.rightHost.element.title = title;
    }
  }

  /** Loads `spread`'s spine item(s) and lays them out — one centered
   * `FixedContentHost` for a `"single"` spread, or two side by side
   * without an inter-page gap for a `"pair"`. Both columns of a
   * pair load concurrently (not sequentially) — nothing about showing
   * one depends on the other having finished first, unlike
   * `SpreadPaginatedHost`'s merged-tail case, so there's no reason to
   * serialize them and make the reader wait twice as long. */
  public async open(
    contentLoader: ContentLoader,
    resolver: ResourceUrlResolver,
    spread: FixedSpread,
    packageViewport: ViewportSize | undefined,
  ): Promise<void> {
    this.disposeChildren();
    this.currentSpread = spread;
    this.canvasEl.replaceChildren();
    this.canvasEl.style.flexDirection = "row";

    if (spread.kind === "single") {
      const host = new FixedContentHost(this.width, this.height, this.ownerDocument);
      this.singleHost = host;
      this.canvasEl.appendChild(host.element);
      await host.open(contentLoader, resolver, spread.spineIndex, packageViewport);
      this.layoutPair();
      return;
    }

    // An initial guess for each column's width — irrelevant beyond
    // giving `FixedContentHost.open`'s own first (throwaway) internal
    // `applyScale` call *some* number to compute against, since
    // `layoutPair` (below) immediately overrides both hosts' scale and
    // each wrapper's own width with the real, shared-scale layout right
    // after both finish loading — seeing this initial guess paint for
    // even one frame isn't a real concern in practice (loading two
    // fixed-layout pages is rarely instant enough for a frame to land
    // in between).
    const initialColumnWidth = FixedSpreadHost.columnWidth(this.width);
    const left = new FixedContentHost(initialColumnWidth, this.height, this.ownerDocument);
    const right = new FixedContentHost(initialColumnWidth, this.height, this.ownerDocument);
    this.leftHost = left;
    this.rightHost = right;

    const leftWrapperEl = this.ownerDocument.createElement("div");
    leftWrapperEl.style.position = "relative";
    leftWrapperEl.style.height = "100%";
    leftWrapperEl.style.flexShrink = "0";
    leftWrapperEl.appendChild(left.element);
    this.leftWrapperEl = leftWrapperEl;

    const rightWrapperEl = this.ownerDocument.createElement("div");
    rightWrapperEl.style.position = "relative";
    rightWrapperEl.style.height = "100%";
    rightWrapperEl.style.flexShrink = "0";
    rightWrapperEl.appendChild(right.element);
    this.rightWrapperEl = rightWrapperEl;

    // Keep native reading and tab order in spine order, independently of screen order.
    if (spread.rightSpineIndex < spread.leftSpineIndex) {
      this.canvasEl.style.flexDirection = "row-reverse";
      this.canvasEl.append(rightWrapperEl, leftWrapperEl);
    } else {
      this.canvasEl.append(leftWrapperEl, rightWrapperEl);
    }

    // Concurrent, not sequential — see this method's own doc comment.
    await Promise.all([
      left.open(contentLoader, resolver, spread.leftSpineIndex, packageViewport),
      right.open(contentLoader, resolver, spread.rightSpineIndex, packageViewport),
    ]);
    this.leftNaturalSize = left.naturalSize;
    this.rightNaturalSize = right.naturalSize;
    this.layoutPair();
  }

  /** Recalculates every loaded column's scale for a new available size
   * — see `FixedContentHost.resize`'s identical reasoning (fixed-layout
   * content is never reflowed, so this is purely a scale-factor
   * recomputation, never a re-measure/re-paginate). */
  public resize(width: number, height: number): void {
    const anchor = this.zoomAnchor();
    this.width = width;
    this.height = height;
    this.layoutPair();
    this.restoreAnchor(anchor);
  }

  /** Computes and applies the one shared scale a `"pair"` spread's two
   * columns must both use (see this class's own doc comment for why),
   * from each column's already-known natural size (`leftNaturalSize`/
   * `rightNaturalSize`, read once at `open` time — fixed-layout content
   * never changes its own intrinsic size, so there's nothing to
   * re-read on a later `resize`). Fits the two pages' *combined*
   * natural width and the *taller* of the two
   * pages' own natural heights into the available pane, then sizes
   * each column's wrapper to exactly that page's own scaled width (not
   * a generic half-share) so the flex row hugs them together without
   * a gap, letting the containing flex's own
   * `justify-content: center` center the whole tightly-hugged unit as
   * one piece within the pane — any leftover space (whenever the pane's
   * own aspect ratio is wider than the combined spread's) only ever
   * appears outside it, on both outer edges equally, never between the
   * two pages themselves. A no-op if either column hasn't finished
   * loading yet (`open`'s own call site already guarantees both have,
   * before this is ever reached the first time; a later `resize` before
   * the *next* `open` reuses these same already-known sizes). */
  private layoutPair(): void {
    if (this.singleHost) {
      const natural = this.singleHost.naturalSize;
      const scale = Math.min(this.width / natural.width, this.height / natural.height) * this.userZoom;
      const canvasWidth = Math.max(this.width, natural.width * scale);
      const canvasHeight = Math.max(this.height, natural.height * scale);
      this.canvasEl.style.width = `${canvasWidth}px`;
      this.canvasEl.style.height = `${canvasHeight}px`;
      this.singleHost.applyExternalScale(scale, canvasWidth, canvasHeight);
      return;
    }
    if (
      !this.leftHost ||
      !this.rightHost ||
      !this.leftWrapperEl ||
      !this.rightWrapperEl ||
      !this.leftNaturalSize ||
      !this.rightNaturalSize
    ) {
      return;
    }
    const combinedNaturalWidth = this.leftNaturalSize.width + this.rightNaturalSize.width;
    const tallestNaturalHeight = Math.max(this.leftNaturalSize.height, this.rightNaturalSize.height);
    const scale = Math.min(
      Math.max(1, this.width) / combinedNaturalWidth,
      this.height / tallestNaturalHeight,
    ) * this.userZoom;
    const canvasWidth = Math.max(this.width, combinedNaturalWidth * scale);
    const canvasHeight = Math.max(this.height, tallestNaturalHeight * scale);
    this.canvasEl.style.width = `${canvasWidth}px`;
    this.canvasEl.style.height = `${canvasHeight}px`;

    const leftScaledWidth = this.leftNaturalSize.width * scale;
    const rightScaledWidth = this.rightNaturalSize.width * scale;
    this.leftWrapperEl.style.width = `${leftScaledWidth}px`;
    this.rightWrapperEl.style.width = `${rightScaledWidth}px`;
    this.leftHost.applyExternalScale(scale, leftScaledWidth, canvasHeight);
    this.rightHost.applyExternalScale(scale, rightScaledWidth, canvasHeight);
  }

  public dispose(): void {
    this.disposeChildren();
    this.containerEl.remove();
  }

  private disposeChildren(): void {
    this.singleHost?.dispose();
    this.leftHost?.dispose();
    this.rightHost?.dispose();
    this.singleHost = undefined;
    this.leftHost = undefined;
    this.rightHost = undefined;
    this.leftWrapperEl = undefined;
    this.rightWrapperEl = undefined;
    this.leftNaturalSize = undefined;
    this.rightNaturalSize = undefined;
    this.currentSpread = undefined;
  }

  /** A rough, generic half-and-half split — used only as `open`'s
   * initial, throwaway placeholder size for each column's own first
   * (immediately-overridden) internal `applyScale` call, before either
   * page's own natural size is known yet (see `layoutPair`, which
   * replaces it with the real, shared-scale, tightly-hugged layout
   * right after both columns finish loading). No longer meaningful as
   * "the" column width once a pair has actually loaded — each column's
   * own final scaled width almost never matches this evenly-split
   * guess, since the two pages only ever share one scale, not one
   * width, once `layoutPair` has run (see this class's own doc
   * comment). */
  private static columnWidth(totalWidth: number): number {
    return Math.max(1, Math.floor(totalWidth / 2));
  }
}
