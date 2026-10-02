import { useLayoutEffect, useRef, useState } from "react";
import type { FC, RefCallback } from "react";
import {
  Body1,
  Button,
  Caption1,
  ToggleButton,
  Tooltip,
  makeStyles,
  mergeClasses,
} from "@fluentui/react-components";
import {
  BookInformationRegular,
  BookmarkFilled,
  BookmarkRegular,
  LibraryRegular,
  QuestionCircleRegular,
  SearchRegular,
  TextBulletListRegular,
} from "@fluentui/react-icons";
import type { ReaderSnapshot } from "../ReaderTypes.js";
import {
  CHROME_BACKDROP_FILTER,
  CHROME_BORDER,
  CHROME_HOVER_BACKGROUND,
  CHROME_SHADOW,
} from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { TypographyMenu } from "./ReaderPreferencesMenus.js";
import type { ReaderSettingsMenuActions, TypographyMenuActions } from "./ReaderPreferencesMenus.js";
import { AmbraSettingsPopover } from "../../components/AmbraSettingsPopover.js";
import { useChromeToolbarStyles } from "../../components/ChromeToolbarStyles.js";
import { useCommandPresentation } from "../../shortcuts/useCommandPresentation.js";
import { AnnotationsIcon } from "./AnnotationsIcon.js";

const useReaderToolbarStyles = makeStyles({
  root: {
    "--ambra-toolbar-gap": "10px",
    "--ambra-toolbar-cluster-gap": "8px",
    "@media (max-width: 480px)": {
      "--ambra-toolbar-gap": "2px",
      "--ambra-toolbar-cluster-gap": "0px",
    },
    "@container reader-pane (max-width: 480px)": {
      "--ambra-toolbar-gap": "2px",
      "--ambra-toolbar-cluster-gap": "0px",
    },
  },
  navigationLabel: {
    "@media (max-width: 800px)": { display: "none" },
    "@container reader-pane (max-width: 800px)": { display: "none" },
  },
  navigationButton: {
    fontSize: "14px",
    lineHeight: "21px",
    "@media (max-width: 800px)": { minWidth: "28px", paddingInline: "4px" },
    "@container reader-pane (max-width: 800px)": { minWidth: "28px", paddingInline: "4px" },
  },
  titleButton: {
    ":focus-visible": {
      outline: "2px solid var(--colorNeutralForeground1, #242424)",
      outlineOffset: "-2px",
    },
  },
});

export type ReaderToolbarMenu = "typography" | "settings";

export interface ToolbarProps extends TypographyMenuActions, ReaderSettingsMenuActions {
  onOpenHelp: (returnFocusTo: HTMLElement | null) => void;
  isHelpOpen: boolean;
  openMenu: ReaderToolbarMenu | undefined;
  onOpenMenuChange: (menu: ReaderToolbarMenu | undefined) => void;
  snapshot: ReaderSnapshot;
  isLibraryOpen: boolean;
  onToggleLibrary: () => void;
  isTocOpen: boolean;
  onToggleToc: () => void;
  isSearchOpen: boolean;
  onToggleSearch: () => void;
  isAnnotationsOpen: boolean;
  onToggleAnnotations: () => void;
  isDetailsOpen: boolean;
  onToggleDetails: () => void;
  onToggleBookmark: () => void;
  /** Whether the toolbar should currently be shown, and the pointer/
   * focus handlers that keep it visible — lifted up into `ReaderApp` (see
   * `useAutoHideChrome`) rather than owned here, so `ProgressScrubber`
   * can share the exact same show/hide state and the two fade together
   * as one unit of chrome instead of drifting out of sync. */
  visible: boolean;
  handlers: {
    ref?: RefCallback<HTMLDivElement>;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
}

/** The reader's toolbar: an unobtrusive, translucent overlay (see
 * `useAutoHideChrome`) in a silvery neutral tone deliberately distinct
 * from the book page itself (see `chromeTheme`), rather than a chrome
 * bar permanently competing with the page for attention.
 *
 * Deliberately compact — kept to a small, mostly-icon-only row rather
 * than growing a button per feature. Chapter/page navigation has no
 * toolbar button at all: it's a keyboard-arrow/click/drag affair (see
 * `ReaderController.turnPage`/`beginDragPageTurn`) for pages, a standard
 * Alt+PageUp/PageDown shortcut for sections, the
 * Table of Contents for jumping to a specific one by name, and the
 * progress scrubber for drag-to-seek — a dedicated "Navigate" menu
 * (compass icon) used to duplicate all four of those in one place and
 * was removed for being pure screen-clutter; "Go to Page…"/"Go to
 * Percentage…" are keyboard commands (see `ReaderCommands`).
 * Typography and page-layout settings (font size/
 * family, line/character spacing, column width, single-page display) share
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
  openMenu,
  onOpenMenuChange,
  snapshot,
  isLibraryOpen,
  onToggleLibrary,
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
  onSetAlwaysShowOnePage,
  onSetFontFamily,
  onSetPageTheme,
  onSetBrightness,
  onSetChromeTheme,
  onSetPageTurnAnimationStyle,
  onSetProgressMarkerStyle,
  onOpenHelp,
  isHelpOpen,
  visible,
  handlers,
}) => {
  const chromePalette = useChromeTheme();
  const reduceMotion = usePrefersReducedMotion();
  const t = useTranslation();
  const searchShortcut = useCommandPresentation("searchBook");
  const bookmarkShortcut = useCommandPresentation("toggleBookmark");
  const searchLabel = isSearchOpen ? t("toolbar.hideSearch") : t("toolbar.search");
  const bookmarkLabel = snapshot.isBookmarked ? t("toolbar.removeBookmark") : t("toolbar.bookmarkThisPage");

  // Measure an unconstrained copy so centering never feeds back into its own
  // fit calculation. Title and chapter truncate independently on separate lines.
  const titleGroupRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const middleWrapperRef = useRef<HTMLDivElement | null>(null);
  const detailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [canCenterTitle, setCanCenterTitle] = useState(false);
  const [hasTitleRoom, setHasTitleRoom] = useState(false);
  const [helpTooltipVisible, setHelpTooltipVisible] = useState(false);

  useLayoutEffect(() => {
    const middleEl = middleWrapperRef.current;
    const measureEl = measureRef.current;
    if (!middleEl || !measureEl) {
      return;
    }
    const check = (): void => {
      setCanCenterTitle(measureEl.scrollWidth <= middleEl.clientWidth);
      const hasRoom = middleEl.clientWidth >= 80;
      if (!hasRoom && titleGroupRef.current?.contains(document.activeElement)) {
        detailsButtonRef.current?.focus({ preventScroll: true });
      }
      setHasTitleRoom(hasRoom);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(middleEl);
    return () => observer.disconnect();
  }, [snapshot.title, snapshot.currentChapterLabel]);

  const toolbarStyles = useChromeToolbarStyles();
  const readerStyles = useReaderToolbarStyles();

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
        data-ambra-page-band
        onPointerEnter={handlers.onPointerEnter}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, zIndex: 9 }}
      />

      <div
        ref={handlers.ref}
        data-ambra-page-band
        className={mergeClasses(toolbarStyles.root, readerStyles.root)}
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
          gap: "var(--ambra-toolbar-gap)",
          padding: "4px 10px",
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
            className={readerStyles.navigationButton}
            appearance="subtle"
            size="small"
            checked={isTocOpen}
            icon={<TextBulletListRegular />}
            onClick={onToggleToc}
          >
            <span className={readerStyles.navigationLabel}>{t("toc.contents")}</span>
          </ToggleButton>
        </Tooltip>

        <Tooltip content={isLibraryOpen ? t("toolbar.hideLibrary") : t("toolbar.backToLibrary")} relationship="label">
          <ToggleButton className={readerStyles.navigationButton} appearance="subtle" size="small" icon={<LibraryRegular />}
            checked={isLibraryOpen} onClick={onToggleLibrary}>
            <span className={readerStyles.navigationLabel}>{t("toolbar.backToLibrary")}</span>
          </ToggleButton>
        </Tooltip>

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
            visibility: hasTitleRoom ? "visible" : "hidden",
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
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Body1 as="span" style={{ fontWeight: 600, padding: "2px 4px" }}>
              {snapshot.title}
            </Body1>
            {snapshot.currentChapterLabel && <Caption1 as="span">{snapshot.currentChapterLabel}</Caption1>}
          </div>

          <div
            ref={titleGroupRef}
            data-ambra-toolbar-title
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: canCenterTitle ? "center" : "flex-start",
              minWidth: 0,
              maxWidth: "100%",
              overflow: "hidden",
              // Measure before paint and position without a transition:
              // startup/resume must not slide provisional labels across
              // the toolbar. `right: 0` keeps the narrow layout bounded.
              position: "absolute",
              top: "50%",
              left: canCenterTitle ? "50%" : 0,
              right: canCenterTitle ? undefined : 0,
              transform: canCenterTitle ? "translate(-50%, -50%)" : "translateY(-50%)",
              whiteSpace: canCenterTitle ? "nowrap" : undefined,
            }}
          >
            <Tooltip content={t("toolbar.bookDetails")} relationship="description">
              <button
                type="button"
                className={readerStyles.titleButton}
                onClick={onToggleDetails}
                style={{
                  flexShrink: 0,
                  minWidth: 0,
                  maxWidth: "100%",
                  display: "block",
                  background: "none",
                  border: "none",
                  padding: "2px 4px",
                  margin: 0,
                  borderRadius: 4,
                  color: "inherit",
                  font: "inherit",
                  cursor: "pointer",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = CHROME_HOVER_BACKGROUND;
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = "none";
                }}
              >
                <Body1
                  as="span"
                  style={{
                    display: "block",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {snapshot.title}
                </Body1>
              </button>
            </Tooltip>

            {snapshot.currentChapterLabel && <Caption1
              as="span"
              style={{
                minWidth: 0,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--colorNeutralForeground2, #444)",
              }}
            >
              {snapshot.currentChapterLabel}
            </Caption1>}
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
            shortcut), and "Go to Page…"/"Go to Percentage…" are keyboard
            commands rather than toolbar or Book Details controls. */}

        <Tooltip
          content={searchShortcut.shortcutLabel ? `${searchLabel} (${searchShortcut.shortcutLabel})` : searchLabel}
          relationship="description"
        >
          <ToggleButton
            aria-label={searchLabel}
            aria-keyshortcuts={searchShortcut.ariaKeyShortcuts}
            appearance="subtle"
            size="small"
            checked={isSearchOpen}
            icon={<SearchRegular />}
            onClick={onToggleSearch}
            style={{ marginInlineEnd: "var(--ambra-toolbar-cluster-gap)" }}
          />
        </Tooltip>

        {!snapshot.isFixedLayout && (
          <TypographyMenu
            open={openMenu === "typography"}
            onOpenChange={open => onOpenMenuChange(open ? "typography" : undefined)}
            fontScale={snapshot.fontScale}
            lineSpacing={snapshot.lineSpacing}
            letterSpacing={snapshot.letterSpacing}
            contentWidthEm={snapshot.contentWidthEm}
            fontFamily={snapshot.fontFamily}
            alwaysShowOnePage={snapshot.alwaysShowOnePage}
            onSetFontScale={onSetFontScale}
            onSetLineSpacing={onSetLineSpacing}
            onSetLetterSpacing={onSetLetterSpacing}
            onSetContentWidth={onSetContentWidth}
            onSetFontFamily={onSetFontFamily}
            onSetAlwaysShowOnePage={onSetAlwaysShowOnePage}
          />
        )}

        <Tooltip
          content={isAnnotationsOpen ? t("toolbar.hideBookmarksAndHighlights") : t("toolbar.bookmarksAndHighlights")}
          relationship="label"
        >
          <ToggleButton
            className={readerStyles.navigationButton}
            appearance="subtle"
            size="small"
            checked={isAnnotationsOpen}
            icon={<AnnotationsIcon />}
            onClick={onToggleAnnotations}
          >
            <span className={readerStyles.navigationLabel}>{t("toolbar.bookmarksAndHighlights")}</span>
          </ToggleButton>
        </Tooltip>

        <Tooltip
          content={isDetailsOpen ? t("toolbar.hideBookDetails") : t("toolbar.bookDetails")}
          relationship="label"
        >
          <ToggleButton
            ref={detailsButtonRef}
            appearance="subtle"
            size="small"
            checked={isDetailsOpen}
            icon={<BookInformationRegular />}
            onClick={onToggleDetails}
          />
        </Tooltip>

        <AmbraSettingsPopover
          open={openMenu === "settings"}
          onOpenChange={open => {
            if (open) setHelpTooltipVisible(false);
            onOpenMenuChange(open ? "settings" : undefined);
          }}
          readingFirst
          isFixedLayout={snapshot.isFixedLayout}
          settings={{
            viewMode: snapshot.viewMode, brightness: snapshot.brightness,
            pageTheme: snapshot.pageTheme, chromeTheme: snapshot.chromeTheme,
            pageTurnAnimationStyle: snapshot.pageTurnAnimationStyle,
            progressMarkerStyle: snapshot.progressMarkerStyle ?? "upcoming",
          }}
          onChange={patch => {
            if (patch.viewMode !== undefined) onSetViewMode(patch.viewMode);
            if (patch.brightness !== undefined) onSetBrightness(patch.brightness);
            if (patch.pageTheme !== undefined) onSetPageTheme(patch.pageTheme);
            if (patch.chromeTheme !== undefined) onSetChromeTheme(patch.chromeTheme);
            if (patch.pageTurnAnimationStyle !== undefined) onSetPageTurnAnimationStyle(patch.pageTurnAnimationStyle);
            if (patch.progressMarkerStyle !== undefined) onSetProgressMarkerStyle(patch.progressMarkerStyle);
          }}
        />

        <Tooltip content={t("settings.helpAbout")} relationship="label"
          visible={helpTooltipVisible && !isHelpOpen && openMenu !== "settings"}
          onVisibleChange={(_event, data) => setHelpTooltipVisible(data.visible && !isHelpOpen && openMenu !== "settings")}>
          <Button appearance="subtle" size="small" icon={<QuestionCircleRegular />}
            onClick={event => {
              setHelpTooltipVisible(false);
              onOpenHelp(event.currentTarget);
            }} />
        </Tooltip>

        <Tooltip
          content={bookmarkShortcut.shortcutLabel ? `${bookmarkLabel} (${bookmarkShortcut.shortcutLabel})` : bookmarkLabel}
          relationship="description"
        >
          <ToggleButton
            aria-label={bookmarkLabel}
            aria-keyshortcuts={bookmarkShortcut.ariaKeyShortcuts}
            appearance="subtle"
            size="small"
            checked={snapshot.isBookmarked}
            icon={snapshot.isBookmarked ? <BookmarkFilled /> : <BookmarkRegular />}
            onClick={(event) => {
              onToggleBookmark();
              // Pointer activation must not pin chrome; keyboard/AT keeps focus.
              if (event.detail > 0) event.currentTarget.blur();
            }}
            style={{ marginLeft: "var(--ambra-toolbar-cluster-gap)" }}
          />
        </Tooltip>
      </div>
    </>
  );
};
