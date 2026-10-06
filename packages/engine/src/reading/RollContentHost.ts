import type { ViewportSize } from "../container/PackageDocument.js";
import type { ContentLoader } from "../content/ContentLoader.js";
import type { DomBreakPoint } from "../layout/Page.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import type { ContentDocumentView } from "./ContentDocumentView.js";
import { FixedContentHost } from "./FixedContentHost.js";

interface RollItem {
  readonly spineIndex: number;
  readonly host: FixedContentHost;
  readonly wrapper: HTMLDivElement;
  readonly cleanupInput: () => void;
  scaledHeight: number;
}

/**
 * EPUB 3.4 roll presentation: every spine item is a fixed-width canvas fitted
 * to the reader width and stacked in one gapless vertical scroller.
 */
export class RollContentHost {
  private readonly containerEl: HTMLDivElement;
  private readonly ownerDocument: Document;
  private items: RollItem[] = [];
  private width: number;
  private height: number;

  public constructor(width: number, height: number, ownerDocument?: Document) {
    this.width = width;
    this.height = height;
    this.ownerDocument = ownerDocument ?? document;
    this.containerEl = this.ownerDocument.createElement("div");
    this.containerEl.dataset.ambraRoll = "";
    Object.assign(this.containerEl.style, {
      width: `${width}px`,
      height: `${height}px`,
      overflowX: "hidden",
      overflowY: "auto",
      position: "relative",
    });
  }

  public get element(): HTMLDivElement {
    return this.containerEl;
  }

  public get spineIndices(): readonly number[] {
    return this.items.map((item) => item.spineIndex);
  }

  public get currentSpineIndex(): number | undefined {
    return this.itemAtOffset(this.containerEl.scrollTop)?.spineIndex;
  }

  public documentViews(): ContentDocumentView[] {
    return this.items.flatMap((item) => {
      const document = item.host.element.contentDocument;
      return document
        ? [{ document, spineIndex: item.spineIndex, physicalSide: "single" as const }]
        : [];
    });
  }

  public async open(
    contentLoader: ContentLoader,
    resolver: ResourceUrlResolver,
    spineIndices: readonly number[],
    packageViewport: ViewportSize | undefined,
  ): Promise<void> {
    this.disposeItems();
    this.containerEl.replaceChildren();

    for (const spineIndex of spineIndices) {
      const wrapper = this.ownerDocument.createElement("div");
      wrapper.dataset.ambraRollSpineIndex = String(spineIndex);
      Object.assign(wrapper.style, {
        width: `${this.width}px`,
        height: `${this.height}px`,
        overflow: "hidden",
        position: "relative",
        margin: "0",
        padding: "0",
      });
      const host = new FixedContentHost(this.width, this.height, this.ownerDocument);
      wrapper.appendChild(host.element);
      this.containerEl.appendChild(wrapper);
      await host.open(contentLoader, resolver, spineIndex, packageViewport);
      const cleanupInput = this.bridgeInput(host);
      const item = { spineIndex, host, wrapper, cleanupInput, scaledHeight: 0 };
      this.items.push(item);
      this.layoutItem(item);
    }
    this.width = this.containerEl.clientWidth || this.width;
    for (const item of this.items) this.layoutItem(item);
    this.containerEl.scrollTop = 0;
  }

  public resize(width: number, height: number): void {
    const position = this.scrollPosition();
    this.height = height;
    this.containerEl.style.width = `${width}px`;
    this.containerEl.style.height = `${height}px`;
    this.width = this.containerEl.clientWidth || width;
    for (const item of this.items) this.layoutItem(item);
    if (position) this.restoreScrollPosition(position.spineIndex, position.fraction);
  }

  public setTitle(title: string): void {
    for (const item of this.items) item.host.element.title = title;
  }

  public currentPosition(): DomBreakPoint | undefined {
    const item = this.itemAtOffset(this.containerEl.scrollTop);
    const document = item?.host.element.contentDocument;
    if (!item || !document) return undefined;
    const itemOffset = this.containerEl.scrollTop - this.offsetFor(item.spineIndex);
    const scale = this.width / item.host.naturalSize.width;
    const target =
      document.elementFromPoint(item.host.naturalSize.width / 2, Math.max(0, itemOffset / scale)) ??
      document.body ??
      document.documentElement;
    return target ? { node: target, offset: 0 } : undefined;
  }

  public scrollToSpine(spineIndex: number, fraction = 0): void {
    this.restoreScrollPosition(spineIndex, Math.max(0, Math.min(1, fraction)));
  }

  public restorePosition(node: Node): void {
    const item = this.items.find(
      (candidate) => candidate.host.element.contentDocument === node.ownerDocument,
    );
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!item || !element) return;
    const scale = this.width / item.host.naturalSize.width;
    const maximum = Math.max(0, this.totalHeight() - this.height);
    this.containerEl.scrollTop = Math.min(
      maximum,
      this.offsetFor(item.spineIndex) + element.getBoundingClientRect().top * scale,
    );
  }

  public onScroll(listener: () => void): () => void {
    this.containerEl.addEventListener("scroll", listener, { passive: true });
    return () => this.containerEl.removeEventListener("scroll", listener);
  }

  public scrollByViewport(direction: 1 | -1): boolean {
    return this.scrollByPixels(direction * Math.max(1, this.height * 0.9));
  }

  public isAtStart(): boolean {
    return this.containerEl.scrollTop <= 0;
  }

  public isAtEnd(): boolean {
    return this.containerEl.scrollTop + this.height >= this.totalHeight() - 1;
  }

  public dispose(): void {
    this.disposeItems();
    this.containerEl.replaceChildren();
  }

  private layoutItem(item: RollItem): void {
    const natural = item.host.naturalSize;
    const scale = this.width / natural.width;
    item.scaledHeight = natural.height * scale;
    item.wrapper.style.width = `${this.width}px`;
    item.wrapper.style.height = `${item.scaledHeight}px`;
    item.host.applyExternalScale(scale, this.width, item.scaledHeight);
  }

  private scrollPosition(): { spineIndex: number; fraction: number } | undefined {
    const item = this.itemAtOffset(this.containerEl.scrollTop);
    if (!item) return undefined;
    const start = this.offsetFor(item.spineIndex);
    return {
      spineIndex: item.spineIndex,
      fraction:
        item.scaledHeight > 0 ? (this.containerEl.scrollTop - start) / item.scaledHeight : 0,
    };
  }

  private restoreScrollPosition(spineIndex: number, fraction: number): void {
    const item = this.items.find((candidate) => candidate.spineIndex === spineIndex);
    if (!item) return;
    const maximum = Math.max(0, this.totalHeight() - this.height);
    this.containerEl.scrollTop = Math.min(
      maximum,
      this.offsetFor(spineIndex) + item.scaledHeight * fraction,
    );
  }

  private itemAtOffset(offset: number): RollItem | undefined {
    let start = 0;
    for (const item of this.items) {
      if (offset < start + item.scaledHeight) return item;
      start += item.scaledHeight;
    }
    return this.items.at(-1);
  }

  private offsetFor(spineIndex: number): number {
    let offset = 0;
    for (const item of this.items) {
      if (item.spineIndex === spineIndex) return offset;
      offset += item.scaledHeight;
    }
    return offset;
  }

  private totalHeight(): number {
    return this.items.reduce((total, item) => total + item.scaledHeight, 0);
  }

  private disposeItems(): void {
    for (const item of this.items) {
      item.cleanupInput();
      item.host.dispose();
    }
    this.items = [];
  }

  private scrollByPixels(delta: number): boolean {
    const before = this.containerEl.scrollTop;
    const maximum = Math.max(0, this.totalHeight() - this.height);
    this.containerEl.scrollTop = Math.max(0, Math.min(maximum, before + delta));
    return this.containerEl.scrollTop !== before;
  }

  private bridgeInput(host: FixedContentHost): () => void {
    const document = host.element.contentDocument;
    if (!document) return () => {};
    const wheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      if (this.scrollByPixels(event.deltaY)) event.preventDefault();
    };
    let touchY: number | undefined;
    const touchStart = (event: TouchEvent): void => {
      touchY = event.touches[0]?.clientY;
    };
    const touchMove = (event: TouchEvent): void => {
      const next = event.touches[0]?.clientY;
      if (touchY === undefined || next === undefined) return;
      if (this.scrollByPixels(touchY - next)) event.preventDefault();
      touchY = next;
    };
    const touchEnd = (): void => {
      touchY = undefined;
    };
    document.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("touchstart", touchStart, { passive: true });
    document.addEventListener("touchmove", touchMove, { passive: false });
    document.addEventListener("touchend", touchEnd);
    document.addEventListener("touchcancel", touchEnd);
    return () => {
      document.removeEventListener("wheel", wheel);
      document.removeEventListener("touchstart", touchStart);
      document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("touchend", touchEnd);
      document.removeEventListener("touchcancel", touchEnd);
    };
  }
}
