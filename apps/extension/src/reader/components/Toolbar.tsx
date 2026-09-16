import type { FC } from "react";
import {
  Body1,
  Caption1,
  Toolbar as FluentToolbar,
  ToolbarButton,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarRadioButton,
  ToolbarRadioGroup,
  Tooltip,
} from "@fluentui/react-components";
import {
  BookOpenRegular,
  ChevronDoubleLeftRegular,
  ChevronDoubleRightRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  FontDecreaseRegular,
  FontIncreaseRegular,
  PanelLeftContractRegular,
  PanelLeftExpandRegular,
  TextColumnOneRegular,
} from "@fluentui/react-icons";
import { ReadingTheme } from "@pagina/engine";
import type { ReaderSnapshot, ViewMode } from "../ReaderController.js";
import { useAutoHideChrome } from "../useAutoHideChrome.js";

export interface ToolbarProps {
  snapshot: ReaderSnapshot;
  isTocOpen: boolean;
  onToggleToc: () => void;
  onTurnPage: (direction: 1 | -1) => void;
  onGoToChapter: (direction: 1 | -1) => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSetFontScale: (scale: number) => void;
}

const VIEW_MODE_GROUP_NAME = "viewMode";

/** The reader's toolbar: an unobtrusive, translucent overlay (see
 * `useAutoHideChrome`) rather than a chrome bar permanently competing
 * with the page for attention. Holds the TOC toggle, book title, chapter
 * navigation, page navigation (paginated mode only — scrolling is
 * continuous, so there's no discrete page concept in scroll mode;
 * fixed-layout spine items have no page/scroll/font concept at all,
 * regardless of `viewMode`, since the whole item is one author-designed
 * page — see `ReaderSnapshot.isFixedLayout`), a font-size stepper, and the
 * paginated/scroll view-mode control.
 *
 * The paginated/scroll control is a real two-option radio group
 * (`ToolbarRadioGroup`/`ToolbarRadioButton`), not a single ambiguous
 * toggle button — each mode has its own always-visible icon+label, and
 * clicking a mode switches directly *to* it, so there's nothing to infer
 * about what the control's current state implies the click will do.
 *
 * Persisting the chosen view mode/font scale is `ReaderController`'s job,
 * not this component's — it just reflects/changes current state. */
export const Toolbar: FC<ToolbarProps> = ({
  snapshot,
  isTocOpen,
  onToggleToc,
  onTurnPage,
  onGoToChapter,
  onSetViewMode,
  onSetFontScale,
}) => {
  const isPaginated = snapshot.viewMode === "paginated";
  const { visible, handlers } = useAutoHideChrome(isTocOpen);

  return (
    <>
      {/* A thin, always-present hover target at the very top edge of the
          reader pane. Necessary because the content pane below is a
          cross-document iframe: once the mouse pointer is over it, the
          browser dispatches pointer events to *that* document, not this
          one (the same reason `AccessibilityController` has to attach its
          keyboard listener directly to the iframe's own document rather
          than the parent window) — so this toolbar's own
          `onPointerEnter` alone would never fire again once the pointer
          drifted from the visible toolbar down into the page. Moving the
          mouse to the top edge to reveal chrome is a familiar convention
          (e.g. auto-hiding menu/toolbars in fullscreen apps) and doesn't
          depend on cross-frame event bubbling at all, since this strip
          lives in the parent document alongside the toolbar itself. */}
      <div
        onPointerEnter={handlers.onPointerEnter}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, zIndex: 9 }}
      />

      <div
        onPointerEnter={handlers.onPointerEnter}
        onPointerLeave={handlers.onPointerLeave}
        onFocus={handlers.onFocus}
        onBlur={handlers.onBlur}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "10px 16px",
          background: "rgba(250, 247, 241, 0.82)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(0, 0, 0, 0.08)",
          boxShadow: visible ? "0 2px 12px rgba(0, 0, 0, 0.06)" : "none",
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
          transition: "opacity 220ms ease, box-shadow 220ms ease",
        }}
      >
        <Tooltip content={isTocOpen ? "Hide contents" : "Show contents"} relationship="label">
          <ToolbarButton
            icon={isTocOpen ? <PanelLeftContractRegular /> : <PanelLeftExpandRegular />}
            onClick={onToggleToc}
        />
      </Tooltip>

      <Body1 as="span" style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
        {snapshot.title}
      </Body1>

      <FluentToolbar
        aria-label="Reader controls"
        size="small"
        checkedValues={{ [VIEW_MODE_GROUP_NAME]: [snapshot.viewMode] }}
        onCheckedValueChange={(_event, data) => {
          if (data.name === VIEW_MODE_GROUP_NAME) {
            onSetViewMode(data.checkedItems[0] as ViewMode);
          }
        }}
      >
        <ToolbarGroup>
          <Caption1 as="span">
            Chapter {snapshot.spineIndex + 1} of {snapshot.spineLength}
          </Caption1>
          <Tooltip content="Previous chapter" relationship="label">
            <ToolbarButton
              icon={<ChevronDoubleLeftRegular />}
              disabled={snapshot.spineIndex <= 0}
              onClick={() => onGoToChapter(-1)}
            />
          </Tooltip>
          <Tooltip content="Next chapter" relationship="label">
            <ToolbarButton
              icon={<ChevronDoubleRightRegular />}
              disabled={snapshot.spineIndex >= snapshot.spineLength - 1}
              onClick={() => onGoToChapter(1)}
            />
          </Tooltip>
        </ToolbarGroup>

        {isPaginated && !snapshot.isFixedLayout && (
          <>
            <ToolbarDivider />
            <ToolbarGroup>
              <Caption1 as="span">
                {snapshot.pageCount === 0
                  ? "Page 0 of 0"
                  : snapshot.secondPageIndex !== undefined
                    ? `Pages ${snapshot.pageIndex + 1}–${snapshot.secondPageIndex + 1} of ${snapshot.pageCount}`
                    : `Page ${snapshot.pageIndex + 1} of ${snapshot.pageCount}`}
              </Caption1>
              <Tooltip content="Previous page" relationship="label">
                <ToolbarButton
                  icon={<ChevronLeftRegular />}
                  disabled={snapshot.pageIndex <= 0}
                  onClick={() => onTurnPage(-1)}
                />
              </Tooltip>
              <Tooltip content="Next page" relationship="label">
                <ToolbarButton
                  icon={<ChevronRightRegular />}
                  disabled={snapshot.pageIndex >= snapshot.pageCount - 1}
                  onClick={() => onTurnPage(1)}
                />
              </Tooltip>
            </ToolbarGroup>
          </>
        )}

        {!snapshot.isFixedLayout && (
          <>
            <ToolbarDivider />
            <ToolbarGroup>
              <Tooltip content="Decrease font size" relationship="label">
                <ToolbarButton
                  icon={<FontDecreaseRegular />}
                  disabled={snapshot.fontScale <= ReadingTheme.MIN_FONT_SCALE}
                  onClick={() => onSetFontScale(snapshot.fontScale - ReadingTheme.FONT_SCALE_STEP)}
                />
              </Tooltip>
              <Caption1 as="span" style={{ minWidth: "3.2em", textAlign: "center" }}>
                {Math.round(snapshot.fontScale * 100)}%
              </Caption1>
              <Tooltip content="Increase font size" relationship="label">
                <ToolbarButton
                  icon={<FontIncreaseRegular />}
                  disabled={snapshot.fontScale >= ReadingTheme.MAX_FONT_SCALE}
                  onClick={() => onSetFontScale(snapshot.fontScale + ReadingTheme.FONT_SCALE_STEP)}
                />
              </Tooltip>
            </ToolbarGroup>

            <ToolbarDivider />
            <ToolbarRadioGroup>
              <Tooltip content="Paginated view" relationship="label">
                <ToolbarRadioButton name={VIEW_MODE_GROUP_NAME} value="paginated" icon={<BookOpenRegular />} />
              </Tooltip>
              <Tooltip content="Scroll view" relationship="label">
                <ToolbarRadioButton name={VIEW_MODE_GROUP_NAME} value="scroll" icon={<TextColumnOneRegular />} />
              </Tooltip>
            </ToolbarRadioGroup>
          </>
        )}
        </FluentToolbar>
      </div>
    </>
  );
};
