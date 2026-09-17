import { useState } from "react";
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
  Slider,
  ToggleButton,
  Tooltip,
} from "@fluentui/react-components";
import {
  BookInformationRegular,
  BookOpenRegular,
  ChevronDoubleLeftRegular,
  ChevronDoubleRightRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  CompassNorthwestRegular,
  SettingsRegular,
  TextBulletListRegular,
  TextColumnOneRegular,
  TextFontRegular,
} from "@fluentui/react-icons";
import { ReadingTheme } from "@ambra/engine";
import type { FontFamilyChoice, PageTheme } from "@ambra/engine";
import type { ReaderSnapshot, ViewMode } from "../ReaderController.js";
import {
  CHROME_BACKDROP_FILTER,
  CHROME_BORDER,
  CHROME_SHADOW,
  CHROME_THEMES,
} from "../chromeTheme.js";
import type { ChromeThemeChoice } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import type { PageTurnAnimationStyle } from "../PageTurnAnimationStyle.js";
import { GoToDialog } from "./GoToDialog.js";

export interface ToolbarProps {
  snapshot: ReaderSnapshot;
  isTocOpen: boolean;
  onToggleToc: () => void;
  isDetailsOpen: boolean;
  onToggleDetails: () => void;
  onTurnPage: (direction: 1 | -1) => void;
  onGoToChapter: (direction: 1 | -1) => void;
  onSeekToFraction: (fraction: number) => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSetFontScale: (scale: number) => void;
  onSetLineSpacing: (spacing: number) => void;
  onSetLetterSpacing: (spacing: number) => void;
  onSetContentWidth: (widthEm: number) => void;
  onSetFontFamily: (family: FontFamilyChoice) => void;
  onSetPageTheme: (theme: PageTheme) => void;
  onSetChromeTheme: (theme: ChromeThemeChoice) => void;
  onSetPageTurnAnimationStyle: (style: PageTurnAnimationStyle) => void;
  /** Whether the toolbar should currently be shown, and the pointer/
   * focus handlers that keep it visible — lifted up into `ReaderApp` (see
   * `useAutoHideChrome`) rather than owned here, so `ProgressScrubber`
   * can share the exact same show/hide state and the two fade together
   * as one unit of chrome instead of drifting out of sync. */
  visible: boolean;
  handlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
}

const VIEW_MODE_GROUP_NAME = "viewMode";
const FONT_FAMILY_GROUP_NAME = "fontFamily";
const PAGE_THEME_GROUP_NAME = "pageTheme";
const CHROME_THEME_GROUP_NAME = "chromeTheme";
const PAGE_TURN_ANIMATION_GROUP_NAME = "pageTurnAnimation";

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
 * unobtrusive row instead of an ever-growing button strip). Typography
 * (font size, font family) lives in its own "Aa" menu, kept separate
 * from the gear "Settings" menu (page color theme, paginated/scroll)
 * since font choice is the setting readers reach for far more often —
 * splitting it out means it's never buried behind less-frequently-used
 * options. Both are a UX pattern deliberately built to scale to more
 * settings later (columns, margins) without needing another redesign.
 *
 * Persisting every chosen setting is `ReaderController`'s job, not this
 * component's — it just reflects/changes current state. */
export const Toolbar: FC<ToolbarProps> = ({
  snapshot,
  isTocOpen,
  onToggleToc,
  isDetailsOpen,
  onToggleDetails,
  onTurnPage,
  onGoToChapter,
  onSeekToFraction,
  onSetViewMode,
  onSetFontScale,
  onSetLineSpacing,
  onSetLetterSpacing,
  onSetContentWidth,
  onSetFontFamily,
  onSetPageTheme,
  onSetChromeTheme,
  onSetPageTurnAnimationStyle,
  visible,
  handlers,
}) => {
  const isPaginated = snapshot.viewMode === "paginated";
  const chromePalette = useChromeTheme();
  const [goToDialogMode, setGoToDialogMode] = useState<"page" | "percentage" | undefined>(undefined);

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
          gap: 10,
          // A little taller than a bare-minimum button bar (12px, not
          // 8px, of vertical padding) so the toolbar fully covers the
          // running header's own title/chapter text underneath it (see
          // `PageFurniture`'s `HEADER_TEXT_TOP_OFFSET`) whenever it's
          // shown, instead of just barely overlapping it.
          padding: "12px 10px",
          background: chromePalette.background,
          backdropFilter: CHROME_BACKDROP_FILTER,
          WebkitBackdropFilter: CHROME_BACKDROP_FILTER,
          borderBottom: `1px solid ${CHROME_BORDER}`,
          boxShadow: visible ? CHROME_SHADOW : "none",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(-8px)",
          pointerEvents: visible ? "auto" : "none",
          transition:
            "opacity 240ms ease, transform 240ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 240ms ease",
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

        {/* Book title + current chapter, sharing one flexible region: the
            chapter name (shown here because it's otherwise only visible
            in the running header underneath — see `PageFurniture` — which
            this same toolbar covers whenever it's shown) is deliberately
            the first thing to truncate/disappear as the toolbar narrows,
            never the book title. */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            overflow: "hidden",
          }}
        >
          <Body1
            as="span"
            style={{
              flexShrink: 0,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}
          >
            {snapshot.title}
          </Body1>

          {/* The current chapter — shown only when there's room for it
              (see the doc comment above): this wrapper takes whatever
              space is left after the book title above (which never
              shrinks below its own content size), so as the toolbar
              narrows, the chapter name is always the first thing to
              truncate and eventually disappear, never the book title. */}
          <Caption1
            as="span"
            style={{
              minWidth: 0,
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--colorNeutralForeground2, #444)",
            }}
          >
            — {snapshot.currentChapterLabel}
          </Caption1>
        </div>

        {/* No page-number display in the toolbar itself — it lives in
            the running footer (see `PageFurniture`) instead. Showing it
            here too was confusing: chapter-relative vs. book-wide page
            numbers side by side (footer + toolbar) read as two different,
            possibly conflicting counts. */}

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
              {!snapshot.isFixedLayout && (
                <>
                  <MenuDivider />
                  <MenuGroup>
                    <MenuGroupHeader>Go To</MenuGroupHeader>
                    {isPaginated && (
                      <MenuItem onClick={() => setGoToDialogMode("page")}>Go to Page…</MenuItem>
                    )}
                    <MenuItem onClick={() => setGoToDialogMode("percentage")}>
                      Go to Percentage…
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
              [FONT_FAMILY_GROUP_NAME]: [snapshot.fontFamily],
              [PAGE_THEME_GROUP_NAME]: [snapshot.pageTheme],
            }}
            onCheckedValueChange={(_event, data) => {
              if (data.name === FONT_FAMILY_GROUP_NAME) {
                onSetFontFamily(data.checkedItems[0] as FontFamilyChoice);
              } else if (data.name === PAGE_THEME_GROUP_NAME) {
                onSetPageTheme(data.checkedItems[0] as PageTheme);
              }
            }}
          >
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content="Text and page layout" relationship="label">
                <Button appearance="subtle" size="small" icon={<TextFontRegular />} />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuGroup>
                  <MenuGroupHeader>Size</MenuGroupHeader>
                  <div style={{ padding: "6px 12px 10px" }}>
                    <Slider
                      min={ReadingTheme.MIN_FONT_SCALE}
                      max={ReadingTheme.MAX_FONT_SCALE}
                      step={ReadingTheme.FONT_SCALE_STEP}
                      value={snapshot.fontScale}
                      onChange={(_event, data) => onSetFontScale(data.value)}
                      aria-label="Font size"
                      style={{ width: "100%" }}
                    />
                  </div>
                </MenuGroup>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>Line Spacing</MenuGroupHeader>
                  <div style={{ padding: "6px 12px 10px" }}>
                    <Slider
                      min={ReadingTheme.MIN_LINE_SPACING}
                      max={ReadingTheme.MAX_LINE_SPACING}
                      step={ReadingTheme.LINE_SPACING_STEP}
                      value={snapshot.lineSpacing}
                      onChange={(_event, data) => onSetLineSpacing(data.value)}
                      aria-label="Line spacing"
                      style={{ width: "100%" }}
                    />
                  </div>
                </MenuGroup>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>Character Spacing</MenuGroupHeader>
                  <div style={{ padding: "6px 12px 10px" }}>
                    <Slider
                      min={ReadingTheme.MIN_LETTER_SPACING}
                      max={ReadingTheme.MAX_LETTER_SPACING}
                      step={ReadingTheme.LETTER_SPACING_STEP}
                      value={snapshot.letterSpacing}
                      onChange={(_event, data) => onSetLetterSpacing(data.value)}
                      aria-label="Character spacing"
                      style={{ width: "100%" }}
                    />
                  </div>
                </MenuGroup>
                <MenuDivider />
                <MenuGroup>
                  {/* Labeled by the underlying value it directly controls
                      (a wider value = a wider text column) rather than
                      "Margins" (the inverse framing some readers use,
                      where turning it up means *narrower* text/more
                      margin) — avoids an inverted slider whose visual
                      direction wouldn't match its own value. */}
                  <MenuGroupHeader>Text Width</MenuGroupHeader>
                  <div style={{ padding: "6px 12px 10px" }}>
                    <Slider
                      min={ReadingTheme.MIN_CONTENT_WIDTH_EM}
                      max={ReadingTheme.MAX_CONTENT_WIDTH_EM}
                      step={ReadingTheme.CONTENT_WIDTH_STEP}
                      value={snapshot.contentWidthEm}
                      onChange={(_event, data) => onSetContentWidth(data.value)}
                      aria-label="Text width"
                      style={{ width: "100%" }}
                    />
                  </div>
                </MenuGroup>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>Font</MenuGroupHeader>
                  {(Object.keys(ReadingTheme.FONT_FAMILIES) as FontFamilyChoice[]).map((key) => {
                    // Preview each option in its own typeface (falling back
                    // to the toolbar's own font for "Book Default", which
                    // has no fixed stack of its own by design — it defers
                    // to whatever the book itself specifies) so the user
                    // can see the difference between options before picking
                    // one, rather than reading identical-looking labels.
                    const stack = ReadingTheme.FONT_FAMILIES[key].stack;
                    return (
                      <MenuItemRadio
                        key={key}
                        name={FONT_FAMILY_GROUP_NAME}
                        value={key}
                        style={stack ? { fontFamily: stack } : undefined}
                      >
                        {ReadingTheme.FONT_FAMILIES[key].label}
                      </MenuItemRadio>
                    );
                  })}
                </MenuGroup>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>Page Style</MenuGroupHeader>
                  {(Object.keys(ReadingTheme.PAGE_THEMES) as PageTheme[]).map((key) => (
                    <MenuItemRadio key={key} name={PAGE_THEME_GROUP_NAME} value={key}>
                      {ReadingTheme.PAGE_THEMES[key].label}
                    </MenuItemRadio>
                  ))}
                </MenuGroup>
              </MenuList>
            </MenuPopover>
          </Menu>
        )}

        <Menu
          persistOnItemClick
          checkedValues={{
            [VIEW_MODE_GROUP_NAME]: [snapshot.viewMode],
            [CHROME_THEME_GROUP_NAME]: [snapshot.chromeTheme],
            [PAGE_TURN_ANIMATION_GROUP_NAME]: [snapshot.pageTurnAnimationStyle],
          }}
          onCheckedValueChange={(_event, data) => {
            if (data.name === VIEW_MODE_GROUP_NAME) {
              onSetViewMode(data.checkedItems[0] as ViewMode);
            } else if (data.name === CHROME_THEME_GROUP_NAME) {
              onSetChromeTheme(data.checkedItems[0] as ChromeThemeChoice);
            } else if (data.name === PAGE_TURN_ANIMATION_GROUP_NAME) {
              onSetPageTurnAnimationStyle(data.checkedItems[0] as PageTurnAnimationStyle);
            }
          }}
        >
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content="Settings" relationship="label">
              <Button appearance="subtle" size="small" icon={<SettingsRegular />} />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {!snapshot.isFixedLayout && (
                <>
                  <MenuGroup>
                    <MenuGroupHeader>Book</MenuGroupHeader>
                    <MenuItemRadio
                      name={VIEW_MODE_GROUP_NAME}
                      value="paginated"
                      icon={<BookOpenRegular />}
                    >
                      Paginated
                    </MenuItemRadio>
                    <MenuItemRadio
                      name={VIEW_MODE_GROUP_NAME}
                      value="scroll"
                      icon={<TextColumnOneRegular />}
                    >
                      Scroll
                    </MenuItemRadio>
                  </MenuGroup>
                  <MenuDivider />
                  <MenuGroup>
                    <MenuGroupHeader>Page Turn</MenuGroupHeader>
                    <MenuItemRadio name={PAGE_TURN_ANIMATION_GROUP_NAME} value="rotate">
                      Rotate
                    </MenuItemRadio>
                    <MenuItemRadio name={PAGE_TURN_ANIMATION_GROUP_NAME} value="slide">
                      Slide
                    </MenuItemRadio>
                  </MenuGroup>
                  <MenuDivider />
                </>
              )}
              <MenuGroup>
                <MenuGroupHeader>Reader Theme</MenuGroupHeader>
                {(Object.keys(CHROME_THEMES) as ChromeThemeChoice[]).map((key) => (
                  <MenuItemRadio key={key} name={CHROME_THEME_GROUP_NAME} value={key}>
                    {CHROME_THEMES[key].label}
                  </MenuItemRadio>
                ))}
              </MenuGroup>
            </MenuList>
          </MenuPopover>
        </Menu>

        <Tooltip
          content={isDetailsOpen ? "Hide book details" : "Book details"}
          relationship="label"
        >
          <ToggleButton
            appearance="subtle"
            size="small"
            checked={isDetailsOpen}
            icon={<BookInformationRegular />}
            onClick={onToggleDetails}
          />
        </Tooltip>
      </div>

      {goToDialogMode && (
        <GoToDialog
          mode={goToDialogMode}
          open={goToDialogMode !== undefined}
          onOpenChange={(open) => {
            if (!open) {
              setGoToDialogMode(undefined);
            }
          }}
          bookPageCount={snapshot.bookPageCount}
          onGo={onSeekToFraction}
        />
      )}
    </>
  );
};
