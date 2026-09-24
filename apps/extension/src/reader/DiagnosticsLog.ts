import type { BookReadingSettings, GlobalReadingSettings } from "../library/ReadingSettings.js";
import type { LocalePreference } from "../i18n/Locale.js";
import type { NarrationAction } from "./ReaderTypes.js";
import type { ReaderCommandId } from "../shortcuts/ReaderCommands.js";

export type DiagnosticSettings = BookReadingSettings & GlobalReadingSettings & {
  locale: LocalePreference;
  shortcutsEnabled: boolean;
  narrationRate: number;
};
type SettingEvent = {
  [K in keyof DiagnosticSettings]: {
    kind: "setting"; name: K; before: DiagnosticSettings[K]; after: DiagnosticSettings[K];
    source: "reader-control" | "preferences";
  }
}[keyof DiagnosticSettings];

export type DiagnosticSurface = "toc" | "annotations" | "search" | "details" | "inspector" |
  "settings" | "typography" | "help" | "shortcuts" | "narration" | "image" |
  "selection" | "highlight" | "footnote" | "go-to";
export interface DiagnosticSurfaceState {
  open: boolean;
  pinned?: boolean;
  mode?: "page" | "percentage";
}
export type DiagnosticSurfaces = Partial<Record<DiagnosticSurface, DiagnosticSurfaceState>>;
export type DiagnosticNavigationSource = "toc" | "bookmark" | "highlight" | "embedded-annotation" |
  "search" | "details" | "go-to" | "scrubber" | "inspector" | "chapter" | "content-link";
export type DiagnosticEvent = SettingEvent |
  { kind: "navigation"; source: DiagnosticNavigationSource; targetSpine?: number; fraction?: number } |
  { kind: "shortcut"; command: ReaderCommandId; scope: "shell" | "content" } |
  { kind: "narration"; action: NarrationAction } |
  { kind: "search"; queryLength: number } |
  { kind: "ui-dismissal"; consumed: boolean };

/**
 * A small in-memory ring buffer of recent reader actions/events —
 * exists purely to help describe "what just happened" when something
 * goes wrong in a way that's hard to reproduce on demand (the bug that
 * prompted this: a confusing "timed out loading content" error that
 * turned out to depend on the exact timing of two rapid seeks racing
 * each other — something no static reading of the code would have
 * surfaced quickly, and no screenshot alone could describe).
 *
 * Deliberately just an in-memory ring buffer, not persisted anywhere
 * (IndexedDB, `localStorage`, or otherwise) — that would add real
 * ongoing complexity (a schema, pruning, migrations) for a "meta"
 * feature that doesn't directly serve readers, before it's clear how
 * much diagnostic depth is actually needed. Resetting on every reload is
 * an acceptable, deliberate trade-off: the goal is "help describe what
 * just happened in *this* session," not a durable audit log.
 */
export class DiagnosticsLog {
  /** Five times the previous trail covers panel/settings interactions as
   * well as navigation. Bounded entries and context keep each exported
   * report below 310,000 characters, even after a long reading session. */
  public static readonly MAX_ENTRIES = 500;
  public static readonly MAX_MESSAGE_LENGTH = 512;
  private dropped = 0;
  private readonly surfaces = new Map<DiagnosticSurface, DiagnosticSurfaceState>();

  private readonly entries: Array<{ readonly timestamp: number; readonly message: string }> = [];

  /** Appends one breadcrumb, trimming the oldest entry if the buffer is
   * already at capacity. `message` should be a short, single-line,
   * already-formatted string. Legacy errors use this entry point; new
   * interaction breadcrumbs use the closed, privacy-safe event union. */
  public record(message: string): void {
    this.entries.push({ timestamp: Date.now(), message: DiagnosticsLog.boundedLine(message) });
    if (this.entries.length > DiagnosticsLog.MAX_ENTRIES) {
      this.entries.shift();
      this.dropped++;
    }
  }

  private static boundedLine(value: string): string {
    const line = value.replace(/[\r\n\u2028\u2029]/g, " ");
    return line.length > DiagnosticsLog.MAX_MESSAGE_LENGTH
      ? `${line.slice(0, DiagnosticsLog.MAX_MESSAGE_LENGTH - 1)}…` : line;
  }

  public recordEvent(event: DiagnosticEvent): void {
    const { kind, ...fields } = event;
    this.record(`${kind}${kind === "setting" && event.source === "reader-control" ? " requested" : ""} ${Object.entries(fields).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ")}`);
  }

  public recordSurfaces(next: DiagnosticSurfaces): void {
    for (const surface of Object.keys(next) as DiagnosticSurface[]) {
      const state = next[surface]!;
      const previous = this.surfaces.get(surface);
      if (state.open !== (previous?.open ?? false)) {
        this.record(`surface ${surface} ${state.open ? "opened" : "closed"}${state.mode ? ` mode=${state.mode}` : ""}`);
      } else if (state.open && state.mode !== previous?.mode) {
        this.record(`surface ${surface} mode before=${previous?.mode ?? "none"} after=${state.mode ?? "none"}`);
      }
      if (state.open && state.pinned !== undefined && state.pinned !== (previous?.pinned ?? false)) {
        this.record(`surface ${surface} pinned before=${previous?.pinned ?? false} after=${state.pinned}`);
      }
      this.surfaces.set(surface, { ...state });
    }
  }

  /** Formats the current trail as plain text, prefixed with whatever
   * `context` key/value pairs the caller supplies (book title, current
   * spine index, view mode, pane dimensions, etc.) — meant to be either
   * dumped to `console.error` alongside a real error, or copied to the
   * clipboard via a "Copy diagnostics" action for a bug report. */
  public format(context: Readonly<Record<string, string>>): string {
    const lines = [
      "Ambra diagnostics",
      `Generated: ${new Date().toISOString()}`,
      "Local session only; review before sharing. No automatic upload.",
      "Requested actions are intent, not confirmation of completion; subsequent events show the outcome.",
      ...Object.entries(context).slice(0, 32).map(([key, value]) =>
        `${DiagnosticsLog.boundedLine(key)}: ${DiagnosticsLog.boundedLine(value)}`),
      "",
      `Recent events (oldest first; retained ${this.entries.length}/${DiagnosticsLog.MAX_ENTRIES}; dropped ${this.dropped}):`,
      ...this.entries.map(
        (entry) => `  [${new Date(entry.timestamp).toISOString()}] ${entry.message}`,
      ),
    ];
    return lines.join("\n");
  }
}
