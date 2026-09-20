import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { ViewportSize } from "../container/PackageDocument.js";
import type { DomBreakPoint } from "../layout/Page.js";
import { FixedContentHost } from "./FixedContentHost.js";
import type { FixedSpread } from "./FixedLayoutSpreadPlanner.js";

/**
 * A two-page fixed-layout spread for wide reader panes: either one
 * `FixedContentHost` shown alone and centered (a `FixedSpread` of kind
 * `"single"` — a lone unpaired page, or one explicitly marked
 * `page-spread-center`), or two side by side with a gutter between them
 * (a `FixedSpread` of kind `"pair"`, computed by `FixedLayoutSpreadPlanner`
 * — see its own doc comment for the full pairing algorithm this class is
 * deliberately *not* responsible for: this class only ever renders
 * whichever `FixedSpread` it's given, exactly like `SpreadPaginatedHost`
 * only ever renders whichever two page indices it's told to).
 *
 * Each `FixedContentHost` gets half the available width (minus the
 * gutter) to scale its own intrinsic page size into — mirroring
 * `SpreadPaginatedHost.columnWidth`'s identical split for reflowable
 * spread mode, just without any of that class's own merged-tail/virtual-
 * index bookkeeping: a fixed-layout "page" is always exactly one whole
 * spine item, with no sub-item pagination at all, so there's no
 * equivalent of a chapter's own last page needing to be "borrowed" into
 * the next spread — crossing from one `FixedSpread` to the next is
 * always just "build a new host for the next `FixedSpread`," the same
 * as `PaginatedContentHost`'s own chapter-to-chapter crossing.
 */
export class FixedSpreadHost {
  public static readonly GUTTER_WIDTH = 24;

  private readonly containerEl: HTMLDivElement;
  private readonly ownerDocument: Document;
  private width: number;
  private height: number;
  private leftHost: FixedContentHost | undefined;
  private rightHost: FixedContentHost | undefined;
  private singleHost: FixedContentHost | undefined;
  private currentSpread: FixedSpread | undefined;

  public constructor(width: number, height: number, ownerDocument?: Document) {
    this.width = width;
    this.height = height;
    this.ownerDocument = ownerDocument ?? document;
    this.containerEl = this.ownerDocument.createElement("div");
    this.containerEl.style.display = "flex";
    this.containerEl.style.alignItems = "center";
    this.containerEl.style.justifyContent = "center";
    this.containerEl.style.width = "100%";
    this.containerEl.style.height = "100%";
  }

  public get element(): HTMLDivElement {
    return this.containerEl;
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

  /** Every content document currently loaded — one for a `"single"`
   * spread, two for a `"pair"` (left column first, then right — matching
   * `SpreadPaginatedHost.contentDocuments`'s own left-then-right
   * convention, for whatever caller needs to treat both spread kinds
   * uniformly, e.g. attaching the same click-to-turn/link-interception
   * listeners to whichever documents actually exist right now). */
  public contentDocuments(): Document[] {
    if (this.singleHost) {
      const doc = this.singleHost.element.contentDocument;
      return doc ? [doc] : [];
    }
    const docs: Document[] = [];
    const leftDoc = this.leftHost?.element.contentDocument;
    const rightDoc = this.rightHost?.element.contentDocument;
    if (leftDoc) {
      docs.push(leftDoc);
    }
    if (rightDoc) {
      docs.push(rightDoc);
    }
    return docs;
  }

  /** The single document accessibility/CFI resolution should key off —
   * the lone page for a `"single"` spread, or the left column of a
   * `"pair"` (mirroring `SpreadPaginatedHost.primaryContentDocument`'s
   * own left-column convention; fixed-layout content has no sub-item
   * reading position to track either way — see
   * `FixedContentHost.currentPosition` — so this is purely about which
   * single document a screen reader's focus/keyboard nav attaches to,
   * not about resuming a saved position). */
  public primaryContentDocument(): Document | undefined {
    return (this.singleHost ?? this.leftHost)?.element.contentDocument ?? undefined;
  }

  /** The primary column's reading position, for whatever generically
   * persists/restores progress across every host type — see
   * `FixedContentHost.currentPosition`'s own doc comment on why this is
   * always just "the start of this page's body," never a sub-item
   * offset. */
  public currentPosition(): DomBreakPoint | undefined {
    return (this.singleHost ?? this.leftHost)?.currentPosition();
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
   * (with `GUTTER_WIDTH` between them) for a `"pair"`. Both columns of a
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
    this.currentSpread = spread;
    this.containerEl.replaceChildren();
    this.leftHost = undefined;
    this.rightHost = undefined;
    this.singleHost = undefined;

    if (spread.kind === "single") {
      const host = new FixedContentHost(this.width, this.height, this.ownerDocument);
      this.singleHost = host;
      this.containerEl.appendChild(host.element);
      await host.open(contentLoader, resolver, spread.spineIndex, packageViewport);
      return;
    }

    const columnWidth = FixedSpreadHost.columnWidth(this.width);
    const left = new FixedContentHost(columnWidth, this.height, this.ownerDocument);
    const right = new FixedContentHost(columnWidth, this.height, this.ownerDocument);
    this.leftHost = left;
    this.rightHost = right;

    const leftWrapperEl = this.ownerDocument.createElement("div");
    leftWrapperEl.style.position = "relative";
    leftWrapperEl.style.width = `${columnWidth}px`;
    leftWrapperEl.style.height = "100%";
    leftWrapperEl.style.flexShrink = "0";
    leftWrapperEl.appendChild(left.element);

    const rightWrapperEl = this.ownerDocument.createElement("div");
    rightWrapperEl.style.position = "relative";
    rightWrapperEl.style.width = `${columnWidth}px`;
    rightWrapperEl.style.height = "100%";
    rightWrapperEl.style.flexShrink = "0";
    rightWrapperEl.appendChild(right.element);

    const gutter = this.ownerDocument.createElement("div");
    gutter.style.width = `${FixedSpreadHost.GUTTER_WIDTH}px`;
    gutter.style.flexShrink = "0";
    gutter.style.alignSelf = "stretch";
    gutter.style.background =
      "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.08) 46%, rgba(0,0,0,0.14) 50%, rgba(0,0,0,0.08) 54%, transparent 100%)";

    this.containerEl.append(leftWrapperEl, gutter, rightWrapperEl);

    // Concurrent, not sequential — see this method's own doc comment.
    await Promise.all([
      left.open(contentLoader, resolver, spread.leftSpineIndex, packageViewport),
      right.open(contentLoader, resolver, spread.rightSpineIndex, packageViewport),
    ]);
  }

  /** Recalculates every loaded column's scale for a new available size
   * — see `FixedContentHost.resize`'s identical reasoning (fixed-layout
   * content is never reflowed, so this is purely a scale-factor
   * recomputation, never a re-measure/re-paginate). */
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.singleHost) {
      this.singleHost.resize(width, height);
      return;
    }
    const columnWidth = FixedSpreadHost.columnWidth(width);
    this.leftHost?.resize(columnWidth, height);
    this.rightHost?.resize(columnWidth, height);
  }

  public dispose(): void {
    this.singleHost?.dispose();
    this.leftHost?.dispose();
    this.rightHost?.dispose();
    this.containerEl.remove();
  }

  private static columnWidth(totalWidth: number): number {
    return Math.max(1, Math.floor((totalWidth - FixedSpreadHost.GUTTER_WIDTH) / 2));
  }

  /** Public alias for `columnWidth` — mirrors `SpreadPaginatedHost
   * .effectiveColumnWidth`'s identical purpose: exposes the exact
   * single-column width a spread of `totalWidth` renders each side at,
   * for a caller (`ReaderController.setUpSpreadClickToNavigate`) that
   * needs to reference the same click-zone geometry a `"pair"`
   * `FixedSpread` is actually laid out at, without duplicating this
   * class's own gutter-width math. Meaningless for a `"single"` spread
   * (there's only one, full-width column) — callers already branch on
   * `spread.kind` before this would matter. */
  public static effectiveColumnWidth(totalWidth: number): number {
    return FixedSpreadHost.columnWidth(totalWidth);
  }
}
