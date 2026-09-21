import { EpubCfi } from "@ambra/engine";
import type { LocatorResolver } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { Highlight } from "../library/LibraryDatabase.js";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { StringCatalog } from "../i18n/locales/en.js";
import type { ActiveHighlightState } from "./ReaderTypes.js";

/** Everything `HighlightManager` needs to read from/call back into
 * `ReaderController` — deliberately narrow, same reasoning as
 * `BookmarkManagerContext`. `activeHighlight` (the currently "opened"
 * popup — see `ReaderController.dismissActiveHighlight`) and the pending
 * text-selection state stay owned by `ReaderController` (both are
 * general reader-UI state other things touch too — e.g. every page-turn
 * clears `activeHighlight`), so this only reads/writes them through
 * narrow accessors rather than owning them outright. Actually painting
 * highlights into a content document (`applyHighlightsToCurrentHost`)
 * and repositioning note markers (`updateNoteMarkers`) stay in
 * `ReaderController` too, since both need live host/document access —
 * this manager only ever *triggers* a repaint, never performs one. */
export interface HighlightManagerContext {
  spineIndex(): number;
  /** A no-op guard for `add`: fixed-layout content has no reflowable
   * text to highlight in the first place. */
  isFixedLayoutHost(): boolean;
  /** The live `Range` `setUpHighlightSelection` last captured, or
   * `undefined` if there's no pending selection to turn into a
   * highlight. */
  pendingSelectionRange(): Range | undefined;
  /** The selection toolbar's current anchor point — reused as the note
   * editor's own anchor when `add`'s `openNoteEditor` immediately opens
   * one (issue #60), so it appears at the exact spot the toolbar itself
   * was, without the reader having to go find and re-click the
   * highlight they just made. */
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
 * `LibraryDatabase`'s persisted copy (grouped by spine index, the same
 * shape `applyHighlightsToCurrentHost`/`updateNoteMarkers` need to look
 * up "highlights for this spine item" cheaply), and every add/remove/
 * edit operation the reader UI needs against it. Extracted out of
 * `ReaderController` (see `BookmarkManager`'s doc comment for the overall
 * decomposition rationale) as the third slice — unlike bookmarks, a
 * highlight *is* actually painted into the content document, but that
 * painting itself (`applyHighlightsToCurrentHost`/`resolveHighlightRange`/
 * the click/selection hit-testing) stays in `ReaderController`, since it
 * needs live host/iframe/document access this manager has no business
 * holding onto. This manager only owns the *data* — the cache and its
 * CRUD — and calls back into `ReaderController` to trigger a repaint
 * once the data's changed. */
export class HighlightManager {
  private cache = new Map<number, Highlight[]>();

  constructor(
    private readonly library: LibraryDatabase,
    private readonly bookId: string,
    private readonly locatorResolver: LocatorResolver,
    private readonly ctx: HighlightManagerContext,
  ) {}

  /** Rebuilds the cache from a flat list — called once right after a
   * book opens (see `ReaderController.open`), grouping once here keeps
   * `forSpineIndex` a simple map lookup rather than a linear filter on
   * every single spine item load. */
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

  /** Every highlight belonging to `spineIndex`, or `undefined` if it has
   * none — used by `ReaderController`'s own rendering/hit-testing code
   * (`applyHighlightsToDocument`, `updateNoteMarkers`,
   * `findHighlightAtPoint`, `openHighlightPopup`). */
  public forSpineIndex(spineIndex: number): readonly Highlight[] | undefined {
    return this.cache.get(spineIndex);
  }

  /** Every highlight across the whole book, in book reading order — see
   * `ReaderSnapshot.highlights` (the Highlights tab). */
  public allSorted(): Highlight[] {
    return Array.from(this.cache.values())
      .flat()
      .sort((a, b) => HighlightManager.compareByBookOrder(a, b));
  }

  /** Orders two highlights by book reading order (`startCfi` — see
   * `EpubCfi.compare`), falling back to creation order if either CFI
   * somehow fails to parse — same defensive reasoning as
   * `LibraryDatabase`'s own identical fallback for the initial DB fetch;
   * this is the *in-memory* cache's own sort, needed since a highlight
   * added mid-session is simply pushed onto its spine index's list
   * without re-sorting (see `add`), so the cache's order can drift out
   * of book order between a fresh DB load and this. */
  private static compareByBookOrder(a: Highlight, b: Highlight): number {
    try {
      return EpubCfi.compare(a.startCfi, b.startCfi);
    } catch {
      return a.createdAt - b.createdAt;
    }
  }

  /** Creates a highlight from the selection `ctx.pendingSelectionRange`
   * currently holds, persists it, applies it immediately (so it renders
   * without waiting for a reload), and dismisses the selection toolbar.
   * A no-op if there's no pending selection (the toolbar isn't showing,
   * or it's since been dismissed) — defensive, since the shell should
   * never be able to call this without one, but never worth crashing
   * over if it somehow did.
   *
   * `openNoteEditor` (issue #60: "add a note directly from the
   * selection menu — no need to highlight, then click, then add a
   * note") skips straight to `activeHighlight`'s note-editing mode for
   * the highlight just created, at the same position the selection
   * toolbar itself was anchored to — the reader never has to go find
   * and re-click the highlight they just made. */
  public async add(style: HighlightStyle, openNoteEditor = false): Promise<void> {
    const range = this.ctx.pendingSelectionRange();
    if (!range || this.ctx.isFixedLayoutHost()) {
      return;
    }
    // Captured before `dismissSelectionToolbar` (in `finally`, below)
    // clears the toolbar's own anchor — the note editor opens at the
    // exact same anchor point the selection toolbar itself used.
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
      // Best-effort — see `ReaderController.saveProgress`'s identical
      // reasoning; a failed highlight save shouldn't surface an error to
      // the reader mid-flow.
    } finally {
      this.ctx.dismissSelectionToolbar();
    }
  }

  /** Removes a highlight (from the Highlights list — see `TocPanel`) and
   * re-applies whatever's left to the current host if it belonged to the
   * spine item currently open. */
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

  /** Attaches, edits, or clears (pass `undefined`) a note on an existing
   * highlight — the annotations feature (#25). Doesn't need the CSS
   * repaint `applyHighlightsToCurrentHost` does (a note has no effect
   * on how the highlighted text itself is painted), but does need
   * `updateNoteMarkers`: issue #99's whole point is a small marker
   * showing *only* on highlights that have a note, which this call can
   * add, remove, or just leave in place depending on whether `note`
   * went from/to `undefined`. */
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

  /** Changes an existing highlight's color/style directly from the
   * inline action popup (issue #79) — previously the only way to
   * change a highlight's color was to delete it and re-select the text
   * to make a new one. Mirrors `setNote`'s find-update-persist shape,
   * but — unlike a note, which has no visual presence on the
   * highlighted text itself — a style change *does* need
   * `applyHighlightsToCurrentHost` to actually repaint it, and only
   * when the highlight belongs to the spine item currently open (the
   * Highlights list can act on a highlight from any spine item, most of
   * which have no live host to repaint right now). */
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
