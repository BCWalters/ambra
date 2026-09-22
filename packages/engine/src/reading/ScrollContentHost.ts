import type { ContentLoader } from "../content/ContentLoader.js";
import type { ResourceUrlResolver } from "../rendering/ResourceUrlResolver.js";
import { SandboxedContentHost } from "../rendering/SandboxedContentHost.js";
import { makeOverflowingPreElementsFocusable } from "../rendering/PreOverflowFocusability.js";
import type { DomBreakPoint } from "../layout/Page.js";
import { ScrollViewEngine } from "../layout/ScrollViewEngine.js";
import { loadAssembledSpineItem } from "./SpineItemAssembler.js";
import type { DisclosureState } from "./DisclosureState.js";

/**
 * Production content host for one spine item in continuous-scroll mode:
 * owns a `SandboxedContentHost`, loads/assembles a spine item into it,
 * and lets it scroll natively — deliberately never touching `overflow`
 * (unlike `PaginatedContentHost`, which disables it), since a normal
 * iframe already scrolls once its content exceeds its box. Position
 * tracking/restoration is delegated to `ScrollViewEngine`.
 */
export class ScrollContentHost {
  private readonly sandboxedHost: SandboxedContentHost;
  private engine: ScrollViewEngine | undefined;
  private disclosureCleanup: (() => void) | undefined;

  public constructor(width: number, height: number, ownerDocument?: Document) {
    this.sandboxedHost = new SandboxedContentHost(ownerDocument);
    this.sandboxedHost.element.style.width = `${width}px`;
    this.sandboxedHost.element.style.height = `${height}px`;
  }

  public get element(): HTMLIFrameElement {
    return this.sandboxedHost.element;
  }

  /** Loads spine item `spineIndex` and prepares position tracking for it,
   * scrolled to the top. Use `restorePosition` afterwards to resume at a
   * specific position instead. */
  public async open(
    contentLoader: ContentLoader,
    resolver: ResourceUrlResolver,
    spineIndex: number,
    disclosures?: DisclosureState,
  ): Promise<void> {
    this.disclosureCleanup?.();
    this.disclosureCleanup = undefined;
    const assembledXhtml = await loadAssembledSpineItem(contentLoader, resolver, spineIndex);
    await this.sandboxedHost.render(assembledXhtml);

    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      throw new Error("Sandboxed iframe has no contentDocument after loading (unexpected).");
    }
    this.disclosureCleanup = disclosures?.attach(spineIndex, iframeDocument);

    this.engine = ScrollViewEngine.prepare(iframeDocument.body);
    makeOverflowingPreElementsFocusable(iframeDocument);
  }

  /** The DOM position currently at the top of the viewport — see
   * `ScrollViewEngine.currentPosition`. */
  public currentPosition(): DomBreakPoint | undefined {
    return this.engine?.currentPosition();
  }

  /** Scrolls so `(node, offset)` sits at the top of the viewport — see
   * `ScrollViewEngine.restorePosition`. */
  public restorePosition(node: Node, offset: number): void {
    this.engine?.restorePosition(node, offset);
  }

  /** Re-measures at a new width/height (e.g. a window resize or
   * font-size change): a width change reflows the text, which can shift
   * every chunk's document-relative position, so position tracking must
   * be re-derived from a fresh, *unscrolled* measurement — re-measuring
   * mid-scroll would wrongly treat the current (non-zero) scroll offset
   * as the new baseline. Preserves reading position across the resize,
   * consistent with `PaginatedContentHost.relayout`. */
  public resize(width: number, height: number): void {
    const preserve = this.currentPosition();

    const iframeDocument = this.sandboxedHost.element.contentDocument;
    if (!iframeDocument) {
      return;
    }

    this.sandboxedHost.element.style.width = `${width}px`;
    this.sandboxedHost.element.style.height = `${height}px`;
    makeOverflowingPreElementsFocusable(iframeDocument);

    const scrollingElement = iframeDocument.scrollingElement ?? iframeDocument.documentElement;
    scrollingElement.scrollTop = 0;

    this.engine = ScrollViewEngine.prepare(iframeDocument.body);
    if (preserve) {
      this.engine.restorePosition(preserve.node, preserve.offset ?? 0);
    }
  }

  /** True if scrolled all the way to the top of this spine item. */
  public isAtStart(): boolean {
    const scrollingElement = this.sandboxedHost.element.contentDocument?.scrollingElement;
    return !scrollingElement || scrollingElement.scrollTop <= 0;
  }

  /** True if scrolled all the way to the bottom of this spine item
   * (within a small tolerance for sub-pixel layout rounding). */
  public isAtEnd(): boolean {
    const scrollingElement = this.sandboxedHost.element.contentDocument?.scrollingElement;
    if (!scrollingElement) {
      return true;
    }
    return (
      scrollingElement.scrollTop + scrollingElement.clientHeight >=
      scrollingElement.scrollHeight - 1
    );
  }

  public dispose(): void {
    this.disclosureCleanup?.();
    this.disclosureCleanup = undefined;
    this.sandboxedHost.dispose();
  }
}
