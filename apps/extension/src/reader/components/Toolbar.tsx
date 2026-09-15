import type { FC } from "react";
import { Body1, Button, ToggleButton } from "@fluentui/react-components";
import type { ReaderSnapshot, ViewMode } from "../ReaderController.js";

export interface ToolbarProps {
  snapshot: ReaderSnapshot;
  onToggleToc: () => void;
  onTurnPage: (direction: 1 | -1) => void;
  onGoToChapter: (direction: 1 | -1) => void;
  onSetViewMode: (mode: ViewMode) => void;
}

/** The reader's top toolbar: TOC toggle, book title, chapter progress,
 * page navigation (paginated mode only — scrolling is continuous, so
 * there's no discrete page concept in scroll mode; fixed-layout spine
 * items have no page/scroll concept at all, regardless of `viewMode`,
 * since the whole item is one page — see
 * `ReaderSnapshot.isFixedLayout`), and the paginated/scroll view-mode
 * toggle.
 *
 * Persisting the chosen view mode is `view-mode-preference`'s job, not
 * this component's — it just reflects/changes the controller's current
 * in-memory mode. */
export const Toolbar: FC<ToolbarProps> = ({ snapshot, onToggleToc, onTurnPage, onGoToChapter, onSetViewMode }) => {
  const isPaginated = snapshot.viewMode === "paginated";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid var(--colorNeutralStroke1, #ccc)",
      }}
    >
      <Button size="small" onClick={onToggleToc} aria-label="Toggle table of contents">
        Contents
      </Button>

      <Body1 as="span" style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
        {snapshot.title}
      </Body1>

      <Body1 as="span">
        Chapter {snapshot.spineIndex + 1} of {snapshot.spineLength}
      </Body1>

      <Button size="small" disabled={snapshot.spineIndex <= 0} onClick={() => onGoToChapter(-1)}>
        ◀ Chapter
      </Button>
      <Button
        size="small"
        disabled={snapshot.spineIndex >= snapshot.spineLength - 1}
        onClick={() => onGoToChapter(1)}
      >
        Chapter ▶
      </Button>

      {isPaginated && !snapshot.isFixedLayout && (
        <>
          <Body1 as="span">
            Page {snapshot.pageCount > 0 ? snapshot.pageIndex + 1 : 0} of {snapshot.pageCount}
          </Body1>
          <Button size="small" disabled={snapshot.pageIndex <= 0} onClick={() => onTurnPage(-1)}>
            ← Prev
          </Button>
          <Button size="small" disabled={snapshot.pageIndex >= snapshot.pageCount - 1} onClick={() => onTurnPage(1)}>
            Next →
          </Button>
        </>
      )}

      {!snapshot.isFixedLayout && (
        <ToggleButton
          size="small"
          checked={!isPaginated}
          onClick={() => onSetViewMode(isPaginated ? "scroll" : "paginated")}
        >
          {isPaginated ? "Paginated" : "Scroll"}
        </ToggleButton>
      )}
    </div>
  );
};
