import { useEffect, useState } from "react";
import type { FC } from "react";
import { Body1, Spinner, Title2 } from "@fluentui/react-components";
import { ReadingTheme } from "@ambra/engine";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { LiveRegion } from "./components/LiveRegion.js";
import { Toolbar } from "./components/Toolbar.js";
import { TocPanel } from "./components/TocPanel.js";
import { BookDetailsPanel } from "./components/BookDetailsPanel.js";
import { ImageViewer } from "./components/ImageViewer.js";
import { PageFurniture } from "./components/PageFurniture.js";
import { ProgressScrubber } from "./components/ProgressScrubber.js";
import { useReaderController } from "./useReaderController.js";
import { useAutoHideChrome } from "./useAutoHideChrome.js";
import { ChromeThemeProvider } from "./ChromeThemeContext.js";
import type { BookDetails } from "./ReaderController.js";

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
export const ReaderApp: FC = () => {
  const {
    snapshot,
    contentHostRef,
    openBook,
    turnPage,
    goToChapter,
    goToNavPoint,
    setViewMode,
    setFontScale,
    setFontFamily,
    setPageTheme,
    setChromeTheme,
    previewSeek,
    seekToFraction,
    getBookDetails,
    closeImageViewer,
  } = useReaderController();
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isTocPinned, setIsTocPinned] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [bookDetails, setBookDetails] = useState<BookDetails | undefined>(undefined);
  const [openError, setOpenError] = useState<string | null>(null);
  // Shared between the toolbar and the progress scrubber (see
  // `useAutoHideChrome`'s doc comment) so both fade in/out together as
  // one unit of chrome, rather than each keeping its own independent
  // (and potentially out-of-sync) visibility state. Kept visible
  // whenever either flyout panel (TOC or Book Details) is open, the
  // same way `isTocOpen` alone did before — both are "pinned" reasons
  // to keep the chrome from auto-hiding out from under an open panel.
  const { visible: chromeVisible, handlers: chromeHandlers } = useAutoHideChrome(
    isTocOpen || isDetailsOpen,
    snapshot?.contentPointerActivityId,
  );

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
      <div style={{ padding: 24 }}>
        <Title2>Ambra Reader</Title2>
        <Body1 as="p" style={{ color: "var(--colorPaletteRedForeground1, crimson)" }}>
          {openError}
        </Body1>
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
            onRequestClose={() => setIsTocOpen(false)}
            onSelect={(navPoint) => {
              goToNavPoint(navPoint);
              if (!isTocPinned) {
                setIsTocOpen(false);
              }
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
              }}
            />
            <PageFurniture snapshot={snapshot} />
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
              onToggleToc={() => setIsTocOpen((open) => !open)}
              isDetailsOpen={isDetailsOpen}
              onToggleDetails={() => setIsDetailsOpen((open) => !open)}
              onTurnPage={turnPage}
              onGoToChapter={goToChapter}
              onSetViewMode={setViewMode}
              onSetFontScale={setFontScale}
              onSetFontFamily={setFontFamily}
              onSetPageTheme={setPageTheme}
              onSetChromeTheme={setChromeTheme}
              visible={chromeVisible}
              handlers={chromeHandlers}
            />

            <BookDetailsPanel
              open={isDetailsOpen}
              onRequestClose={() => setIsDetailsOpen(false)}
              details={bookDetails}
            />

            <ImageViewer image={snapshot.imageViewer} onRequestClose={closeImageViewer} />

            <ProgressScrubber
              snapshot={snapshot}
              visible={chromeVisible}
              handlers={chromeHandlers}
              onPreview={previewSeek}
              onSeek={seekToFraction}
            />

            {snapshot.error && (
              <Body1
                as="p"
                style={{
                  position: "absolute",
                  top: 64,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 20,
                  margin: 0,
                  padding: "6px 14px",
                  borderRadius: 6,
                  background: "var(--colorPaletteRedBackground3, #fde7e9)",
                  color: "var(--colorPaletteRedForeground1, crimson)",
                }}
              >
                Error: {snapshot.error}
              </Body1>
            )}
          </div>
        </div>

        <LiveRegion text={snapshot.announcement} announcementId={snapshot.announcementId} />
      </div>
    </ChromeThemeProvider>
  );
};
