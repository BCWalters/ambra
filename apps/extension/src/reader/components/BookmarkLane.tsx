import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Button, Popover, PopoverSurface, PopoverTrigger, makeStyles, tokens,
} from "@fluentui/react-components";
import { BookmarkFilled } from "@fluentui/react-icons";
import type { Bookmark } from "../../library/LibraryDatabase.js";
import type { BookmarkLocation, BookmarkProgressMarker } from "../BookmarkManager.js";
import { BOOKMARK_ROW_HEIGHT, groupBookmarkMarkers } from "../BookmarkGroups.js";
import { useTranslation } from "../../i18n/LocaleContext.js";

const MAX_CHOICES = 5;
const useStyles = makeStyles({
  lane: {
    position: "relative",
    height: `${BOOKMARK_ROW_HEIGHT}px`,
  },
  flag: {
    position: "absolute",
    top: 0,
    minWidth: 0,
    height: `${BOOKMARK_ROW_HEIGHT}px`,
    minHeight: `${BOOKMARK_ROW_HEIGHT}px`,
    padding: 0,
    columnGap: "1px",
    transform: "translateX(-50%)",
    color: tokens.colorBrandForeground1,
    "@media (forced-colors: active)": { color: "CanvasText" },
  },
  icon: { width: "18px", height: "18px" },
  count: { fontSize: "10px", lineHeight: "16px", fontVariantNumeric: "tabular-nums" },
  surface: {
    width: "280px",
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "min(360px, calc(100dvh - 16px))",
    boxSizing: "border-box",
    padding: tokens.spacingHorizontalM,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
  title: { margin: 0, fontSize: tokens.fontSizeBase300, flexShrink: 0 },
  range: {
    margin: 0,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    flexShrink: 0,
  },
  choices: {
    display: "grid",
    gap: tokens.spacingVerticalXS,
    minHeight: 0,
    overflowY: "auto",
    padding: "3px",
    margin: "-3px",
  },
  choice: {
    display: "block",
    textAlign: "start",
    padding: "4px 8px",
    fontSize: tokens.fontSizeBase200,
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
  location: {
    display: "block",
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightRegular,
  },
  all: { flexShrink: 0 },
});

export interface BookmarkLaneProps {
  bookmarks: readonly Bookmark[];
  markers: readonly BookmarkProgressMarker[];
  locations?: Readonly<Record<string, BookmarkLocation>>;
  rtl: boolean;
  onSelect: (bookmark: Bookmark) => void;
  onShowAll: () => void;
  onOpenChange: (open: boolean) => void;
  dismissRequest?: number;
}

export function BookmarkLane({
  bookmarks, markers, locations, rtl, onSelect, onShowAll, onOpenChange, dismissRequest = 0,
}: BookmarkLaneProps) {
  const styles = useStyles();
  const t = useTranslation();
  const headingId = useId();
  const laneRef = useRef<HTMLDivElement>(null);
  const focusedBookmark = useRef<string | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [openGroup, setOpenGroup] = useState<string>();
  const [openMembers, setOpenMembers] = useState<string>();
  const handoffFrame = useRef<number | undefined>(undefined);
  const cancelHandoff = () => {
    if (handoffFrame.current !== undefined) cancelAnimationFrame(handoffFrame.current);
    handoffFrame.current = undefined;
  };
  useEffect(() => cancelHandoff, []);
  const previousDismissRequest = useRef(dismissRequest);
  useLayoutEffect(() => {
    if (previousDismissRequest.current === dismissRequest) return;
    previousDismissRequest.current = dismissRequest;
    cancelHandoff();
    focusedBookmark.current = undefined;
    setOpenGroup(undefined);
    setOpenMembers(undefined);
    onOpenChange(false);
  }, [dismissRequest, onOpenChange]);
  const byId = useMemo(() => new Map(bookmarks.map(bookmark => [bookmark.id, bookmark])), [bookmarks]);
  const groups = useMemo(() => {
    const markerById = new Map(markers.map(marker => [marker.id, marker]));
    // Bookmark order already follows CFIs; retain it for equal page fractions.
    return groupBookmarkMarkers(bookmarks.flatMap(bookmark => {
      const marker = markerById.get(bookmark.id);
      return marker ? [marker] : [];
    }), width);
  }, [bookmarks, markers, width]);
  useLayoutEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;
    const measure = () => setWidth(lane.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(lane);
    return () => observer.disconnect();
  }, []);

  const focusBookmarkFlag = (id: string) => {
    const flags = laneRef.current?.querySelectorAll<HTMLButtonElement>("[data-bookmark-marker]");
    for (const flag of flags ?? []) {
      const group = groups.find(candidate => candidate.markers[0]!.id === flag.dataset.groupId);
      if (group?.markers.some(marker => marker.id === id)) {
        flag.focus({ preventScroll: true });
        return;
      }
    }
  };
  useLayoutEffect(() => {
    const group = groups.find(group => group.markers[0]!.id === openGroup);
    if (openGroup && (
      !group || group.markers.length < 2 ||
      JSON.stringify(group.markers.map(marker => marker.id)) !== openMembers
    )) {
      setOpenGroup(undefined);
      setOpenMembers(undefined);
      onOpenChange(false);
      if (focusedBookmark.current) focusBookmarkFlag(focusedBookmark.current);
    } else if (
      focusedBookmark.current &&
      (document.activeElement === document.body || laneRef.current?.contains(document.activeElement)) &&
      !openGroup
    ) {
      focusBookmarkFlag(focusedBookmark.current);
    }
  }, [groups, openGroup, openMembers, onOpenChange]);

  const closeChooser = () => {
    cancelHandoff();
    setOpenGroup(undefined);
    setOpenMembers(undefined);
    onOpenChange(false);
  };
  const showAllAfterClose = (surface: HTMLElement | null) => {
    cancelHandoff();
    // Exit with focus outside the surface so Tabster never queues a late restore.
    if (openGroup) focusBookmarkFlag(openGroup);
    focusedBookmark.current = undefined;
    setOpenGroup(undefined);
    setOpenMembers(undefined);
    // Fluent must release the exiting chooser's focus scope before the panel opens.
    const afterUnmount = () => {
      if (surface?.isConnected) {
        handoffFrame.current = requestAnimationFrame(afterUnmount);
        return;
      }
      handoffFrame.current = undefined;
      onOpenChange(false);
      onShowAll();
    };
    handoffFrame.current = requestAnimationFrame(afterUnmount);
  };
  const locationLabel = (bookmark: Bookmark) => {
    const location = locations?.[bookmark.id];
    return location?.page.status === "known"
      ? t("annotations.bookmarkPage", { page: location.page.number })
      : t(location?.page.status === "pending"
        ? "annotations.bookmarkPagePending" : "annotations.bookmarkPageUnavailable");
  };

  return (
    <div ref={laneRef} className={styles.lane} data-bookmark-lane="" role="group"
      aria-label={t("annotations.bookmarksTab")}>
      {groups.map(group => {
        const first = group.markers[0]!;
        const bookmark = byId.get(first.id)!;
        const count = group.markers.length;
        const title = locations?.[bookmark.id]?.chapterTitle ?? bookmark.label;
        const groupHeadingId = `${headingId}-${first.id}`;
        const label = count > 1
          ? t("scrubber.chooseBookmark", { count })
          : t("scrubber.goToBookmark", { title, location: locationLabel(bookmark) });
        const flag = (
          <Button
            appearance="subtle"
            className={styles.flag}
            style={{ left: `${(rtl ? 1 - group.fraction : group.fraction) * 100}%`, width: group.width }}
            aria-label={label}
            title={label}
            data-bookmark-marker=""
            data-group-id={first.id}
            data-bookmark-count={count}
            onFocus={() => {
              if (!group.markers.some(marker => marker.id === focusedBookmark.current)) {
                focusedBookmark.current = first.id;
              }
            }}
            onBlur={event => {
              if (event.relatedTarget instanceof Node &&
                !event.currentTarget.parentElement?.contains(event.relatedTarget) &&
                !openGroup) focusedBookmark.current = undefined;
            }}
            onClick={count === 1 ? () => onSelect(bookmark) : undefined}
          >
            <BookmarkFilled className={styles.icon} aria-hidden="true" />
            {count > 1 && <span className={styles.count} aria-hidden="true">{count > 99 ? "99+" : count}</span>}
          </Button>
        );
        if (count === 1) return <span key={first.id}>{flag}</span>;
        const firstLocation = locations?.[first.id]?.page;
        const lastLocation = locations?.[group.markers[count - 1]!.id]?.page;
        const range = firstLocation?.status === "known" && lastLocation?.status === "known"
          ? firstLocation.number === lastLocation.number
            ? t("annotations.bookmarkPage", { page: firstLocation.number })
            : t("scrubber.bookmarkRange", { first: firstLocation.number, last: lastLocation.number })
          : undefined;
        return (
          <Popover key={first.id} open={openGroup === first.id}
            positioning={{ position: "above", align: "center", offset: 6, overflowBoundary: document.body }}
            onOpenChange={(_, data) => {
              cancelHandoff();
              setOpenGroup(data.open ? first.id : undefined);
              setOpenMembers(data.open ? JSON.stringify(group.markers.map(marker => marker.id)) : undefined);
              onOpenChange(data.open);
            }}>
            <PopoverTrigger disableButtonEnhancement>{flag}</PopoverTrigger>
            <PopoverSurface className={styles.surface} role="dialog" aria-labelledby={groupHeadingId}
              onKeyDown={event => {
                if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeChooser();
                  focusBookmarkFlag(first.id);
                }
              }}>
              <h2 id={groupHeadingId} className={styles.title}>{label}</h2>
              {range && <p className={styles.range}>{range}</p>}
              <div className={styles.choices}>
                {group.markers.slice(0, MAX_CHOICES).map((marker, index) => {
                  const target = byId.get(marker.id)!;
                  const targetTitle = locations?.[target.id]?.chapterTitle ?? target.label;
                  const sharedPosition = group.markers.some(other =>
                    other.id !== marker.id && other.fraction === marker.fraction);
                  return (
                    <Button key={marker.id} className={styles.choice}
                      onClick={() => {
                        focusedBookmark.current = undefined;
                        closeChooser();
                        onSelect(target);
                      }}>
                      {targetTitle}
                      <span className={styles.location}>{locationLabel(target)}</span>
                      {sharedPosition && <span className={styles.location}>
                        {t("scrubber.bookmarkPosition", { index: index + 1 })}
                      </span>}
                    </Button>
                  );
                })}
              </div>
              {count > MAX_CHOICES && <Button className={styles.all}
                onClick={event => showAllAfterClose(event.currentTarget.closest<HTMLElement>('[role="dialog"]'))}>
                {t("scrubber.showAllBookmarks")}
              </Button>}
            </PopoverSurface>
          </Popover>
        );
      })}
    </div>
  );
}
