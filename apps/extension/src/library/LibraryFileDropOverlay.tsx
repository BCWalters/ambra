import type { FC } from "react";
import { DocumentAddRegular } from "@fluentui/react-icons";
import { useTranslation } from "../i18n/LocaleContext.js";
import { useChromeTheme } from "../reader/ChromeThemeContext.js";
import { CHROME_SHADOW } from "../reader/chromeTheme.js";

export const LibraryFileDropOverlay: FC<{ active: boolean }> = ({ active }) => {
  const t = useTranslation();
  const palette = useChromeTheme();
  if (!active) return null;
  return (
    <div data-library-file-drop="" role="status" aria-live="polite" aria-atomic="true"
      style={{
        position: "fixed", inset: 12, zIndex: 1000, pointerEvents: "none",
        border: `2px dashed ${palette.accentForeground}`, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", margin: 12,
        maxWidth: 420, minWidth: 0, borderRadius: 8, border: `1px solid ${palette.accentForeground}`,
        background: palette.surface, color: palette.text, boxShadow: CHROME_SHADOW,
      }}>
        <DocumentAddRegular aria-hidden="true" style={{ fontSize: 28, flexShrink: 0, color: palette.accentForeground }} />
        <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{t("library.dropFilesTitle")}</p>
          <p style={{ margin: "4px 0 0", fontSize: 13 }}>{t("library.dropFilesHint")}</p>
        </div>
      </div>
    </div>
  );
};
