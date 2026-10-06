import { useEffect, useState, type FC, type KeyboardEvent } from "react";
import { Button, Tooltip, makeStyles, mergeClasses, useRestoreFocusTarget } from "@fluentui/react-components";
import { ArrowRightRegular, BookInformationRegular } from "@fluentui/react-icons";
import type { LibraryBookViewModel } from "./useLibrary.js";
import { useLocale, useTranslation } from "../i18n/LocaleContext.js";
import { formatLibraryProgress } from "./LibraryFormatting.js";
import { EPUB_TOOLTIP_STYLE } from "../components/EpubTextStyles.js";
import { metadataTextContext } from "@ambra/engine";
import { metadataTextAttributes } from "../MetadataText.js";

const GENERATED_COVER_COLORS = ["#40564e", "#55516b", "#69494b", "#40566b", "#735a35"] as const;

export function generatedCoverColor(title: string): string {
  let hash = 2166136261;
  const name = title.normalize("NFC").trim();
  for (let index = 0; index < name.length; index++) {
    hash = Math.imul(hash ^ name.charCodeAt(index), 16777619) >>> 0;
  }
  return GENERATED_COVER_COLORS[hash % GENERATED_COVER_COLORS.length]!;
}

const useStyles = makeStyles({
  continueCard: {
    padding: "24px",
    gap: "24px",
    borderRadius: "8px",
    boxSizing: "border-box",
    backgroundColor: "color-mix(in srgb, var(--colorBrandBackground2) 45%, var(--colorNeutralBackground1))",
    "@media (max-width: 600px)": { padding: "16px", gap: "16px" },
  },
  continueActions: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    maxWidth: "100%",
    flexShrink: 0,
    "@media (max-width: 600px)": { width: "100%" },
  },
  continueTitle: {
    fontSize: "21px",
    "@media (max-width: 600px)": { fontSize: "18px" },
  },
  generatedCover: {
    position: "relative",
    display: "flex",
    height: "100%",
    boxSizing: "border-box",
    flexDirection: "column",
    justifyContent: "space-between",
    textAlign: "left",
    boxShadow: "inset 4px 0 rgba(0, 0, 0, 0.12)",
    "::after": {
      content: '""',
      position: "absolute",
      inset: "8px",
      border: "1px solid rgba(255, 248, 233, 0.3)",
      pointerEvents: "none",
    },
  },
  compactCover: {
    "::after": { inset: "4px" },
  },
  open: {
    cursor: "pointer",
    border: "1px solid var(--colorNeutralStroke2)",
    borderRadius: "3px 7px 7px 3px",
    padding: 0,
    overflow: "hidden",
    backgroundColor: "var(--colorNeutralBackground2)",
    color: "var(--colorNeutralForeground1)",
    font: "inherit",
    ":hover": { border: "1px solid var(--colorBrandStroke1)" },
    ":active:not(:disabled)": { filter: "brightness(0.88)" },
    ":disabled": { cursor: "default", opacity: 0.55 },
    ":focus-visible": { outline: "3px solid var(--colorStrokeFocus2)", outlineOffset: "3px" },
    "@media (forced-colors: active)": {
      ":focus-visible": { outlineColor: "Highlight" },
    },
  },
  artwork: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid transparent",
    backgroundColor: "transparent",
    ":hover": { border: "1px solid transparent" },
  },
});

/** Only a focused book owns removal keys; dialogs and text editing always win. */
export function isBookRemovalKey(event: KeyboardEvent<HTMLElement>): boolean {
  const target = event.target;
  return (event.key === "Delete" || event.key === "Backspace") &&
    !event.defaultPrevented && !event.repeat && !event.nativeEvent.isComposing &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    target instanceof HTMLElement && !target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') &&
    !target.ownerDocument.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
}

export const LibraryBookCard: FC<{
  book: LibraryBookViewModel;
  compact: boolean;
  variant?: "collection" | "continue";
  current?: boolean;
  active?: boolean;
  openDisabled?: boolean;
  openDescriptionId?: string | undefined;
  onOpen: () => void;
  onRequestRemove: () => void;
  onShowDetails: () => void;
}> = ({ book, compact, variant = "collection", current = false, active = true, openDisabled = false, openDescriptionId, onOpen, onRequestRemove, onShowDetails }) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const styles = useStyles();
  const restoreFocusTarget = useRestoreFocusTarget();
  const [detailsTooltip, setDetailsTooltip] = useState(false);
  useEffect(() => { if (!active) setDetailsTooltip(false); }, [active]);
  const progress = book.progressFraction === undefined ? undefined : Math.round(book.progressFraction * 100);
  const resume = variant === "continue";
  const Title = resume ? "h3" : "p";
  const titleContext = metadataTextContext(book.metadataLocalization, "title", book.title, 0);
  const creatorContext = metadataTextContext(book.metadataLocalization, "creator", book.creator, 0);
  const detailsButton = (
    <Tooltip content={{ children: t("library.bookDetails", { title: book.title }), style: EPUB_TOOLTIP_STYLE }} relationship="label"
      visible={active && detailsTooltip} onVisibleChange={(_event, data) => setDetailsTooltip(data.visible)}>
      <Button {...restoreFocusTarget} appearance="subtle" size="small" icon={<BookInformationRegular />}
        aria-label={t("library.bookDetails", { title: book.title })} onClick={() => { setDetailsTooltip(false); onShowDetails(); }} />
    </Tooltip>
  );
  return (
    <article data-library-book={book.id} data-library-continue={resume || undefined} className={resume ? styles.continueCard : undefined} style={{
      minWidth: 0, width: compact ? "100%" : 140, display: "flex",
      flexDirection: compact ? "row" : "column", gap: resume ? undefined : compact ? 12 : 8,
      alignItems: resume ? "center" : undefined, flexWrap: resume ? "wrap" : undefined,
      paddingBlock: resume ? undefined : compact ? 8 : 0,
      borderBottom: !resume && compact ? "1px solid var(--colorNeutralStroke2)" : undefined,
    }} onKeyDown={(event) => {
      if (isBookRemovalKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        onRequestRemove();
      }
    }}>
      <button {...restoreFocusTarget} type="button" className={mergeClasses(styles.open, !!book.cardCoverUrl && styles.artwork)} data-book-open={book.id}
        disabled={openDisabled} aria-describedby={openDescriptionId}
        aria-current={current ? "true" : undefined}
        onClick={onOpen}
        aria-label={progress === undefined ? t("library.openBook", { title: book.title }) :
          t("library.openBookProgress", { title: book.title, progress: formatLibraryProgress(progress / 100, locale) })}
        style={{ width: resume ? 72 : compact ? 56 : 140, height: resume ? 108 : compact ? 84 : 210, flexShrink: 0 }}>
        {book.cardCoverUrl ? (
          <img src={book.cardCoverUrl} alt="" style={{ display: "block", width: "auto", height: "auto",
            maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "3px 7px 7px 3px",
            outline: "1px solid var(--colorNeutralStroke2)", outlineOffset: "-1px" }} />
        ) : (
          <span aria-hidden="true" data-generated-cover="" className={mergeClasses(styles.generatedCover, compact && styles.compactCover)} style={{
            padding: compact ? 8 : "16px 14px", gap: compact ? 4 : 8,
            backgroundColor: generatedCoverColor(book.title), color: "#fff8e9",
          }}>
            <span {...metadataTextAttributes(titleContext, { fontFamily: "Georgia, serif", fontSize: resume ? 12 : compact ? 9 : 18, lineHeight: 1.15,
              flexShrink: 0, display: "-webkit-box", WebkitLineClamp: compact ? 3 : 4, WebkitBoxOrient: "vertical",
              overflow: "hidden", overflowWrap: "anywhere" })}>{book.title}</span>
            <span data-cover-ornament="" style={{ width: compact ? 6 : 18, height: compact ? 6 : 18,
              border: "1px solid rgba(255, 248, 233, 0.55)", transform: "rotate(45deg)",
              alignSelf: "center", flexShrink: 0 }} />
            <span {...metadataTextAttributes(creatorContext, { fontSize: compact ? 6 : 10, lineHeight: 1.3, letterSpacing: compact ? 0 : 1,
              textTransform: "uppercase", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              overflow: "hidden", overflowWrap: "anywhere" })}>{book.creator}</span>
          </span>
        )}
      </button>
      <div style={{ minWidth: 0, flex: resume ? "1 1 140px" : 1, display: "flex", flexDirection: "column", gap: resume ? 0 : 4 }}>
        {resume && <span style={{ textTransform: "uppercase", letterSpacing: "1.8px", fontSize: 11,
          fontWeight: 650, color: "var(--colorNeutralForeground2)" }}>{t("library.continueReading")}</span>}
        <Title className={resume ? styles.continueTitle : undefined}
          {...metadataTextAttributes(titleContext, { margin: resume ? "4px 0" : 0, fontWeight: resume ? 550 : 600, fontSize: resume ? undefined : 14,
          lineHeight: resume ? 1.3 : "20px", height: resume ? undefined : 40,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" })}>
          {book.title}
        </Title>
        <p {...metadataTextAttributes(creatorContext, { margin: 0, height: resume ? undefined : 18, lineHeight: resume ? "21px" : "18px",
          fontSize: resume ? 14 : 12, color: "var(--colorNeutralForeground2)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{book.creator}</p>
        <div data-library-progress-track="" aria-hidden="true" style={{ height: 3,
          marginTop: resume ? 12 : 2, marginBottom: 2, maxWidth: resume ? 240 : undefined, width: "100%",
          background: "var(--colorNeutralStroke2)", borderRadius: 2 }}>
          {progress !== undefined && <div style={{ width: `${progress}%`, height: "100%", background: "var(--colorBrandBackground)", borderRadius: 2 }} />}
        </div>
        <div data-library-progress-status="" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 28,
          maxWidth: resume ? 240 : undefined, width: "100%", marginTop: resume ? 4 : undefined }}>
          <span style={{ fontSize: 12, color: "var(--colorNeutralForeground2)" }}>
            {progress === undefined
              ? t(book.lastReadAt === undefined ? "library.notStarted" : "library.started")
              : resume ? t("library.percentRead", { progress: formatLibraryProgress(progress / 100, locale) })
                : formatLibraryProgress(progress / 100, locale)}
          </span>
          {detailsButton}
        </div>
      </div>
      {resume && <div data-library-continue-actions="" className={styles.continueActions}>
        <Button appearance="secondary" icon={<ArrowRightRegular />} iconPosition="after"
          disabled={openDisabled} aria-describedby={openDescriptionId} onClick={onOpen}
          style={{ flex: 1, minWidth: 0, whiteSpace: "normal" }}>
          {t("library.continueReading")}
        </Button>
      </div>}
    </article>
  );
};
