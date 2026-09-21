/** The shape every locale's string catalog must match — a flat,
 * dot-namespaced key -> string map. English (`en.ts`) is the source of
 * truth; every other locale file is typechecked against this exact same
 * key set, so a missing translation is a compile error, not a silent
 * runtime fallback discovered only by clicking around in that language.
 *
 * Covers essentially the entire reader page: the toolbar (including its
 * Text/Page/Settings menus, the reader theme/page style/font pickers,
 * and the language switcher itself), the Table of Contents/Search/
 * Bookmarks & Highlights panels, Book Details, the EPUB Inspector, the
 * Go to Page/Percentage dialog, the image viewer, the in-book selection/
 * highlight popups, the progress scrubber, the page's own running
 * footer ("Page N"), and the screen-reader-only announcements
 * `ReaderController` emits on navigation (`Translate`/`getTranslate` in
 * `translate.ts` is how that non-component class gets a locale-aware
 * translator at all). The one remaining unlocalized surface is the
 * library page (`apps/extension/src/library/`), which has no
 * `LocaleProvider` wired up yet at all — a separate, larger piece of
 * follow-up work, not a simple string swap.
 *
 * A few categories of string are deliberately left as plain English (or
 * their own untranslated proper name) in every locale rather than
 * translated: actual typeface names in the font picker (Georgia,
 * Palatino, Times, Sitka — like any font picker leaves "Helvetica"
 * alone), the "Ambra" chrome theme's own signature name (see
 * `Toolbar.tsx`'s `CHROME_THEME_LABEL_KEYS`), and this app's own name
 * ("Ambra Reader").
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
  "settings.readingMode": string;
  "settings.paginated": string;
  "settings.scroll": string;
  "settings.pageTurn": string;
  "settings.pageFlip": string;
  "settings.experimental": string;
  "settings.slide": string;
  "settings.filmStrip": string;
  "settings.off": string;
  "settings.brightness": string;
  "settings.readerTheme": string;
  "text.textMenuLabel": string;
  "settings.resetToDefault": string;
  "settings.resetSliderToDefault": string;
  "text.pageMenuLabel": string;
  "text.size": string;
  "text.fontSizeAriaLabel": string;
  "text.lineSpacing": string;
  "text.characterSpacing": string;
  "text.font": string;
  "text.columnWidth": string;
  "text.pageStyle": string;
  "fontFamily.sansSerif": string;
  "fontFamily.bookDefault": string;
  "pageTheme.white": string;
  "pageTheme.sepia": string;
  "pageTheme.dark": string;
  "chromeTheme.silver": string;
  "chromeTheme.green": string;
  "chromeTheme.blue": string;
  "chromeTheme.purple": string;
  "highlightStyle.yellow": string;
  "highlightStyle.green": string;
  "highlightStyle.blue": string;
  "highlightStyle.pink": string;
  "highlightStyle.purple": string;
  "highlightStyle.underline": string;
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
  "annotations.panelAriaLabel": string;
  "annotations.pinPanel": string;
  "annotations.unpinPanel": string;
  "annotations.closePanel": string;
  "annotations.bookmarksTab": string;
  "annotations.highlightsTab": string;
  "annotations.noBookmarksYet": string;
  "annotations.noHighlightsYet": string;
  "annotations.removeBookmark": string;
  "annotations.editNote": string;
  "annotations.addNote": string;
  "annotations.removeHighlight": string;
  "annotations.notePlaceholder": string;
  "annotations.cancelNote": string;
  "annotations.saveNote": string;
  "highlight.selectionToolbarAriaLabel": string;
  "highlight.optionsDialogAriaLabel": string;
  "highlight.changeColor": string;
  "highlight.addNote": string;
  "highlight.editNote": string;
  "highlight.deleteHighlight": string;
  "highlight.close": string;
  "highlight.colorGroupAriaLabel": string;
  "highlight.hasNote": string;
  "announcements.bookmarkAdded": string;
  "announcements.bookmarkRemoved": string;
  "announcements.bookmarksRemoved": string;
  "announcements.paginatedView": string;
  "announcements.scrollView": string;
  "announcements.highlightAdded": string;
  "announcements.spreadOfTotal": string;
  "reader.loading": string;
  "reader.bookContentAriaLabel": string;
  "inspector.specialFileContainer": string;
  "inspector.specialFileOpf": string;
  "inspector.specialFileCover": string;
  "inspector.previewLoadError": string;
  "inspector.openFile": string;
  "inspector.fontFile": string;
  "inspector.binaryFile": string;
  "inspector.binaryPreviewHint": string;
  "inspector.turnOffLineWrapping": string;
  "inspector.turnOnLineWrapping": string;
  "inspector.exitFullScreen": string;
  "inspector.fullScreen": string;
  "inspector.selectFileToPreview": string;
  "inspector.fileName": string;
  "inspector.titleLabel": string;
  "inspector.creators": string;
  "inspector.creator": string;
  "inspector.contributors": string;
  "inspector.publisher": string;
  "inspector.date": string;
  "inspector.rights": string;
  "inspector.language": string;
  "inspector.renditionLayout": string;
  "inspector.renditionOrientation": string;
  "inspector.rootFile": string;
  "inspector.identifier": string;
  "inspector.subjects": string;
  "inspector.description": string;
  "inspector.allOpfMetaEntries": string;
  "inspector.propertyOrName": string;
  "inspector.value": string;
  "inspector.refines": string;
  "inspector.spineDescription": string;
  "inspector.path": string;
  "inspector.linear": string;
  "inspector.mediaType": string;
  "inspector.properties": string;
  "inspector.yes": string;
  "inspector.no": string;
  "inspector.manifestDescription": string;
  "inspector.id": string;
  "inspector.back": string;
  "inspector.closeInspector": string;
  "inspector.title": string;
  "inspector.filesTab": string;
  "inspector.metadataTab": string;
  "inspector.spineTab": string;
  "inspector.manifestTab": string;
  "bookDetails.copyright": string;
  "bookDetails.closePanel": string;
  "bookDetails.publisher": string;
  "bookDetails.descriptionSourcePrefix": string;
  "bookDetails.isbn": string;
  "bookDetails.identifier": string;
  "bookDetails.goToPage": string;
  "bookDetails.goToPercentage": string;
  "bookDetails.epubInspector": string;
  "bookDetails.accessibilitySummary": string;
  "bookDetails.accessibilityFeatures": string;
  "goTo.pageTitle": string;
  "goTo.percentageTitle": string;
  "goTo.pageCountMeasuring": string;
  "goTo.pageInputLabel": string;
  "goTo.percentageInputLabel": string;
  "goTo.rangeValidation": string;
  "goTo.goButton": string;
  "imageViewer.dialogAriaLabel": string;
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
  "settings.readingMode": "Reading mode",
  "settings.paginated": "Paginated",
  "settings.scroll": "Scroll",
  "settings.pageTurn": "Page turn",
  "settings.pageFlip": "Page flip",
  "settings.experimental": "Experimental",
  "settings.slide": "Slide",
  "settings.filmStrip": "Film strip",
  "settings.off": "Off",
  "settings.brightness": "Brightness",
  "settings.readerTheme": "Reader theme",
  "text.textMenuLabel": "Text",
  "settings.resetToDefault": "Reset to default",
  "settings.resetSliderToDefault": "Reset {label} to default",
  "text.pageMenuLabel": "Page",
  "text.size": "Size",
  "text.fontSizeAriaLabel": "Font size",
  "text.lineSpacing": "Line spacing",
  "text.characterSpacing": "Character spacing",
  "text.font": "Font",
  "text.columnWidth": "Column width",
  "text.pageStyle": "Page style",
  "fontFamily.sansSerif": "Sans-Serif",
  "fontFamily.bookDefault": "Book default",
  "pageTheme.white": "White",
  "pageTheme.sepia": "Sepia",
  "pageTheme.dark": "Dark",
  "chromeTheme.silver": "Silver",
  "chromeTheme.green": "Green",
  "chromeTheme.blue": "Blue",
  "chromeTheme.purple": "Purple",
  "highlightStyle.yellow": "Yellow",
  "highlightStyle.green": "Green",
  "highlightStyle.blue": "Blue",
  "highlightStyle.pink": "Pink",
  "highlightStyle.purple": "Purple",
  "highlightStyle.underline": "Underline",
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
  "annotations.panelAriaLabel": "Bookmarks and highlights",
  "annotations.pinPanel": "Pin bookmarks and highlights panel",
  "annotations.unpinPanel": "Unpin bookmarks and highlights panel",
  "annotations.closePanel": "Close bookmarks and highlights panel",
  "annotations.bookmarksTab": "Bookmarks",
  "annotations.highlightsTab": "Highlights",
  "annotations.noBookmarksYet": "No bookmarks yet — use the bookmark button in the toolbar to save your place.",
  "annotations.noHighlightsYet": "No highlights yet — select some text while reading to highlight it.",
  "annotations.removeBookmark": "Remove bookmark: {label}",
  "annotations.editNote": "Edit note: {text}",
  "annotations.addNote": "Add note: {text}",
  "annotations.removeHighlight": "Remove highlight: {text}",
  "annotations.notePlaceholder": "Add a note…",
  "annotations.cancelNote": "Cancel",
  "annotations.saveNote": "Save",
  "highlight.selectionToolbarAriaLabel": "Highlight this selection",
  "highlight.optionsDialogAriaLabel": "Highlight options",
  "highlight.changeColor": "Change color",
  "highlight.addNote": "Add note",
  "highlight.editNote": "Edit note",
  "highlight.deleteHighlight": "Delete highlight",
  "highlight.close": "Close",
  "highlight.colorGroupAriaLabel": "Highlight color",
  "highlight.hasNote": "This highlight has a note",
  "announcements.bookmarkAdded": "Bookmark added",
  "announcements.bookmarkRemoved": "Bookmark removed",
  "announcements.bookmarksRemoved": "Bookmarks removed",
  "announcements.paginatedView": "Paginated view",
  "announcements.scrollView": "Scroll view",
  "announcements.highlightAdded": "Highlight added",
  "announcements.spreadOfTotal": "Pages {first}–{second} of {total}",
  "reader.loading": "Loading…",
  "reader.bookContentAriaLabel": "Book content",
  "inspector.specialFileContainer": "OCF container descriptor",
  "inspector.specialFileOpf": "Package document (OPF)",
  "inspector.specialFileCover": "Cover image",
  "inspector.previewLoadError": "Couldn't load this file's preview.",
  "inspector.openFile": "Open {path}",
  "inspector.fontFile": "Font file",
  "inspector.binaryFile": "Binary file",
  "inspector.binaryPreviewHint": "Not shown as text; use it as intended (font/embedded media).",
  "inspector.turnOffLineWrapping": "Turn off line wrapping",
  "inspector.turnOnLineWrapping": "Turn on line wrapping",
  "inspector.exitFullScreen": "Exit full screen",
  "inspector.fullScreen": "Full screen",
  "inspector.selectFileToPreview": "Select a file to view its contents.",
  "inspector.fileName": "File name",
  "inspector.titleLabel": "Title",
  "inspector.creators": "Creators",
  "inspector.creator": "Creator",
  "inspector.contributors": "Contributors",
  "inspector.publisher": "Publisher",
  "inspector.date": "Date",
  "inspector.rights": "Rights",
  "inspector.language": "Language",
  "inspector.renditionLayout": "Rendition layout",
  "inspector.renditionOrientation": "Rendition orientation",
  "inspector.rootFile": "Root file",
  "inspector.identifier": "Identifier",
  "inspector.subjects": "Subjects",
  "inspector.description": "Description",
  "inspector.allOpfMetaEntries": "All OPF meta entries ({count})",
  "inspector.propertyOrName": "Property / name",
  "inspector.value": "Value",
  "inspector.refines": "Refines",
  "inspector.spineDescription": "Reading order, as declared by {path}'s own spine.",
  "inspector.path": "Path",
  "inspector.linear": "Linear",
  "inspector.mediaType": "Media type",
  "inspector.properties": "Properties",
  "inspector.yes": "yes",
  "inspector.no": "no",
  "inspector.manifestDescription": "Every resource declared in {path}'s own manifest.",
  "inspector.id": "ID",
  "inspector.back": "Back",
  "inspector.closeInspector": "Close EPUB Inspector",
  "inspector.title": "EPUB Inspector",
  "inspector.filesTab": "Files",
  "inspector.metadataTab": "Metadata",
  "inspector.spineTab": "Spine",
  "inspector.manifestTab": "Manifest",
  "bookDetails.copyright": "Copyright",
  "bookDetails.closePanel": "Close book details panel",
  "bookDetails.publisher": "Publisher",
  "bookDetails.descriptionSourcePrefix": "via",
  "bookDetails.isbn": "ISBN",
  "bookDetails.identifier": "Identifier",
  "bookDetails.goToPage": "Go to Page…",
  "bookDetails.goToPercentage": "Go to Percentage…",
  "bookDetails.epubInspector": "EPUB Inspector",
  "bookDetails.accessibilitySummary": "Accessibility",
  "bookDetails.accessibilityFeatures": "Accessibility features",
  "goTo.pageTitle": "Go to Page",
  "goTo.percentageTitle": "Go to Percentage",
  "goTo.pageCountMeasuring": "Still measuring this book's page count — try again in a moment.",
  "goTo.pageInputLabel": "Page number (1–{max})",
  "goTo.percentageInputLabel": "Percentage (1–100)",
  "goTo.rangeValidation": "Enter a number between 1 and {max}.",
  "goTo.goButton": "Go",
  "imageViewer.dialogAriaLabel": "Image viewer",
};
