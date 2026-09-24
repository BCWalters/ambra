import { useCallback, useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Spinner, Title2 } from "@fluentui/react-components";
import { FixedContentHost, ReadingTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { libraryFullTabUrl } from "../navigation.js";
import { LiveRegion } from "./components/LiveRegion.js";
import { Toolbar } from "./components/Toolbar.js";
import type { ReaderToolbarMenu } from "./components/Toolbar.js";
import { TocPanel } from "./components/TocPanel.js";
import { SearchPanel } from "./components/SearchPanel.js";
import { AnnotationsPanel } from "./components/AnnotationsPanel.js";
import { BookDetailsPanel } from "./components/BookDetailsPanel.js";
import { EpubInspectorPanel } from "./components/EpubInspectorPanel.js";
import { ImageViewer } from "./components/ImageViewer.js";
import { SelectionToolbar } from "./components/SelectionToolbar.js";
import { NarrationControls } from "./components/NarrationControls.js";
import { NarrationDiscoveryNotice } from "./components/NarrationDiscoveryNotice.js";
import { HighlightActionPopup } from "./components/HighlightActionPopup.js";
import { FootnotePopup } from "./components/FootnotePopup.js";
import { NoteMarkers } from "./components/NoteMarkers.js";
import { FriendlyError } from "./components/FriendlyError.js";
import { PageFurniture } from "./components/PageFurniture.js";
import { ProgressScrubber } from "./components/ProgressScrubber.js";
import { useReaderController } from "./useReaderController.js";
import { useAutoHideChrome } from "./useAutoHideChrome.js";
import { ChromeThemeProvider } from "./ChromeThemeContext.js";
import { ReaderDiagnosticContext } from "./ReaderDiagnosticContext.js";
import { LocaleProvider, useLocale, useTranslation } from "../i18n/LocaleContext.js";
import type { BookDetails, EpubInspectionData, InspectorReaderBridge } from "./ReaderTypes.js";
import { CHROME_THEMES } from "./chromeTheme.js";
import { ShortcutPreferencesProvider, useShortcutPreferences } from "../shortcuts/ShortcutPreferencesContext.js";
import { HelpAboutFlyout } from "../components/HelpAboutFlyout.js";
import { KeyboardShortcutsDialog } from "../components/KeyboardShortcutsDialog.js";
import { captureFocusReturn, useHelpDialogs } from "../components/useHelpDialogs.js";

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
  const locale = useLocale();
  const {
    recordDiagnosticEvent,
    recordDiagnosticSurfaces,
    snapshot,
    contentHostRef,
    openBook,
    narrationAction,
    setNarrationRate,
    dismissNarrationNotice,
    goToNavPoint,
    setViewMode,
    setFontScale,
    setLineSpacing,
    setLetterSpacing,
    setContentWidth,
    setFontFamily,
    setPageTheme,
    setBrightness,
    setChromeTheme,
    setPageTurnAnimationStyle,
    previewSeek,
    seekToFraction,
    getBookDetails,
    getEpubInspectionData,
    getInspectorReaderBridge,
    findInspectionReferences,
    readInspectionFileText,
    getInspectionFilePreviewUrl,
    closeImageViewer,
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
  } = useReaderController(t);
  const shortcutSettings = useShortcutPreferences();
  const help = useHelpDialogs(restoreContentFocus);
  const [toolbarMenu, setToolbarMenu] = useState<ReaderToolbarMenu>();
  const toolbarMenuRef = useRef<ReaderToolbarMenu | undefined>(undefined);
  const changeToolbarMenu = useCallback((menu: ReaderToolbarMenu | undefined) => {
    toolbarMenuRef.current = menu;
    setToolbarMenu(menu);
  }, []);
  const searchFocusReturn = useRef<(() => void) | undefined>(undefined);
  const [searchInputFocusRequest, setSearchInputFocusRequest] = useState(0);
  // Exactly one of these two "left panels" (Contents/Bookmarks & Highlights)
  // can be shown at a time — see `activePanel`'s doc comment (issue #65).
  // Search and Book Details are their own separate, mutually-exclusive
  // pair on the *opposite* side of the reader pane (issue #68: search
  // moved from the left, alongside TOC, over to the right, alongside Book
  // Details — most readers expect a search/results affordance on the
  // same side as other "about this book" tools, not mixed in with pure
  // navigation panels).
  type LeftPanel = "toc" | "annotations";
  const [activePanel, setActivePanel] = useState<LeftPanel | undefined>(undefined);
  const [isActivePanelPinned, setIsActivePanelPinned] = useState(false);
  const [seekError, setSeekError] = useState<string>();
  const [isNarrationOpen, setIsNarrationOpen] = useState(false);
  const isTocOpen = activePanel === "toc";
  const isAnnotationsOpen = activePanel === "annotations";
  const isTocPinned = isTocOpen && isActivePanelPinned;
  const isAnnotationsPinned = isAnnotationsOpen && isActivePanelPinned;

  // The right-side pair: Search and Book Details. Only Search supports a
  // pinned/docked mode (see `SearchPanel`'s doc comment) — Book Details is
  // deliberately glance-and-close-only (see `BookDetailsPanel`'s doc
  // comment), so it gets no pin state of its own. `isSearchPinned` is
  // derived from *both* `isSearchOpen` and the raw pinned-toggle state
  // (mirroring `isTocPinned`/`isAnnotationsPinned` above) rather than
  // being the raw state directly — otherwise switching to Book Details
  // while Search happened to be pinned would leave Search's docked panel
  // rendered indefinitely (`SearchPanel` treats `pinned` as "stay shown
  // regardless of `open`"), a real bug caught via direct Chromium
  // testing: opening Book Details didn't actually replace a pinned
  // Search panel, it just showed both at once.
  type RightPanel = "search" | "details";
  const [rightPanel, setRightPanel] = useState<RightPanel | undefined>(undefined);
  const [isSearchPinnedToggle, setIsSearchPinnedToggle] = useState(false);
  const isSearchOpen = rightPanel === "search";
  const isDetailsOpen = rightPanel === "details";
  const isSearchPinned = isSearchOpen && isSearchPinnedToggle;
  const openSearch = useCallback(() => {
    if (!document.activeElement?.closest("[data-ambra-search-panel]")) {
      searchFocusReturn.current = captureFocusReturn(restoreContentFocus);
    }
    setRightPanel("search");
    setSearchInputFocusRequest(request => request + 1);
  }, [restoreContentFocus]);
  const closeSearch = useCallback(() => {
    setRightPanel(undefined);
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
    setShortcutActions({ searchBook: openSearch, showKeyboardShortcuts: help.openShortcuts });
  }, [openSearch, help.openShortcuts, setShortcutActions]);

  // Issue #100: keeps the controller's own view of the Search panel's
  // open/pinned state in sync — it drives whether/how long the live
  // "highlight matches on screen" spotlight survives (see
  // `ReaderController.setSearchPanelState`'s own doc comment for why the
  // controller can't just observe this itself, being outside React).
  useEffect(() => {
    setSearchPanelState(isSearchOpen, isSearchPinned);
  }, [isSearchOpen, isSearchPinned, setSearchPanelState]);

  /** Toggles one of the two left panels open/closed, per the "wonky"
   * behavior explicitly called out in issue #65: closes whichever other
   * left panel was showing (if any) rather than letting more than one
   * be open/docked at once — including a *pinned* one, which simply
   * hands its docked slot to the newly-selected panel (keeping
   * `isActivePanelPinned` untouched) rather than requiring an explicit
   * unpin-then-reopen-elsewhere dance. Clicking the *already*-active
   * panel's own button still just closes it, same as before. */
  const toggleLeftPanel = (panel: LeftPanel): void => {
    setActivePanel((current) => (current === panel ? undefined : panel));
  };

  /** Same idea as `toggleLeftPanel`, for the right-side Search/Book
   * Details pair (issue #68). */
  const toggleRightPanel = (panel: RightPanel): void => {
    setRightPanel((current) => (current === panel ? undefined : panel));
  };
  const [bookDetails, setBookDetails] = useState<BookDetails | undefined>(undefined);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [inspectorReader, setInspectorReader] = useState<InspectorReaderBridge>();
  const inspectionFocusReturn = useRef<(() => void) | undefined>(undefined);
  const [inspectionData, setInspectionData] = useState<EpubInspectionData | undefined>(undefined);
  const [openError, setOpenError] = useState<string | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    recordDiagnosticSurfaces({
      toc: { open: isTocOpen, pinned: isTocPinned },
      annotations: { open: isAnnotationsOpen, pinned: isAnnotationsPinned },
      search: { open: isSearchOpen, pinned: isSearchPinned },
      details: { open: isDetailsOpen }, inspector: { open: isInspectorOpen },
      settings: { open: toolbarMenu === "settings" }, typography: { open: toolbarMenu === "typography" },
      help: { open: help.view === "about" }, shortcuts: { open: help.view === "shortcuts" },
      narration: { open: isNarrationOpen },
      image: { open: snapshot.imageViewer !== undefined },
      selection: { open: snapshot.selectionToolbar !== undefined },
      highlight: { open: snapshot.activeHighlight !== undefined },
      footnote: { open: snapshot.footnotePopup !== undefined },
    });
  }, [snapshot, isTocOpen, isTocPinned, isAnnotationsOpen, isAnnotationsPinned,
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
    setShortcutModalOpen(isInspectorOpen || help.view !== undefined || snapshot?.imageViewer !== undefined);
  }, [isInspectorOpen, help.view, snapshot?.imageViewer, setShortcutModalOpen]);
  // Shared between the toolbar and the progress scrubber (see
  // `useAutoHideChrome`'s doc comment) so both fade in/out together as
  // one unit of chrome, rather than each keeping its own independent
  // (and potentially out-of-sync) visibility state. Kept visible
  // whenever any flyout panel (either side) is open — all are "pinned"
  // reasons to keep the chrome from auto-hiding out from under an open
  // panel.
  const { visible: chromeVisible, handlers: chromeHandlers, dismissForContent, hide: hideChrome } = useAutoHideChrome(
    activePanel !== undefined || rightPanel !== undefined || help.view !== undefined || snapshot?.narrationNoticeVisible === true,
    snapshot?.contentPointerActivityId,
  );

  useEffect(() => {
    setContentUiDismissal(() => {
      const dismissedChrome = dismissForContent();
      const dismissedMenu = toolbarMenuRef.current !== undefined;
      if (dismissedMenu) {
        // Fluent restores a closing menu's focus to its trigger if focus is
        // still inside the popup. Transfer it first, or that restoration
        // reveals chrome again during this same content pointerdown.
        restoreContentFocus();
        changeToolbarMenu(undefined);
      }
      const dismissedPopup = snapshot?.activeHighlight !== undefined || snapshot?.footnotePopup !== undefined;
      if (snapshot?.activeHighlight) dismissActiveHighlight();
      if (snapshot?.footnotePopup) dismissFootnotePopup();
      return dismissedChrome || dismissedMenu || dismissedPopup;
    });
    return () => setContentUiDismissal(undefined);
  }, [dismissForContent, setContentUiDismissal, snapshot?.activeHighlight, snapshot?.footnotePopup,
    dismissActiveHighlight, dismissFootnotePopup, changeToolbarMenu, restoreContentFocus]);

  const dismissPanelToContent = (side: "left" | "right"): void => {
    if (side === "left") setActivePanel(undefined);
    else {
      setRightPanel(undefined);
      searchFocusReturn.current = undefined;
    }
    restoreContentFocus();
    // The backdrop already consumed the reading-area click. Hide its chrome
    // too, unless another open surface still needs it.
    const otherPanelOpen = side === "left" ? rightPanel !== undefined : activePanel !== undefined;
    if (!otherPanelOpen && help.view === undefined && !snapshot?.narrationNoticeVisible) hideChrome();
  };
  const dismissHelpToContent = (): void => {
    help.closeToContent();
    if (activePanel === undefined && rightPanel === undefined && !snapshot?.narrationNoticeVisible) hideChrome();
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
    if (!isDetailsOpen || bookDetails !== undefined) {
      return;
    }
    let cancelled = false;
    void getBookDetails().then((details) => {
      if (!cancelled) {
        setBookDetails(details);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isDetailsOpen, bookDetails, getBookDetails]);

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
    setInspectorReader(getInspectorReaderBridge());
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
      setActivePanel(undefined);
    }
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
      setActivePanel(undefined);
    }
  };

  const handleSelectReadOnlyAnnotation = (cfi: string): void => {
    void goToReadOnlyAnnotation(cfi);
    if (!isAnnotationsPinned) {
      setActivePanel(undefined);
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
      setRightPanel(undefined);
    }
  };

  useEffect(() => {
    const bookId = new URLSearchParams(window.location.search).get("bookId");
    if (!bookId) {
      setOpenError("No book selected — open this book from the Ambra library.");
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
          setOpenError(err instanceof Error ? err.message : String(err));
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
          message={openError}
          severity="blocking"
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
        <Spinner label={t("reader.loading")} />
      </div>
    );
  }

  const pageBackground = snapshot.isFixedLayout
    ? FixedContentHost.LETTERBOX_BACKGROUND
    : ReadingTheme.PAGE_THEMES[snapshot.pageTheme].background;
  // Mirrors `ProgressScrubber`'s own identical early-return condition —
  // the flyout panels need to know this too so they can stop above the
  // scrubber bar instead of running underneath it (issue #59).
  const scrubberVisible = !snapshot.isFixedLayout && snapshot.viewMode === "paginated";
  const startNarration = (): void => {
    setIsNarrationOpen(true);
    narrationAction("start");
  };

  return (
    <ReaderDiagnosticContext.Provider value={recordDiagnosticSurfaces}>
    <ChromeThemeProvider theme={snapshot.chromeTheme}>
      <div style={{ position: "relative", height: "100vh", overflow: "hidden" }}>
        {/* The content row fills the entire viewport — the toolbar is an
              absolutely-positioned overlay (see `Toolbar`), not a normal-flow
              element pushing this row down, so it can fade in/out without
              ever changing this row's size (which would otherwise trigger a
              pointless relayout via the `ResizeObserver` below on every
              fade). */}
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          <TocPanel
            items={snapshot.toc}
            currentPath={snapshot.highlightedTocPath}
            firstSpinePath={snapshot.firstSpinePath}
            pageNumbers={snapshot.tocPageNumbers}
            open={isTocOpen}
            pinned={isTocPinned}
            onTogglePin={() => setIsActivePanelPinned((pinned) => !pinned)}
            onRequestClose={() => {
              setActivePanel(undefined);
              restoreContentFocus();
            }}
            onOutsideClick={() => dismissPanelToContent("left")}
            onSelect={(navPoint) => {
              goToNavPoint(navPoint);
              if (!isTocPinned) {
                setActivePanel(undefined);
              }
            }}
            scrubberVisible={scrubberVisible}
          />

          <AnnotationsPanel
            bookmarks={snapshot.bookmarks}
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
            pinned={isAnnotationsPinned}
            onTogglePin={() => setIsActivePanelPinned((pinned) => !pinned)}
            onRequestClose={() => {
              setActivePanel(undefined);
              restoreContentFocus();
            }}
            onOutsideClick={() => dismissPanelToContent("left")}
            scrubberVisible={scrubberVisible}
          />

          <div
            style={{ flex: 1, position: "relative", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}
            role="main"
            aria-label={t("reader.bookContentAriaLabel")}
          >
            <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            {/* This div is owned entirely by imperative code (ReaderController
                mounts the active content host's iframe into it) — it must never
                receive React-rendered children, or React's reconciliation and
                the controller's direct DOM mutations will conflict. `position:
                absolute; inset: 0` (rather than percentage width/height) sizes
                it reliably regardless of how many layers of flexbox surround
                it, which is what a real-Chromium test caught going wrong.
                Carries its own background (the active page color theme,
                rather than "inheriting" it from the `role="main"` div around
                it, since that div itself no longer paints one — see below) so
                the bottom slack under a short last page and the spread gutter
                between two columns (both of which show this div's background
                through, not the content host's own) never visually mismatch
                the page. `filter` lives here too, not on the `role="main"`
                div around it: that outer div also contains the toolbar,
                scrubber, and every other overlay panel, none of which should
                ever dim along with the book's own content and margins (issue
                #93) — scoping the `filter` to exactly this div (which a CSS
                `filter` then applies to its *entire* rendered subtree,
                including the content host's nested iframes — see
                `ReadingTheme`'s own doc comment on `MIN_BRIGHTNESS`) dims
                precisely the book's page(s) and the margins around them,
                nothing else. */}
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
            {snapshot.narrationNoticeVisible && !snapshot.isLoading && !snapshot.error &&
              activePanel === undefined && rightPanel === undefined && !isNarrationOpen && (
              <NarrationDiscoveryNotice
                onListen={startNarration}
                onDismiss={() => {
                  dismissNarrationNotice();
                  restoreContentFocus();
                }}
              />
            )}
            {snapshot.isLoading && (
              <Spinner
                label="Loading…"
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                }}
              />
            )}

            {/* Scoped to this content pane (not the TOC panel beside it) —
                the toolbar is positioned relative to *this* div so it never
                overlaps the TOC panel's own clickable area when both are
                open at once. */}
            <Toolbar
              openMenu={toolbarMenu}
              onOpenMenuChange={changeToolbarMenu}
              onListen={snapshot.narration?.available ? startNarration : undefined}
              snapshot={snapshot}
              onBackToLibrary={() => {
                window.location.href = libraryFullTabUrl();
              }}
              isTocOpen={isTocOpen}
              onToggleToc={() => {
                if (isTocOpen) {
                  restoreContentFocus();
                }
                toggleLeftPanel("toc");
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
                }
                toggleLeftPanel("annotations");
              }}
              isDetailsOpen={isDetailsOpen}
              onToggleDetails={() => {
                if (isDetailsOpen) {
                  restoreContentFocus();
                }
                toggleRightPanel("details");
              }}
              onToggleBookmark={handleToggleBookmark}
              onSetViewMode={setViewMode}
              onSetFontScale={setFontScale}
              onSetLineSpacing={setLineSpacing}
              onSetLetterSpacing={setLetterSpacing}
              onSetContentWidth={setContentWidth}
              onSetFontFamily={setFontFamily}
              onSetPageTheme={setPageTheme}
              onSetBrightness={setBrightness}
              onSetChromeTheme={setChromeTheme}
              onSetPageTurnAnimationStyle={setPageTurnAnimationStyle}
              onOpenHelp={help.openHelp}
              visible={chromeVisible}
              handlers={chromeHandlers}
            />

            <HelpAboutFlyout
              open={help.view === "about"}
              focusShortcutsOnOpen={help.focusShortcutsOnOpen}
              onRequestClose={help.close}
              onOutsideClick={dismissHelpToContent}
              onAfterClose={help.afterClose}
              backgroundSolid={CHROME_THEMES[snapshot.chromeTheme].backgroundSolid}
              accentForeground={CHROME_THEMES[snapshot.chromeTheme].accentForeground}
              onOpenKeyboardShortcuts={help.openShortcutsFromHelp}
              getReaderDiagnostics={getDiagnosticsText}
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
                setRightPanel(undefined);
                restoreContentFocus();
              }}
              onOutsideClick={() => dismissPanelToContent("right")}
              details={bookDetails}
              onOpenInspector={openInspector}
              onOpenHelp={help.openHelp}
              scrubberVisible={scrubberVisible}
              isPaginated={snapshot.viewMode === "paginated"}
              isFixedLayout={snapshot.isFixedLayout}
              bookPageCount={snapshot.bookPageCount}
              onSeekToFraction={(fraction) => {
                recordDiagnosticEvent({ kind: "navigation", source: "details", fraction });
                void seekToFraction(fraction);
              }}
            />

            <EpubInspectorPanel
              onFindReferences={findInspectionReferences}
              reader={inspectorReader}
              open={isInspectorOpen}
              onOpenChange={(open, reason) => {
                if (reason === "show-in-book") {
                  inspectionFocusReturn.current = inspectorReader?.restoreFocus ?? restoreContentFocus;
                  setRightPanel(undefined);
                }
                setIsInspectorOpen(open);
              }}
              data={inspectionData}
              fileName={bookDetails?.fileName}
              onReadFile={readInspectionFileText}
              onGetPreviewUrl={getInspectionFilePreviewUrl}
            />

            <ImageViewer image={snapshot.imageViewer} onRequestClose={closeImageViewer} />

            <SelectionToolbar
              state={snapshot.selectionToolbar}
              onPick={handleAddHighlight}
              onAddNote={handleAddHighlightWithNote}
            />

            <HighlightActionPopup
              state={snapshot.activeHighlight}
              onSetNote={setHighlightNote}
              onSetStyle={(id, style) => void setHighlightStyle(id, style)}
              onRemove={(id) => void removeHighlight(id)}
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
              visible={chromeVisible}
              handlers={chromeHandlers}
              onPreview={previewSeek}
              onSeek={async (fraction) => {
                recordDiagnosticEvent({ kind: "navigation", source: "scrubber", fraction });
                setSeekError(undefined);
                await seekToFraction(fraction);
              }}
              onSeekError={(error) => setSeekError(error instanceof Error ? error.message : String(error))}
            />

            {(seekError || (snapshot.error && snapshot.errorSeverity)) && (
              <FriendlyError
                message={seekError ?? snapshot.error!}
                notificationId={snapshot.errorNotificationId}
                detail={seekError ? undefined : snapshot.errorDetail}
                severity={seekError ? "transient" : snapshot.errorSeverity!}
                onDismiss={() => { setSeekError(undefined); dismissError(); }}
                getDiagnosticsText={getDiagnosticsText}
              />
            )}
            </div>
            {isNarrationOpen && snapshot.narration?.available && (
              <NarrationControls
                hasSelection={snapshot.hasReadingSelection === true}
                state={snapshot.narration}
                focusOnOpen
                onPlayPause={() => narrationAction("toggle")}
                onPrevious={() => narrationAction("previous")}
                onNext={() => narrationAction("next")}
                onReturnToNarration={() => narrationAction("return")}
                onListenFromHere={() => narrationAction("here")}
                onRateChange={setNarrationRate}
                onClose={() => {
                  narrationAction("close");
                  setIsNarrationOpen(false);
                  restoreContentFocus();
                }}
              />
            )}
          </div>

          <SearchPanel
            query={snapshot.searchQuery}
            results={snapshot.searchResults}
            isSearching={snapshot.isSearching}
            onSearch={search}
            onSelect={handleSelectSearchResult}
            open={isSearchOpen}
            pinned={isSearchPinned}
            onTogglePin={() => setIsSearchPinnedToggle((pinned) => !pinned)}
            onRequestClose={closeSearch}
            onOutsideClick={() => dismissPanelToContent("right")}
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
