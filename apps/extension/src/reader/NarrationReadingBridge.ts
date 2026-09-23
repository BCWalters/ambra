import { Locator } from "@ambra/engine";
import type { ContentDocumentView, ContentLoader, DomBreakPoint, LocatorResolver } from "@ambra/engine";
import type { NarrationTarget } from "./MediaOverlayNarration.js";
import { applyNarrationRange } from "./HighlightRenderer.js";
import { selectedReadingPosition, visibleReadingPosition } from "./ReadingPosition.js";

interface NarrationReadingContext {
  documents: () => readonly ContentDocumentView[];
  position: () => DomBreakPoint | undefined;
  navigate: (target: NarrationTarget) => Promise<void>;
  disposed: () => boolean;
}

export class NarrationReadingBridge {
  private generation = 0;
  private target: NarrationTarget | undefined;
  private playing = false;
  private readonly painted = new Map<Document, { element: Element; clean: () => void; playing: boolean }>();

  public constructor(
    private readonly loader: Pick<ContentLoader, "loadSpineDocument">,
    private readonly resolver: Pick<LocatorResolver, "generate" | "resolveInDocument">,
    private readonly styles: { activeClass?: string; playbackActiveClass?: string },
    private readonly context: NarrationReadingContext,
  ) {}

  public async readingPosition(): Promise<{ spineIndex: number; element: Element }> {
    const views = this.context.documents();
    const position = selectedReadingPosition(views, this.resolver)
      ?? visibleReadingPosition(views, this.context.position(), this.resolver);
    if (!position) throw new Error("There is no reading passage available for narration.");
    const content = await this.loader.loadSpineDocument(position.spineIndex);
    if (this.context.disposed()) throw new Error("The reading session has closed.");
    const node = position.cfi
      ? this.resolver.resolveInDocument(new Locator(position.cfi), position.spineIndex, content.document).node
      : content.document.body ?? content.document.documentElement;
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!element) throw new Error("The current reading passage could not be located.");
    return { spineIndex: position.spineIndex, element };
  }

  public async update(target: NarrationTarget, follow: boolean): Promise<void> {
    const generation = ++this.generation;
    this.target = target;
    if (follow && !this.visible(target)) await this.context.navigate(target);
    if (generation !== this.generation || this.context.disposed()) return;
    this.repaint();
  }

  public invalidateNavigation(): void {
    this.generation++;
  }

  public setPlaying(playing: boolean): void {
    this.playing = playing;
    this.repaint();
  }

  public repaint(): void {
    const matching = this.target
      ? this.context.documents().filter(view => view.spineIndex === this.target!.spineIndex)
      : [];
    const retained = new Set<Document>();
    for (const view of matching) {
      const element = this.element(view.document, this.target!);
      if (!element) continue;
      retained.add(view.document);
      const previous = this.painted.get(view.document);
      if (previous?.element === element && previous.playing === this.playing) continue;
      previous?.clean();
      const activeClass = this.styles.activeClass;
      const playbackClass = this.styles.playbackActiveClass;
      const removals: Array<() => void> = [];
      const addClasses = (target: Element, classes: string | undefined) => {
        for (const name of classes?.trim().split(/\s+/).filter(Boolean) ?? []) {
          if (target.classList.contains(name)) continue;
          target.classList.add(name);
          removals.push(() => target.classList.remove(name));
        }
      };
      if (activeClass) {
        addClasses(element, activeClass);
      } else {
        const range = view.document.createRange();
        range.selectNodeContents(element);
        applyNarrationRange(view.document, range);
        removals.push(() => applyNarrationRange(view.document));
      }
      if (this.playing) addClasses(view.document.documentElement, playbackClass);
      this.painted.set(view.document, {
        element, playing: this.playing,
        clean: () => { for (const remove of removals) remove(); },
      });
    }
    for (const [document, paint] of this.painted) {
      if (retained.has(document)) continue;
      paint.clean();
      this.painted.delete(document);
    }
  }

  public clear(): void {
    this.invalidateNavigation();
    this.target = undefined;
    for (const paint of this.painted.values()) paint.clean();
    this.painted.clear();
  }

  private element(document: Document, target: NarrationTarget): Element | null {
    return target.fragment ? document.getElementById(target.fragment) : document.body ?? document.documentElement;
  }

  private visible(target: NarrationTarget): boolean {
    return this.context.documents().some(view => {
      if (view.spineIndex !== target.spineIndex) return false;
      const element = this.element(view.document, target);
      const window = view.document.defaultView;
      if (!element || !window) return false;
      const range = view.document.createRange();
      range.selectNodeContents(element);
      const rect = Array.from(range.getClientRects()).find(rect => rect.width > 0 && rect.height > 0)
        ?? element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight
        && rect.left >= 0 && rect.left < window.innerWidth;
    });
  }
}
