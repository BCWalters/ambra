/** How the Library page orders its book grid. Persisted the same way as
 * every other reader-wide preference (see `LibraryDatabase.
 * getDefaultLibrarySort`) so a reader's chosen order survives a reload
 * of the library page/popup rather than resetting to newest-first every
 * time. Defined in its own module for the same reason `ViewMode`/
 * `PageTurnAnimationStyle` are: `LibraryDatabase` needs the type without
 * depending on whichever module owns the actual sorting behavior
 * (`useLibrary`). */
export type LibrarySortOption = "dateAddedDesc" | "dateAddedAsc" | "titleAsc" | "authorAsc";

export const DEFAULT_LIBRARY_SORT: LibrarySortOption = "dateAddedDesc";
