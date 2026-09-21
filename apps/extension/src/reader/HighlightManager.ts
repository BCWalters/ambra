import { EpubCfi } from "@ambra/engine";
import type { LocatorResolver } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { Highlight } from "../library/LibraryDatabase.js";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { StringCatalog } from "../i18n/locales/en.js";
import type { ActiveHighlightState } from "./ReaderTypes.js";

/** What `HighlightManager` needs from `ReaderController`. Painting
 * highlights (`applyHighlightsToCurrentHost`) and note markers
 * (`updateNoteMarkers`) stay in `ReaderController`, since both need
 * live host/document access — this manager only triggers a repaint. */
export interface HighlightManagerContext {
  spineIndex(): number;
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
  notify(): void;
}

/** Owns the current book's highlights: the in-memory cache mirroring
 * `LibraryDatabase`'s persisted copy (grouped by spine index), and
 * every add/remove/edit op the reader UI needs. Painting/hit-testing
 * stays in `ReaderController`, which owns the live host/document. */
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
    const spineIndex = this.ctx.spineIndex();
    try {
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
      if (openNoteEditor && anchor) {
        this.ctx.setActiveHighlight({ highlight, left: anchor.left, top: anchor.top, openNoteEditor: true });
      }
    } catch {
      // Best-effort — a failed save shouldn't surface an error mid-flow.
    } finally {
      this.ctx.dismissSelectionToolbar();
    }
  }

  /** Removes a highlight and repaints the current host if it belonged
   * to the open spine item. */
  public async remove(id: string): Promise<void> {
    await this.library.removeHighlight(id);
    for (const [spineIndex, highlights] of this.cache) {
      const index = highlights.findIndex((highlight) => highlight.id === id);
      if (index !== -1) {
        highlights.splice(index, 1);
        if (spineIndex === this.ctx.spineIndex()) {
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

  /** Attaches, edits, or clears (pass `undefined`) a note on a
   * highlight (issue #25). */
  public async setNote(id: string, note: string | undefined): Promise<void> {
    for (const highlights of this.cache.values()) {
      const index = highlights.findIndex((highlight) => highlight.id === id);
      if (index !== -1) {
        const updated: Highlight = { ...highlights[index]!, note };
        await this.library.updateHighlight(updated);
        highlights[index] = updated;
        const active = this.ctx.getActiveHighlight();
        if (active?.highlight.id === id) {
          this.ctx.setActiveHighlight({ ...active, highlight: updated });
        }
        this.ctx.updateNoteMarkers();
        this.ctx.notify();
        return;
      }
    }
  }

  /** Changes a highlight's color/style (issue #79). */
  public async setStyle(id: string, style: HighlightStyle): Promise<void> {
    for (const [spineIndex, highlights] of this.cache) {
      const index = highlights.findIndex((highlight) => highlight.id === id);
      if (index !== -1) {
        const updated: Highlight = { ...highlights[index]!, style };
        await this.library.updateHighlight(updated);
        highlights[index] = updated;
        const active = this.ctx.getActiveHighlight();
        if (active?.highlight.id === id) {
          this.ctx.setActiveHighlight({ ...active, highlight: updated });
        }
        if (spineIndex === this.ctx.spineIndex()) {
          this.ctx.applyHighlightsToCurrentHost();
        }
        this.ctx.notify();
        return;
      }
    }
  }
}
