import { useEffect, useRef, useState, type FC } from "react";
import { Button } from "@fluentui/react-components";
import { DocumentAddRegular } from "@fluentui/react-icons";
import { useTranslation } from "../i18n/LocaleContext.js";
import { closeLibraryImportWindow, finishLibraryImport, libraryFullTabUrl, readerTabUrl } from "../navigation.js";
import { useChromeTheme } from "../reader/ChromeThemeContext.js";
import { AmbraMarkIcon } from "../reader/components/AmbraMarkIcon.js";
import { LibraryFileDropOverlay } from "./LibraryFileDropOverlay.js";
import { LibraryImportError } from "./LibraryImportError.js";
import { LibraryImportIllustration } from "./LibraryImportIllustration.js";
import { LibraryImportStatus } from "./LibraryImportStatus.js";
import { useLibraryFileDrop } from "./useLibraryFileDrop.js";
import type { UseLibraryResult } from "./useLibrary.js";

export const LibraryImportWindow: FC<{ library: UseLibraryResult }> = ({ library }) => {
  const t = useTranslation();
  const palette = useChromeTheme();
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const initialFocus = useRef(true);
  const [windowError, setWindowError] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const busy = library.importActivities.some(activity => activity.phase !== "complete");
  const canChoose = library.canImport && !busy && !leaving;
  const { dropTargetRef, isDraggingFiles } = useLibraryFileDrop({
    enabled: true, canImport: canChoose, busy: busy || leaving, importFiles: library.importFiles,
  });
  useEffect(() => { document.title = `${t("library.importEpub")} - Ambra`; }, [t]);
  useEffect(() => {
    if (!canChoose || !initialFocus.current) return;
    initialFocus.current = false;
    choose.current?.focus();
  }, [canChoose]);
  const leave = async (destination?: string) => {
    if (busy || leaving) return;
    setLeaving(true);
    setWindowError(undefined);
    try {
      if (destination) await finishLibraryImport(destination);
      else await closeLibraryImportWindow();
    } catch (cause) {
      setWindowError(cause instanceof Error ? cause.message : String(cause));
    } finally { setLeaving(false); }
  };
  return <main ref={dropTargetRef} data-library-import-window="" aria-label={t("library.importEpub")}
    style={{ boxSizing: "border-box", minHeight: "100dvh", padding: 24, display: "flex", flexDirection: "column",
      gap: 20, color: palette.text, background: palette.backgroundSolid }}>
    <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <AmbraMarkIcon />
      <h1 style={{ margin: 0, fontSize: 22, lineHeight: "28px", fontWeight: 600 }}>{t("library.importEpub")}</h1>
    </header>
    <div style={{ border: `1px dashed ${palette.border}`, borderRadius: 8, padding: 20, textAlign: "center" }}>
      {!library.importActivities.length && <LibraryImportIllustration busy={false} />}
      <p style={{ margin: "0 0 16px" }}>{t("library.importWindowHint")}</p>
      <Button ref={choose} appearance={library.importActivities.length ? "secondary" : "primary"}
        icon={<DocumentAddRegular />} disabled={!canChoose}
        style={{ maxWidth: "100%", whiteSpace: "normal" }} onClick={() => input.current?.click()}>
        {t("library.chooseEpubFiles")}
      </Button>
      <p style={{ margin: "12px 0 0", color: "var(--colorNeutralForeground2)" }}>{t("library.importWindowDrop")}</p>
      <input ref={input} type="file" accept=".epub" multiple disabled={!canChoose} style={{ display: "none" }}
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) void library.importFiles(files);
        }} />
    </div>
    {windowError && <LibraryImportError message={windowError} onDismiss={() => setWindowError(undefined)} />}
    {library.error && <LibraryImportError message={library.error}
      {...(library.errorHeadline ? { headline: library.errorHeadline } : {})} onDismiss={library.dismissError} />}
    <LibraryImportStatus activities={library.importActivities} books={library.books}
      onOpenBook={id => { void leave(readerTabUrl(id)); }} onDismissCompleted={library.dismissCompletedImports}
      onCancelDownload={library.cancelDownload} isBookOpenDisabled={() => busy || leaving} focusFallbackRef={choose} />
    <footer style={{ marginTop: "auto", display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
      <Button disabled={busy || leaving} onClick={() => { void leave(libraryFullTabUrl()); }}>{t("library.openLibrary")}</Button>
      <Button disabled={busy || leaving} onClick={() => { void leave(); }}>{t("highlight.close")}</Button>
    </footer>
    <LibraryFileDropOverlay active={isDraggingFiles} />
  </main>;
};
