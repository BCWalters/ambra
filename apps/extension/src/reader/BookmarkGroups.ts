import type { BookmarkProgressMarker } from "./BookmarkManager.js";

export const BOOKMARK_ROW_HEIGHT = 24;
export const BOOKMARK_FLAG_WIDTH = 24;
export const BOOKMARK_GROUP_WIDTH = 40;
const FLAG_GAP = 2;

export interface BookmarkGroup {
  readonly markers: readonly BookmarkProgressMarker[];
  readonly fraction: number;
  readonly width: number;
}

/** Group display collisions, never the saved bookmarks or their CFIs. */
export function groupBookmarkMarkers(
  markers: readonly BookmarkProgressMarker[],
  trackWidth: number,
): BookmarkGroup[] {
  if (trackWidth <= 0) return [];
  const groups: BookmarkProgressMarker[][] = [];
  const centre = (group: readonly BookmarkProgressMarker[]) =>
    (group[0]!.fraction + group[group.length - 1]!.fraction) / 2;
  const width = (group: readonly BookmarkProgressMarker[]) =>
    group.length > 1 ? BOOKMARK_GROUP_WIDTH : BOOKMARK_FLAG_WIDTH;
  for (const marker of [...markers].sort((a, b) => a.fraction - b.fraction)) {
    const previous = groups[groups.length - 1];
    if (
      previous &&
      (marker.fraction - previous[previous.length - 1]!.fraction) * trackWidth <
        BOOKMARK_FLAG_WIDTH + FLAG_GAP
    ) {
      previous.push(marker);
    } else {
      groups.push([marker]);
    }
    // Count badges can collide even when the original single flags did not.
    while (groups.length > 1) {
      const right = groups[groups.length - 1]!;
      const left = groups[groups.length - 2]!;
      if ((centre(right) - centre(left)) * trackWidth >= (width(left) + width(right)) / 2 + FLAG_GAP) {
        break;
      }
      for (const marker of right) left.push(marker);
      groups.pop();
    }
  }
  return groups.map(markers => ({ markers, fraction: centre(markers), width: width(markers) }));
}
