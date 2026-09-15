import { useEffect, useState } from "react";
import type { FC } from "react";
import { Body1, Spinner, Title2 } from "@fluentui/react-components";
import { LibraryDatabase } from "../library/LibraryDatabase.js";
import { Toolbar } from "./components/Toolbar.js";
import { TocPanel } from "./components/TocPanel.js";
import { useReaderController } from "./useReaderController.js";

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
  const { snapshot, contentHostRef, openBook, turnPage, goToChapter, goToNavPoint, setViewMode } =
    useReaderController();
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    const bookId = new URLSearchParams(window.location.search).get("bookId");
    if (!bookId) {
      setOpenError("No book selected — open this book from the Pagina library.");
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
          throw new Error("This book could not be found in your library — it may have been removed.");
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
        <Title2>Pagina Reader</Title2>
        <Body1 as="p" style={{ color: "var(--colorPaletteRedForeground1, crimson)" }}>
          {openError}
        </Body1>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div style={{ padding: 24 }}>
        <Title2>Pagina Reader</Title2>
        <Spinner label="Loading…" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Toolbar
        snapshot={snapshot}
        onToggleToc={() => setIsTocOpen((open) => !open)}
        onTurnPage={turnPage}
        onGoToChapter={goToChapter}
        onSetViewMode={setViewMode}
      />

      {snapshot.error && (
        <Body1 as="p" style={{ color: "var(--colorPaletteRedForeground1, crimson)", padding: "4px 12px" }}>
          Error: {snapshot.error}
        </Body1>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {isTocOpen && (
          <TocPanel
            items={snapshot.toc}
            onSelect={(navPoint) => {
              goToNavPoint(navPoint);
              setIsTocOpen(false);
            }}
          />
        )}

        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {/* This div is owned entirely by imperative code (ReaderController
              mounts the active content host's iframe into it) — it must never
              receive React-rendered children, or React's reconciliation and
              the controller's direct DOM mutations will conflict. `position:
              absolute; inset: 0` (rather than percentage width/height) sizes
              it reliably regardless of how many layers of flexbox surround
              it, which is what a real-Chromium test caught going wrong. */}
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
          {snapshot.isLoading && (
            <Spinner
              label="Loading…"
              style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
