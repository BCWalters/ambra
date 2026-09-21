/**
 * Gives every `pre` block that's actually overflowing its own box
 * horizontally (see `EpubCssReset`'s `pre { overflow-x: auto }` — a
 * genuinely wide code/markup sample, one deep enough that even preserving
 * its exact original indentation still runs past a narrow reading column
 * or spread column) a `tabindex="0"`, so a sighted keyboard user (who,
 * unlike a screen reader, does rely on the visual scroll affordance — a
 * screen reader reads the underlying text in DOM order regardless of any
 * visual wrapping/overflow) can actually reach and arrow-key/scroll
 * through it, rather than it being an inert, mouse-only scroll region. A
 * `pre` that already fits needs no such affordance and is deliberately
 * left out of the keyboard tab order rather than adding a no-op stop to
 * every single code sample in a book.
 *
 * Shared by every content host (`PaginatedContentHost`, `ScrollContentHost`
 * — fixed-layout content doesn't paginate/reflow prose the same way and
 * isn't expected to contain this kind of long-form code sample) rather
 * than reimplemented per host, since the same real gap (a `pre` wide
 * enough to need horizontal scrolling is otherwise unreachable by
 * keyboard) applies identically regardless of which one is currently
 * showing the content.
 */
export function makeOverflowingPreElementsFocusable(doc: Document): void {
  for (const pre of Array.from(doc.querySelectorAll("pre"))) {
    if (pre.scrollWidth > pre.clientWidth) {
      pre.tabIndex = 0;
    }
  }
}
