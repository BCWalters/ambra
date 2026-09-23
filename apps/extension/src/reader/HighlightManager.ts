import { EpubCfi } from "@ambra/engine";
import type { LocatorResolver } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { Highlight } from "../library/LibraryDatabase.js";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { StringCatalog } from "../i18n/locales/en.js";
import type { ActiveHighlightState } from "./ReaderTypes.js";

/** Persistence and cached annotations are independent of DOM painting. */
export interface HighlightManagerContext {
  spineIndexForDocument(document: Document): number | undefined;
  isSpineVisible(spineIndex: number): boolean;
  isFixedLayoutHost(): boolean;
  /** The live `Range` `setUpHighlightSelection` last captured. */
  pendingSelectionRange(): Range | undefined;
  /** The selection toolbar's current anchor point, reused as the note
   * editor's anchor (issue #60). */
  selectionToolbarAnchor(): { left: number; top: number } | undefined;
  dismissSelectionToolbar(): void;
  applyHighlightsToCurrentHost(): void;
  updateNoteMarkers(): void;
  announce(translationKey: keyof StringCatalog): void;
  getActiveHighlight(): ActiveHighlightState | undefined;
  setActiveHighlight(state: ActiveHighlightState | undefined): void;
  reportError(err: unknown): void;
  notify(): void;
}

/** Owns persisted highlight mutations and their cache. Painting and hit testing
 * belong to HighlightInteraction, using the reader's visible document views. */
export class HighlightManager {
  private cache = new Map<number, Highlight[]>();

  constructor(
    private readonly library: LibraryDatabase,
    private readonly bookId: string,
    private readonly locatorResolver: LocatorResolver,
    private readonly ctx: HighlightManagerContext,
  ) {}

  /** Rebuilds the cache from a flat list, grouped by spine index —
   * called once right after a book opens. */
  public load(all: readonly Highlight[]): void {
    this.cache = new Map();
    for (const highlight of all) {
      const existing = this.cache.get(highlight.spineIndex);
      if (existing) {
        existing.push(highlight);
      } else {
        this.cache.set(highlight.spineIndex, [highlight]);
      }
    }
  }

  public forSpineIndex(spineIndex: number): readonly Highlight[] | undefined {
    return this.cache.get(spineIndex);
  }

  /** Every highlight across the whole book, in reading order, for the
   * Highlights tab. */
  public allSorted(): Highlight[] {
    return Array.from(this.cache.values())
      .flat()
      .sort((a, b) => HighlightManager.compareByBookOrder(a, b));
  }

  /** Orders by book reading order (`startCfi`), falling back to
   * creation order if a CFI fails to parse. */
  private static compareByBookOrder(a: Highlight, b: Highlight): number {
    try {
      return EpubCfi.compare(a.startCfi, b.startCfi);
    } catch {
      return a.createdAt - b.createdAt;
    }
  }

  /** Creates a highlight from the current pending selection, persists
   * it, applies it immediately, and dismisses the selection toolbar.
   * `openNoteEditor` (issue #60) opens the note editor for it right
   * away, at the toolbar's own anchor. */
  public async add(style: HighlightStyle, openNoteEditor = false): Promise<void> {
    const range = this.ctx.pendingSelectionRange();
    if (!range || this.ctx.isFixedLayoutHost()) {
      return;
    }
    // Captured before `dismissSelectionToolbar` clears it, below.
    const anchor = this.ctx.selectionToolbarAnchor();
    const document = range.startContainer.ownerDocument;
    try {
      const spineIndex = document ? this.ctx.spineIndexForDocument(document) : undefined;
      if (spineIndex === undefined) throw new Error("The selection no longer belongs to a visible document.");
      const startLocator = this.locatorResolver.generate(spineIndex, range.startContainer, range.startOffset);
      const endLocator = this.locatorResolver.generate(spineIndex, range.endContainer, range.endOffset);
      const highlight = await this.library.addHighlight({
        bookId: this.bookId,
        spineIndex,
        startCfi: startLocator.cfi,
        endCfi: endLocator.cfi,
        style,
        text: range.toString(),
        note: undefined,
      });
      const existing = this.cache.get(spineIndex);
      if (existing) {
        existing.push(highlight);
      } else {
        this.cache.set(spineIndex, [highlight]);
      }
      this.ctx.applyHighlightsToCurrentHost();
      this.ctx.announce("announcements.highlightAdded");
      if (openNoteEditor && anchor && this.ctx.pendingSelectionRange() === range &&
          document && this.ctx.spineIndexForDocument(document) === spineIndex) {
        this.ctx.setActiveHighlight({ highlight, left: anchor.left, top: anchor.top, openNoteEditor: true });
      }
      this.ctx.notify();
    } catch (err) {
      this.ctx.reportError(err);
    } finally {
      if (this.ctx.pendingSelectionRange() === range) this.ctx.dismissSelectionToolbar();
    }
  }

  /** Removes a highlight and repaints the current host if it belonged
   * to the open spine item. */
  public async remove(id: string): Promise<void> {
    try {
      await this.library.removeHighlight(id);
    } catch (error) {
      this.ctx.reportError(error);
      return;
    }
    this.removeFromCache(id);
  }

  private removeFromCache(id: string): void {
    for (const [spineIndex, highlights] of this.cache) {
      const index = highlights.findIndex((highlight) => highlight.id === id);
      if (index !== -1) {
        highlights.splice(index, 1);
        if (this.ctx.isSpineVisible(spineIndex)) {
          this.ctx.applyHighlightsToCurrentHost();
        }
        break;
      }
    }
    if (this.ctx.getActiveHighlight()?.highlight.id === id) {
      this.ctx.setActiveHighlight(undefined);
    }
    this.ctx.notify();
  }

  public setNote(id: string, note: string | undefined): Promise<boolean> {
    return this.update(id, { note });
  }

  public async setStyle(id: string, style: HighlightStyle): Promise<void> {
    await this.update(id, { style });
  }

  private async update(id: string, patch: Parameters<LibraryDatabase["patchHighlight"]>[1]): Promise<boolean> {
    if (!Array.from(this.cache.values()).some(highlights => highlights.some(highlight => highlight.id === id))) {
      this.ctx.reportError(new Error("The highlight is not part of the open book."));
      return false;
    }
    let updated: Highlight | undefined;
    try {
      updated = await this.library.patchHighlight(id, patch);
    } catch (error) {
      this.ctx.reportError(error);
      return false;
    }
    if (!updated) {
      this.removeFromCache(id);
      this.ctx.reportError(new Error("The highlight no longer exists."));
      return false;
    }
    // Look up the current cache after commit: import/refresh may have replaced it.
    const highlights = this.cache.get(updated.spineIndex);
    const index = highlights?.findIndex(highlight => highlight.id === id) ?? -1;
    const styleChanged = highlights?.[index]?.style !== updated.style;
    if (highlights && index !== -1) highlights[index] = updated;
    const active = this.ctx.getActiveHighlight();
    if (active?.highlight.id === id) {
      this.ctx.setActiveHighlight({ ...active, highlight: updated });
    }
    if (styleChanged && this.ctx.isSpineVisible(updated.spineIndex)) {
      this.ctx.applyHighlightsToCurrentHost();
    }
    this.ctx.updateNoteMarkers();
    this.ctx.notify();
    return true;
  }
}
