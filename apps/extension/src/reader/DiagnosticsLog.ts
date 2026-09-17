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
  /** How many recent entries to keep — old entries are dropped as new
   * ones arrive (see `record`). Generous enough to cover a burst of
   * rapid interaction (several seeks, page turns, or resizes in quick
   * succession) without growing unbounded over a long reading session. */
  private static readonly MAX_ENTRIES = 100;

  private readonly entries: Array<{ readonly timestamp: number; readonly message: string }> = [];

  /** Appends one breadcrumb, trimming the oldest entry if the buffer is
   * already at capacity. `message` should be a short, single-line,
   * already-formatted string (e.g. via template literals at the call
   * site) — this class doesn't impose any particular schema, since the
   * entries are for a human to read, not for further programmatic
   * processing. */
  public record(message: string): void {
    this.entries.push({ timestamp: Date.now(), message });
    if (this.entries.length > DiagnosticsLog.MAX_ENTRIES) {
      this.entries.shift();
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
      ...Object.entries(context).map(([key, value]) => `${key}: ${value}`),
      "",
      "Recent events (oldest first):",
      ...this.entries.map(
        (entry) => `  [${new Date(entry.timestamp).toISOString()}] ${entry.message}`,
      ),
    ];
    return lines.join("\n");
  }
}
