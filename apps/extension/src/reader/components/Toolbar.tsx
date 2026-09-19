import { useEffect, useRef, useState } from "react";
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
  BookInformationRegular,
  BookOpenRegular,
  BookmarkFilled,
  BookmarkRegular,
  DocumentOnePageColumnsRegular,
  ReadingListRegular,
  SearchRegular,
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
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import type { PageTurnAnimationStyle } from "../PageTurnAnimationStyle.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { DefaultableSlider } from "./DefaultableSlider.js";

export interface ToolbarProps {
  snapshot: ReaderSnapshot;
  isTocOpen: boolean;
  onToggleToc: () => void;
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  isAnnotationsOpen: boolean;
  onToggleAnnotations: () => void;
  isDetailsOpen: boolean;
  onToggleDetails: () => void;
  onToggleBookmark: () => void;
  onSetViewMode: (mode: ViewMode) => void;
  onSetFontScale: (scale: number) => void;
  onSetLineSpacing: (spacing: number) => void;
  onSetLetterSpacing: (spacing: number) => void;
  onSetContentWidth: (widthEm: number) => void;
  onSetFontFamily: (family: FontFamilyChoice) => void;
  onSetPageTheme: (theme: PageTheme) => void;
  onSetBrightness: (brightness: number) => void;
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

/** A small color swatch shown in place of a plain icon beside each
 * "Reader theme" option — an actual preview of that theme's own chrome
 * background (the exact `backgroundSolid` gradient/color `chromeTheme.ts`
 * paints the toolbar/panels with), not just a generic bullet, so a
 * reader can tell at a glance what each named option actually looks
 * like rather than having to apply it first to find out. Sits in
 * `MenuItemRadio`'s `icon` slot, which accepts any element, not just a
 * literal icon component.
 *
 * The small dot in the corner previews `accent` (issue #86) — the same
 * saturated color the progress scrubber picks up for that theme — so
 * this menu is also where a reader first sees that a theme now carries
 * a genuine accent color, not just its own soft background tint. */
const ThemeSwatch: FC<{ background: string; accent: string }> = ({ background, accent }) => (
  <span
    aria-hidden="true"
    style={{
      position: "relative",
      display: "inline-block",
      width: 20,
      height: 20,
      borderRadius: 4,
      background,
      border: "1px solid rgba(0, 0, 0, 0.15)",
      boxSizing: "border-box",
    }}
  >
    <span
      style={{
        position: "absolute",
        bottom: -2,
        right: -2,
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: accent,
        border: "1.5px solid var(--colorNeutralBackground1, #fff)",
        boxSizing: "border-box",
      }}
    />
  </span>
);

/** The reader's toolbar: an unobtrusive, translucent overlay (see
 * `useAutoHideChrome`) in a silvery neutral tone deliberately distinct
 * from the book page itself (see `chromeTheme`), rather than a chrome
 * bar permanently competing with the page for attention.
 *
 * Deliberately compact — kept to a small, mostly-icon-only row rather
 * than growing a button per feature. Chapter/page navigation has no
 * toolbar button at all: it's a keyboard-arrow/click/drag affair (see
 * `ReaderController.turnPage`/`beginDragPageTurn`) for pages, a standard
 * Ctrl/Cmd+ArrowRight/Left shortcut for chapters (see
 * `AccessibilityController`'s `onNextChapter`/`onPreviousChapter`), the
 * Table of Contents for jumping to a specific one by name, and the
 * progress scrubber for drag-to-seek — a dedicated "Navigate" menu
 * (compass icon) used to duplicate all four of those in one place and
 * was removed for being pure screen-clutter; "Go to Page…"/"Go to
 * Percentage…" moved to the Book Details panel instead (see
 * `BookDetailsPanel`). Typography and page-layout settings (font size/
 * family, line/character spacing, column width, page style) share
 * one "Aa" menu with two cascading submenus ("Text"/"Page") rather than
 * either a flat wall of every setting at once or two separate top-level
 * buttons — kept apart from the gear "Settings" menu (reading mode, page
 * turn animation, reader theme) since typography is what a reader
 * reaches for far more often. Built to scale to more settings later
 * (more submenus, not more top-level buttons) without needing another
 * redesign.
 *
 * Persisting every chosen setting is `ReaderController`'s job, not this
 * component's — it just reflects/changes current state. */
export const Toolbar: FC<ToolbarProps> = ({
  snapshot,
  isTocOpen,
  onToggleToc,
  isSearchOpen,
  onToggleSearch,
  isAnnotationsOpen,
  onToggleAnnotations,
  isDetailsOpen,
  onToggleDetails,
  onToggleBookmark,
  onSetViewMode,
  onSetFontScale,
  onSetLineSpacing,
  onSetLetterSpacing,
  onSetContentWidth,
  onSetFontFamily,
  onSetPageTheme,
  onSetBrightness,
  onSetChromeTheme,
  onSetPageTurnAnimationStyle,
  visible,
  handlers,
}) => {
  const chromePalette = useChromeTheme();
  const reduceMotion = usePrefersReducedMotion();
  const t = useTranslation();

  // Centers the title/chapter group within the space left over between
  // the TOC toggle and the menu buttons whenever it comfortably fits
  // there without truncating — falling back to today's left-aligned,
  // chapter-truncates-first layout in narrower windows, per explicit
  // design direction. `titleGroupRef`/`measureRef` render the *exact*
  // same "Title — Chapter" text, but `measureRef`'s copy is always
  // `white-space: nowrap` and invisible, existing purely so its
  // `scrollWidth` reports the group's true, untruncated width — `<span
  // style="text-overflow: ellipsis">`'s own `scrollWidth` would report
  // the same untruncated width regardless (that's just how the CSS
  // property works, not exclusive to visibly-truncated text), but only
  // once *this* render's actual title/chapter text has painted, whereas
  // the hidden measuring copy can be sized independently of whatever
  // layout mode is currently active — deliberately avoiding a feedback
  // loop where switching modes changes the exact thing being measured.
  // `middleWrapperRef` is the flex:1 region between the two button
  // groups — its own width is unaffected by whether the title/chapter
  // inside it is a normal flex child or pulled out via `position:
  // absolute` for centering, so comparing against it stays stable
  // either way.
  const titleGroupRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const middleWrapperRef = useRef<HTMLDivElement | null>(null);
  const [canCenterTitle, setCanCenterTitle] = useState(false);

  useEffect(() => {
    const middleEl = middleWrapperRef.current;
    const measureEl = measureRef.current;
    if (!middleEl || !measureEl) {
      return;
    }
    const check = (): void => {
      setCanCenterTitle(measureEl.scrollWidth <= middleEl.clientWidth);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(middleEl);
    return () => observer.disconnect();
  }, [snapshot.title, snapshot.currentChapterLabel]);

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
          transition: reduceMotion
            ? "none"
            : "opacity 240ms ease, transform 240ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 240ms ease",
        }}
      >
        <Tooltip content={isTocOpen ? t("toolbar.hideContents") : t("toolbar.showContents")} relationship="label">
          <ToggleButton
            appearance="subtle"
            size="small"
            checked={isTocOpen}
            icon={<TextBulletListRegular />}
            onClick={onToggleToc}
          />
        </Tooltip>

        <Tooltip
          content={isAnnotationsOpen ? t("toolbar.hideBookmarksAndHighlights") : t("toolbar.bookmarksAndHighlights")}
          relationship="label"
        >
          <ToggleButton
            appearance="subtle"
            size="small"
            checked={isAnnotationsOpen}
            icon={<ReadingListRegular />}
            onClick={onToggleAnnotations}
          />
        </Tooltip>

        {/* Book title + current chapter, sharing one flexible region: the
            chapter name (shown here because it's otherwise only visible
            in the running header underneath — see `PageFurniture` — which
            this same toolbar covers whenever it's shown) is deliberately
            the first thing to truncate/disappear as the toolbar narrows,
            never the book title.
            
            Centered within this region (see `canCenterTitle`'s doc
            comment) whenever it comfortably fits without truncating,
            falling back to the left-aligned/truncating layout below in
            narrower windows. */}
        <div
          ref={middleWrapperRef}
          style={{
            flex: 1,
            minWidth: 0,
            // Both children of this wrapper (the hidden measuring clone,
            // always, and the visible title group, always pulled out via
            // `position: absolute` — see `titleGroupRef` below) stop
            // contributing to normal-flow height entirely — with nothing
            // left in normal flow, the wrapper's own height collapses to
            // 0, and `overflow: hidden` then clips the absolutely
            // positioned title completely invisible even though it's
            // "there" in the DOM with correct styles. `alignSelf: stretch`
            // makes this flex item take the row's real height (set by the
            // button siblings) instead of shrinking to its own
            // (nonexistent) content height, so the title has room to
            // paint regardless of which layout mode is active.
            alignSelf: "stretch",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            ref={measureRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              // Without an explicit width, an absolutely positioned box
              // with `left` set but not `right` uses a shrink-to-fit
              // algorithm that's capped by the *available* space in its
              // containing block (`middleWrapperRef`) — so on a narrow
              // window this clone would silently shrink to fit the
              // available space instead of reporting the text's true,
              // unconstrained width, making `scrollWidth` equal
              // `clientWidth` (always "fits") even when the real title
              // doesn't. `width: max-content` forces it to size to its
              // actual content every time, which is the whole point of
              // this hidden clone.
              width: "max-content",
              visibility: "hidden",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "baseline",
              gap: 6,
            }}
          >
            <Body1 as="span" style={{ fontWeight: 600 }}>
              {snapshot.title}
            </Body1>
            <Caption1 as="span">— {snapshot.currentChapterLabel}</Caption1>
          </div>

          <div
            ref={titleGroupRef}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              minWidth: 0,
              overflow: "hidden",
              // Always absolutely positioned now (in both layout modes)
              // so a flip between them — triggered by a chapter change
              // that crosses the "does it fit centered?" threshold, most
              // commonly right as a page turn lands on a new chapter —
              // animates smoothly via the `transition` below instead of
              // an instant snap between two incompatible layout systems
              // (a plain flex child can't be transitioned into an
              // absolutely-centered one; `left`/`top`/`transform` on the
              // other hand animate perfectly well). `right: 0` in the
              // non-centered case gives this the same full-width-minus-
              // nothing box the old `flex: 1` flex-child version had, so
              // the chapter label still has room to truncate with an
              // ellipsis exactly as before.
              position: "absolute",
              top: "50%",
              left: canCenterTitle ? "50%" : 0,
              right: canCenterTitle ? undefined : 0,
              transform: canCenterTitle ? "translate(-50%, -50%)" : "translateY(-50%)",
              whiteSpace: canCenterTitle ? "nowrap" : undefined,
              transition: reduceMotion ? "none" : "left 220ms ease, right 220ms ease, transform 220ms ease",
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
                truncate and eventually disappear, never the book title.
                When centered, it never needs to shrink at all — that's
                exactly the case `canCenterTitle` already confirmed has
                enough room. */}
            <Caption1
              as="span"
              style={{
                minWidth: 0,
                flex: canCenterTitle ? undefined : 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--colorNeutralForeground2, #444)",
              }}
            >
              — {snapshot.currentChapterLabel}
            </Caption1>
          </div>
        </div>

        {/* No page-number display in the toolbar itself — it lives in
            the running footer (see `PageFurniture`) instead. Showing it
            here too was confusing: chapter-relative vs. book-wide page
            numbers side by side (footer + toolbar) read as two different,
            possibly conflicting counts.

            The compass "Navigate" menu that used to sit here (Chapter/
            Page/Go to) was removed entirely: chapter jumps duplicated
            the Table of Contents, page-by-page nav duplicated arrow-key/
            click/drag turning, and "Go to" duplicated the progress
            scrubber's own drag-to-seek — four buttons of screen-clutter
            for actions a reader already had two or three other ways to
            do. Chapter jumping now has a standard keyboard shortcut
            instead (Ctrl/Cmd+ArrowRight/Left — see
            `AccessibilityController`'s `onNextChapter`/`onPreviousChapter`
            and `ReaderApp`'s parent-document mirror of the same
            shortcut), and "Go to Page…"/"Go to Percentage…" moved to the
            Book Details panel (see `BookDetailsPanel`). */}

        {/* Search now stands on its own, separated by a gap from the
            Text/Settings/Details cluster that follows (issue #78) —
            previously grouped tightly alongside them, which read as
            "one more settings-ish button" even though searching the
            book isn't a settings/configuration action at all. Text
            options, Settings, and Book Details stay grouped closely
            together immediately after, per the same explicit direction. */}
        <Tooltip content={isSearchOpen ? t("toolbar.hideSearch") : t("toolbar.search")} relationship="label">
          <ToggleButton
            appearance="subtle"
            size="small"
            checked={isSearchOpen}
            icon={<SearchRegular />}
            onClick={onToggleSearch}
            style={{ marginLeft: 8 }}
          />
        </Tooltip>

        {!snapshot.isFixedLayout && (
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content={t("toolbar.textOptions")} relationship="label">
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<TextFontRegular />}
                  style={{ marginLeft: 8 }}
                />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                {/* Two cascading submenus ("Text"/"Page") rather than one
                    flat list of four groups — each opens its own popover
                    on hover/Enter/ArrowRight, Fluent's standard nested-
                    menu pattern (built-in ARIA: `aria-haspopup`, arrow-key
                    open/close, `Escape` steps back one level rather than
                    closing everything at once). Each nested `<Menu>` gets
                    its own `checkedValues`/`onCheckedValueChange`, scoped
                    to just the radio group(s) inside it — simpler and
                    more robust than trying to thread one shared context
                    through the submenu boundary. */}
                <Menu
                  persistOnItemClick
                  checkedValues={{
                    [FONT_FAMILY_GROUP_NAME]: [snapshot.fontFamily],
                  }}
                  onCheckedValueChange={(_event, data) => {
                    if (data.name === FONT_FAMILY_GROUP_NAME) {
                      onSetFontFamily(data.checkedItems[0] as FontFamilyChoice);
                    }
                  }}
                >
                  <MenuTrigger disableButtonEnhancement>
                    <MenuItem icon={<TextFontRegular />}>Text</MenuItem>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuGroup>
                        <MenuGroupHeader>Size</MenuGroupHeader>
                        <div style={{ padding: "6px 12px 10px" }}>
                          <DefaultableSlider
                            min={ReadingTheme.MIN_FONT_SCALE}
                            max={ReadingTheme.MAX_FONT_SCALE}
                            step={ReadingTheme.FONT_SCALE_STEP}
                            value={snapshot.fontScale}
                            defaultValue={ReadingTheme.DEFAULT_FONT_SCALE}
                            onChange={onSetFontScale}
                            aria-label="Font size"
                          />
                        </div>
                      </MenuGroup>
                      <MenuDivider />
                      <MenuGroup>
                        <MenuGroupHeader>Line spacing</MenuGroupHeader>
                        <div style={{ padding: "6px 12px 10px" }}>
                          <DefaultableSlider
                            min={ReadingTheme.MIN_LINE_SPACING}
                            max={ReadingTheme.MAX_LINE_SPACING}
                            step={ReadingTheme.LINE_SPACING_STEP}
                            value={snapshot.lineSpacing}
                            defaultValue={ReadingTheme.DEFAULT_LINE_SPACING}
                            onChange={onSetLineSpacing}
                            aria-label="Line spacing"
                          />
                        </div>
                      </MenuGroup>
                      <MenuDivider />
                      <MenuGroup>
                        <MenuGroupHeader>Character spacing</MenuGroupHeader>
                        <div style={{ padding: "6px 12px 10px" }}>
                          <DefaultableSlider
                            min={ReadingTheme.MIN_LETTER_SPACING}
                            max={ReadingTheme.MAX_LETTER_SPACING}
                            step={ReadingTheme.LETTER_SPACING_STEP}
                            value={snapshot.letterSpacing}
                            defaultValue={ReadingTheme.DEFAULT_LETTER_SPACING}
                            onChange={onSetLetterSpacing}
                            aria-label="Character spacing"
                          />
                        </div>
                      </MenuGroup>
                      <MenuDivider />
                      <MenuGroup>
                        <MenuGroupHeader>Font</MenuGroupHeader>
                        {(Object.keys(ReadingTheme.FONT_FAMILIES) as FontFamilyChoice[]).map((key) => {
                          // Preview each option in its own typeface (falling back
                          // to the toolbar's own font for "Book default", which
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
                    </MenuList>
                  </MenuPopover>
                </Menu>

                <Menu
                  persistOnItemClick
                  checkedValues={{
                    [PAGE_THEME_GROUP_NAME]: [snapshot.pageTheme],
                  }}
                  onCheckedValueChange={(_event, data) => {
                    if (data.name === PAGE_THEME_GROUP_NAME) {
                      onSetPageTheme(data.checkedItems[0] as PageTheme);
                    }
                  }}
                >
                  <MenuTrigger disableButtonEnhancement>
                    <MenuItem icon={<DocumentOnePageColumnsRegular />}>Page</MenuItem>
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuGroup>
                        {/* Labeled by the underlying value it directly controls
                            (a wider value = a wider text column) rather than
                            "Margins" (the inverse framing some readers use,
                            where turning it up means *narrower* text/more
                            margin) — avoids an inverted slider whose visual
                            direction wouldn't match its own value. Named
                            "Column width" (issue #77), not "Page text
                            width" — this is a two-page spread's column
                            measure just as much as a single page's, and
                            "column" is the more precise, print-typography
                            term for what's actually being adjusted. */}
                        <MenuGroupHeader>Column width</MenuGroupHeader>
                        <div style={{ padding: "6px 12px 10px" }}>
                          <DefaultableSlider
                            min={ReadingTheme.MIN_CONTENT_WIDTH_EM}
                            max={ReadingTheme.MAX_CONTENT_WIDTH_EM}
                            step={ReadingTheme.CONTENT_WIDTH_STEP}
                            value={snapshot.contentWidthEm}
                            defaultValue={ReadingTheme.DEFAULT_CONTENT_WIDTH_EM}
                            onChange={onSetContentWidth}
                            aria-label="Column width"
                          />
                        </div>
                      </MenuGroup>
                      <MenuDivider />
                      <MenuGroup>
                        <MenuGroupHeader>Page style</MenuGroupHeader>
                        {(Object.keys(ReadingTheme.PAGE_THEMES) as PageTheme[]).map((key) => (
                          <MenuItemRadio key={key} name={PAGE_THEME_GROUP_NAME} value={key}>
                            {ReadingTheme.PAGE_THEMES[key].label}
                          </MenuItemRadio>
                        ))}
                      </MenuGroup>
                      <MenuDivider />
                      <MenuGroup>
                        {/* Issue #92: dims the whole page (text, background,
                            and any images) below whichever "Page style"
                            theme is active — a single slider that works the
                            same way across every theme, rather than a
                            separate darkening mechanism per theme, since a
                            plain brightness filter already dims a lighter
                            theme's whole page while dimming mostly the
                            *text* of the already-dark "Dark" theme, exactly
                            the two behaviors asked for. */}
                        <MenuGroupHeader>Brightness</MenuGroupHeader>
                        <div style={{ padding: "6px 12px 10px" }}>
                          <DefaultableSlider
                            min={ReadingTheme.MIN_BRIGHTNESS}
                            max={ReadingTheme.MAX_BRIGHTNESS}
                            step={ReadingTheme.BRIGHTNESS_STEP}
                            value={snapshot.brightness}
                            defaultValue={ReadingTheme.DEFAULT_BRIGHTNESS}
                            onChange={onSetBrightness}
                            aria-label="Brightness"
                          />
                        </div>
                      </MenuGroup>
                    </MenuList>
                  </MenuPopover>
                </Menu>
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
            <Tooltip content={t("toolbar.settings")} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                icon={<SettingsRegular />}
                // Only the "Aa" menu (Text and page layout) is skipped
                // for fixed-layout books, at which point Settings becomes
                // the first button in this group instead — it needs the
                // same grouping gap "Aa" normally carries in that case,
                // not an extra one stacked on top of it otherwise.
                style={snapshot.isFixedLayout ? { marginLeft: 8 } : undefined}
              />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {!snapshot.isFixedLayout && (
                <>
                  <MenuGroup>
                    <MenuGroupHeader>Reading mode</MenuGroupHeader>
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
                    <MenuGroupHeader>Page turn</MenuGroupHeader>
                    <MenuItemRadio
                      name={PAGE_TURN_ANIMATION_GROUP_NAME}
                      value="rotate"
                      secondaryContent="Experimental"
                    >
                      Page flip
                    </MenuItemRadio>
                    <MenuItemRadio name={PAGE_TURN_ANIMATION_GROUP_NAME} value="slide">
                      Slide
                    </MenuItemRadio>
                    <MenuItemRadio name={PAGE_TURN_ANIMATION_GROUP_NAME} value="scroll">
                      Film strip
                    </MenuItemRadio>
                    <MenuItemRadio name={PAGE_TURN_ANIMATION_GROUP_NAME} value="none">
                      Off
                    </MenuItemRadio>
                  </MenuGroup>
                  <MenuDivider />
                </>
              )}
              <MenuGroup>
                <MenuGroupHeader>Reader theme</MenuGroupHeader>
                {(Object.keys(CHROME_THEMES) as ChromeThemeChoice[]).map((key) => (
                  <MenuItemRadio
                    key={key}
                    name={CHROME_THEME_GROUP_NAME}
                    value={key}
                    icon={
                      <ThemeSwatch
                        background={CHROME_THEMES[key].backgroundSolid}
                        accent={CHROME_THEMES[key].accent}
                      />
                    }
                  >
                    {CHROME_THEMES[key].label}
                  </MenuItemRadio>
                ))}
              </MenuGroup>
            </MenuList>
          </MenuPopover>
        </Menu>

        <Tooltip
          content={isDetailsOpen ? t("toolbar.hideBookDetails") : t("toolbar.bookDetails")}
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

        {/* Bookmark stands alone at the far right, set apart from the
            Text/Settings/Details group with some extra breathing room
            (beyond the toolbar's own uniform `gap`) — per explicit
            design direction, the toolbar reads as three loose clusters
            left to right: Search on its own (issue #78: previously
            grouped tightly with Text/Settings/Details, which read as
            "one more settings-ish button" even though searching isn't
            a settings/configuration action), then Text/Settings/Details
            grouped closely together (issue #68: Search used to dock
            here too, alongside Book Details on the same, opposite edge
            of the reader pane — see `SearchPanel`'s doc comment), then
            Bookmark on its own at the end. (A fourth "Navigate" cluster
            used to sit further left — removed as redundant clutter, see
            this file's doc comment.)

            A single toggle rather than a plain "add" action (issue
            #47): pressed/filled whenever any bookmark already falls on
            whichever page(s) are visible right now (`snapshot.isBookmarked`,
            resolved against the *live* page content, not just "was one
            ever added to this chapter") — clicking it either adds one
            at the current position or removes every bookmark on the
            current page(s), whichever the pressed state says is about
            to happen. */}
        <Tooltip
          content={snapshot.isBookmarked ? t("toolbar.removeBookmark") : t("toolbar.bookmarkThisPage")}
          relationship="label"
        >
          <ToggleButton
            appearance="subtle"
            size="small"
            checked={snapshot.isBookmarked}
            icon={snapshot.isBookmarked ? <BookmarkFilled /> : <BookmarkRegular />}
            onClick={onToggleBookmark}
            style={{ marginLeft: 8 }}
          />
        </Tooltip>
      </div>
    </>
  );
};
