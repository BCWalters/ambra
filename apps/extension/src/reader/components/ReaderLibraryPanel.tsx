import { useEffect, useRef, type FC } from "react";
import { Button } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { LibraryApp } from "../../library/LibraryApp.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { CHROME_TOOLBAR_HEIGHT } from "../../components/ChromeToolbarStyles.js";
import { CHROME_SHADOW, SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useFocusOnOpen } from "../useFocusOnOpen.js";

export interface ReaderLibraryPanelProps {
  open: boolean;
  onRequestClose: () => void;
  onOutsideClick?: (() => void) | undefined;
  /** The reader owns saving, same-tab activation and closing this panel after activation. */
  onActivateBook: (bookId: string) => void;
  scrubberVisible: boolean;
  /** Prevent deletion beneath the active reading session; other books retain removal. */
  currentBookId?: string | undefined;
}

/** Keep mounted even when closed: the embedded library owns ongoing imports and its draft query. */
export const ReaderLibraryPanel: FC<ReaderLibraryPanelProps> = ({
  open, onRequestClose, onOutsideClick, onActivateBook, scrubberVisible, currentBookId,
}) => {
  const t = useTranslation();
  const palette = useChromeTheme();
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusOnOpen(closeRef, open);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.repeat ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onRequestClose();
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open, onRequestClose]);

  return (
    <>
      <div data-ambra-library-backdrop aria-hidden="true" hidden={!open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          (onOutsideClick ?? onRequestClose)();
        }}
        style={{ display: open ? "block" : "none", position: "absolute", inset: 0, zIndex: 7,
          background: "rgba(15, 23, 42, 0.18)" }} />
      <nav data-ambra-library-panel aria-label={t("toolbar.backToLibrary")} hidden={!open} inert={!open}
        style={{ position: "absolute", top: CHROME_TOOLBAR_HEIGHT,
          bottom: `calc(${scrubberVisible ? SCRUBBER_HEIGHT : 8}px + var(--ambra-narration-height, 0px))`,
          left: 0, zIndex: 8, width: 360, maxWidth: "100%", minWidth: 0, minHeight: 0,
          display: open ? "flex" : "none", flexDirection: "column", overflow: "hidden",
          boxSizing: "border-box", background: palette.surface, color: palette.text,
          borderRight: `1px solid ${palette.border}`, boxShadow: CHROME_SHADOW }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          flexShrink: 0, borderBottom: `1px solid ${palette.border}` }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 16, lineHeight: "24px", overflowWrap: "anywhere" }}>
            {t("toolbar.backToLibrary")}
          </h2>
          <Button ref={closeRef} appearance="subtle" icon={<DismissRegular />} aria-label={t("highlight.close")} onClick={onRequestClose} />
        </header>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          <LibraryApp embedded={{ open, onActivateBook, currentBookId }} />
        </div>
      </nav>
    </>
  );
};
