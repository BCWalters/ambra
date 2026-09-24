import { describe, expect, it } from "vitest";
import { DiagnosticsLog, type DiagnosticSurface } from "./DiagnosticsLog.js";

describe("bounded local diagnostics", () => {
  it("retains 500 newest events and reports evictions without growing the export", () => {
    const log = new DiagnosticsLog();
    for (let index = 0; index < 1200; index++) log.record(`event-${index}`);
    const report = log.format({});
    expect(report).toContain("retained 500/500; dropped 700");
    expect(report).not.toContain("] event-699\n");
    expect(report).toContain("] event-700\n");
    expect(report).toContain("] event-1199");
    expect(report.split("\n").filter(line => line.includes("] event-"))).toHaveLength(500);
    expect(new DiagnosticsLog().format({})).toContain("retained 0/500; dropped 0");
  });

  it("bounds multiline messages and export context including hostile book metadata", () => {
    const log = new DiagnosticsLog();
    for (let index = 0; index < 600; index++) log.record("x\n".repeat(10000));
    const context = Object.fromEntries(Array.from({ length: 100 }, (_, i) =>
      [`${i}${"k".repeat(1000)}`, "v\n".repeat(10000)]));
    const report = log.format(context);
    expect(report.length).toBeLessThan(310000);
    expect(report).toContain("…");
    expect(report.match(/\] /g)).toHaveLength(500);
    expect(report).toContain("review before sharing");
    expect(report).toContain("No automatic upload");
  });

  it.each<DiagnosticSurface>([
    "toc", "annotations", "search", "details", "inspector", "settings", "typography",
    "help", "shortcuts", "narration", "image", "selection", "highlight", "footnote", "go-to",
  ])("records %s open/close and pin transitions only once", surface => {
    const log = new DiagnosticsLog();
    log.recordSurfaces({ [surface]: { open: false } });
    log.recordSurfaces({ [surface]: { open: true, pinned: false } });
    log.recordSurfaces({ [surface]: { open: true, pinned: false } });
    log.recordSurfaces({ [surface]: { open: true, pinned: true } });
    log.recordSurfaces({ [surface]: { open: false, pinned: true } });
    const report = log.format({});
    expect(report).toContain(`surface ${surface} opened`);
    expect(report).toContain(`surface ${surface} closed`);
    expect(report).toContain(`surface ${surface} pinned before=false after=true`);
    expect(report).toContain("retained 3/500");
  });

  it("formats typed settings and navigation intent without arbitrary payloads", () => {
    const log = new DiagnosticsLog();
    log.recordEvent({ kind: "setting", name: "pageTurnAnimationStyle",
      before: "slide", after: "scroll", source: "reader-control" });
    log.recordEvent({ kind: "navigation", source: "details", fraction: 0.5 });
    expect(log.format({})).toContain('setting requested name="pageTurnAnimationStyle" before="slide" after="scroll"');
    expect(log.format({})).toContain('navigation source="details" fraction=0.5');
  });

  it("includes Go-to mode on both lifecycle events and mode changes", () => {
    const log = new DiagnosticsLog();
    log.recordSurfaces({ "go-to": { open: true, mode: "page" } });
    log.recordSurfaces({ "go-to": { open: true, mode: "percentage" } });
    log.recordSurfaces({ "go-to": { open: false, mode: "percentage" } });
    expect(log.format({})).toContain("surface go-to opened mode=page");
    expect(log.format({})).toContain("surface go-to mode before=page after=percentage");
    expect(log.format({})).toContain("surface go-to closed mode=percentage");
  });
});
