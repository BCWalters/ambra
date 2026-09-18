/** The shape every locale's string catalog must match — a flat,
 * dot-namespaced key -> string map. English (`en.ts`) is the source of
 * truth; every other locale file is typechecked against this exact same
 * key set, so a missing translation is a compile error, not a silent
 * runtime fallback discovered only by clicking around in that language.
 *
 * Covers the toolbar, the Table of Contents/Search panel, the progress
 * scrubber, and the page's own running footer ("Page N") — the
 * reader's most prominent, always-visible surfaces (issues #50, #53).
 * The remaining shell surfaces (Book Details, dialogs, the Bookmarks/
 * Highlights panel, the library page) still read as plain English
 * literals for now; extending them to use this same
 * `useTranslation()`/`t(key)` pattern is straightforward follow-up work
 * once this foundation is in place, not a redesign.
 *
 * Machine-translated (by the AI assistant that built this feature, not
 * a native speaker) as a starting point for every non-English locale —
 * good enough to demonstrate and use the feature end to end, but worth
 * a native-speaker review pass before treating any of it as final,
 * ship-quality copy. */
export interface StringCatalog {
  "toolbar.showContents": string;
  "toolbar.hideContents": string;
  "toolbar.bookmarksAndHighlights": string;
  "toolbar.hideBookmarksAndHighlights": string;
  "toolbar.textOptions": string;
  "toolbar.settings": string;
  "toolbar.bookDetails": string;
  "toolbar.hideBookDetails": string;
  "toolbar.bookmarkThisPage": string;
  "toolbar.removeBookmark": string;
  "toolbar.search": string;
  "toolbar.hideSearch": string;
  "settings.language": string;
  "settings.languageSystemDefault": string;
  "toc.contents": string;
  "toc.tableOfContents": string;
  "toc.pinContentsPanel": string;
  "toc.unpinContentsPanel": string;
  "toc.pinOpen": string;
  "toc.unpin": string;
  "toc.closeContentsPanel": string;
  "toc.startOfBook": string;
  "search.title": string;
  "search.placeholder": string;
  "search.minCharacters": string;
  "search.searching": string;
  "search.noMatchesFound": string;
  "search.pinSearchPanel": string;
  "search.unpinSearchPanel": string;
  "search.closeSearchPanel": string;
  "scrubber.positionInBook": string;
  "scrubber.pageOfTotal": string;
  "scrubber.chapterOfTotal": string;
  "scrubber.pagesLeftInChapterOne": string;
  "scrubber.pagesLeftInChapterOther": string;
  "pageFurniture.pageNumber": string;
  /** The blocking `FriendlyError` card's headline (issue #73) — always
   * "Oh [a silly word], something went wrong," with the silly word
   * itself localized to something with the same warm, self-deprecating
   * goofiness in each language, not a literal translation of
   * "snickerdoodles" (which means nothing in most of them). */
  "error.somethingWentWrongHeadline": string;
}

export const en: StringCatalog = {
  "toolbar.showContents": "Show contents",
  "toolbar.hideContents": "Hide contents",
  "toolbar.bookmarksAndHighlights": "Bookmarks and highlights",
  "toolbar.hideBookmarksAndHighlights": "Hide bookmarks and highlights",
  "toolbar.textOptions": "Text and page options",
  "toolbar.settings": "Settings",
  "toolbar.bookDetails": "Book details",
  "toolbar.hideBookDetails": "Hide book details",
  "toolbar.bookmarkThisPage": "Bookmark this page",
  "toolbar.removeBookmark": "Remove bookmark",
  "toolbar.search": "Search",
  "toolbar.hideSearch": "Hide search",
  "settings.language": "Language",
  "settings.languageSystemDefault": "System default",
  "toc.contents": "Contents",
  "toc.tableOfContents": "Table of contents",
  "toc.pinContentsPanel": "Pin contents panel",
  "toc.unpinContentsPanel": "Unpin contents panel",
  "toc.pinOpen": "Pin open",
  "toc.unpin": "Unpin",
  "toc.closeContentsPanel": "Close contents panel",
  "toc.startOfBook": "Start of book",
  "search.title": "Search",
  "search.placeholder": "Search this book…",
  "search.minCharacters": "Keep typing — searches start at 3 characters.",
  "search.searching": "Searching…",
  "search.noMatchesFound": "No matches found.",
  "search.pinSearchPanel": "Pin search panel",
  "search.unpinSearchPanel": "Unpin search panel",
  "search.closeSearchPanel": "Close search panel",
  "scrubber.positionInBook": "Position in book",
  "scrubber.pageOfTotal": "Page {current} of {total}",
  "scrubber.chapterOfTotal": "Chapter {current} of {total}",
  "scrubber.pagesLeftInChapterOne": "1 page left in this chapter",
  "scrubber.pagesLeftInChapterOther": "{count} pages left in this chapter",
  "pageFurniture.pageNumber": "Page {number}",
  "error.somethingWentWrongHeadline": "Oh snickerdoodles, something went wrong.",
};
