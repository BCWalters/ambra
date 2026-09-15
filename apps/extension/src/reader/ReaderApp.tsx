import { useState } from "react";
import type { ChangeEvent, FC } from "react";
import { Body1, Spinner, Title2 } from "@fluentui/react-components";
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
 * Loading is still a plain file picker for now — `library-storage`
 * (IndexedDB import/library UI) will replace this with a real library,
 * but the reading surface itself doesn't depend on how the book file was
 * obtained.
 */
export const ReaderApp: FC = () => {
  const { snapshot, contentHostRef, openFile, turnPage, goToChapter, goToNavPoint, setViewMode } =
    useReaderController();
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setOpenError(null);
    void openFile(file).catch((err: unknown) => {
      setOpenError(err instanceof Error ? err.message : String(err));
    });
  };

  if (!snapshot) {
    return (
      <div style={{ padding: 24 }}>
        <Title2>Pagina Reader</Title2>
        <Body1 as="p">Pick an .epub file to start reading.</Body1>
        <input type="file" accept=".epub" onChange={handleFileChange} />
        {openError && (
          <Body1 as="p" style={{ color: "var(--colorPaletteRedForeground1, crimson)" }}>
            Error: {openError}
          </Body1>
        )}
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
