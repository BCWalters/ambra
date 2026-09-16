import type { FC } from "react";
import {
  Body1,
  Button,
  Caption1,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  ToggleButton,
  Tooltip,
} from "@fluentui/react-components";
import {
  BookOpenRegular,
  ChevronDoubleLeftRegular,
  ChevronDoubleRightRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  CompassNorthwestRegular,
  FontDecreaseRegular,
  FontIncreaseRegular,
  SlideSettingsRegular,
  TextBulletListRegular,
  TextColumnOneRegular,
} from "@fluentui/react-icons";
import { ReadingTheme } from "@pagina/engine";
import type { FontFamilyChoice, PageTheme } from "@pagina/engine";
import type { ReaderSnapshot, ViewMode } from "../ReaderController.js";
import { useAutoHideChrome } from "../useAutoHideChrome.js";
import { CHROME_BACKDROP_FILTER, CHROME_BACKGROUND, CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";

export interface ToolbarProps {
  snapshot: ReaderSnapshot;
  isTocOpen: boolean;
  onToggleToc: () => void;
  onTurnPage: (direction: 1 | -1) => void;
  onGoToChapter: (direction: 1 | -1) => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSetFontScale: (scale: number) => void;
  onSetFontFamily: (family: FontFamilyChoice) => void;
  onSetPageTheme: (theme: PageTheme) => void;
}

const VIEW_MODE_GROUP_NAME = "viewMode";
const FONT_FAMILY_GROUP_NAME = "fontFamily";
const PAGE_THEME_GROUP_NAME = "pageTheme";

/** The reader's toolbar: an unobtrusive, translucent overlay (see
 * `useAutoHideChrome`) in a silvery neutral tone deliberately distinct
 * from the book page itself (see `chromeTheme`), rather than a chrome
 * bar permanently competing with the page for attention.
 *
 * Deliberately compact: chapter/page navigation lives in the "Navigate"
 * menu rather than as always-visible buttons (turning pages is normally
 * a keyboard-arrow/click/drag affair — see `ReaderController.turnPage`/
 * `beginDragPageTurn` — not a toolbar-button one, and folding four
 * buttons into one menu trigger is what keeps this bar a single
 * unobtrusive row instead of an ever-growing button strip). Display
 * settings live in a second "Reading settings" menu, grouped under "Page"
 * (font size, font family, page color theme) and "Book" (paginated/
 * scroll) headers — a UX pattern deliberately built to scale to more
 * settings later (columns, margins) without needing another redesign.
 *
 * Persisting every chosen setting is `ReaderController`'s job, not this
 * component's — it just reflects/changes current state. */
export const Toolbar: FC<ToolbarProps> = ({
  snapshot,
  isTocOpen,
  onToggleToc,
  onTurnPage,
  onGoToChapter,
  onSetViewMode,
  onSetFontScale,
  onSetFontFamily,
  onSetPageTheme,
}) => {
  const isPaginated = snapshot.viewMode === "paginated";
  const { visible, handlers } = useAutoHideChrome(isTocOpen);

  const pageLabel = (() => {
    if (snapshot.secondPageIndex !== undefined) {
      // Spread mode: chapter-relative for now — see `bookPageIndex`'s
      // doc comment on why book-wide numbering is scoped to the
      // single-page case for this first pass.
      return snapshot.pageCount === 0
        ? undefined
        : `Pages ${snapshot.pageIndex + 1}–${snapshot.secondPageIndex + 1} of ${snapshot.pageCount}`;
    }
    if (snapshot.bookPageIndex !== undefined && snapshot.bookPageCount !== undefined) {
      // Prefer the book-wide number once background pagination knows it
      // — see `BookPaginationEstimator`. Falls back to the per-chapter
      // number below while that's still being measured, so the toolbar
      // never shows nothing.
      return `Page ${snapshot.bookPageIndex} of ${snapshot.bookPageCount}`;
    }
    return snapshot.pageCount === 0 ? undefined : `Page ${snapshot.pageIndex + 1} of ${snapshot.pageCount}`;
  })();

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
          drifted from the visible toolbar down into the page. */}
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
          padding: "8px 10px",
          background: CHROME_BACKGROUND,
          backdropFilter: CHROME_BACKDROP_FILTER,
          WebkitBackdropFilter: CHROME_BACKDROP_FILTER,
          borderBottom: `1px solid ${CHROME_BORDER}`,
          boxShadow: visible ? CHROME_SHADOW : "none",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(-8px)",
          pointerEvents: visible ? "auto" : "none",
          transition: "opacity 240ms ease, transform 240ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 240ms ease",
        }}
      >
        <Tooltip content={isTocOpen ? "Hide contents" : "Show contents"} relationship="label">
          <ToggleButton
            appearance="subtle"
            size="small"
            checked={isTocOpen}
            icon={<TextBulletListRegular />}
            onClick={onToggleToc}
          />
        </Tooltip>

        <Body1
          as="span"
          style={{
            flex: 1,
            minWidth: 0,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {snapshot.title}
        </Body1>

        {pageLabel && (
          <Caption1
            as="span"
            style={{ whiteSpace: "nowrap", color: "var(--colorNeutralForeground2, #444)", flexShrink: 0 }}
          >
            {pageLabel}
          </Caption1>
        )}

        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content="Navigate" relationship="label">
              <Button appearance="subtle" size="small" icon={<CompassNorthwestRegular />} />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuGroup>
                <MenuGroupHeader>Chapter</MenuGroupHeader>
                <MenuItem
                  icon={<ChevronDoubleLeftRegular />}
                  disabled={snapshot.spineIndex <= 0}
                  onClick={() => onGoToChapter(-1)}
                >
                  Previous Chapter
                </MenuItem>
                <MenuItem
                  icon={<ChevronDoubleRightRegular />}
                  disabled={snapshot.spineIndex >= snapshot.spineLength - 1}
                  onClick={() => onGoToChapter(1)}
                >
                  Next Chapter
                </MenuItem>
              </MenuGroup>
              {isPaginated && !snapshot.isFixedLayout && (
                <>
                  <MenuDivider />
                  <MenuGroup>
                    <MenuGroupHeader>Page</MenuGroupHeader>
                    <MenuItem
                      icon={<ChevronLeftRegular />}
                      disabled={snapshot.pageIndex <= 0}
                      onClick={() => onTurnPage(-1)}
                    >
                      Previous Page
                    </MenuItem>
                    <MenuItem
                      icon={<ChevronRightRegular />}
                      disabled={snapshot.pageIndex >= snapshot.pageCount - 1}
                      onClick={() => onTurnPage(1)}
                    >
                      Next Page
                    </MenuItem>
                  </MenuGroup>
                </>
              )}
            </MenuList>
          </MenuPopover>
        </Menu>

        {!snapshot.isFixedLayout && (
          <Menu
            persistOnItemClick
            checkedValues={{
              [VIEW_MODE_GROUP_NAME]: [snapshot.viewMode],
              [FONT_FAMILY_GROUP_NAME]: [snapshot.fontFamily],
              [PAGE_THEME_GROUP_NAME]: [snapshot.pageTheme],
            }}
            onCheckedValueChange={(_event, data) => {
              if (data.name === VIEW_MODE_GROUP_NAME) {
                onSetViewMode(data.checkedItems[0] as ViewMode);
              } else if (data.name === FONT_FAMILY_GROUP_NAME) {
                onSetFontFamily(data.checkedItems[0] as FontFamilyChoice);
              } else if (data.name === PAGE_THEME_GROUP_NAME) {
                onSetPageTheme(data.checkedItems[0] as PageTheme);
              }
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content="Reading settings" relationship="label">
                <Button appearance="subtle" size="small" icon={<SlideSettingsRegular />} />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuGroup>
                  <MenuGroupHeader>Page</MenuGroupHeader>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px" }}>
                    <Tooltip content="Decrease font size" relationship="label">
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<FontDecreaseRegular />}
                        disabled={snapshot.fontScale <= ReadingTheme.MIN_FONT_SCALE}
                        onClick={() => onSetFontScale(snapshot.fontScale - ReadingTheme.FONT_SCALE_STEP)}
                      />
                    </Tooltip>
                    <Body1 as="span" style={{ flex: 1, textAlign: "center" }}>
                      Font Size
                    </Body1>
                    <Tooltip content="Increase font size" relationship="label">
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<FontIncreaseRegular />}
                        disabled={snapshot.fontScale >= ReadingTheme.MAX_FONT_SCALE}
                        onClick={() => onSetFontScale(snapshot.fontScale + ReadingTheme.FONT_SCALE_STEP)}
                      />
                    </Tooltip>
                  </div>
                </MenuGroup>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>Font</MenuGroupHeader>
                  {(Object.keys(ReadingTheme.FONT_FAMILIES) as FontFamilyChoice[]).map((key) => (
                    <MenuItemRadio key={key} name={FONT_FAMILY_GROUP_NAME} value={key}>
                      {ReadingTheme.FONT_FAMILIES[key].label}
                    </MenuItemRadio>
                  ))}
                </MenuGroup>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>Theme</MenuGroupHeader>
                  {(Object.keys(ReadingTheme.PAGE_THEMES) as PageTheme[]).map((key) => (
                    <MenuItemRadio key={key} name={PAGE_THEME_GROUP_NAME} value={key}>
                      {ReadingTheme.PAGE_THEMES[key].label}
                    </MenuItemRadio>
                  ))}
                </MenuGroup>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>Book</MenuGroupHeader>
                  <MenuItemRadio name={VIEW_MODE_GROUP_NAME} value="paginated" icon={<BookOpenRegular />}>
                    Paginated
                  </MenuItemRadio>
                  <MenuItemRadio name={VIEW_MODE_GROUP_NAME} value="scroll" icon={<TextColumnOneRegular />}>
                    Scroll
                  </MenuItemRadio>
                </MenuGroup>
              </MenuList>
            </MenuPopover>
          </Menu>
        )}
      </div>
    </>
  );
};
