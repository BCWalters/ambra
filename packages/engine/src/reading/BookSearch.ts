import type { ContentLoader } from "../content/ContentLoader.js";
import type { SpineItemRef } from "../container/PackageDocument.js";
import type { LocatorResolver } from "../locator/Locator.js";
import { findTextMatchesInDocument } from "../content/DocumentTextSearch.js";

/** One match — a CFI (so the shell can navigate straight to it, the same
 * way a bookmark or highlight does) plus enough surrounding text to show
 * a readable excerpt with the match itself distinguishable from its
 * context, without the shell needing to re-run the search itself just to
 * know which substring to emphasize. */
export interface SearchResult {
  readonly spineIndex: number;
  readonly cfi: string;
  readonly before: string;
  readonly match: string;
  readonly after: string;
}

/** The smallest query length actually worth searching a whole book for —
 * below this, a single- or two-character query would routinely produce
 * thousands of meaningless matches (every "a", every "an") while still
 * costing a full linear scan, a bad trade for a book of any real size.
 * Exported so the shell's own live "highlight matches on screen as you
 * type" feature (`ReaderController.applySearchHighlightToCurrentHost`)
 * uses this exact same threshold rather than a second, possibly
 * drifting copy of the same number. */
export const MIN_QUERY_LENGTH = 3;

/** How much surrounding text (in characters) to include on each side of
 * a match in `SearchResult.before`/`after` — enough to read the match in
 * context on one line of a results list, not a full sentence. */
const EXCERPT_CONTEXT_CHARS = 40;

/**
 * Searches a book's full text for `query`, spine item by spine item, in
 * book order — deliberately **not** a pre-built index (per explicit
 * product direction: "we don't need to index, it's fine if it's slow as
 * long as it shows results progressively"). Each spine item's matches
 * are reported via `onResult` as soon as that item finishes, so results
 * for the first chapters appear immediately rather than waiting for the
 * whole (possibly large) book to finish; control is yielded back to the
 * event loop between every spine item so a long search never hangs the
 * UI thread, satisfying "scale well to large books... without hanging/UI
 * quirks" without needing any pre-computed index at all.
 *
 * Cancellable via a generation token (the same pattern
 * `BookPaginationEstimator` uses for the same reason): starting a new
 * search — a fresh keystroke's worth of query — immediately invalidates
 * any still-in-flight previous one, whose remaining spine items simply
 * stop reporting results rather than needing to be forcibly aborted
 * mid-`await`.
 */
export class BookSearch {
  private generation = 0;

  public constructor(
    private readonly contentLoader: ContentLoader,
    private readonly locatorResolver: LocatorResolver,
    private readonly spine: readonly SpineItemRef[],
  ) {}

  /** Cancels any in-flight `search` — its remaining spine items will stop
   * reporting results (and stop doing further work) the next time they
   * check the generation token, without needing anything awaited to be
   * forcibly interrupted. */
  public cancel(): void {
    this.generation++;
  }

  public async search(
    query: string,
    onResult: (result: SearchResult) => void,
    onComplete: () => void,
  ): Promise<void> {
    const token = ++this.generation;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      onComplete();
      return;
    }

    for (let spineIndex = 0; spineIndex < this.spine.length; spineIndex++) {
      if (token !== this.generation) {
        return;
      }
      const spineItem = this.spine[spineIndex];
      if (!spineItem) {
        continue;
      }

      let contentDocument;
      try {
        contentDocument = await this.contentLoader.loadContentDocument(spineItem.manifestItem);
      } catch {
        // A malformed/unreadable spine item shouldn't stop the rest of
        // the book from being searched — skip it and move on.
        continue;
      }
      if (token !== this.generation) {
        return;
      }

      this.searchDocument(contentDocument.document, spineIndex, trimmed, onResult);

      // Yield to the event loop between spine items — the actual "don't
      // hang the UI" mechanism, since a `for` loop with only synchronous
      // work inside never gives the browser a chance to paint/respond to
      // input no matter how many iterations remain.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    if (token === this.generation) {
      onComplete();
    }
  }

  private searchDocument(
    doc: Document,
    spineIndex: number,
    needle: string,
    onResult: (result: SearchResult) => void,
  ): void {
    for (const match of findTextMatchesInDocument(doc, needle)) {
      try {
        const locator = this.locatorResolver.generate(spineIndex, match.start.node, match.start.offset);
        onResult({
          spineIndex,
          cfi: locator.cfi,
          before: match.text.slice(Math.max(0, match.startIndex - EXCERPT_CONTEXT_CHARS), match.startIndex),
          match: match.text.slice(match.startIndex, match.endIndex),
          after: match.text.slice(match.endIndex, match.endIndex + EXCERPT_CONTEXT_CHARS),
        });
      } catch {
        // A locator that fails to generate for one match shouldn't
        // stop the rest of the search — skip just this one.
      }
    }
  }
}
