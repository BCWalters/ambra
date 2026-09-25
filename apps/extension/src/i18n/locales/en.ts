/** The shape every locale's string catalog must match — a flat,
 * dot-namespaced key -> string map. English (`en.ts`) is the source of
 * truth; every other locale file is typechecked against this exact same
 * key set, so a missing translation is a compile error, not a silent
 * runtime fallback discovered only by clicking around in that language.
 *
 * Covers essentially the entire reader page: the toolbar (including its
 * Text/Page/Settings menus, the reader theme/page theme/font pickers,
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
  "settings.helpAbout": string;
  "library.about": string;
  "about.userGuide": string;
  "about.issues": string;
  "about.readerDiagnosticsWarning": string;
  "about.readerDiagnosticsUnavailable": string;
  "shortcuts.title": string;
  "shortcuts.enabled": string;
  "shortcuts.scope": string;
  "shortcuts.layoutNote": string;
  "shortcuts.disabledHint": string;
  "shortcuts.saving": string;
  "shortcuts.saved": string;
  "shortcuts.saveError": string;
  "shortcuts.loading": string;
  "shortcuts.loadError": string;
  "shortcuts.navigation": string;
  "shortcuts.reading": string;
  "shortcuts.help": string;
  "shortcuts.dismiss": string;
  "shortcuts.previousPage": string;
  "shortcuts.nextPage": string;
  "shortcuts.previousSection": string;
  "shortcuts.nextSection": string;
  "shortcuts.goToPage": string;
  "shortcuts.goToPercentage": string;
  "shortcuts.goToHint": string;
  "goTo.fixedLayoutUnavailable": string;
  "goTo.scrollingUnavailable": string;
  "goTo.seekFailed": string;
  "shortcuts.toggleBookmark": string;
  "shortcuts.searchBook": string;
  "shortcuts.showKeyboardShortcuts": string;
  "shortcuts.switchToScrolling": string;
  "shortcuts.switchToPaginated": string;
  "readingBoundary.navigation": string;
  "readingBoundary.nextChapter": string;
  "readingBoundary.nextSection": string;
  "readingBoundary.nextPage": string;
  "readingBoundary.endOfBook": string;
  "narration.listen": string;
  "narration.discoveryTitle": string;
  "narration.discoveryMessage": string;
  "narration.notNow": string;
  "narration.noticeListen": string;
  "narration.controls": string;
  "narration.play": string;
  "narration.pause": string;
  "narration.previous": string;
  "narration.next": string;
  "narration.speed": string;
  "narration.close": string;
  "narration.return": string;
  "narration.listenFromPage": string;
  "narration.listenFromSelection": string;
  "narration.loading": string;
  "narration.browsing": string;
  "narration.error": string;
  "library.pageTitle": string;
  "library.toolbar": string;
  "library.sortNewest": string;
  "library.sortOldest": string;
  "library.sortTitle": string;
  "library.sortAuthor": string;
  "library.openBookProgress": string;
  "library.openBook": string;
  "library.bookDetails": string;
  "library.removeBook": string;
  "library.importEpub": string;
  "library.sort": string;
  "library.sortBy": string;
  "library.expand": string;
  "library.loading": string;
  "library.importQueued": string;
  "library.importDownloading": string;
  "library.importProcessing": string;
  "library.importSaving": string;
  "library.importComplete": string;
  "library.importKeepOpen": string;
  "library.readNow": string;
  "library.readNowBook": string;
  "library.inspectorNotReady": string;
  "library.bookCount": string;
  "library.storageUsedOf": string;
  "library.storageUsed": string;
  "library.progress": string;
  "library.readingProgress": string;
  "library.percentRead": string;
  "library.added": string;
  "library.emptyTitle": string;
  "library.emptyDescription": string;
  "library.fromDevice": string;
  "library.bringBook": string;
  "library.bringBookDescription": string;
  "library.chooseEpubFiles": string;
  "library.onWeb": string;
  "library.findNextBook": string;
  "library.findNextBookDescription": string;
  "library.exploreFreeBooks": string;
  "library.standardEbooksDownload": string;
  "library.gutenbergDownload": string;
  "library.readBeyondDownload": string;
  "library.dismiss": string;
  "library.saveAs": string;
  "library.saveAsFailed": string;
  "library.downloadProgress": string;
  "library.downloadReceived": string;
  "library.cancelDownload": string;
  "library.cancelDownloadFile": string;
  "library.cancelDownloadFailed": string;
  "library.findBooks": string;
  "library.discoveryTitle": string;
  "library.discoveryDescription": string;
  "library.gutenbergDescription": string;
  "library.standardEbooksDescription": string;
  "library.readBeyondDescription": string;
  "library.discoverySteps": string;
  "library.discoveryDownload": string;
  "library.discoveryImport": string;
  "library.discoveryNotice": string;
  "library.importStorageFull": string;
  "library.storageFull": string;
  "library.importNotReady": string;
  "library.notReady": string;
  "library.fileMissing": string;
  "library.downloadFailed": string;
  "library.downloadNetworkFailed": string;
  "library.downloadAccessDenied": string;
  "library.downloadUnsupported": string;
  "library.downloadImportFailed": string;
  "about.title": string;
  "about.version": string;
  "about.description": string;
  "about.createdBy": string;
  "about.helpShape": string;
  "about.feedback": string;
  "about.copied": string;
  "about.copying": string;
  "about.copyDiagnostics": string;
  "about.diagnosticsHint": string;
  "about.copyError": string;
  "about.localLibrary": string;
  "about.privacy": string;
  "about.sourceCode": string;
  "about.standards": string;
  "about.epubSpec": string;
  "about.publishingGroup": string;
  "about.openSourceCredits": string;
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
  "toolbar.backToLibrary": string;
  "settings.language": string;
  "settings.languageSystemDefault": string;
  "settings.readingMode": string;
  "settings.globalScope": string;
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
  "text.bookScope": string;
  "settings.resetToDefault": string;
  "settings.resetSliderToDefault": string;
  "text.pageMenuLabel": string;
  "text.size": string;
  "text.fontSizeAriaLabel": string;
  "text.lineSpacing": string;
  "text.characterSpacing": string;
  "text.font": string;
  "text.columnWidth": string;
  "text.alwaysShowOnePage": string;
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
  "scrubber.seeking": string;
  "scrubber.bookmarked": string;
  "scrubber.pageOfTotal": string;
  "scrubber.countingPages": string;
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
  "error.invalidEpubHeadline": string;
  /** The "actionFailed" toast's headline (issue #114) — a punchier,
   * one-word interjection distinct from the blocking card's own (that
   * one's self-deprecating "oh well"; this one's more "yikes", since a
   * reader-initiated action just visibly failed). Localized to
   * something with the same fun spirit, not a literal translation of
   * "Zoinks" (which means nothing in most languages). */
  "error.actionFailedHeadline": string;
  /** Prefix before a de-emphasized technical detail line shown under an
   * "actionFailed" error's main message — see issue #119. e.g. "Error
   * details: No element found at CFI step 2 under <p>." */
  "error.detailsPrefix": string;
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
  /** The small read-only-row tag shown on a publisher-embedded
   * annotation merged into the Bookmarks/Highlights tabs (issue #116). */
  "annotations.publisherNoteTag": string;
  /** Issue #114: a file that fails to even parse as an EPUB Annotations
   * 1.0 collection (garbage/unrelated JSON, not just "the wrong book"
   * — see `importWrongBook`). */
  "annotations.importNotAnAnnotationsFile": string;
  /** Issue #114: every annotation in an otherwise well-formed file
   * failed to resolve against *this* book at all — overwhelmingly
   * likely it was exported from a different one. */
  "annotations.importWrongBook": string;
  /** Issue #115: nothing new was added because every annotation in the
   * file was already present — not an error, just worth saying so
   * rather than silently doing nothing. */
  "annotations.importAllDuplicates": string;
  /** Issue #119: fallback friendly message for an annotation-import
   * failure that isn't specifically classified above (e.g. malformed
   * JSON, or a per-annotation resolution error that still made it out
   * of `importAnnotations`) — the raw exception is shown separately as
   * a smaller detail line, never as this primary text. */
  "annotations.importGenericFailure": string;
  "annotations.exportButton": string;
  "annotations.exportTooltip": string;
  "annotations.importButton": string;
  "annotations.importTooltip": string;
  "highlight.selectionToolbarAriaLabel": string;
  "highlight.optionsDialogAriaLabel": string;
  "highlight.changeColor": string;
  "highlight.addNote": string;
  "highlight.editNote": string;
  "highlight.deleteHighlight": string;
  "highlight.close": string;
  "highlight.colorGroupAriaLabel": string;
  "highlight.hasNote": string;
  "footnote.dialogAriaLabel": string;
  "footnote.close": string;
  "announcements.bookmarkAdded": string;
  "announcements.bookmarkRemoved": string;
  "announcements.bookmarksRemoved": string;
  "announcements.paginatedView": string;
  "announcements.scrollView": string;
  "announcements.highlightAdded": string;
  "announcements.spreadOfTotal": string;
  "announcements.annotationsImported": string;
  "reader.loading": string;
  "reader.openingBook": string;
  "reader.navigating": string;
  "reader.bookContentAriaLabel": string;
  "inspector.specialFileContainer": string;
  "inspector.locateCurrentPassage": string;
  "inspector.locatingPassage": string;
  "inspector.locateError": string;
  "inspector.showInBook": string;
  "inspector.showingInBook": string;
  "inspector.showInBookError": string;
  "inspector.sourceMappingError": string;
  "inspector.sourceElementSelected": string;
  "inspector.sourceSelectionHint": string;
  "inspector.sourceCode": string;
  "inspector.help": string;
  "inspector.referencesHelp": string;
  "inspector.referenceSelected": string;
  "inspector.findReferences": string;
  "inspector.findingReferences": string;
  "inspector.referencesCount": string;
  "inspector.noReferences": string;
  "inspector.referencesError": string;
  "inspector.originalSourceLine": string;
  "inspector.specialFileOpf": string;
  "inspector.specialFileCover": string;
  "inspector.previewLoadError": string;
  "inspector.openFile": string;
  "inspector.fontFile": string;
  "inspector.binaryFile": string;
  "inspector.binaryPreviewHint": string;
  "inspector.turnOffLineWrapping": string;
  "inspector.turnOnLineWrapping": string;
  "inspector.popoverView": string;
  "inspector.dockLeft": string;
  "inspector.dockRight": string;
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
  "bookDetails.rights": string;
  "bookDetails.showMore": string;
  "bookDetails.showLess": string;
  "bookDetails.closePanel": string;
  "bookDetails.publisher": string;
  "bookDetails.readingTools": string;
  "bookDetails.publicationDetails": string;
  "bookDetails.fileSize": string;
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
  "imageViewer.zoomIn": string;
  "imageViewer.zoomOut": string;
  "imageViewer.fit": string;
  "imageViewer.controls": string;
  "imageViewer.instructions": string;
}

export const en: StringCatalog = {
  "settings.helpAbout": "Help & About",
  "library.about": "Help & About",
  "about.userGuide": "User guide",
  "about.issues": "GitHub issues (optional)",
  "about.readerDiagnosticsWarning": "Reader reports may include book details (such as title and file paths), reading locations and recent diagnostic events. Nothing is sent automatically. Review the copied report before sharing.",
  "about.readerDiagnosticsUnavailable": "The reader report is not available yet. Try again when the book is ready.",
  "shortcuts.title": "Keyboard shortcuts",
  "shortcuts.enabled": "Enable keyboard shortcuts",
  "shortcuts.scope": "Reader commands apply while reading. This popup’s shortcut also works in the library. Settings are shared across books.",
  "shortcuts.layoutNote": "PageUp, PageDown and Space turn pages in paginated mode and scroll natively in scrolling mode. Mode switches apply only to reflowable books.",
  "shortcuts.disabledHint": "Shortcuts are off. You can still open this panel from Help & About. Native browser and screen-reader keys are unchanged.",
  "shortcuts.saving": "Saving…",
  "shortcuts.saved": "Shortcut settings saved.",
  "shortcuts.saveError": "Could not save shortcut settings. Your previous settings are unchanged. Try again.",
  "shortcuts.loading": "Loading shortcut settings…",
  "shortcuts.loadError": "Shortcut settings could not be loaded. Reopen Ambra to try again.",
  "shortcuts.navigation": "Navigation",
  "shortcuts.reading": "Reading",
  "shortcuts.help": "Help",
  "shortcuts.dismiss": "Close the current popup",
  "shortcuts.previousPage": "Previous page",
  "shortcuts.nextPage": "Next page",
  "shortcuts.previousSection": "Previous section",
  "shortcuts.nextSection": "Next section",
  "shortcuts.goToPage": "Go to page",
  "shortcuts.goToPercentage": "Go to percentage",
  "shortcuts.goToHint": "Go to requires reflowable pagination. Pages use the measured book-wide count; percentages accept whole numbers from 1 to 100. Enter submits; Escape dismisses. Focus the book or a reader toolbar button; editing, selections, widgets, and dialogs keep their own keys.",
  "goTo.fixedLayoutUnavailable": "Go to is unavailable for fixed-layout content. Use the table of contents or page controls.",
  "goTo.scrollingUnavailable": "Go to requires paginated mode. Switch to pagination first; your reading mode has not been changed.",
  "goTo.seekFailed": "Could not go to that position. Please try again.",
  "shortcuts.toggleBookmark": "Toggle bookmark",
  "shortcuts.searchBook": "Search book",
  "shortcuts.showKeyboardShortcuts": "Show keyboard shortcuts",
  "shortcuts.switchToScrolling": "Switch to scrolling",
  "shortcuts.switchToPaginated": "Switch to paginated",
  "readingBoundary.navigation": "Continue reading",
  "readingBoundary.nextChapter": "Next chapter: {title}",
  "readingBoundary.nextSection": "Next section",
  "readingBoundary.nextPage": "Next page",
  "readingBoundary.endOfBook": "End of book",
  "narration.listen": "Listen",
  "narration.discoveryTitle": "This book has narration",
  "narration.discoveryMessage": "Listen to recorded audio while the text is highlighted. You can start anytime with the headphones button.",
  "narration.notNow": "Not now",
  "narration.noticeListen": "Listen now",
  "narration.controls": "Narration controls",
  "narration.play": "Play narration",
  "narration.pause": "Pause narration",
  "narration.previous": "Previous narrated passage",
  "narration.next": "Next narrated passage",
  "narration.speed": "Narration speed",
  "narration.close": "Close narration",
  "narration.return": "Return to narration",
  "narration.listenFromPage": "Listen from this page",
  "narration.listenFromSelection": "Listen from selection",
  "narration.loading": "Loading narration…",
  "narration.browsing": "Browsing away from narration.",
  "narration.error": "Narration could not be played.",
  "library.pageTitle": "Ambra — Library",
  "library.toolbar": "Library actions",
  "library.sortNewest": "Date added (newest first)",
  "library.sortOldest": "Date added (oldest first)",
  "library.sortTitle": "Title (A–Z)",
  "library.sortAuthor": "Author (A–Z)",
  "library.openBookProgress": "Open {title}, {progress} read",
  "library.openBook": "Open {title}",
  "library.bookDetails": "{title} details",
  "library.removeBook": "Remove {title} from library",
  "library.importEpub": "Import EPUB",
  "library.sort": "Sort library",
  "library.sortBy": "Sort by",
  "library.expand": "Expand library into a full browser tab",
  "library.loading": "Loading your library…",
  "library.importQueued": "Waiting to import {fileName}…",
  "library.importDownloading": "Downloading {fileName}…",
  "library.importProcessing": "Preparing {fileName} for reading…",
  "library.importSaving": "Adding {fileName} to your library…",
  "library.importComplete": "Added {fileName} to your library.",
  "library.importKeepOpen": "Keep your library open. Your book will appear here when it’s ready.",
  "library.readNow": "Read now",
  "library.readNowBook": "Read now: {title}",
  "library.inspectorNotReady": "The Inspector isn't ready yet.",
  "library.bookCount": "Books: {count}",
  "library.storageUsedOf": "{used} used of {available} available",
  "library.storageUsed": "{used} used",
  "library.progress": "Progress",
  "library.readingProgress": "Reading progress",
  "library.percentRead": "{progress} read",
  "library.added": "Added",
  "library.emptyTitle": "What will you read first?",
  "library.emptyDescription": "Bring a book you have, or discover something new.",
  "library.fromDevice": "FROM YOUR DEVICE",
  "library.bringBook": "Bring a book",
  "library.bringBookDescription": "Add an EPUB file to your library",
  "library.chooseEpubFiles": "Choose EPUB files...",
  "library.onWeb": "ON THE WEB",
  "library.findNextBook": "Find your next book",
  "library.findNextBookDescription": "Explore trusted sources of free books",
  "library.exploreFreeBooks": "Explore free books",
  "library.standardEbooksDownload": "On a book’s page, choose “Advanced epub”.",
  "library.gutenbergDownload": "On a book’s page, choose an EPUB or EPUB3 download.",
  "library.readBeyondDownload": "Choose “Download” for an EPUB with audio, not “Read+Listen”.",
  "library.dismiss": "Dismiss",
  "library.saveAs": "Save as…",
  "library.saveAsFailed": "Could not save a copy of this EPUB. {message}",
  "library.downloadProgress": "{received} of {total} ({percent})",
  "library.downloadReceived": "{received} received",
  "library.cancelDownload": "Cancel download",
  "library.cancelDownloadFile": "Cancel download: {fileName}",
  "library.cancelDownloadFailed": "Ambra stopped downloading, but could not confirm cancellation in Chrome. Open Chrome Downloads to check and cancel the original download.",
  "library.findBooks": "Find books",
  "library.discoveryTitle": "Find your next read",
  "library.discoveryDescription": "Start with these free EPUB collections. Links open in a new tab.",
  "library.gutenbergDescription": "A vast collection of free literature and classics.",
  "library.standardEbooksDescription": "Carefully edited classics with beautiful typography.",
  "library.readBeyondDescription": "Read along with recorded narration and synchronized text.",
  "library.discoverySteps": "From discovery to your library",
  "library.discoveryDownload": "Choose a book, then choose its EPUB download (not Kindle or PDF).",
  "library.discoveryImport": "Ambra may open a direct EPUB link for you. If it downloads instead, return here, select {importLabel}, and choose the saved {extension} file.",
  "library.discoveryNotice": "Check each book's license and the copyright rules where you live. Free does not always mean public domain. Your library stays on this device; Ambra does not browse these sites for you.",
  "library.importStorageFull": "Couldn't import \"{fileName}\" — your device appears to be out of storage space. Free up some disk space and try again.",
  "library.storageFull": "Your device appears to be out of storage space. Free up some disk space and try again.",
  "library.importNotReady": "The library isn't ready to import books. Wait for loading to finish, or reload this page if it failed.",
  "library.notReady": "The library isn't ready yet.",
  "library.fileMissing": "This book's file couldn't be found.",
  "library.downloadFailed": "The site couldn't provide this book (HTTP {status}). Check Chrome's Downloads, or download the EPUB from the site, then choose {importLabel}.",
  "library.downloadNetworkFailed": "Ambra couldn't fetch this book. Check your connection and Ambra's site access in Chrome. Check Chrome's Downloads, or download the EPUB from the site, then choose {importLabel}.",
  "library.downloadAccessDenied": "Ambra doesn't have access to fetch this book here. Check its site access in Chrome's extension settings, or choose {importLabel} to open a downloaded copy.",
  "library.downloadUnsupported": "This link can't be imported directly. Download the EPUB from the site, then choose {importLabel}.",
  "library.downloadImportFailed": "This file couldn't be added to the library. Check Chrome's Downloads and make sure the file is an EPUB, then choose {importLabel} to try again. Error details: {detail}",
  "about.title": "Help & About",
  "about.version": "Version {version}",
  "about.description": "An EPUB reader designed for comfortable, beautiful reading.",
  "about.createdBy": "Created by",
  "about.helpShape": "Help shape Ambra",
  "about.feedback": "Report an issue or request a feature",
  "about.copied": "Copied!",
  "about.copying": "Copying...",
  "about.copyDiagnostics": "Copy diagnostics",
  "about.diagnosticsHint": "Include diagnostics when reporting a problem. They contain version and browser information, not your books.",
  "about.copyError": "Could not copy diagnostics.",
  "about.localLibrary": "Your library stays on this device.",
  "about.privacy": "Privacy policy",
  "about.sourceCode": "Source code on GitHub",
  "about.standards": "Standards and open source",
  "about.epubSpec": "EPUB 3.4 specification",
  "about.publishingGroup": "W3C Publishing Working Group",
  "about.openSourceCredits": "Built with these open-source projects:",
  "inspector.help": "Inspector help",
  "inspector.referencesHelp": "For images and CSS, Find references lists uses in this archive. Open a result to view its source and highlight the reference when available. Line numbers refer to the original source, before formatting. Use Tab and Enter to open results; Back returns to the list.",
  "inspector.referenceSelected": "Source reference selected.",
  "inspector.findReferences": "Find references",
  "inspector.findingReferences": "Finding references…",
  "inspector.referencesCount": "References ({count})",
  "inspector.noReferences": "No references found in this archive.",
  "inspector.referencesError": "Could not find references.",
  "inspector.originalSourceLine": "Original source line {line}",
  "inspector.locateCurrentPassage": "Locate current passage",
  "inspector.locatingPassage": "Locating passage…",
  "inspector.locateError": "Could not locate the current passage.",
  "inspector.showInBook": "Show in book",
  "inspector.showingInBook": "Opening passage…",
  "inspector.showInBookError": "Could not open this location in the book.",
  "inspector.sourceMappingError": "This source location could not be mapped to the book. Select another element or file.",
  "inspector.sourceElementSelected": "Source element selected. Show in book opens this element.",
  "inspector.sourceSelectionHint": "Click or select source text to choose an element. With source focused, use arrow keys; hold Shift to select. Without a selection, Show in book opens the file start.",
  "inspector.sourceCode": "Source code",
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
  "toolbar.backToLibrary": "Library",
  "settings.language": "Language",
  "settings.languageSystemDefault": "System default",
  "settings.readingMode": "Reading mode",
  "settings.globalScope": "Ambra settings",
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
  "text.bookScope": "Book options",
  "settings.resetToDefault": "Reset to default",
  "settings.resetSliderToDefault": "Reset {label} to default",
  "text.pageMenuLabel": "Page",
  "text.size": "Size",
  "text.fontSizeAriaLabel": "Font size",
  "text.lineSpacing": "Line spacing",
  "text.characterSpacing": "Character spacing",
  "text.font": "Font",
  "text.columnWidth": "Page width",
  "text.alwaysShowOnePage": "Always show one page",
  "text.pageStyle": "Page theme",
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
  "scrubber.seeking": "Going to position…",
  "scrubber.bookmarked": "Bookmarked",
  "scrubber.pageOfTotal": "Page {current} of {total}",
  "scrubber.countingPages": "Counting pages…",
  "scrubber.chapterOfTotal": "Chapter {current} of {total}",
  "scrubber.pagesLeftInChapterOne": "1 page left in this chapter",
  "scrubber.pagesLeftInChapterOther": "{count} pages left in this chapter",
  "pageFurniture.pageNumber": "Page {number}",
  "error.somethingWentWrongHeadline": "Oh snickerdoodles, something went wrong.",
  "error.invalidEpubHeadline": "Oh dear, that doesn't look like a valid EPUB file.",
  "error.actionFailedHeadline": "Zoinks!",
  "error.detailsPrefix": "Error details:",
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
  "annotations.publisherNoteTag": "Publisher note",
  "annotations.importNotAnAnnotationsFile": "We couldn't load the annotations from that file. It doesn't look like a valid annotations export.",
  "annotations.importWrongBook": "We couldn't load the annotations from that file. It looks like they might be from a different book.",
  "annotations.importAllDuplicates": "Looks like you already have all of these annotations — nothing new to add.",
  "annotations.importGenericFailure": "The annotations you imported don't line up with this book. Are you sure you picked the right file?",
  "annotations.exportButton": "Export",
  "annotations.exportTooltip": "Export your bookmarks and highlights to a file",
  "annotations.importButton": "Import",
  "annotations.importTooltip": "Import bookmarks and highlights from a file",
  "highlight.selectionToolbarAriaLabel": "Highlight this selection",
  "highlight.optionsDialogAriaLabel": "Highlight options",
  "highlight.changeColor": "Change color",
  "highlight.addNote": "Add note",
  "highlight.editNote": "Edit note",
  "highlight.deleteHighlight": "Delete highlight",
  "highlight.close": "Close",
  "highlight.colorGroupAriaLabel": "Highlight color",
  "highlight.hasNote": "This highlight has a note",
  "footnote.dialogAriaLabel": "Footnote",
  "footnote.close": "Close",
  "announcements.bookmarkAdded": "Bookmark added",
  "announcements.bookmarkRemoved": "Bookmark removed",
  "announcements.bookmarksRemoved": "Bookmarks removed",
  "announcements.paginatedView": "Paginated view",
  "announcements.scrollView": "Scroll view",
  "announcements.highlightAdded": "Highlight added",
  "announcements.spreadOfTotal": "Pages {first}–{second} of {total}",
  "announcements.annotationsImported": "Imported {highlights} highlights and {bookmarks} bookmarks. {skipped} entries were skipped.",
  "reader.loading": "Loading…",
  "reader.openingBook": "Getting your book ready…",
  "reader.navigating": "Turning to your page…",
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
  "inspector.popoverView": "Popover view",
  "inspector.dockLeft": "Dock left",
  "inspector.dockRight": "Dock right",
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
  "bookDetails.rights": "Rights",
  "bookDetails.showMore": "Show more",
  "bookDetails.showLess": "Show less",
  "bookDetails.closePanel": "Close book details panel",
  "bookDetails.publisher": "Publisher",
  "bookDetails.readingTools": "Reading tools",
  "bookDetails.publicationDetails": "Publication details",
  "bookDetails.fileSize": "EPUB file size",
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
  "imageViewer.zoomIn": "Zoom in",
  "imageViewer.zoomOut": "Zoom out",
  "imageViewer.fit": "Fit to window",
  "imageViewer.controls": "Image zoom",
  "imageViewer.instructions": "Scroll to zoom. Drag or use arrow keys to pan. Press 0 to fit.",
};
