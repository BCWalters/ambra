import { useId, useLayoutEffect, useRef, useState, type FC, type RefObject } from "react";
import { Body1, Title2, makeStyles, mergeClasses } from "@fluentui/react-components";
import { DocumentAddRegular, CompassNorthwestRegular } from "@fluentui/react-icons";
import { LibraryEmptyIllustration } from "./LibraryEmptyIllustration.js";
import { LibraryDiscovery } from "./LibraryDiscovery.js";
import { useTranslation } from "../i18n/LocaleContext.js";

export interface LibraryEmptyStateProps {
  accent: string;
  canImport: boolean;
  onImport: () => void;
  compact?: boolean;
  focusFallbackRef?: RefObject<HTMLButtonElement | null>;
  importButtonRef?: RefObject<HTMLButtonElement | null>;
}

const useStyles = makeStyles({
  choices: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
    gap: "16px",
    width: "100%",
    marginTop: "20px",
  },
  choice: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "8px",
    padding: "20px",
    minWidth: 0,
    border: "1px solid var(--colorNeutralStroke1, #d1d1d1)",
    borderRadius: "12px",
    backgroundColor: "var(--colorNeutralBackground1, #fff)",
    color: "var(--colorNeutralForeground1, #242424)",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    ":hover:not(:disabled)": {
      border: "1px solid #a56a2a",
      backgroundColor: "rgba(165, 106, 42, 0.08)",
    },
    ":focus-visible": {
      outline: "3px solid #a56a2a",
      outlineOffset: "3px",
    },
    ":disabled": {
      color: "var(--colorNeutralForegroundDisabled, #767676)",
      cursor: "not-allowed",
    },
    "@media (forced-colors: active)": {
      ":focus-visible": { outlineColor: "Highlight" },
      ":disabled": { color: "GrayText" },
    },
  },
  eyebrow: { fontSize: "11px", lineHeight: "16px", letterSpacing: "0.08em", fontWeight: 600 },
  title: { fontSize: "20px", lineHeight: "26px", fontWeight: 600 },
  description: { fontSize: "14px", lineHeight: "20px" },
  action: { marginTop: "auto", paddingTop: "12px", fontWeight: 600 },
  compactChoice: {
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr)",
    columnGap: "12px",
    rowGap: "4px",
    padding: "12px",
    "& > svg": { gridColumn: "1", gridRow: "1 / span 3", fontSize: "24px" },
    "& > span": { gridColumn: "2" },
  },
});

/** Two equally weighted entry points, only for a loaded, genuinely empty library. */
export const LibraryEmptyState: FC<LibraryEmptyStateProps> = ({ accent, canImport, onImport, compact = false, focusFallbackRef, importButtonRef }) => {
  const t = useTranslation();
  const styles = useStyles();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    return () => {
      if (!root?.contains(document.activeElement)) return;
      // Wait for the replacement toolbar to mount; never override focus that
      // moved elsewhere, or a StrictMode cleanup that did not remove the node.
      queueMicrotask(() => {
        if (!root.isConnected && document.activeElement === document.body) {
          focusFallbackRef?.current?.focus();
        }
      });
    };
  }, [focusFallbackRef]);
  return (
  <div
    ref={rootRef}
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
      maxWidth: 720,
      margin: compact ? "0 auto" : "12px auto 0",
      gap: 4,
    }}
  >
    <LibraryEmptyIllustration size={compact ? 56 : 104} />
    <Title2 as="h2" style={{ color: accent, margin: "8px 0 0",
      fontSize: compact ? 20 : undefined, lineHeight: compact ? "28px" : undefined }}>
      {t("library.emptyTitle")}
    </Title2>
    <Body1 as="p" style={{ margin: "4px 0 0", color: "var(--colorNeutralForeground2, #333)" }}>
      {t("library.emptyDescription")}
    </Body1>
    <div className={styles.choices} style={compact ? { marginTop: 12, gap: 12 } : undefined}>
      <button ref={importButtonRef} type="button" className={mergeClasses(styles.choice, compact && styles.compactChoice)} disabled={!canImport} onClick={onImport}
        aria-labelledby={`${id}-import-title ${id}-import-action`} aria-describedby={`${id}-import-description`}>
        <DocumentAddRegular fontSize={28} aria-hidden="true" />
        <span className={styles.eyebrow} style={compact ? { display: "none" } : undefined}>{t("library.fromDevice")}</span>
        <span id={`${id}-import-title`} className={styles.title} style={compact ? { fontSize: 18, lineHeight: "24px" } : undefined}>{t("library.bringBook")}</span>
        <span id={`${id}-import-description`} className={styles.description}>{t("library.bringBookDescription")}</span>
        <span id={`${id}-import-action`} className={styles.action} style={compact ? { paddingTop: 4 } : undefined}>{t("library.chooseEpubFiles")}</span>
      </button>
      <button type="button" className={mergeClasses(styles.choice, compact && styles.compactChoice)} aria-expanded={expanded} aria-controls={`${id}-discovery`}
        aria-labelledby={`${id}-discover-title ${id}-discover-action`} aria-describedby={`${id}-discover-description`}
        onClick={() => setExpanded(!expanded)}>
        <CompassNorthwestRegular fontSize={28} aria-hidden="true" />
        <span className={styles.eyebrow} style={compact ? { display: "none" } : undefined}>{t("library.onWeb")}</span>
        <span id={`${id}-discover-title`} className={styles.title} style={compact ? { fontSize: 18, lineHeight: "24px" } : undefined}>{t("library.findNextBook")}</span>
        <span id={`${id}-discover-description`} className={styles.description}>{t("library.findNextBookDescription")}</span>
        <span id={`${id}-discover-action`} className={styles.action} style={compact ? { paddingTop: 4 } : undefined}>{t("library.exploreBooks")}</span>
      </button>
    </div>
    <div style={{ width: "100%", marginTop: expanded ? 20 : 0 }}>
      <LibraryDiscovery expanded={expanded} panelId={`${id}-discovery`} importLabel={t("library.chooseEpubFiles")} />
    </div>
  </div>
  );
};
