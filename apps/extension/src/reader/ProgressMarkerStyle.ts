export type ProgressMarkerStyle = "off" | "upcoming";

export const DEFAULT_PROGRESS_MARKER_STYLE: ProgressMarkerStyle = "upcoming";

export function normalizeProgressMarkerStyle(value: unknown): ProgressMarkerStyle {
  return value === "off" ? "off" : DEFAULT_PROGRESS_MARKER_STYLE;
}
