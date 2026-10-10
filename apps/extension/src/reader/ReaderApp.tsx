import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Spinner, Title2 } from "@fluentui/react-components";
import { useBrowserAppearance } from "@ambra/shell";
import { FixedContentHost, ReadingTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { libraryFullTabUrl, readerTabUrl } from "../navigation.js";
import { LiveRegion } from "./components/LiveRegion.js";
import { Toolbar } from "./components/Toolbar.js";
import type { ReaderToolbarMenu } from "./components/Toolbar.js";
import { TocPanel } from "./components/TocPanel.js";
import { ReaderLibraryPanel } from "./components/ReaderLibraryPanel.js";
import { SearchPanel } from "./components/SearchPanel.js";
import { AnnotationsPanel } from "./components/AnnotationsPanel.js";
import { BookDetailsPanel } from "./components/BookDetailsPanel.js";
import { GoToDialog } from "./components/GoToDialog.js";
import { EpubInspectorPanel, INSPECTOR_DOCK_WIDTH, type InspectorViewMode } from "./components/EpubInspectorPanel.js";
import { ImageViewer } from "./components/ImageViewer.js";
import { TableViewer } from "./components/TableViewer.js";
import { SelectionToolbar } from "./components/SelectionToolbar.js";
import { NarrationControls } from "./components/NarrationControls.js";
import { HighlightActionPopup } from "./components/HighlightActionPopup.js";
import { FootnotePopup } from "./components/FootnotePopup.js";
import { NoteMarkers } from "./components/NoteMarkers.js";
import { FriendlyError } from "./components/FriendlyError.js";
import { isInvalidEpubError } from "../EpubErrors.js";
import { PageFurniture } from "./components/PageFurniture.js";
import { ProgressScrubber } from "./components/ProgressScrubber.js";
import { useReaderController } from "./useReaderController.js";
import { useAutoHideChrome } from "./useAutoHideChrome.js";
import { ChromeThemeProvider } from "./ChromeThemeContext.js";
import { ReaderDiagnosticContext } from "./ReaderDiagnosticContext.js";
import { LocaleProvider, useLocale, useTranslation } from "../i18n/LocaleContext.js";
import type { BookDetails, EpubInspectionData, InspectorReaderBridge } from "./ReaderTypes.js";
import { getChromeTheme } from "./chromeTheme.js";
import { ShortcutPreferencesProvider, useShortcutPreferences } from "../shortcuts/ShortcutPreferencesContext.js";
import { HelpAboutFlyout } from "../components/HelpAboutFlyout.js";
import { KeyboardShortcutsDialog } from "../components/KeyboardShortcutsDialog.js";
import { captureFocusReturn, useHelpDialogs } from "../components/useHelpDialogs.js";
import { ReadingWelcome } from "./components/ReadingWelcome.js";
import { useReadingWelcome } from "./useReadingWelcome.js";
import { PageTurnGuide } from "./components/PageTurnGuide.js";
import { closeReferencePanel, openReferencePanel, referencePanelLayout, referencePanelSide, wantsReferencePanelPin } from "./referencePanels.js";
import type { ReferencePanel, ReferencePanels } from "./referencePanels.js";

/**
 * Real reader page: toolbar (title, TOC toggle, chapter/page navigation,
 * paginated/scroll view-mode toggle), a collapsible Table of Contents
 * panel, and the content pane the active reading surface (paginated or
 * continuous scroll) mounts into. Supersedes `EpubInspector`, the
 * temporary dev tool used to exercise the engine while the real reading
 * surface didn't exist yet.
 *
 * Loads its book from `LibraryDatabase` by the `?bookId=` query parameter
 * the library page opens this tab with (see `navigation.ts`) — the
 * reading surface itself doesn't care how the bytes were obtained, it
 * just needs an `ArrayBuffer`.
 */
export const ReaderApp: FC = () => (
  <LocaleProvider>
    <ShortcutPreferencesProvider>
      <ReaderAppInner />
    </ShortcutPreferencesProvider>
  </LocaleProvider>
);

const ReaderAppInner: FC = () => {
  const t = useTranslation();
  const appearance = useBrowserAppearance();
  const locale = useLocale();
  const {
    recordDiagnosticEvent,
    recordDiagnosticSurfaces,
    snapshot,
    contentHostRef,
    openBook,
    flushProgress,
    narrationAction,
    setNarrationRate,
    setNarrationSkipping,
    goToNavPoint,
    setViewMode,
    setFontScale,
    setFixedZoom,
    setLineSpacing,
    setLetterSpacing,
    setContentWidth,
    setAlwaysShowOnePage,
    setFontFamily,
    setPageTheme,
    setBrightness,
    setChromeTheme,
    setPageTurnAnimationStyle,
    setProgressMarkerStyle,
    previewSeek,
    seekToFraction,
    getBookDetails,
    getEpubInspectionData,
    getInspectorReaderBridge,
    findInspectionReferences,
    readInspectionFileText,
    getInspectionFilePreviewUrl,
    closeImageViewer,
    closeTableViewer,
    reportTableViewerError,
    restoreContentFocus,
    getDiagnosticsText,
    toggleBookmark,
    refreshBookmarks,
    removeBookmark,
    goToBookmark,
    addHighlight,
    removeHighlight,
    goToHighlight,
    listEmbeddedAnnotations,
    goToReadOnlyAnnotation,
    exportAnnotations,
    saveBookAs,
    importAnnotationsFile,
    setHighlightNote,
    setHighlightStyle,
    dismissActiveHighlight,
    openHighlightPopup,
    dismissFootnotePopup,
    search,
    goToSearchResult,
    setSearchPanelState,
    dismissError,
    setShortcutPreferences,
    setShortcutActions,
    setShortcutModalOpen,
    setContentUiDismissal,
    pageTurnGuideController,
  } = useReaderController(t);
  const shortcutSettings = useShortcutPreferences();
  const help = useHelpDialogs(restoreContentFocus);
  const [toolbarMenu, setToolbarMenu] = useState<ReaderToolbarMenu>();
  const [goToMode, setGoToMode] = useState<"page" | "percentage">();
  const toolbarMenuRef = useRef<ReaderToolbarMenu | undefined>(undefined);
  const changeToolbarMenu = useCallback((menu: ReaderToolbarMenu | undefined) => {
    toolbarMenuRef.current = menu;
    setToolbarMenu(menu);
  }, []);
  const searchFocusReturn = useRef<(() => void) | undefined>(undefined);
  const [searchInputFocusRequest, setSearchInputFocusRequest] = useState(0);
  const [referencePanels, setReferencePanels] = useState<ReferencePanels>({});
  const [hasOpenedLibrary, setHasOpenedLibrary] = useState(false);
  const bookActivationRequest = useRef(0);
  const currentBookId = new URLSearchParams(window.location.search).get("bookId") ?? undefined;
  const [isActivePanelPinned, setIsActivePanelPinned] = useState(false);
  const referenceRowRef = useRef<HTMLDivElement>(null);
  const [referenceRowSize, setReferenceRowSize] = useState({
    available: 0, toc: 0, annotations: 0, search: 0,
  });
  const [seekError, setSeekError] = useState<string>();
  const [bookmarkFilterRequest, setBookmarkFilterRequest] = useState(0);
  const [bookmarkChooserOpen, setBookmarkChooserOpen] = useState(false);
  const [bookmarkChooserDismissRequest, setBookmarkChooserDismissRequest] = useState(0);
  const isNarrationOpen = snapshot?.narration?.available === true;
  const [isNarrationCollapsed, setIsNarrationCollapsed] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const narrationRegionRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const narration = narrationRegionRef.current;
    if (!layout) return;
    if (!narration) {
      layout.style.removeProperty("--ambra-narration-height");
      return;
    }
    const measure = () => layout.style.setProperty("--ambra-narration-height",
      `${narration.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(narration);
    return () => observer.disconnect();
  }, [isNarrationOpen]);
  // Contents/Annotations share a pin preference; Search retains its own.
  // Opposite docks share a width budget; narrow rows never overwrite intent.
  const [isSearchPinnedToggle, setIsSearchPinnedToggle] = useState(false);
  const panelPins = { reference: isActivePanelPinned, search: isSearchPinnedToggle };
  const panelLayout = referencePanelLayout(referencePanels, panelPins, referenceRowSize.available, referenceRowSize);
  const canDock = panelLayout.canPin;
  const isTocOpen = panelLayout.visible.left === "toc";
  const isLibraryOpen = panelLayout.visible.left === "library";
  const isAnnotationsOpen = panelLayout.visible.right === "annotations";
  const isSearchOpen = panelLayout.visible.right === "search";
  const isDetailsOpen = panelLayout.visible.right === "details";
  const isTocPinned = panelLayout.docked.toc;
  const isAnnotationsPinned = panelLayout.docked.annotations;
  const isSearchPinned = panelLayout.docked.search;
  const hasReferencePanel = referencePanels.active !== undefined;
  const openPanel = useCallback((panel: ReferencePanel) => {
    setReferencePanels(current => openReferencePanel(current, panel, {
      reference: isActivePanelPinned, search: isSearchPinnedToggle,
    }));
  }, [isActivePanelPinned, isSearchPinnedToggle]);
  const closePanel = (panel: ReferencePanel): void => {
    setReferencePanels(current => closeReferencePanel(current, panel));
  };
  const openSearch = useCallback(() => {
    if (!document.activeElement?.closest("[data-ambra-search-panel]")) {
      searchFocusReturn.current = captureFocusReturn(restoreContentFocus);
    }
    openPanel("search");
    setSearchInputFocusRequest(request => request + 1);
  }, [restoreContentFocus, openPanel]);
  const closeSearch = useCallback(() => {
    setReferencePanels(current => closeReferencePanel(current, "search"));
    (searchFocusReturn.current ?? restoreContentFocus)();
    searchFocusReturn.current = undefined;
  }, [restoreContentFocus]);

  useEffect(() => {
    setShortcutPreferences({
      ...shortcutSettings.preferences,
      enabled: shortcutSettings.ready && shortcutSettings.preferences.enabled,
    }, shortcutSettings.platform);
  }, [shortcutSettings.preferences, shortcutSettings.platform, shortcutSettings.ready, setShortcutPreferences]);

  useEffect(() => {
    setShortcutActions({
      searchBook: openSearch,
      showKeyboardShortcuts: help.openShortcuts,
      goToPage: () => setGoToMode("page"),
      goToPercentage: () => setGoToMode("percentage"),
    });
  }, [openSearch, help.openShortcuts, setShortcutActions]);

  // Issue #100: keeps the controller's own view of the Search panel's
  // open/pinned state in sync — it drives whether/how long the live
  // "highlight matches on screen" spotlight survives (see
  // `ReaderController.setSearchPanelState`'s own doc comment for why the
  // controller can't just observe this itself, being outside React).
  useEffect(() => {
    setSearchPanelState(isSearchOpen, isSearchPinned);
  }, [isSearchOpen, isSearchPinned, setSearchPanelState]);

  const toggleReferencePanel = (panel: ReferencePanel): void => {
    setReferencePanels(current => current[referencePanelSide(panel)] === panel &&
      panelLayout.visible[referencePanelSide(panel)] === panel
      ? closeReferencePanel(current, panel) : openReferencePanel(current, panel, panelPins));
  };
  const togglePanelPin = (panel: "toc" | "annotations" | "search"): void => {
    const nextPins = panel === "search"
      ? { ...panelPins, search: !panelPins.search }
      : { ...panelPins, reference: !panelPins.reference };
    // Unpinning restores ordinary flyout exclusivity, not two overlapping flyouts.
    setReferencePanels(current => {
      const next = openReferencePanel(current, panel, nextPins);
      if (current.focusTarget) next.focusTarget = current.focusTarget;
      return next;
    });
    if (panel === "search") setIsSearchPinnedToggle(nextPins.search);
    else setIsActivePanelPinned(nextPins.reference);
  };
  const [bookDetails, setBookDetails] = useState<BookDetails | undefined>(undefined);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [inspectorInitialTab, setInspectorInitialTab] = useState<"files" | "warnings">("files");
  const [inspectorView, setInspectorView] = useState<InspectorViewMode>("popover");
  const [inspectorReader, setInspectorReader] = useState<InspectorReaderBridge>();
  const inspectionFocusReturn = useRef<(() => void) | undefined>(undefined);
  const [inspectionData, setInspectionData] = useState<EpubInspectionData | undefined>(undefined);
  const [openError, setOpenError] = useState<{ message: string; invalidEpub?: boolean } | null>(null);
  const hasReaderLayout = snapshot !== undefined && openError === null;
  useLayoutEffect(() => {
    const visibility = { toc: isTocOpen, annotations: isAnnotationsOpen, search: isSearchOpen };
    for (const [panel, visible] of Object.entries(visibility)) {
      if (!visible && referenceRowRef.current?.querySelector(
        `[data-ambra-reference-panel="${panel}"]`,
      )?.contains(document.activeElement)) {
        restoreContentFocus();
        break;
      }
    }
  }, [isTocOpen, isAnnotationsOpen, isSearchOpen, restoreContentFocus]);
  useLayoutEffect(() => {
    const row = referenceRowRef.current;
    if (!row) return;
    const panels = {
      toc: row.querySelector<HTMLElement>('[data-ambra-reference-panel="toc"]')!,
      annotations: row.querySelector<HTMLElement>('[data-ambra-reference-panel="annotations"]')!,
      search: row.querySelector<HTMLElement>('[data-ambra-reference-panel="search"]')!,
    };
    const measure = () => {
      // Measure the actual row after Inspector docking, not the viewport. Panel
      // border-box widths remain measurable even when their flyouts are closed.
      const available = row.getBoundingClientRect().width;
      const next = { available, toc: panels.toc.getBoundingClientRect().width,
        annotations: panels.annotations.getBoundingClientRect().width, search: panels.search.getBoundingClientRect().width };
      setReferenceRowSize(previous => previous.available === next.available &&
        previous.toc === next.toc && previous.annotations === next.annotations
        && previous.search === next.search ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const panel of Object.values(panels)) observer.observe(panel);
    return () => observer.disconnect();
  }, [hasReaderLayout]);
  const [pageTurnGuideRun, setPageTurnGuideRun] = useState(0);
  const guidePending = useRef(false);
  const welcome = useReadingWelcome(snapshot?.hasRenderedContent === true, help.view === undefined &&
    !snapshot?.isLoading && !snapshot?.error && !openError &&
    !isInspectorOpen && goToMode === undefined && !snapshot?.imageViewer && !snapshot?.tableViewer &&
    !hasReferencePanel &&
    toolbarMenu === undefined, help.openWelcome);
  useEffect(() => {
    if (!snapshot) return;
    recordDiagnosticSurfaces({
      toc: { open: isTocOpen, pinned: isTocPinned },
      library: { open: isLibraryOpen },
      "bookmark-chooser": { open: bookmarkChooserOpen },
      annotations: { open: isAnnotationsOpen, pinned: isAnnotationsPinned },
      search: { open: isSearchOpen, pinned: isSearchPinned },
      details: { open: isDetailsOpen }, inspector: { open: isInspectorOpen },
      settings: { open: toolbarMenu === "settings" }, typography: { open: toolbarMenu === "typography" },
      help: { open: help.view === "about" }, shortcuts: { open: help.view === "shortcuts" },
      narration: { open: isNarrationOpen },
      image: { open: snapshot.imageViewer !== undefined },
      table: { open: snapshot.tableViewer !== undefined },
      selection: { open: snapshot.selectionToolbar !== undefined },
      highlight: { open: snapshot.activeHighlight !== undefined },
      footnote: { open: snapshot.footnotePopup !== undefined },
    });
  }, [snapshot, isTocOpen, isTocPinned, isLibraryOpen, bookmarkChooserOpen, isAnnotationsOpen, isAnnotationsPinned,
    isSearchOpen, isSearchPinned, isDetailsOpen, isInspectorOpen, toolbarMenu, help.view,
    isNarrationOpen, recordDiagnosticSurfaces]);
  const previousPreferences = useRef<{ locale: typeof locale.preference; shortcutsEnabled: boolean } | undefined>(undefined);
  useEffect(() => {
    if (!snapshot || !locale.ready || !shortcutSettings.ready) return;
    const next = { locale: locale.preference, shortcutsEnabled: shortcutSettings.preferences.enabled };
    const previous = previousPreferences.current;
    if (previous) {
      recordDiagnosticEvent({ kind: "setting", name: "locale", before: previous.locale,
        after: next.locale, source: "preferences" });
      recordDiagnosticEvent({ kind: "setting", name: "shortcutsEnabled", before: previous.shortcutsEnabled,
        after: next.shortcutsEnabled, source: "preferences" });
    }
    previousPreferences.current = next;
  }, [snapshot, locale.ready, locale.preference, shortcutSettings.ready,
    shortcutSettings.preferences.enabled, recordDiagnosticEvent]);
  useEffect(() => {
    setShortcutModalOpen((isInspectorOpen && inspectorView === "fullscreen") ||
      goToMode !== undefined || help.view !== undefined || snapshot?.imageViewer !== undefined ||
      snapshot?.tableViewer !== undefined);
  }, [isInspectorOpen, inspectorView, goToMode, help.view, snapshot?.imageViewer, snapshot?.tableViewer, setShortcutModalOpen]);
  // Shared between the toolbar and the progress scrubber (see
  // `useAutoHideChrome`'s doc comment) so both fade in/out together as
  // one unit of chrome, rather than each keeping its own independent
  // (and potentially out-of-sync) visibility state. Kept visible
  // whenever any flyout panel (either side) is open — all are "pinned"
  // reasons to keep the chrome from auto-hiding out from under an open
  // panel.
  const hasReadingError = snapshot?.errorSeverity === "blocking" || snapshot?.errorSeverity === "navigationFailed";
  const activeSeekError = hasReadingError ? undefined : seekError;
  useEffect(() => {
    if (hasReadingError) setSeekError(undefined);
  }, [hasReadingError, seekError]);
  const { visible: chromeVisible, handlers: chromeHandlers, dismissForContent, hide: hideChrome } = useAutoHideChrome(
    hasReferencePanel || help.view !== undefined || bookmarkChooserOpen || hasReadingError,
    snapshot?.contentPointerActivityId,
  );

  useEffect(() => {
    setContentUiDismissal(point => {
      const dismissedChrome = dismissForContent(point);
      const dismissedMenu = toolbarMenuRef.current !== undefined;
      if (dismissedMenu) {
        // Fluent restores a closing menu's focus to its trigger if focus is
        // still inside the popup. Transfer it first, or that restoration
        // reveals chrome again during this same content pointerdown.
        restoreContentFocus();
        changeToolbarMenu(undefined);
      }
      if (bookmarkChooserOpen) {
        restoreContentFocus();
        setBookmarkChooserOpen(false);
        setBookmarkChooserDismissRequest(request => request + 1);
        if (!hasReferencePanel && help.view === undefined) hideChrome();
      }
      const dismissedPopup = snapshot?.activeHighlight !== undefined || snapshot?.footnotePopup !== undefined;
      if (snapshot?.activeHighlight) dismissActiveHighlight(false);
      if (snapshot?.footnotePopup) dismissFootnotePopup(false);
      return dismissedChrome || dismissedMenu || dismissedPopup || bookmarkChooserOpen;
    });
    return () => setContentUiDismissal(undefined);
  }, [dismissForContent, setContentUiDismissal, snapshot?.activeHighlight, snapshot?.footnotePopup,
    dismissActiveHighlight, dismissFootnotePopup, changeToolbarMenu, restoreContentFocus,
    bookmarkChooserOpen, hasReferencePanel, help.view, hideChrome]);

  const dismissPanelToContent = (panel: ReferencePanel): void => {
    closePanel(panel);
    if (panel === "search") searchFocusReturn.current = undefined;
    restoreContentFocus();
    if (help.view === undefined && closeReferencePanel(referencePanels, panel).active === undefined) hideChrome();
  };
  const dismissHelpToContent = (): void => {
    help.closeToContent();
    if (!hasReferencePanel) hideChrome();
  };

  // Names the browser tab after the book itself, rather than leaving it
  // on the reader page's own generic title — the tab strip is often the
  // only place a reader can tell which of several open books a given tab
  // is, especially with more than one open at once. Runs whenever the
  // title becomes available/changes (book open, or a different book
  // loaded into the same tab via a fresh `?bookId=`), not just once on
  // mount.
  useEffect(() => {
    if (snapshot?.title) {
      document.title = snapshot.title;
    }
  }, [snapshot?.title]);

  // Fetches the book's details (cover/file name need an async
  // `LibraryDatabase` read the first time — see `ReaderController.
  // getBookDetails`) the first time the panel is opened, not on every
  // mount — there's no reason to pay for it before the reader ever asks
  // to see it, and the controller itself caches the cover's object URL
  // so a second open doesn't re-fetch anything.
  useEffect(() => {
    if ((!isDetailsOpen && !isInspectorOpen) || bookDetails !== undefined) {
      return;
    }
    let cancelled = false;
    void getBookDetails().then((details) => {
      if (!cancelled) {
        setBookDetails(details);
      }
    }).catch((error: unknown) => {
      if (!cancelled) setSeekError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [isDetailsOpen, isInspectorOpen, bookDetails, getBookDetails]);

  // Same "fetch once, cache for the controller's lifetime" pattern as
  // `bookDetails` above — the EPUB Inspector's data (issue #46) is
  // already fully parsed and in memory by the time the reader's even
  // looking at it, so unlike bookmarks below there's genuinely nothing
  // to go stale between opens.
  useEffect(() => {
    if (!isInspectorOpen || inspectionData !== undefined) {
      return;
    }
    setInspectionData(getEpubInspectionData());
  }, [isInspectorOpen, inspectionData, getEpubInspectionData]);

  useEffect(() => {
    if (isInspectorOpen || !inspectionFocusReturn.current) return;
    const frame = requestAnimationFrame(() => {
      inspectionFocusReturn.current?.();
      inspectionFocusReturn.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [isInspectorOpen]);

  const openInspector = (): void => {
    setInspectorInitialTab("files");
    setInspectorReader(getInspectorReaderBridge());
    inspectionFocusReturn.current = restoreContentFocus;
    closePanel("details");
    setIsInspectorOpen(true);
  };

  // Refresh on open for edits made in another reader tab; local mutations
  // already publish through the controller's single annotation snapshot.
  useEffect(() => {
    if (isAnnotationsOpen) void refreshBookmarks();
  }, [isAnnotationsOpen, refreshBookmarks]);

  const handleToggleBookmark = (): void => {
    void toggleBookmark();
  };

  const handleRemoveBookmark = (id: string): void => {
    void removeBookmark(id);
  };

  const handleSelectBookmark = (cfi: string): void => {
    void goToBookmark(cfi);
    if (!isAnnotationsPinned) {
      closePanel("annotations");
    }
  };

  const activateLibraryBook = async (bookId: string): Promise<void> => {
    const request = ++bookActivationRequest.current;
    if (bookId === currentBookId) {
      closePanel("library");
      restoreContentFocus();
      return;
    }
    try {
      await flushProgress();
    } catch (error) {
      if (request === bookActivationRequest.current) throw error;
      console.error("Could not save reading position for a superseded Library request.", error);
      return;
    }
    if (request !== bookActivationRequest.current) return;
    window.location.assign(readerTabUrl(bookId));
  };

  const handleAddHighlight = (style: HighlightStyle): void => {
    void addHighlight(style);
  };

  /** Issue #60: "Add note" in the selection toolbar — creates the
   * highlight (in the toolbar's own default/first style) and, unlike
   * `handleAddHighlight`, immediately opens its note editor rather than
   * requiring the reader to click the highlight again afterward. */
  const handleAddHighlightWithNote = (): void => {
    void addHighlight("yellow", true);
  };

  const handleRemoveHighlight = (id: string): void => {
    void removeHighlight(id);
  };

  const handleSelectHighlight = (cfi: string): void => {
    void goToHighlight(cfi);
    if (!isAnnotationsPinned) {
      closePanel("annotations");
    }
  };

  const handleSelectReadOnlyAnnotation = (cfi: string): void => {
    void goToReadOnlyAnnotation(cfi);
    if (!isAnnotationsPinned) {
      closePanel("annotations");
    }
  };

  /** Triggers a plain browser file download — no extension permission
   * needed, unlike `chrome.downloads`, and works the same whether the
   * reader is running as a packed extension or a plain dev page. */
  const handleExportAnnotations = async (): Promise<void> => {
    const result = await exportAnnotations();
    if (!result) {
      return;
    }
    const blob = new Blob([result.text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportAnnotationsFile = async (file: File): Promise<void> => {
    await importAnnotationsFile(file);
  };

  const handleSelectSearchResult = (cfi: string): void => {
    void goToSearchResult(cfi);
    if (!isSearchPinned) {
      closePanel("search");
    }
  };

  useEffect(() => {
    const bookId = new URLSearchParams(window.location.search).get("bookId");
    if (!bookId) {
      setOpenError({ message: "No book selected — open this book from the Ambra library." });
      return;
    }

    let cancelled = false;
    void (async () => {
      // Deliberately not closed here: `ReaderController` keeps this
      // connection open for the whole reading session to persist/restore
      // progress (see `resume-reading`), and closes it itself on dispose.
      let library: LibraryDatabase | undefined;
      try {
        library = await LibraryDatabase.open();
        if (cancelled) {
          library.close();
          return;
        }
        const blob = await library.getBookFile(bookId);
        if (!blob) {
          throw new Error(
            "This book could not be found in your library — it may have been removed.",
          );
        }
        const buffer = await blob.arrayBuffer();
        if (!cancelled) {
          await openBook(buffer, bookId, library);
        } else {
          library.close();
        }
      } catch (err) {
        library?.close();
        if (!cancelled) {
          setOpenError({ message: err instanceof Error ? err.message : String(err), invalidEpub: isInvalidEpubError(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (openError) {
    return (
      <div style={{ height: "100vh", position: "relative" }}>
        <FriendlyError
          message={openError.message}
          headline={openError.invalidEpub ? t("error.invalidEpubHeadline") : undefined}
          severity="blocking"
          libraryHref={libraryFullTabUrl()}
          onDismiss={() => setOpenError(null)}
          getDiagnosticsText={getDiagnosticsText}
        />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div style={{ padding: 24 }}>
        <Title2>Ambra Reader</Title2>
        <Spinner label={t("reader.openingBook")} />
      </div>
    );
  }

  const pageBackground = snapshot.isFixedLayout
    ? FixedContentHost.LETTERBOX_BACKGROUND
    : ReadingTheme.PAGE_THEMES[snapshot.pageTheme].background;
  // Mirrors `ProgressScrubber`'s own identical early-return condition —
  // the flyout panels need to know this too so they can stop above the
  // scrubber bar instead of running underneath it (issue #59).
  const scrubberVisible = snapshot.isFixedLayout || snapshot.viewMode === "paginated";
  return (
    <ReaderDiagnosticContext.Provider value={recordDiagnosticSurfaces}>
    <ChromeThemeProvider theme={snapshot.chromeTheme}>
      {/* Issue #98: a marker's `left`/`top` are computed for the page
                that was on screen when they were placed, and don't track the
                page-turn animation as it slides/flips/rotates the content
                out from under them — simplest fix is to just not render any
                until the incoming page has settled and fresh positions are
                computed for it (see `updateNoteMarkers`'s callers). */}
      <div ref={layoutRef} style={{ position: "relative", height: "100vh", overflow: "clip" }}>
        {/* Issue #98: a marker's `left`/`top` are computed for the page
                that was on screen when they were placed, and don't track the
                page-turn animation as it slides/flips/rotates the content
                out from under them — simplest fix is to just not render any
                until the incoming page has settled and fresh positions are
                computed for it (see `updateNoteMarkers`'s callers). */}
        <div ref={referenceRowRef} data-ambra-reference-row style={{
          position: "absolute", inset: 0, display: "flex",
          left: isInspectorOpen && inspectorView === "dock-left" ? INSPECTOR_DOCK_WIDTH : 0,
          right: isInspectorOpen && inspectorView === "dock-right" ? INSPECTOR_DOCK_WIDTH : 0,
        }}>
          <TocPanel
            items={snapshot.toc}
              additionalLists={snapshot.additionalNavigation}
              currentPath={snapshot.highlightedTocPath}
            firstSpinePath={snapshot.firstSpinePath}
            pageNumbers={snapshot.tocPageNumbers}
            open={isTocOpen}
            focusOnOpen={referencePanels.focusTarget === "toc"}
            pinned={isTocPinned}
            canPin={canDock.toc}
            onTogglePin={() => togglePanelPin("toc")}
            onRequestClose={() => {
              closePanel("toc");
              restoreContentFocus();
            }}
            onOutsideClick={() => dismissPanelToContent("toc")}
            onSelect={(navPoint) => {
              goToNavPoint(navPoint);
              if (!isTocPinned) {
                closePanel("toc");
              }
            }}
            scrubberVisible={scrubberVisible}
          />

          {hasOpenedLibrary && (
              <ReaderLibraryPanel
            open={isLibraryOpen}
            currentBookId={currentBookId}
            scrubberVisible={scrubberVisible}
            onRequestClose={() => {
              closePanel("library");
              restoreContentFocus();
            }}
            onOutsideClick={() => dismissPanelToContent("library")}
            onActivateBook={bookId => {
              void activateLibraryBook(bookId).catch(error =>
                setSeekError(error instanceof Error ? error.message : String(error)));
            }}
          />
            )}

          <div
            style={{
              flex: 1, position: "relative", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column",
              containerType: "inline-size", containerName: "reader-pane",
            }}
            role="main"
            aria-label={t("reader.bookContentAriaLabel")}
          >
            <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            {/* Issue #98: a marker's `left`/`top` are computed for the page
                that was on screen when they were placed, and don't track the
                page-turn animation as it slides/flips/rotates the content
                out from under them — simplest fix is to just not render any
                until the incoming page has settled and fresh positions are
                computed for it (see `updateNoteMarkers`'s callers). */}
            <div
              ref={contentHostRef}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                justifyContent: "center",
                alignItems: "flex-start",
                overflow: "hidden",
                background: pageBackground,
                filter: `brightness(${snapshot.brightness})`,
                // Continuous scroll mode gets no baked-in top inset the
                // way paginated pages do (see `ReadingTheme.PAGE_INSET_TOP`'s
                // doc comment — it relies on normal document flow and the
                // toolbar auto-hiding). That assumption breaks whenever the
                // toolbar is being kept forcibly visible (a pinned/open TOC
                // or Book Details panel — see `chromeVisible`), which can
                // leave a chapter's very first heading sitting right under
                // it. Push the content down by the same amount paginated
                // mode already reserves, but via `transform` rather than
                // `padding` — this div is exactly what `useReaderController`'s
                // `ResizeObserver` watches to drive `resize()`/relayout, and
                // a transform (unlike padding) never changes its observed
                // content-box size, so toggling this alongside the toolbar's
                // own fade never triggers a pointless re-measurement (see
                // the comment on the toolbar overlay above for the same
                // reasoning applied to the toolbar itself).
                transform:
                  !snapshot.isFixedLayout && snapshot.viewMode === "scroll" && chromeVisible
                    ? `translateY(${ReadingTheme.PAGE_INSET_TOP}px)`
                    : "translateY(0)",
                transition: "transform 240ms ease",
              }}
            />
                <PageFurniture snapshot={snapshot} chromeVisible={chromeVisible} />
                {pageTurnGuideRun > 0 && pageTurnGuideController && (
              <PageTurnGuide key={pageTurnGuideRun} controller={pageTurnGuideController}
                hidden={help.view !== undefined || !!snapshot.isLoading || !!snapshot.error ||
                  isInspectorOpen || goToMode !== undefined || !!snapshot.imageViewer || !!snapshot.tableViewer ||
                  hasReferencePanel || toolbarMenu !== undefined || !!snapshot.selectionToolbar ||
                  !!snapshot.activeHighlight || !!snapshot.footnotePopup} />
            )}
                {snapshot.isLoading && (
              <Spinner
                label={t(snapshot.loadingPhase === "navigating" ? "reader.navigating" : "reader.openingBook")}
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                }}
              />
            )}

                {/* Issue #98: a marker's `left`/`top` are computed for the page
                that was on screen when they were placed, and don't track the
                page-turn animation as it slides/flips/rotates the content
                out from under them — simplest fix is to just not render any
                until the incoming page has settled and fresh positions are
                computed for it (see `updateNoteMarkers`'s callers). */}
                <Toolbar
              openMenu={toolbarMenu}
              onOpenMenuChange={changeToolbarMenu}
              snapshot={snapshot}
              isLibraryOpen={isLibraryOpen}
              onToggleLibrary={() => {
                setHasOpenedLibrary(true);
                if (isLibraryOpen) restoreContentFocus();
                toggleReferencePanel("library");
              }}
              isTocOpen={isTocOpen}
              onToggleToc={() => {
                if (isTocOpen) {
                  restoreContentFocus();
                }
                toggleReferencePanel("toc");
              }}
              isSearchOpen={isSearchOpen}
              onToggleSearch={() => {
                if (isSearchOpen) {
                  closeSearch();
                } else {
                  openSearch();
                }
              }}
              isAnnotationsOpen={isAnnotationsOpen}
              onToggleAnnotations={() => {
                if (isAnnotationsOpen) {
                  restoreContentFocus();
                } else {
                  setBookmarkFilterRequest(0);
                }
                toggleReferencePanel("annotations");
              }}
              isDetailsOpen={isDetailsOpen}
              onToggleDetails={() => {
                if (isDetailsOpen) {
                  restoreContentFocus();
                }
                toggleReferencePanel("details");
              }}
              onToggleBookmark={handleToggleBookmark}
              onSetViewMode={setViewMode}
              onSetFontScale={setFontScale}
              onSetFixedZoom={setFixedZoom}
              onSetLineSpacing={setLineSpacing}
              onSetLetterSpacing={setLetterSpacing}
              onSetContentWidth={setContentWidth}
              onSetAlwaysShowOnePage={setAlwaysShowOnePage}
              onSetFontFamily={setFontFamily}
              onSetPageTheme={setPageTheme}
              onSetBrightness={setBrightness}
              onSetChromeTheme={setChromeTheme}
              onSetPageTurnAnimationStyle={setPageTurnAnimationStyle}
              onSetProgressMarkerStyle={setProgressMarkerStyle}
              onOpenHelp={help.openHelp}
              isHelpOpen={help.view !== undefined}
              visible={chromeVisible}
              handlers={chromeHandlers}
            />

                <HelpAboutFlyout
              open={help.view === "about"}
              focusShortcutsOnOpen={help.focusShortcutsOnOpen}
              onRequestClose={help.close}
              onOutsideClick={dismissHelpToContent}
              onAfterClose={help.afterClose}
              backgroundSolid={getChromeTheme(snapshot.chromeTheme, appearance).backgroundSolid}
              accentForeground={getChromeTheme(snapshot.chromeTheme, appearance).accentForeground}
              onOpenKeyboardShortcuts={help.openShortcutsFromHelp}
              onOpenReadingTips={help.openWelcome}
              getReaderDiagnostics={getDiagnosticsText}
            />
                <ReadingWelcome
              open={help.view === "welcome"}
              scrolling={!snapshot.isFixedLayout && snapshot.viewMode === "scroll"}
              rtl={snapshot.pageProgressionDirection === "rtl"}
              onDismiss={() => {
                guidePending.current = true;
                void welcome.acknowledge();
                help.closeToContent();
              }}
              onAfterClose={() => {
                help.afterClose();
                if (guidePending.current) {
                  guidePending.current = false;
                  setPageTurnGuideRun(run => run + 1);
                }
              }}
            />
                <KeyboardShortcutsDialog
              open={help.view === "shortcuts"}
              onRequestClose={help.close}
              onOutsideClick={dismissHelpToContent}
              onAfterClose={help.afterClose}
              pageProgressionDirection={snapshot.pageProgressionDirection}
            />

                <BookDetailsPanel
              open={isDetailsOpen}
              onRequestClose={() => {
                closePanel("details");
                restoreContentFocus();
              }}
              onOutsideClick={() => dismissPanelToContent("details")}
              details={bookDetails}
              onOpenInspector={openInspector}
              onOpenHelp={help.openHelp}
              onSaveAs={saveBookAs}
              getDiagnosticsText={getDiagnosticsText}
              scrubberVisible={scrubberVisible}
            />

                <GoToDialog
              open={goToMode !== undefined}
              mode={goToMode ?? "page"}
              onOpenChange={(open) => {
                if (!open) {
                  setGoToMode(undefined);
                }
              }}
              onAfterClose={restoreContentFocus}
              isPaginated={snapshot.viewMode === "paginated"}
              isFixedLayout={snapshot.isFixedLayout}
              bookPageCount={snapshot.bookPageCount}
              onGo={async (fraction) => {
                recordDiagnosticEvent({ kind: "navigation", source: "go-to", fraction });
                await seekToFraction(fraction, { preserveFocus: true });
              }}
            />

                <EpubInspectorPanel
              initialTab={inspectorInitialTab}
              onFindReferences={findInspectionReferences}
              reader={inspectorReader}
              open={isInspectorOpen}
              viewMode={inspectorView}
              onViewModeChange={setInspectorView}
              onOpenChange={setIsInspectorOpen}
              onShowInBook={() => {
                setReferencePanels(current => {
                  let next = current;
                  if (next.left && !wantsReferencePanelPin(next.left, panelPins)) next = closeReferencePanel(next, next.left);
                  if (next.right && !wantsReferencePanelPin(next.right, panelPins)) next = closeReferencePanel(next, next.right);
                  return next;
                });
              }}
              data={inspectionData}
              fileName={bookDetails?.fileName}
              onReadFile={readInspectionFileText}
              onGetPreviewUrl={getInspectionFilePreviewUrl}
            />

                <ImageViewer image={snapshot.imageViewer} onRequestClose={closeImageViewer} />
                <TableViewer table={snapshot.tableViewer} onRequestClose={closeTableViewer} onError={reportTableViewerError} />

                <SelectionToolbar
              state={snapshot.selectionToolbar}
              onPick={handleAddHighlight}
              onAddNote={handleAddHighlightWithNote}
            />

                <HighlightActionPopup
              state={snapshot.activeHighlight}
              onSetNote={setHighlightNote}
              onSetStyle={(id, style) => void setHighlightStyle(id, style)}
              onRemove={(id) => {
                dismissActiveHighlight(false);
                restoreContentFocus();
                void removeHighlight(id);
              }}
              onDismiss={dismissActiveHighlight}
            />

                <FootnotePopup state={snapshot.footnotePopup} onDismiss={dismissFootnotePopup} />

                {/* Issue #98: a marker's `left`/`top` are computed for the page
                that was on screen when they were placed, and don't track the
                page-turn animation as it slides/flips/rotates the content
                out from under them — simplest fix is to just not render any
                until the incoming page has settled and fresh positions are
                computed for it (see `updateNoteMarkers`'s callers). */}
                <NoteMarkers markers={snapshot.isAnimatingPageTurn ? [] : snapshot.noteMarkers} onSelect={openHighlightPopup} />

                <ProgressScrubber
              snapshot={snapshot}
              markerStyle={snapshot.progressMarkerStyle ?? "upcoming"}
              markerData={snapshot.progressMarkers}
              visible={chromeVisible}
              handlers={chromeHandlers}
              onPreview={previewSeek}
              onSeek={async (fraction) => {
                recordDiagnosticEvent({ kind: "navigation", source: "scrubber", fraction });
                setSeekError(undefined);
                await seekToFraction(fraction);
              }}
              onSeekError={(error) => setSeekError(error instanceof Error ? error.message : String(error))}
              onGoToBookmark={bookmark => { void goToBookmark(bookmark.cfi); }}
              onShowBookmarks={() => {
                openPanel("annotations");
                setBookmarkFilterRequest(request => request + 1);
              }}
              bookmarkChooserDismissRequest={bookmarkChooserDismissRequest}
              onBookmarkChooserOpenChange={setBookmarkChooserOpen}
            />

                {(activeSeekError || (snapshot.error && snapshot.errorSeverity)) && (
              <FriendlyError
                message={activeSeekError ?? snapshot.error!}
                notificationId={snapshot.errorNotificationId}
                detail={activeSeekError ? undefined : snapshot.errorDetail}
                severity={activeSeekError ? "transient" : snapshot.errorSeverity!}
                libraryHref={hasReadingError ? libraryFullTabUrl() : undefined}
                onDismiss={() => { setSeekError(undefined); dismissError(); restoreContentFocus(); }}
                getDiagnosticsText={getDiagnosticsText}
                onOpenInspector={() => {
                  const data = getEpubInspectionData();
                  setInspectionData(data);
                  openInspector();
                  setInspectorInitialTab(data?.navigationDiagnostics?.length ? "warnings" : "files");
                  setSeekError(undefined);
                  if (snapshot.errorSeverity !== "blocking") dismissError();
                }}
              />
            )}
              </div>
              {isNarrationOpen && snapshot.narration?.available && (
                <div ref={narrationRegionRef} style={{ flexShrink: 0, minWidth: 0 }}>
                  <NarrationControls
                hasSelection={snapshot.hasReadingSelection === true}
                state={snapshot.narration}
                collapsed={isNarrationCollapsed}
                onCollapsedChange={setIsNarrationCollapsed}
                onPlayPause={() => narrationAction("toggle")}
                onPrevious={() => narrationAction("previous")}
                onNext={() => narrationAction("next")}
                onListenFromHere={() => narrationAction("here")}
                onListenFromSelection={() => narrationAction("selection")}
                onRateChange={setNarrationRate}
                onSkippingChange={setNarrationSkipping}
                onEscape={() => narrationAction("escape")}
              />
                </div>
              )}
            </div>

            <AnnotationsPanel
            filterRequest={bookmarkFilterRequest
              ? { filter: "bookmarks", requestId: bookmarkFilterRequest } : undefined}
            bookmarks={snapshot.bookmarks}
            bookmarkLocations={snapshot.bookmarkLocations}
            onSelectBookmark={handleSelectBookmark}
            onRemoveBookmark={handleRemoveBookmark}
            highlights={snapshot.highlights}
            onSelectHighlight={handleSelectHighlight}
            onRemoveHighlight={handleRemoveHighlight}
            onSetHighlightNote={setHighlightNote}
            readOnlyAnnotations={listEmbeddedAnnotations()}
            onSelectReadOnlyAnnotation={handleSelectReadOnlyAnnotation}
            onExport={handleExportAnnotations}
            onImportFile={handleImportAnnotationsFile}
            open={isAnnotationsOpen}
            focusOnOpen={referencePanels.focusTarget === "annotations"}
            pinned={isAnnotationsPinned}
            canPin={canDock.annotations}
            onTogglePin={() => togglePanelPin("annotations")}
            onRequestClose={() => {
              closePanel("annotations");
              restoreContentFocus();
            }}
            onOutsideClick={() => dismissPanelToContent("annotations")}
            scrubberVisible={scrubberVisible}
          />

            <SearchPanel
            query={snapshot.searchQuery}
            results={snapshot.searchResults}
            isSearching={snapshot.isSearching}
            onSearch={search}
            onSelect={handleSelectSearchResult}
            open={isSearchOpen}
            focusOnOpen={referencePanels.focusTarget === "search"}
            pinned={isSearchPinned}
            canPin={canDock.search}
            onTogglePin={() => togglePanelPin("search")}
            onRequestClose={closeSearch}
            onOutsideClick={() => dismissPanelToContent("search")}
            inputFocusRequest={searchInputFocusRequest}
            scrubberVisible={scrubberVisible}
          />
          </div>

          <LiveRegion text={snapshot.announcement} announcementId={snapshot.announcementId} />
        </div>
      </ChromeThemeProvider>
    </ReaderDiagnosticContext.Provider>
  );
};
