/** The shape every locale's string catalog must match — a flat,
 * dot-namespaced key -> string map. English (`en.ts`) is the source of
 * truth; every other locale file is typechecked against this exact same
 * key set, so a missing translation is a compile error, not a silent
 * runtime fallback discovered only by clicking around in that language.
 *
 * Scoped to the toolbar and the language picker itself for this first
 * pass (issue #50) — the single most prominent, always-visible surface
 * in the reader, and the one a reader needs to actually *find and use*
 * the language switcher in the first place. The remaining shell
 * surfaces (TOC/Bookmarks panels, Book Details, dialogs, the library
 * page) still read as plain English literals for now; extending them
 * to use this same `useTranslation()`/`t(key)` pattern is straightforward
 * follow-up work once this foundation is in place, not a redesign.
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
  "toolbar.navigate": string;
  "toolbar.previousChapter": string;
  "toolbar.nextChapter": string;
  "toolbar.previousPage": string;
  "toolbar.nextPage": string;
  "toolbar.goToPage": string;
  "toolbar.goToPercentage": string;
  "toolbar.textOptions": string;
  "toolbar.pageOptions": string;
  "toolbar.settings": string;
  "toolbar.bookDetails": string;
  "toolbar.hideBookDetails": string;
  "toolbar.bookmarkThisPage": string;
  "toolbar.removeBookmark": string;
  "settings.language": string;
  "settings.languageSystemDefault": string;
}

export const en: StringCatalog = {
  "toolbar.showContents": "Show contents",
  "toolbar.hideContents": "Hide contents",
  "toolbar.bookmarksAndHighlights": "Bookmarks and highlights",
  "toolbar.hideBookmarksAndHighlights": "Hide bookmarks and highlights",
  "toolbar.navigate": "Navigate",
  "toolbar.previousChapter": "Previous Chapter",
  "toolbar.nextChapter": "Next Chapter",
  "toolbar.previousPage": "Previous Page",
  "toolbar.nextPage": "Next Page",
  "toolbar.goToPage": "Go to Page…",
  "toolbar.goToPercentage": "Go to Percentage…",
  "toolbar.textOptions": "Text options",
  "toolbar.pageOptions": "Page options",
  "toolbar.settings": "Settings",
  "toolbar.bookDetails": "Book details",
  "toolbar.hideBookDetails": "Hide book details",
  "toolbar.bookmarkThisPage": "Bookmark this page",
  "toolbar.removeBookmark": "Remove bookmark",
  "settings.language": "Language",
  "settings.languageSystemDefault": "System default",
};
