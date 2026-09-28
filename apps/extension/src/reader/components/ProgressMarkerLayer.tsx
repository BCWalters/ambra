import { makeStyles } from "@fluentui/react-components";
import type { ProgressMarkerSelection } from "../ProgressMarkers.js";
import { useChromeTheme } from "../ChromeThemeContext.js";

const useStyles = makeStyles({
  mark: {
    backgroundColor: "var(--colorNeutralForeground1, #242424)",
    "@media (forced-colors: active)": {
      backgroundColor: "CanvasText",
      forcedColorAdjust: "none",
    },
  },
  bands: {
    "@media (forced-colors: active)": { display: "none" },
  },
  start: {
    backgroundColor: "var(--colorPaletteGreenForeground1, #107c10)",
    border: "1px solid white",
    "@media (forced-colors: active)": {
      backgroundColor: "Highlight",
      border: "1px solid Canvas",
      forcedColorAdjust: "none",
    },
  },
});

export function ProgressMarkerLayer({
  selection, rtl, currentFraction, trackTop, trackHeight,
}: {
  selection: ProgressMarkerSelection;
  rtl: boolean;
  currentFraction: number;
  trackTop: number;
  trackHeight: number;
}) {
  const classes = useStyles();
  const theme = useChromeTheme();
  const readingStart = selection.landmarks.find(marker => marker.kind === "start")?.fraction;
  const readingEnd = selection.landmarks.find(marker => marker.kind === "end")?.fraction;
  const left = (fraction: number) => `${(rtl ? 1 - fraction : fraction) * 100}%`;
  const boundaries = [...new Set([
    0, ...selection.bandBoundaries,
    ...(readingStart !== undefined ? [readingStart] : []),
    ...(readingEnd !== undefined ? [readingEnd] : []), 1,
  ])].sort((a, b) => a - b);
  return (
    <div data-progress-markers="" data-marker-detail={selection.detail} aria-hidden="true"
      style={{ pointerEvents: "none" }}>
      {(selection.bandBoundaries.length > 0 || readingStart !== undefined || readingEnd !== undefined) && (
        <div data-upcoming-track="" style={{
          position: "absolute", left: 0, right: 0, top: trackTop, height: trackHeight,
          borderRadius: trackHeight / 2, overflow: "hidden",
        }}>
          {boundaries.slice(0, -1).map((boundary, index) => {
            const start = Math.max(boundary, currentFraction);
            const end = boundaries[index + 1]!;
            const frontMatter = readingStart !== undefined && end <= readingStart;
            const backMatter = readingEnd !== undefined && boundary >= readingEnd;
            if (end <= start || (!selection.bandBoundaries.length && !frontMatter && !backMatter)) return null;
            return <div key={boundary} data-upcoming-band=""
              data-reading-start-band={frontMatter ? "" : undefined} data-reading-end-band={backMatter ? "" : undefined}
              className={classes.bands}
              style={{
                position: "absolute", left: left(rtl ? end : start), height: "100%",
                width: `${(end - start) * 100}%`, background: theme.accentForeground,
                opacity: frontMatter || backMatter ? 0.64 : index % 2 ? 0.38 : 0.16,
              }} />;
          })}
          {selection.chapters.filter(marker => marker.fraction >= currentFraction).map(marker => (
            <div key={marker.target} data-upcoming-boundary="" className={classes.mark}
              style={{
                position: "absolute", left: left(marker.fraction), height: "100%", width: 1,
                transform: "translateX(-50%)",
              }} />
          ))}
        </div>
      )}
      {selection.landmarks.filter(marker => marker.kind === "start").map(marker => (
        <div key={marker.kind} data-reading-landmark="start" data-fraction={marker.fraction}
          className={classes.start}
          style={{
            position: "absolute", left: left(marker.fraction), top: trackTop,
            width: 6, height: trackHeight, boxSizing: "border-box", borderRadius: 2,
            transform: "translateX(-50%)",
          }} />
      ))}
    </div>
  );
}
