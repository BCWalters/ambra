import { useEffect, useState, type FC, type KeyboardEvent } from "react";
import { Button, Tooltip, makeStyles, mergeClasses, useRestoreFocusTarget } from "@fluentui/react-components";
import { BookInformationRegular } from "@fluentui/react-icons";
import type { LibraryBookViewModel } from "./useLibrary.js";
import { useLocale, useTranslation } from "../i18n/LocaleContext.js";
import { formatLibraryProgress } from "./LibraryFormatting.js";
import { EPUB_TOOLTIP_STYLE } from "../components/EpubTextStyles.js";

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
  current?: boolean;
  active?: boolean;
  openDisabled?: boolean;
  openDescriptionId?: string | undefined;
  onOpen: () => void;
  onRequestRemove: () => void;
  onShowDetails: () => void;
}> = ({ book, compact, current = false, active = true, openDisabled = false, openDescriptionId, onOpen, onRequestRemove, onShowDetails }) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const styles = useStyles();
  const restoreFocusTarget = useRestoreFocusTarget();
  const [detailsTooltip, setDetailsTooltip] = useState(false);
  useEffect(() => { if (!active) setDetailsTooltip(false); }, [active]);
  const progress = book.progressFraction === undefined ? undefined : Math.round(book.progressFraction * 100);
  return (
    <article data-library-book={book.id} style={{
      minWidth: 0, width: compact ? "100%" : 140, display: "flex",
      flexDirection: compact ? "row" : "column", gap: compact ? 12 : 8,
      paddingBlock: compact ? 8 : 0,
      borderBottom: compact ? "1px solid var(--colorNeutralStroke2)" : undefined,
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
        style={{ width: compact ? 56 : 140, height: compact ? 84 : 210, flexShrink: 0 }}>
        {book.cardCoverUrl ? (
          <img src={book.cardCoverUrl} alt="" style={{ display: "block", width: "auto", height: "auto",
            maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "3px 7px 7px 3px",
            outline: "1px solid var(--colorNeutralStroke2)", outlineOffset: "-1px" }} />
        ) : (
          <span aria-hidden="true" data-generated-cover="" className={mergeClasses(styles.generatedCover, compact && styles.compactCover)} style={{
            padding: compact ? 8 : "16px 14px", gap: compact ? 4 : 8,
            backgroundColor: generatedCoverColor(book.title), color: "#fff8e9",
          }}>
            <span style={{ fontFamily: "Georgia, serif", fontSize: compact ? 9 : 18, lineHeight: 1.15,
              flexShrink: 0, display: "-webkit-box", WebkitLineClamp: compact ? 3 : 4, WebkitBoxOrient: "vertical",
              overflow: "hidden", overflowWrap: "anywhere" }}>{book.title}</span>
            <span data-cover-ornament="" style={{ width: compact ? 6 : 18, height: compact ? 6 : 18,
              border: "1px solid rgba(255, 248, 233, 0.55)", transform: "rotate(45deg)",
              alignSelf: "center", flexShrink: 0 }} />
            <span style={{ fontSize: compact ? 6 : 10, lineHeight: 1.3, letterSpacing: compact ? 0 : 1,
              textTransform: "uppercase", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              overflow: "hidden", overflowWrap: "anywhere" }}>{book.creator}</span>
          </span>
        )}
      </button>
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 14, lineHeight: "20px", height: 40,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>
          {book.title}
        </p>
        <p style={{ margin: 0, height: 18, lineHeight: "18px", fontSize: 12, color: "var(--colorNeutralForeground2)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.creator}</p>
        <div data-library-progress-track="" aria-hidden="true" style={{ height: 3, marginBlock: 2,
          background: "var(--colorNeutralStroke2)", borderRadius: 2 }}>
          {progress !== undefined && <div style={{ width: `${progress}%`, height: "100%", background: "var(--colorBrandBackground)", borderRadius: 2 }} />}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 28 }}>
          <span style={{ fontSize: 12, color: "var(--colorNeutralForeground2)" }}>
            {progress === undefined
              ? t(book.lastReadAt === undefined ? "library.notStarted" : "library.started")
              : formatLibraryProgress(progress / 100, locale)}
          </span>
          <Tooltip content={{ children: t("library.bookDetails", { title: book.title }), style: EPUB_TOOLTIP_STYLE }} relationship="label"
            visible={active && detailsTooltip} onVisibleChange={(_event, data) => setDetailsTooltip(data.visible)}>
            <Button {...restoreFocusTarget} appearance="subtle" size="small" icon={<BookInformationRegular />}
              aria-label={t("library.bookDetails", { title: book.title })} onClick={() => { setDetailsTooltip(false); onShowDetails(); }} />
          </Tooltip>
        </div>
      </div>
    </article>
  );
};
