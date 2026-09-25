import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { DomBreakPoint, Page } from "../layout/Page.js";
import { PaginatedContentHost } from "./PaginatedContentHost.js";
import type { DisclosureState } from "./DisclosureState.js";
import type { ReflowablePagePosition, ReflowableSpread } from "./ReflowableSpreadPlanner.js";
import type { ContentDocumentView } from "./ContentDocumentView.js";
import type { PaginationSnapshot } from "../layout/PaginationSnapshot.js";

const MIN_SPREAD_COLUMN_WIDTH = 480;

/**
 * Two independently laid out pages, in reading order. Each iframe is mounted
 * once, before loading, and remains owned by this host until disposal.
 * Chapter boundaries are ordinary page pairs, not borrowed/reparented iframes.
 */
export class SpreadPaginatedHost {
  public static readonly GUTTER_WIDTH = 40;
  private readonly first: PaginatedContentHost;
  private readonly second: PaginatedContentHost;
  private readonly containerEl: HTMLDivElement;
  private spread: ReflowableSpread = { first: { spineIndex: 0, pageIndex: 0 } };
  private rtl = false;

  public constructor(
    private width: number,
    private height: number,
    ownerDocument?: Document,
  ) {
    const doc = ownerDocument ?? document;
    const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(width);
    this.first = new PaginatedContentHost(columnWidth, height, doc);
    this.second = new PaginatedContentHost(columnWidth, height, doc);
    this.first.element.style.flexShrink = "0";
    this.second.element.style.flexShrink = "0";
    const divider = doc.createElement("div");
    Object.assign(divider.style, {
      width: `${SpreadPaginatedHost.GUTTER_WIDTH}px`,
      flexShrink: "0",
      alignSelf: "stretch",
      background:
        "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.06) 46%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.06) 54%, transparent 100%)",
    });
    this.containerEl = doc.createElement("div");
    Object.assign(this.containerEl.style, {
      display: "flex",
      alignItems: "flex-start",
      height: `${height}px`,
    });
    this.containerEl.append(this.first.element, divider, this.second.element);
  }

  public get element(): HTMLDivElement {
    return this.containerEl;
  }
  public get positions(): ReflowableSpread {
    return this.spread;
  }
  public get primarySpineIndex(): number {
    return this.spread.second?.spineIndex ?? this.spread.first.spineIndex;
  }
  private get primary(): PaginatedContentHost {
    return this.isShowingMergedTail ? this.second : this.first;
  }
  public get pageIndex(): number {
    return this.primary.currentPageIndex;
  }
  public get pageCount(): number {
    return this.primary.pageCount;
  }
  public get secondPageIndex(): number | undefined {
    return this.spread.second ? this.second.currentPageIndex : undefined;
  }
  public pageCountFor(spineIndex: number): number | undefined {
    if (this.spread.first.spineIndex === spineIndex) return this.first.pageCount;
    if (this.spread.second?.spineIndex === spineIndex) return this.second.pageCount;
    return undefined;
  }
  public paginationSnapshotFor(spineIndex: number): PaginationSnapshot | undefined {
    for (const [host, position] of [
      [this.first, this.spread.first], [this.second, this.spread.second],
    ] as const) {
      if (position?.spineIndex !== spineIndex) continue;
      const snapshot = host.paginationSnapshot();
      if (snapshot) return snapshot;
    }
    return undefined;
  }
  /** Reuse only the documents already owned by their respective columns. */
  public tryGoToSpread(spread: ReflowableSpread): boolean {
    if (spread.first.spineIndex !== this.spread.first.spineIndex ||
      spread.first.pageIndex < 0 || spread.first.pageIndex >= this.first.pageCount ||
      (spread.second && (spread.second.spineIndex !== this.spread.second?.spineIndex ||
        spread.second.pageIndex < 0 || spread.second.pageIndex >= this.second.pageCount))) return false;
    this.first.goToPageIndex(spread.first.pageIndex);
    if (spread.second) this.second.goToPageIndex(spread.second.pageIndex);
    this.second.element.style.visibility = spread.second ? "visible" : "hidden";
    this.spread = spread;
    return true;
  }
  public get isShowingMergedTail(): boolean {
    return !!this.spread.second && this.spread.first.spineIndex !== this.spread.second.spineIndex;
  }
  public mergedTailDocument(): Document | undefined {
    return this.isShowingMergedTail ? (this.first.element.contentDocument ?? undefined) : undefined;
  }
  public contentDocuments(): Document[] {
    return this.documentViews().map(view => view.document);
  }
  /** Reading order is stable even when RTL reverses the physical columns. */
  public documentViews(): ContentDocumentView[] {
    return ([
      [this.first, this.spread.first, this.rtl ? "right" : "left"],
      [this.second, this.spread.second, this.rtl ? "left" : "right"],
    ] as const).flatMap(([host, position, physicalSide]) => {
      const doc = host.element.contentDocument;
      return doc && position ? [{
        document: doc, spineIndex: position.spineIndex, physicalSide,
        page: host.currentPageAndDocument()?.page,
        revealOverlay: () => host.revealReaderOverlay(),
      }] : [];
    });
  }
  public primaryContentDocument(): Document | undefined {
    return this.primary.element.contentDocument ?? undefined;
  }
  public setTitle(title: string): void {
    this.first.element.title = title;
    this.second.element.title = title;
  }
  public setProgressionDirection(direction: "ltr" | "rtl" | "default"): void {
    this.rtl = direction === "rtl";
    // Reverse the frame boxes, never the EPUB's text direction.
    this.containerEl.style.flexDirection = this.rtl ? "row-reverse" : "row";
  }

  public async open(
    loader: ContentLoader,
    resolver: ResourceUrlResolver,
    spineIndex: number,
    disclosures?: DisclosureState,
  ): Promise<void> {
    await this.openSpread(loader, resolver, {
      first: { spineIndex, pageIndex: 0 },
      second: { spineIndex, pageIndex: 1 },
    }, undefined, disclosures);
  }

  public async openSpread(
    loader: ContentLoader,
    resolver: ResourceUrlResolver,
    spread: ReflowableSpread,
    configure?: (doc: Document) => void,
    disclosures?: DisclosureState,
    snapshotFor?: (spineIndex: number) => PaginationSnapshot | undefined,
  ): Promise<void> {
    this.spread = spread;
    const snapshots = new Map<number, PaginationSnapshot>();
    for (const [host, position] of [
      [this.first, spread.first],
      [this.second, spread.second],
    ] as const) {
      host.element.style.visibility = position ? "visible" : "hidden";
      if (!position) continue;
      await host.open(loader, resolver, position.spineIndex, disclosures, configure, undefined,
        snapshots.get(position.spineIndex) ?? snapshotFor?.(position.spineIndex));
      const snapshot = host.paginationSnapshot();
      if (snapshot) snapshots.set(position.spineIndex, snapshot);
      host.goToPageIndex(position.pageIndex);
    }
    if (spread.second && spread.second.pageIndex >= this.second.pageCount) {
      this.spread = { first: spread.first };
      this.second.element.style.visibility = "hidden";
    }
    // Only hide a genuinely redundant copy. Both chapters of a boundary
    // spread remain accessible, including their independent links.
    if (this.isShowingMergedTail) {
      this.second.element.removeAttribute("aria-hidden");
      this.second.element.removeAttribute("tabindex");
    } else {
      this.second.element.setAttribute("aria-hidden", "true");
      this.second.element.setAttribute("tabindex", "-1");
    }
  }

  public currentPosition(): DomBreakPoint | undefined {
    return this.primary.currentPosition();
  }
  /** Resolve a page in the chapter's accessible document, not its hidden duplicate. */
  public pageStartPosition(spineIndex: number, pageIndex: number): DomBreakPoint | undefined {
    const host = this.spread.first.spineIndex === spineIndex ? this.first
      : this.spread.second?.spineIndex === spineIndex ? this.second : undefined;
    return host?.pageStartPosition(pageIndex);
  }
  public currentPagesAndDocuments(): Array<{ page: Page; document: Document; spineIndex: number }> {
    return this.documentViews().flatMap(({ page, document, spineIndex }) =>
      page ? [{ page, document, spineIndex }] : []);
  }
  private resizeBlankCompanion(width: number, height: number): void {
    if (this.spread.second) return;
    // The hidden page still defines a physical column and its outer margin,
    // but has no publication document to reflow.
    this.second.element.style.width = `${width}px`;
    this.second.element.style.height = `${height}px`;
  }
  public relayout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.containerEl.style.height = `${height}px`;
    const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(width);
    this.resizeBlankCompanion(columnWidth, height);
    this.first.relayout(columnWidth, height, undefined, false);
    if (this.spread.second) this.second.relayout(columnWidth, height, undefined, false);
    if (!this.isShowingMergedTail && this.spread.second) {
      this.second.goToPageIndex(this.first.currentPageIndex + 1);
    }
    this.capturePositions();
  }
  public goToPosition(node: Node, offset: number): void {
    this.primary.goToPosition(node, offset, false);
    this.goToPageIndex(this.primary.currentPageIndex);
  }
  /** Reuses the current documents when reflow still leaves an adjacent pair.
   * A changed chapter pairing requires the controller's normal owned load.
   * Roll back before returning false so that load failures retain a valid host. */
  public relayoutForResize(width: number, height: number, anchor?: DomBreakPoint): boolean {
    const previous = { width: this.width, height: this.height, spread: this.spread };
    const firstDocument = this.first.element.contentDocument;
    const secondDocument = this.second.element.contentDocument;
    this.width = width;
    this.height = height;
    this.containerEl.style.height = `${height}px`;
    const columnWidth = SpreadPaginatedHost.effectiveColumnWidth(width);
    this.resizeBlankCompanion(columnWidth, height);
    this.first.relayout(columnWidth, height,
      anchor?.node.ownerDocument === firstDocument ? anchor : undefined, false);
    if (this.spread.second) {
      this.second.relayout(columnWidth, height,
        anchor?.node.ownerDocument === secondDocument ? anchor : undefined, false);
    }
    const anchorInSecond = !!anchor && anchor.node.ownerDocument === secondDocument;
    const firstIndex = !this.isShowingMergedTail && anchorInSecond
      ? this.second.currentPageIndex - 1 : this.first.currentPageIndex;
    const adjacent = this.isShowingMergedTail
      ? this.first.currentPageIndex === this.first.pageCount - 1 && this.second.currentPageIndex === 0
      : this.spread.second
        ? firstIndex >= 0 && firstIndex + 1 < this.first.pageCount
        : firstIndex === this.first.pageCount - 1;
    if (!adjacent) {
      this.relayout(previous.width, previous.height);
      this.first.goToPageIndex(previous.spread.first.pageIndex);
      if (previous.spread.second) this.second.goToPageIndex(previous.spread.second.pageIndex);
      this.spread = previous.spread;
      return false;
    }
    if (!this.isShowingMergedTail && this.spread.second) {
      this.first.goToPageIndex(firstIndex);
      this.second.goToPageIndex(firstIndex + 1);
    }
    this.capturePositions();
    return true;
  }
  public goToPageIndex(index: number): void {
    if (this.isShowingMergedTail) return;
    this.first.goToPageIndex(index);
    const companion = index + 1 < this.first.pageCount;
    this.second.element.style.visibility = companion ? "visible" : "hidden";
    if (companion) this.second.goToPageIndex(index + 1);
    this.spread = {
      first: { spineIndex: this.spread.first.spineIndex, pageIndex: this.first.currentPageIndex },
      second: companion
        ? { spineIndex: this.spread.first.spineIndex, pageIndex: index + 1 }
        : undefined,
    };
  }
  public goToLastPage(): void {
    this.goToPageIndex(Math.floor((this.pageCount - 1) / 2) * 2);
  }
  private capturePositions(): void {
    const position = (old: ReflowablePagePosition, host: PaginatedContentHost) => ({
      spineIndex: old.spineIndex,
      pageIndex: host.currentPageIndex,
    });
    this.spread = {
      first: position(this.spread.first, this.first),
      second: this.spread.second ? position(this.spread.second, this.second) : undefined,
    };
  }
  private columnHost(column: "left" | "right"): PaginatedContentHost {
    return (column === "left") !== this.rtl ? this.first : this.second;
  }
  public columnElement(column: "left" | "right"): HTMLIFrameElement {
    return this.columnHost(column).element;
  }
  public growColumnToFullHeight(column: "left" | "right", height: number): void {
    this.columnHost(column).growToFullHeight(height);
  }
  public suppressColumnClipPathForAnimation(column: "left" | "right"): void {
    this.columnHost(column).suppressClipPathForAnimation();
  }
  public restoreColumnNaturalHeight(column: "left" | "right"): void {
    this.columnHost(column).restoreNaturalHeight();
  }
  public dispose(): void {
    this.first.dispose();
    this.second.dispose();
    this.containerEl.remove();
  }
  public static isEligible(width: number): boolean {
    return width >= MIN_SPREAD_COLUMN_WIDTH * 2 + SpreadPaginatedHost.GUTTER_WIDTH;
  }
  public static effectiveColumnWidth(width: number): number {
    return Math.max(
      MIN_SPREAD_COLUMN_WIDTH,
      Math.floor((width - SpreadPaginatedHost.GUTTER_WIDTH) / 2),
    );
  }
}
