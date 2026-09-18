import { useEffect, useState } from "react";
import type { FC } from "react";
import { Spinner, Title2 } from "@fluentui/react-components";
import { ReadingTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { LiveRegion } from "./components/LiveRegion.js";
import { Toolbar } from "./components/Toolbar.js";
import { TocPanel } from "./components/TocPanel.js";
import { SearchPanel } from "./components/SearchPanel.js";
import { AnnotationsPanel } from "./components/AnnotationsPanel.js";
import { BookDetailsPanel } from "./components/BookDetailsPanel.js";
import { EpubInspectorPanel } from "./components/EpubInspectorPanel.js";
import { ImageViewer } from "./components/ImageViewer.js";
import { SelectionToolbar } from "./components/SelectionToolbar.js";
import { HighlightActionPopup } from "./components/HighlightActionPopup.js";
import { FriendlyError } from "./components/FriendlyError.js";
import { PageFurniture } from "./components/PageFurniture.js";
import { ProgressScrubber } from "./components/ProgressScrubber.js";
import { useReaderController } from "./useReaderController.js";
import { useAutoHideChrome } from "./useAutoHideChrome.js";
import { ChromeThemeProvider } from "./ChromeThemeContext.js";
import { LocaleProvider } from "../i18n/LocaleContext.js";
import type { BookDetails, EpubInspectionData } from "./ReaderController.js";
import type { Bookmark } from "../library/LibraryDatabase.js";

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
    <ReaderAppInner />
  </LocaleProvider>
);

const ReaderAppInner: FC = () => {
  const {
    snapshot,
    contentHostRef,
    openBook,
    turnPage,
    goToChapter,
    goToNavPoint,
    setViewMode,
    setFontScale,
    setLineSpacing,
    setLetterSpacing,
    setContentWidth,
    setFontFamily,
    setPageTheme,
    setChromeTheme,
    setPageTurnAnimationStyle,
    previewSeek,
    seekToFraction,
    getBookDetails,
    getEpubInspectionData,
    readInspectionFileText,
    getInspectionFilePreviewUrl,
    closeImageViewer,
    restoreContentFocus,
    getDiagnosticsText,
    toggleBookmark,
    listBookmarks,
    removeBookmark,
    goToBookmark,
    addHighlight,
    removeHighlight,
    goToHighlight,
    setHighlightNote,
    dismissActiveHighlight,
    search,
    goToSearchResult,
    dismissError,
  } = useReaderController();
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isTocPinned, setIsTocPinned] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearchPinned, setIsSearchPinned] = useState(false);
  const [isAnnotationsOpen, setIsAnnotationsOpen] = useState(false);
  const [isAnnotationsPinned, setIsAnnotationsPinned] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [bookDetails, setBookDetails] = useState<BookDetails | undefined>(undefined);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [inspectionData, setInspectionData] = useState<EpubInspectionData | undefined>(undefined);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  // Shared between the toolbar and the progress scrubber (see
  // `useAutoHideChrome`'s doc comment) so both fade in/out together as
  // one unit of chrome, rather than each keeping its own independent
  // (and potentially out-of-sync) visibility state. Kept visible
  // whenever any flyout panel (TOC, Search, Bookmarks/Highlights, or
  // Book Details) is open — all four are "pinned" reasons to keep the
  // chrome from auto-hiding out from under an open panel.
  const { visible: chromeVisible, handlers: chromeHandlers } = useAutoHideChrome(
    isTocOpen || isSearchOpen || isAnnotationsOpen || isDetailsOpen,
    snapshot?.contentPointerActivityId,
  );

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

  // Re-fetches every time the Bookmarks/Highlights panel opens (unlike
  // book details above, which only ever needs fetching once per book) —
  // bookmarks change far more often, via the toolbar's "Bookmark this
  // page" button, so a stale list from an earlier open would routinely
  // miss ones just added.
  useEffect(() => {
    if (!isAnnotationsOpen) {
      return;
    }
    let cancelled = false;
    void listBookmarks().then((list) => {
      if (!cancelled) {
        setBookmarks(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAnnotationsOpen, listBookmarks]);

  const handleToggleBookmark = (): void => {
    // Re-fetches the full list afterward rather than patching local state
    // in place — unlike a plain add (always exactly one new entry),
    // `toggleBookmark` can *remove* an arbitrary number of entries (every
    // bookmark on the current page), so there's no single "diff" to
    // apply locally that's simpler than just asking for the current
    // truth again. Keeps the Bookmarks panel's list correct even if it's
    // already open when this fires, not just the next time it opens.
    void toggleBookmark()
      .then(() => listBookmarks())
      .then(setBookmarks);
  };

  const handleRemoveBookmark = (id: string): void => {
    setBookmarks((current) => current.filter((bookmark) => bookmark.id !== id));
    void removeBookmark(id);
  };

  const handleSelectBookmark = (cfi: string): void => {
    void goToBookmark(cfi);
    if (!isAnnotationsPinned) {
      setIsAnnotationsOpen(false);
    }
  };

  const handleAddHighlight = (style: HighlightStyle): void => {
    void addHighlight(style);
  };

  const handleRemoveHighlight = (id: string): void => {
    void removeHighlight(id);
  };

  const handleSetHighlightNote = (id: string, note: string | undefined): void => {
    void setHighlightNote(id, note);
  };

  const handleSelectHighlight = (cfi: string): void => {
    void goToHighlight(cfi);
    if (!isAnnotationsPinned) {
      setIsAnnotationsOpen(false);
    }
  };

  const handleSelectSearchResult = (cfi: string): void => {
    void goToSearchResult(cfi);
    if (!isSearchPinned) {
      setIsSearchOpen(false);
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
      const library = await LibraryDatabase.open();
      try {
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
        library.close();
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
        <Spinner label="Loading…" />
      </div>
    );
  }

  const pageBackground = snapshot.isFixedLayout
    ? "#e5e5e5"
    : ReadingTheme.PAGE_THEMES[snapshot.pageTheme].background;

  return (
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
            onTogglePin={() => setIsTocPinned((pinned) => !pinned)}
            onRequestClose={() => {
              setIsTocOpen(false);
              restoreContentFocus();
            }}
            onSelect={(navPoint) => {
              goToNavPoint(navPoint);
              if (!isTocPinned) {
                setIsTocOpen(false);
              }
            }}
          />

          <SearchPanel
            query={snapshot.searchQuery}
            results={snapshot.searchResults}
            isSearching={snapshot.isSearching}
            onSearch={search}
            onSelect={handleSelectSearchResult}
            open={isSearchOpen}
            pinned={isSearchPinned}
            onTogglePin={() => setIsSearchPinned((pinned) => !pinned)}
            onRequestClose={() => {
              setIsSearchOpen(false);
              restoreContentFocus();
            }}
          />

          <AnnotationsPanel
            bookmarks={bookmarks}
            onSelectBookmark={handleSelectBookmark}
            onRemoveBookmark={handleRemoveBookmark}
            highlights={snapshot.highlights}
            onSelectHighlight={handleSelectHighlight}
            onRemoveHighlight={handleRemoveHighlight}
            onSetHighlightNote={handleSetHighlightNote}
            open={isAnnotationsOpen}
            pinned={isAnnotationsPinned}
            onTogglePin={() => setIsAnnotationsPinned((pinned) => !pinned)}
            onRequestClose={() => {
              setIsAnnotationsOpen(false);
              restoreContentFocus();
            }}
          />

          <div
            style={{ flex: 1, position: "relative", minHeight: 0, background: pageBackground }}
            role="main"
            aria-label="Book content"
          >
            {/* This div is owned entirely by imperative code (ReaderController
                mounts the active content host's iframe into it) — it must never
                receive React-rendered children, or React's reconciliation and
                the controller's direct DOM mutations will conflict. `position:
                absolute; inset: 0` (rather than percentage width/height) sizes
                it reliably regardless of how many layers of flexbox surround
                it, which is what a real-Chromium test caught going wrong.
                Deliberately no background of its own — it inherits the
                surrounding `role="main"` div's background (kept in sync with
                the active page color theme above), so the bottom slack under
                a short last page and the spread gutter between two columns
                (both of which show this div's background through, not the
                content host's own) never visually mismatch the page. */}
            <div
              ref={contentHostRef}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                justifyContent: "center",
                alignItems: "flex-start",
                overflow: "hidden",
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
              snapshot={snapshot}
              isTocOpen={isTocOpen}
              onToggleToc={() => {
                if (isTocOpen) {
                  restoreContentFocus();
                }
                setIsTocOpen((open) => !open);
              }}
              isSearchOpen={isSearchOpen}
              onToggleSearch={() => {
                if (isSearchOpen) {
                  restoreContentFocus();
                }
                setIsSearchOpen((open) => !open);
              }}
              isAnnotationsOpen={isAnnotationsOpen}
              onToggleAnnotations={() => {
                if (isAnnotationsOpen) {
                  restoreContentFocus();
                }
                setIsAnnotationsOpen((open) => !open);
              }}
              isDetailsOpen={isDetailsOpen}
              onToggleDetails={() => {
                if (isDetailsOpen) {
                  restoreContentFocus();
                }
                setIsDetailsOpen((open) => !open);
              }}
              onTurnPage={turnPage}
              onGoToChapter={goToChapter}
              onSeekToFraction={(fraction) => void seekToFraction(fraction)}
              onToggleBookmark={handleToggleBookmark}
              onSetViewMode={setViewMode}
              onSetFontScale={setFontScale}
              onSetLineSpacing={setLineSpacing}
              onSetLetterSpacing={setLetterSpacing}
              onSetContentWidth={setContentWidth}
              onSetFontFamily={setFontFamily}
              onSetPageTheme={setPageTheme}
              onSetChromeTheme={setChromeTheme}
              onSetPageTurnAnimationStyle={setPageTurnAnimationStyle}
              visible={chromeVisible}
              handlers={chromeHandlers}
            />

            <BookDetailsPanel
              open={isDetailsOpen}
              onRequestClose={() => {
                setIsDetailsOpen(false);
                restoreContentFocus();
              }}
              details={bookDetails}
              onOpenInspector={() => setIsInspectorOpen(true)}
            />

            <EpubInspectorPanel
              open={isInspectorOpen}
              onOpenChange={setIsInspectorOpen}
              data={inspectionData}
              fileName={bookDetails?.fileName}
              onReadFile={readInspectionFileText}
              onGetPreviewUrl={getInspectionFilePreviewUrl}
            />

            <ImageViewer image={snapshot.imageViewer} onRequestClose={closeImageViewer} />

            <SelectionToolbar state={snapshot.selectionToolbar} onPick={handleAddHighlight} />

            <HighlightActionPopup
              state={snapshot.activeHighlight}
              onSetNote={(id, note) => void setHighlightNote(id, note)}
              onRemove={(id) => void removeHighlight(id)}
              onDismiss={dismissActiveHighlight}
            />

            <ProgressScrubber
              snapshot={snapshot}
              visible={chromeVisible}
              handlers={chromeHandlers}
              onPreview={previewSeek}
              onSeek={seekToFraction}
            />

            {snapshot.error && snapshot.errorSeverity && (
              <FriendlyError
                message={snapshot.error}
                severity={snapshot.errorSeverity}
                onDismiss={dismissError}
                getDiagnosticsText={getDiagnosticsText}
              />
            )}
          </div>
        </div>

        <LiveRegion text={snapshot.announcement} announcementId={snapshot.announcementId} />
      </div>
    </ChromeThemeProvider>
  );
};
