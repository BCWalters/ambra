import { isReaderOwnedContent } from "@ambra/engine";
import type { ContentDocumentView, DomBreakPoint } from "@ambra/engine";

export interface NativeReadingPoint extends DomBreakPoint {
  spineIndex: number;
}

interface Signals {
  node: Node | null;
  offset: number;
  collapsed: boolean;
  focus: Element | null;
}

/** Best-effort DOM caret/focus evidence, not an assistive technology's spoken cursor. */
export class NativeReadingPosition {
  private point: NativeReadingPoint | undefined;
  private visual: DomBreakPoint | undefined;
  private readonly signals = new Map<Document, Signals>();
  private readonly scrollPositions = new Map<Document, { top: number; left: number }>();

  public constructor(
    private readonly views: () => readonly ContentDocumentView[],
    private readonly visualPosition: () => DomBreakPoint | undefined,
  ) {}

  public attach(document: Document): () => void {
    this.visual = this.visualPosition();
    this.signals.set(document, this.snapshot(document));
    this.scrollPositions.set(document, this.scrollPosition(document));
    const update = () => { this.current(); };
    const scroll = (event: Event) => {
      // Viewport scrolling targets Document; nested publication scrollers do not.
      if (event.target === document && this.views().some(view => view.document === document) &&
        this.available(document) && this.hasScrolled(document)) this.reset();
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("focusin", update);
    document.addEventListener("scroll", scroll, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("scroll", scroll);
      this.signals.delete(document);
      this.scrollPositions.delete(document);
    };
  }

  /** Consume existing signals on navigation, so an unmoved old caret cannot win again. */
  public reset(): void {
    this.point = undefined;
    this.visual = this.visualPosition();
    for (const view of this.views()) {
      this.signals.set(view.document, this.snapshot(view.document));
      // Restore/reflow may have queued a scroll event; consume its final baseline
      // now, without masking the next actual viewport movement.
      this.scrollPositions.set(view.document, this.scrollPosition(view.document));
    }
  }

  /** A resolved resume CFI or a layout-only change can retain a precise position. */
  public retain(point: NativeReadingPoint): void {
    this.reset();
    if (this.validPoint(point, true)) this.point = point;
  }

  public current(): NativeReadingPoint | undefined {
    const visual = this.visualPosition();
    if (visual?.node !== this.visual?.node || visual?.offset !== this.visual?.offset ||
      this.views().some(view => this.available(view.document) && this.hasScrolled(view.document))) {
      this.reset();
      return undefined;
    }
    for (const view of this.views()) {
      const doc = view.document;
      const previous = this.signals.get(doc);
      const next = this.snapshot(doc);
      this.signals.set(doc, next);
      const frame = doc.defaultView?.frameElement;
      if (!previous || !frame || frame.ownerDocument.activeElement !== frame || !this.available(doc)) continue;
      let candidate: NativeReadingPoint | undefined;
      if (next.collapsed && next.node &&
        (next.node !== previous.node || next.offset !== previous.offset || !previous.collapsed)) {
        candidate = { spineIndex: view.spineIndex, node: next.node, offset: next.offset };
      } else if (next.focus !== previous.focus && next.focus &&
        next.focus !== doc.body && next.focus !== doc.documentElement &&
        // Do not turn annotation selection/toolbar focus into a new reading location.
        next.collapsed) {
        candidate = { spineIndex: view.spineIndex, node: next.focus, offset: 0 };
      }
      if (candidate && this.validPoint(candidate)) this.point = candidate;
    }
    if (this.point && !this.validPoint(this.point)) {
      // Modal accessibility scopes temporarily exclude the shell, not the book.
      // Keep the caret privately until that scope clears; never expose hidden content.
      if (this.validPoint(this.point, true)) return undefined;
      this.point = undefined;
    }
    return this.point;
  }

  /** Shell focus return/reflow can use the saved caret while a modal obscures it. */
  public retainedForShell(): NativeReadingPoint | undefined {
    this.current();
    return this.point && this.validPoint(this.point, true) ? this.point : undefined;
  }

  private scrollPosition(doc: Document): { top: number; left: number } {
    const root = doc.scrollingElement ?? doc.documentElement;
    return { top: root.scrollTop, left: root.scrollLeft };
  }

  private hasScrolled(doc: Document): boolean {
    const previous = this.scrollPositions.get(doc);
    const current = this.scrollPosition(doc);
    return previous !== undefined && (previous.top !== current.top || previous.left !== current.left);
  }

  private snapshot(doc: Document): Signals {
    const selection = doc.getSelection();
    return {
      node: selection?.anchorNode ?? null,
      offset: selection?.anchorOffset ?? 0,
      collapsed: selection?.isCollapsed ?? true,
      focus: doc.activeElement,
    };
  }

  private available(doc: Document, ignoreShellScope = false): boolean {
    const frame = doc.defaultView?.frameElement;
    if (!frame?.isConnected || (frame as HTMLIFrameElement).contentDocument !== doc) return false;
    for (let element: Element | null = frame; element; element = element.parentElement) {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      const excluded = element.hasAttribute("inert") || element.getAttribute("aria-hidden") === "true";
      if (element.hasAttribute("hidden") || (excluded && (!ignoreShellScope || element === frame)) ||
        style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return false;
    }
    return true;
  }

  private validPoint(point: NativeReadingPoint, ignoreShellScope = false): boolean {
    const doc = point.node.ownerDocument;
    const element = point.node.nodeType === 1 ? point.node as Element : point.node.parentElement;
    if (!doc || !point.node.isConnected || point.node.getRootNode() !== doc ||
      !doc.body?.contains(point.node) || !element || isReaderOwnedContent(point.node) ||
      element.closest("input, textarea, select, [contenteditable]") ||
      !this.views().some(view => view.document === doc && view.spineIndex === point.spineIndex) ||
      !this.available(doc, ignoreShellScope)) return false;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = doc.defaultView?.getComputedStyle(ancestor);
      if (ancestor.hasAttribute("hidden") || ancestor.hasAttribute("inert") ||
        ancestor.getAttribute("aria-hidden") === "true" ||
        style?.display === "none" || style?.visibility === "hidden") return false;
    }
    const offset = point.offset ?? 0;
    const child = point.node.nodeType === 1
      ? point.node.childNodes[offset] ?? point.node.childNodes[offset - 1] : undefined;
    if (child && isReaderOwnedContent(child)) return false;
    return offset >= 0 && offset <= (point.node.nodeType === 3
      ? point.node.textContent?.length ?? 0 : point.node.childNodes.length);
  }
}
