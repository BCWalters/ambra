import type { NavPoint } from "@ambra/engine";

export interface ChapterProgressMarker {
  readonly target: string;
  readonly label: string;
  readonly fraction: number;
}

export interface ReadingLandmarkMarker {
  readonly kind: "start" | "end";
  readonly fraction: number;
}

export interface ProgressMarkerData {
  readonly ready: boolean;
  readonly chapters: readonly ChapterProgressMarker[];
  readonly sections: readonly ChapterProgressMarker[];
  readonly landmarks: readonly ReadingLandmarkMarker[];
}

const MAX_CHAPTER_MARKERS = 100;

function linkedPoints(items: readonly NavPoint[]): NavPoint[] {
  return items.flatMap(item => [...(item.target ? [item] : []), ...linkedPoints(item.children)]);
}

function chapterPoints(items: readonly NavPoint[]): NavPoint[] {
  return items.flatMap(item => {
    const descendants = chapterPoints(item.children);
    return descendants.length ? descendants : item.target ? [item] : [];
  });
}

/** Missing/ambiguous destinations do not become invented chapter boundaries. */
export function resolveProgressMarkers(
  toc: readonly NavPoint[],
  landmarks: readonly NavPoint[],
  pages: ReadonlyMap<string, number>,
  totalPages: number | undefined,
): ProgressMarkerData {
  const empty = { ready: false, chapters: [], sections: [], landmarks: [] };
  if (!totalPages || !Number.isFinite(totalPages) || totalPages < 1) return empty;
  const fractionFor = (point: NavPoint): number | undefined => {
    const page = point.target ? pages.get(point.target) : undefined;
    return page !== undefined && Number.isFinite(page) && page >= 1 && page <= totalPages
      ? (page - 1) / totalPages : undefined;
  };
  function resolve(points: readonly NavPoint[]): ChapterProgressMarker[] {
    const seen = new Set<string>();
    const result: ChapterProgressMarker[] = [];
    for (const point of points) {
      if (!point.target || seen.has(point.target)) continue;
      seen.add(point.target);
      const fraction = fractionFor(point);
      if (fraction === undefined) return [];
      result.push({ target: point.target, label: point.label, fraction });
    }
    return result;
  }
  const linkedLandmarks = linkedPoints(landmarks);
  const uniqueBoundary = (type: string): number | undefined => {
    const points = linkedLandmarks.filter(point => point.epubTypes.includes(type));
    const values = points.map(fractionFor);
    if (!values.length || values.some(value => value === undefined)) return undefined;
    return new Set(values).size === 1 ? values[0] : undefined;
  };
  const start = uniqueBoundary("bodymatter");
  const end = uniqueBoundary("backmatter");
  const boundaries: ReadingLandmarkMarker[] = [];
  if (start !== undefined) boundaries.push({ kind: "start", fraction: start });
  // Back matter starts *after* the main text; it is evidence, not an explicit end marker.
  const readingEnd = end !== undefined && end > (start ?? 0) ? end : undefined;
  if (readingEnd !== undefined) boundaries.push({ kind: "end", fraction: readingEnd });
  const inReadingRange = (point: NavPoint): boolean => {
    const fraction = fractionFor(point);
    // Unresolved targets must still invalidate their candidate level.
    return fraction === undefined ||
      ((start === undefined || fraction >= start) && (readingEnd === undefined || fraction < readingEnd));
  };
  const readingChapters = chapterPoints(toc).filter(inReadingRange);
  let topLevel = toc;
  // Unwrap a single reading-work heading even when front/back matter are its siblings.
  while (true) {
    topLevel = topLevel.filter(item => chapterPoints([item]).some(inReadingRange));
    if (topLevel.length !== 1 || !topLevel[0]!.children.length) break;
    topLevel = topLevel[0]!.children;
  }
  const sectionPoints = topLevel.flatMap(item => {
    const point = item.target && inReadingRange(item) ? item : linkedPoints(item.children).find(inReadingRange);
    return point ? [point] : [];
  });
  return {
    ready: true,
    chapters: resolve(readingChapters),
    sections: resolve(sectionPoints),
    landmarks: boundaries,
  };
}

export interface ProgressMarkerSelection {
  readonly detail: "pending" | "chapters" | "sections" | "landmarks" | "none";
  readonly chapters: readonly ChapterProgressMarker[];
  readonly bandBoundaries: readonly number[];
  readonly landmarks: readonly ReadingLandmarkMarker[];
}

/** Assess the complete level, never a misleading every-Nth sample of chapters. */
export function selectProgressMarkers(
  data: ProgressMarkerData,
  width: number,
): ProgressMarkerSelection {
  if (!data.ready || width <= 0) return { detail: "pending", chapters: [], bandBoundaries: [], landmarks: [] };
  function usable(markers: readonly ChapterProgressMarker[]): boolean {
    if (!markers.length || markers.length > MAX_CHAPTER_MARKERS) return false;
    // Short chapters may overlap visually; only backwards navigation invalidates the level.
    return markers.every((marker, index) =>
      index === 0 || marker.fraction >= markers[index - 1]!.fraction,
    );
  }
  const chapters = usable(data.chapters) ? data.chapters
    : usable(data.sections) ? data.sections : [];
  const landmarks = data.landmarks.filter((marker, index) =>
    index === 0 || Math.abs(marker.fraction - data.landmarks[0]!.fraction) * width >= 14,
  );
  const detail = chapters.length
    ? chapters === data.chapters ? "chapters" : "sections"
    : landmarks.length ? "landmarks" : "none";
  // Reading landmarks take precedence when a nearby tick would obscure their shape.
  const visibleChapters = chapters.filter(chapter => landmarks.every(landmark =>
    Math.abs(landmark.fraction - chapter.fraction) * width >= 12,
  ));
  return { detail, chapters: visibleChapters, bandBoundaries: chapters.map(chapter => chapter.fraction), landmarks };
}
